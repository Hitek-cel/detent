// Regenerate conformance/x402-recovery-control12.json from the test suite.
// The same test checks the file on every normal run; this run rewrites it.
import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["--test", "--test-name-pattern=x402 recovery control 12", "test/x402.test.ts"],
  { stdio: "inherit", env: { ...process.env, DETENT_WRITE_VECTORS: "1" } },
);
process.exit(result.status ?? 1);
