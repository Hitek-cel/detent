# Changelog

0.3.0 is the first version published to npm. Earlier versions existed only in
this repository.

## Unreleased

- **Renamed from Latch (`latch402`) to Detent (`detent402` on npm).** Another
  x402 project, the @latch402 readiness scanner for OKX.AI, used the name
  first; npm refuses a bare `detent` as too close to `dedent`. Install
  `detent402`; import from `"detent402"`, `"detent402/x402"` and
  `"detent402/conformance"`. Renamed exports: `latchX402` → `detentX402`,
  `X402Latch` → `X402Detent`, `X402LatchOptions` → `X402DetentOptions`,
  `LatchError` → `DetentError`, `isLatchError` → `isDetentError`. Error
  codes `latch_unavailable` and `latch_unsupported_payment` are now
  `detent_unavailable` and `detent_unsupported_payment`, and the token the 402
  carries is in a `detent` extension instead of `latch`. Database tables keep
  their `latch_` names, so existing journals and receipts work unchanged. The
  demo folder is now `.detent-demo/`, and the demo moves an old
  `.latch-demo/` across. The GitHub repository is now Hitek-cel/detent; old
  links redirect. Earlier entries keep the old name.
- **A `stuck` payment's retry is now answered `503 payment_unresolved`, not
  409** (with `detent.http()`). Recovery spec 0.9 splits the two "don't pay
  again yet" answers: `409 operation_in_flight` with `Retry-After` while the
  payment can still resolve, and `503` with no `Retry-After` once it is stuck
  (control 11). The body is unchanged and names the reason, so a client can
  tell it apart from a server-health 503. Payments still in flight keep 409.
- **A payment recovered from the chain now keeps its settlement transaction.**
  When the facilitator's reply was lost (a crash, a timeout), Detent learned
  from `authorizationState` that the payment landed but not which transaction
  did it, so the report showed "—" and the receipt had no `settlementRef`.
  `eip3009Oracle` now has `findTransaction`, which finds the
  `AuthorizationUsed` event within the payment's own time window, in chunks
  small enough for public RPCs (`logRangeBlocks`, default 200; `maxLogCalls`,
  default 30). A custom `SettlementOracle` may add its own `findTransaction`.
  Best effort: if it fails or finds nothing, the payment is delivered exactly as
  before, without the link. Payments recovered earlier are not rewritten.
- The x402 demo takes `--facilitator payai` to run against PayAI's public
  facilitator instead of x402.org (only those two are allowed).

## 0.5.0 — 2026-11-15

The first npm release since 0.3.2. It also carries the 0.4.0 and 0.4.1
changes below, which were never published on their own.


- **Added `latch.http(httpServer)`: a payment still in flight gets
  `409 operation_in_flight`, not a 402.** The proposed x402 recovery extension
  (x402-foundation/x402#3848, §5.1(6)–(7), control 9) says a copy that loses
  the claim, or a retry while a settle is unresolved, MUST NOT get a payment
  challenge: a 402 invites a second signature for one purchase. The SDK turns
  every hook refusal into a full 402, and hooks cannot choose the status, so
  `latch.http()` wraps the SDK's `x402HTTPResourceServer` and rewrites only the
  refusals Latch made as "in flight". It also covers the SDK's own
  settlement-failure 402 when the payment could still land. Pass the wrapped
  server to `paymentMiddlewareFromHTTPServer`. Every other answer is unchanged.
- **A `stuck` payment's retry is now refused as `payment_unresolved`** (409
  with `latch.http()`), not `payment_closed`: its outcome is unknown, so the
  purchase stays blocked and the caller is never invited to sign again.
- The demo uses `latch.http()`; steps 3 and 4 now show the 409.

## 0.4.1 — 2026-11-14 (not published; included in 0.5.0)

- **The report is now a dashboard.** Filters for time range, outcome and
  search scope the whole page; the payments table sorts, expands each payment
  into a step-by-step timeline, and exports to CSV; the activity chart splits
  delivered from not delivered and has a table view; new sections show what
  sold by route, top buyers and median time to deliver.
