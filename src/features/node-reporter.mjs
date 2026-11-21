// This reporter runs in the supervising Node test runner. Test stdout is never parsed as a receipt.
import path from "node:path";
export default async function* report(events) {
  const file = path.resolve(process.env.JEV_VERIFY_FILE);
  for await (const { type, data } of events) {
    if (type === "test:pass" || type === "test:fail") {
      if (!data.file || path.resolve(data.file) !== file) continue;
      const record = {
        type,
        name: data.name,
        line: data.line,
        skip: Boolean(data.skip || data.todo),
      };
      yield JSON.stringify(record) + "\n";
    }
  }
}
