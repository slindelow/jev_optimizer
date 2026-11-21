// Observe the native assertion at the requested call site during an authorized test run.
import strict from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (process.env.JEV_VERIFY_RECEIPTS && process.env.JEV_VERIFY_FILE) {
  const file = process.env.JEV_VERIFY_FILE;
  const targetLine = Number(process.env.JEV_VERIFY_LINE);
  const prefixes = [file, pathToFileURL(file).href];
  const method = process.env.JEV_VERIFY_METHOD;
  const original = strict[method];
  if (
    ["equal", "strictEqual", "deepEqual", "deepStrictEqual"].includes(method) &&
    typeof original === "function"
  ) {
    strict[method] = function observedAssertion(...args) {
      const marker = {};
      Error.captureStackTrace(marker, observedAssertion);
      const caller = String(marker.stack).split("\n")[1] ?? "";
      const target = prefixes.some((prefix) =>
        caller.includes(prefix + ":" + targetLine + ":"),
      );
      if (!target) return Reflect.apply(original, this, args);
      let outcome = "passed";
      try {
        return Reflect.apply(original, this, args);
      } catch (error) {
        outcome = error?.code === "ERR_ASSERTION" ? "failed" : "unknown";
        throw error;
      } finally {
        appendFileSync(
          process.env.JEV_VERIFY_RECEIPTS,
          JSON.stringify({ line: targetLine, method, outcome }) + "\n",
          { mode: 0o600 },
        );
      }
    };
  }
}