- **Light, dark and auto themes**, remembered between visits.
- **Added `journalReportData(sql)`**: the same data as plain objects, for
  anything else that wants to build on the journal. `journalReport` gains a
  `refreshSeconds` option for a page served live.

## 0.4.0 — 2026-11-14 (not published; included in 0.5.0)

- **Added `journalReport(sql)`**: a read-only HTML page built from a Postgres
  journal — headline numbers, where every payment ended, activity over time,
  recoveries, and each payment with its path and settlement link. The page is
  self-contained and loads nothing from the network.
- **`npm run report` / `npm run report:testnet`** open that page for the demo's
  payments. The demo now keeps its journal in `.latch-demo/` between runs and
  signs receipts with a fixed demo secret.

## 0.3.2 — 2026-11-14

- **Added `purchasePaymentId(...parts)`** in `latch402/x402`: a payment
  identifier derived from the purchase, for the buyer's side. The
  `payment-identifier` extension only stops a re-signed retry from being
  charged twice when the retry carries the same identifier; the stock client
  sends none, and generating a random one per call protects nothing. Reported
  by Selliksss after running the demo.
- **The demo has a new step:** a buyer told "failed" signs a new payment for
  the same order. The second signature is refused, and retrying the original
  finishes the purchase with one charge.
- The README states the identifier requirement plainly.

## 0.3.1 — 2026-11-13

No change to the library's behaviour. Documentation, tests and a demo.

- **Ran live on Base Sepolia** through the public x402 facilitator with test
  USDC. All five demo steps held, and the chain showed exactly three charges
  for three purchases. The README's status section now says what has and has
  not been run.
- **A runnable demo** in the repository: `npm run example` (offline, no keys)
  and `npm run example:testnet` (Base Sepolia). It is not part of the npm
  package.
- **Documented a limit:** while a settle is unresolved, a client that signs a
  new payment can be charged twice unless the route declares the
  `payment-identifier` extension. The quickstart now declares it, and two
  tests pin both cases.
- Tested against `@x402/core` 2.31.0 as well as 2.30.0.
- The author is credited in the README and the package metadata.

## 0.3.0 — 2026-11

Latch now works with the official x402 SDK instead of beside it.

### Added

- **`latch402/x402` — a bridge for the official SDK.** `latchX402(server, …)`
  registers lifecycle hooks on an `x402ResourceServer` and journals every
  payment on the `exact` scheme's default flow. Route handlers do not change.
  - One atomic claim per payment, keyed by (payer, nonce) as the chain keys it.
    Concurrent copies of a payment run the handler once.
  - The response is stored before the settle is requested, so a payment that
    lands always has something to deliver.
  - A failed or timed-out settle is checked against an oracle before anything
    is concluded. Money that moved is delivered; a payment that can still land
    waits; one that cannot is voided.
  - A retry of a settled payment gets the stored response back, authorised by a
    per-402 replay token carried in a `latch` extension. A new signature under
    the same `payment-identifier` is answered from the store and never settled.
  - `sweep()` and `recover()` finish or close payments whose process died.
    Recovery never initiates a charge.
- **`eip3009Oracle`** — asks the token contract `authorizationState(payer,
  nonce)` over JSON-RPC. No key, no dependency.
- **`postgresAuthorizedPaymentStorage`** — the SDK's `auth-capture`
  `AuthorizedPaymentStorage` interface on Postgres, so the record of escrow
  holds survives a restart.
- A JavaScript build with type declarations. The package now runs on Node 20+
  without a TypeScript loader.

### Changed

- `Latch.sweep()` skips invoices opened by the x402 bridge, so the two can
  share one journal.
- The package exports compiled files from `dist/`. Import paths are unchanged.

### Notes

- The strict gate (`quote` / `redeem`) is unchanged and still does not speak
  the x402 wire format. Use the bridge for x402.
- Nothing in this release has been run against a live facilitator. See
  "Status" and "Limits" in the README.

## 0.2.0 — 2026-10

- Batched settlement: wait by default, or serve now on bounded credit.
- Executable conformance kits for the `Journal` and `Facilitator` ports, and
  fixes for the six adapter bugs they found.

## 0.1.0 — 2026-08

- The strict gate, the in-memory and Postgres journals, signed hash-chained
  receipts, and crash injection at every journal write.
