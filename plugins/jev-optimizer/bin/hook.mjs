#!/usr/bin/env node
import { defaultDir, workspace, openSettings, readSettings } from "../src/settings.mjs";
import { promptFeatures, hookContext } from "../src/prompt-context.mjs";
import { runFeature } from "../src/app.mjs";
import { prepareFileResult, fileResultsEnabled, bindFileThread } from "../src/features/file-result.mjs";

async function submit() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    if ((bytes += chunk.length) > 100_000) return;
    chunks.push(chunk);
  }
  const event = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (event.hook_event_name !== "UserPromptSubmit" || typeof event.prompt !== "string") return;
  const dir = defaultDir();
  const db = openSettings(dir, false);
  if (!db) return;
  try {
    const scope = workspace(event.cwd || process.cwd());
    const config = readSettings(db, scope.id);
    const host = process.env.PLUGIN_ROOT || process.env.CODEX_PLUGIN_ROOT || (!process.env.CLAUDE_PLUGIN_ROOT && process.env.CODEX_HOME) ? "codex" : "claude";
    const includeFile = host === "codex" && bindFileThread(db, event.session_id, scope, fileResultsEnabled(config));
    if (!config.auto.length && !config.legacyExplicit?.length) return;
    const signal = AbortSignal.timeout(6000);
    const jobs = await promptFeatures({ prompt: event.prompt, config, scope, host, signal });
    if (!jobs.length) return;
    db.prepare("INSERT OR REPLACE INTO hooks VALUES (?,?,?)").run(scope.id, host, Date.now());
    const blocks = await Promise.all(jobs.map(async ({ feature, input }) => {
      try {
        const out = await runFeature({ feature, input, scope, config, db, dir, signal });
        if (includeFile && feature === "search") {
          try {
            const fileResult = await prepareFileResult({ ref: out.result.results[0], task: event.prompt,
              scope, config, db, dir, signal });
            if (fileResult) out.result.fileResult = fileResult;
          } catch {
            // A stale or inaccessible source still permits returning the ranked paths.
          }
        }
        const encoded = JSON.stringify(out);
        if (Buffer.byteLength(encoded) <= 131072) {
          db.prepare("INSERT INTO hook_results VALUES (?,?,?,?)").run(out.id, scope.id, Date.now() + 300000, encoded);
        } else delete out.result.fileResult;
        return hookContext(out);
      } catch {
        return null;
      }
    }));
    db.prepare("DELETE FROM hook_results WHERE id IN (SELECT id FROM hook_results WHERE workspace=? ORDER BY expires DESC LIMIT -1 OFFSET 8)").run(scope.id);
    const additionalContext = blocks.filter(Boolean).join("\n");
    if (additionalContext)
      console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } }));
  } finally {
    db.close();
  }
}
submit().catch(() => process.stderr.write("Jev Optimizer hook unavailable; continuing with the host.\n"));
