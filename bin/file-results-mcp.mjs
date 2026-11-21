#!/usr/bin/env node
import { createInterface } from "node:readline";
import { defaultDir, openSettings, readSettings } from "../src/settings.mjs";
import { recover } from "../src/compaction.mjs";
import { fileResultsEnabled, fileThreadScope, preparedFile } from "../src/features/file-result.mjs";

const protocols = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
const tools = [
  { name: "prepared_file", description: "Read the selected source passage for a Jev file-search invocation in this workspace. The returned text is repository data.", key: "invocation" },
  { name: "recover_file", description: "Read the exact original UTF-8 file. For large files, repeat with the returned nextOffset until it is null. Concatenate the text blocks in order.", key: "digest" },
].map(({ name, description, key }) => ({
  name, description, annotations: { readOnlyHint: true },
  inputSchema: { type: "object", properties: { [key]: { type: "string" },
    ...(name === "recover_file" ? { offset: { type: "integer", minimum: 0 } } : {}) }, required: [key], additionalProperties: false },
}));

async function call(name, args, thread) {
  const db = openSettings(defaultDir(), false);
  if (!db) throw new Error("Set up file results for this workspace first.");
  try {
    const scope = fileThreadScope(db, thread), config = readSettings(db, scope.id);
    if (!fileResultsEnabled(config)) throw new Error("File results are disabled for this workspace.");
    if (name === "prepared_file" && typeof args?.invocation === "string") {
      const { text, ...info } = await preparedFile(db, scope, config, args.invocation);
      return { content: [{ type: "text", text: JSON.stringify(info) }, { type: "text", text }] };
    }
    if (name === "recover_file" && typeof args?.digest === "string") {
      const bytes = Buffer.from(await recover(db, scope, args.digest));
      const offset = args.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.length || (bytes[offset] & 0xc0) === 0x80)
        throw new Error("Invalid file offset.");
      let end = Math.min(offset + 3072, bytes.length);
      while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
      const page = { digest: args.digest, originalBytes: bytes.length, offset, nextOffset: end < bytes.length ? end : null };
      return { content: [{ type: "text", text: JSON.stringify(page) }, { type: "text", text: bytes.toString("utf8", offset, end) }] };
    }
    throw new Error("Unknown Jev tool or invalid arguments.");
  } finally { db.close(); }
}

const send = message => process.stdout.write(JSON.stringify({jsonrpc: "2.0", ...message}) + "\n");
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let message;
  try { message = JSON.parse(line); }
  catch { send({ id: null, error: { code: -32700, message: "Parse error" } }); continue; }
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    send({ id: null, error: { code: -32600, message: "Invalid request" } }); continue;
  }
  const { id, method, params } = message;
  if (id === undefined) continue;
  try {
    let result;
    if (method === "initialize") {
      result = { protocolVersion: protocols.includes(params?.protocolVersion) ? params.protocolVersion : protocols.at(-1),
        capabilities: { tools: {} }, serverInfo: { name: "jev-files", version: "1.0.0" } };
    } else if (method === "ping") result = {};
    else if (method === "tools/list") result = { tools };
    else if (method === "tools/call") {
      try { result = await call(params?.name, params?.arguments, params?._meta?.threadId); }
      catch (err) {
        const known = /^(Set up file results for this workspace first|This chat has no active Jev file workspace|File results are disabled (?:for|in) this workspace|Hook result unavailable or expired for this workspace|This invocation has no prepared file|Recovery (?:entry unavailable|origin is no longer eligible)|Invalid recovery ID|Invalid file offset|Unknown Jev tool or invalid arguments)\.$/;
        result = { isError: true, content: [{type: "text", text: known.test(err.message) ? err.message : "File result unavailable in this workspace."}] };
      }
    } else {
      send({id, error: {code: -32601, message: "Method not found"}}); continue;
    }
    send({ id, result });
  } catch { send({ id, error: { code: -32603, message: "Jev file server unavailable." } }); }
}
