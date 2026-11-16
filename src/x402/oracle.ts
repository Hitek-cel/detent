import type { SettlementOracle, SettlementProbe } from "./types.ts";

/** `authorizationState(address,bytes32)` — the EIP-3009 view that says whether a nonce was used. */
const AUTHORIZATION_STATE = "0xe94a0102";
/** `AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)` — emitted when it is. */
const AUTHORIZATION_USED = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const HEX = /^0x[0-9a-fA-F]+$/;

/**
 * A settlement oracle for EIP-3009 payments (x402 `exact` on EVM, the USDC
 * default), answered by the token contract itself.
 *
 * A facilitator's settle response can be lost, time out, or simply be wrong.
 * The token contract cannot: `authorizationState(payer, nonce)` is true exactly
 * when that signed authorization has moved money. One read-only `eth_call`, no
 * key, no dependency.
 *
 * For a payment it calls settled, `findTransaction` looks up the transaction
 * that used the authorization (its `AuthorizationUsed` event), so a payment
 * recovered after a crash still gets a settlement reference. That lookup is
 * best effort: it searches only the payment's own time window, in chunks of
 * `logRangeBlocks` (public RPCs cap `eth_getLogs` ranges; Base's allows 200),
 * gives up after `maxLogCalls`, and never changes the answer.
 *
 * `rpcUrls` maps a CAIP-2 network to a JSON-RPC endpoint, e.g.
 * `{ "eip155:8453": "https://mainnet.base.org" }`. Use an endpoint you trust:
 * a lying node is a lying oracle.
 */
export function eip3009Oracle(config: {
  rpcUrls: Readonly<Record<string, string>>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  logRangeBlocks?: number;
  maxLogCalls?: number;
}): SettlementOracle {
  const doFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? 5_000;
  const logRange = Math.max(1, Math.floor(config.logRangeBlocks ?? 200));
  const maxLogCalls = Math.max(1, Math.floor(config.maxLogCalls ?? 30));

  function check(probe: SettlementProbe): string {
    if (probe.method !== "eip3009") {
      throw new Error(`eip3009Oracle cannot answer for transfer method "${probe.method}"`);
    }
    const url = config.rpcUrls[probe.network];
    if (!url) throw new Error(`eip3009Oracle has no RPC URL for network "${probe.network}"`);
    if (!ADDRESS.test(probe.asset)) throw new Error("eip3009Oracle: asset is not an EVM address");
    if (!ADDRESS.test(probe.payer)) throw new Error("eip3009Oracle: payer is not an EVM address");
    if (!BYTES32.test(probe.nonce)) throw new Error("eip3009Oracle: nonce is not 32 bytes");
    return url;
  }

  async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`eip3009Oracle: RPC answered HTTP ${res.status}`);
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(`eip3009Oracle: RPC error: ${body.error.message ?? "unknown"}`);
    return body.result;
  }

  const word = (hex: string) => "0x" + hex.slice(2).toLowerCase().padStart(64, "0");

  const oracle = (async (probe) => {
    const url = check(probe);
    const data = AUTHORIZATION_STATE + word(probe.payer).slice(2) + probe.nonce.slice(2).toLowerCase();
    const result = await rpc(url, "eth_call", [{ to: probe.asset, data }, "latest"]);
    // Anything but one clean 32-byte word is not an answer. An empty "0x" is
    // what a call to a non-contract returns, and must never read as "unused".
    if (typeof result !== "string" || !BYTES32.test(result)) {
      throw new Error("eip3009Oracle: RPC returned a malformed result");
    }
    return BigInt(result) !== 0n ? "settled" : "unsettled";
  }) as SettlementOracle;

  oracle.findTransaction = async (probe) => {
    const url = check(probe);
    const block = async (tag: string) => {
      const b = (await rpc(url, "eth_getBlockByNumber", [tag, false])) as { number?: unknown; timestamp?: unknown } | null;
      if (!b || typeof b.number !== "string" || typeof b.timestamp !== "string" || !HEX.test(b.number) || !HEX.test(b.timestamp)) {
        throw new Error("eip3009Oracle: malformed block");
      }
      return { n: Number(BigInt(b.number)), t: Number(BigInt(b.timestamp)) };
    };

    // Map the payment's time window to blocks, from the chain's own recent pace.
    const head = await block("latest");
    const back = Math.min(1_000, head.n);
    const past = back > 0 ? await block("0x" + (head.n - back).toString(16)) : head;
    const secondsPerBlock = back > 0 && head.t > past.t ? (head.t - past.t) / back : 2;
    const endS = Math.min(probe.expiresAt / 1000, head.t);
    // A start after the end (a bad openedAt) would search nothing: clamp it.
    const startS = Math.min(endS, (probe.openedAt ?? probe.expiresAt - 3_600_000) / 1000);
    const span = Math.max(0, (endS - startS) / secondsPerBlock);
    const pad = Math.ceil(20 + span * 0.1);
    const to = Math.min(head.n, head.n - Math.floor((head.t - endS) / secondsPerBlock) + pad);
    const from = Math.max(0, head.n - Math.ceil((head.t - startS) / secondsPerBlock) - pad);
    if (to < from || Math.ceil((to - from + 1) / logRange) > maxLogCalls) return null;

    const topics = [AUTHORIZATION_USED, word(probe.payer), probe.nonce.toLowerCase()];
    for (let lo = from; lo <= to; lo += logRange) {
      const hi = Math.min(to, lo + logRange - 1);
      const logs = await rpc(url, "eth_getLogs", [
        { address: probe.asset, topics, fromBlock: "0x" + lo.toString(16), toBlock: "0x" + hi.toString(16) },
      ]);
      if (!Array.isArray(logs)) throw new Error("eip3009Oracle: malformed logs");
      for (const log of logs as { transactionHash?: unknown; topics?: unknown; removed?: unknown }[]) {
        const t = Array.isArray(log.topics) ? log.topics.map((x) => String(x).toLowerCase()) : [];
        if (log.removed === true || t[0] !== AUTHORIZATION_USED || t[1] !== topics[1] || t[2] !== topics[2]) continue;
        if (typeof log.transactionHash === "string" && BYTES32.test(log.transactionHash)) return log.transactionHash;
      }
    }
    return null;
  };

  return oracle;
}
