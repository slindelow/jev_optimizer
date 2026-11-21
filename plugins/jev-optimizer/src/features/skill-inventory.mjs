import { constants } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const exec = promisify(execFile);
const segment = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const safeName = (name) => typeof name === "string" && name.length <= 129 &&
  name.split(/[:/]/).length <= 2 && name.split(/[:/]/).every(part => segment.test(part));
const byName = (a,b) => a.name.localeCompare(b.name, "en");
const inside = (base, target) => base === target || target.startsWith(base + path.sep);

// Read bounded metadata only. A skill body is executable guidance for its own
// host; neither the remote classifier nor prompt-hook output needs that body.
async function header(filename) {
  if (await realpath(filename) !== filename) return "";
  const stat = await lstat(filename);
  if (!stat.isFile()) return "";
  const fd = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await fd.stat();
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) return "";
    const bytes = Buffer.alloc(8192);
    const { bytesRead } = await fd.read(bytes, 0, bytes.length, 0);
    if (await realpath(filename) !== filename) return "";
    return bytes.toString("utf8", 0, bytesRead).replace(/\r\n/g, "\n");
  } finally {
    await fd.close();
  }
}

function metadata(body) {
  const front = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(body)?.[1];
  if (!front || /^disable-model-invocation:[ \t]*['"]?true['"]?[ \t]*(?:#.*)?$/mi.test(front) || /^paths:/m.test(front)) return null;
  const field = (key) => new RegExp("^" + key + ":\\s*([^\\n]+)", "m").exec(front)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  const id = field("name");
  let description = field("description") ?? "";
  if (/^[|>][-+]?$/.test(description)) {
    description = /^description:[^\n]*\n((?:[ \t]+[^\n]*(?:\n|$))+)/m.exec(front)?.[1]?.trim().replace(/\s+/g, " ") ?? "";
  }
  if (!safeName(id) || !description) return null;
  return { id, description: description.slice(0, 550) };
}

// skills/list resolves disabled skills, marketplace versions, symlinks and
// qualified names using Codex's own discovery rules. It makes no model turn.
async function codexSkills(repo, env, signal) {
  const child = spawn("codex", ["app-server"], { cwd: repo, env, signal, stdio: ["pipe","pipe","ignore"] });
  child.stdin.on("error", () => {});
  const send = (id, method, params) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", () => resolve(null));
    let buffer = "", bytes = 0;
    child.stdout.setEncoding("utf8").on("data", chunk => {
      if ((bytes += Buffer.byteLength(chunk)) > 4 * 1024 * 1024) { child.kill(); return; }
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0,end);
        buffer = buffer.slice(end+1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1 && message.result) {
          send(undefined, "initialized", {});
          send(2, "skills/list", { cwds: [repo] });
        } else if (message.id === 2 || message.error) {
          resolve(message.result?.data?.find(group => group.cwd === repo)?.skills ?? null);
          child.kill();
          return;
        }
      }
    });
    send(1, "initialize", { clientInfo: { name:"jev-optimizer", version:"1" }, capabilities:{experimentalApi:true} });
  });
}

async function allowsImplicit(skillDir) {
  const file = path.join(skillDir, "agents/openai.yaml");
  try { await lstat(file); }
  catch (error) { return error.code === "ENOENT"; }
  const text = await header(file).catch(() => "");
  return Boolean(text) && !/^\s*allow_implicit_invocation:[ \t]*['"]?false['"]?[ \t]*(?:#.*)?$/mi.test(text);
}

async function claudePlugins(repo, env, signal) {
  const { stdout } = await exec("claude", ["plugin", "list", "--json"], {cwd:repo, env, signal, maxBuffer:2*1024*1024});
  const plugins = JSON.parse(stdout);
  if (!Array.isArray(plugins)) return [];
  const sets = await Promise.all(plugins.filter(item => item.enabled && !item.errors?.length).slice(0,200).map(async item => {
    const namespace = item.id?.split("@")[0];
    if (!segment.test(namespace ?? "") || !path.isAbsolute(item.installPath ?? "")) return [];
    const base = await realpath(item.installPath).catch(() => null);
    if (!base) return [];
    const manifest = await header(path.join(base, ".claude-plugin/plugin.json")).catch(() => "");
    let custom;
    try { custom = JSON.parse(manifest).skills; } catch {}
    const dirs = [...new Set(["skills", ...(Array.isArray(custom) ? custom : typeof custom === "string" ? [custom] : [])])];
    return dirs.filter(dir => typeof dir === "string" && !path.isAbsolute(dir))
      .map(dir => ({ directory:path.resolve(base,dir), within:base, namespace, source:"plugin" }))
      .filter(spec => inside(base,spec.directory));
  }));
  return sets.flat();
}

async function fromDirectories(specs,host,signal) {
  const seen = new Map(), ambiguous = new Set();
  let examined = 0;
  for (const spec of specs) {
    signal?.throwIfAborted();
    const dir = await realpath(spec.directory).catch(() => null);
    if (!dir || !inside(spec.within,dir)) continue;
    const children = (await readdir(dir,{withFileTypes:true}).catch(() => [])).sort(byName);
    // A plugin may declare a directory for one skill or a collection.
    const single = spec.namespace && children.some(e => e.isFile() && e.name === "SKILL.md");
    const paths = single ? [dir] : children.filter(e => !e.name.startsWith(".") && (e.isDirectory() || e.isSymbolicLink())).map(e => path.join(dir,e.name));
    for (const candidate of paths) {
      if (++examined > 1500) break;
      signal?.throwIfAborted();
      const actual = await realpath(candidate).catch(() => null);
      if (!actual || !(spec.userLinks || inside(spec.within,actual))) continue;
      const meta = metadata(await header(path.join(actual,"SKILL.md")).catch(() => ""));
      if (!meta || (host === "codex" && !(await allowsImplicit(actual)))) continue;
      const id = spec.namespace ? spec.namespace + ":" + meta.id : meta.id;
      if (!safeName(id)) continue;
      if (seen.has(id) && seen.get(id).actual !== actual) ambiguous.add(id);
      seen.set(id, {actual, entry:{...meta,id,source:spec.source,available:null}});
    }
  }
  return [...seen].filter(([id]) => !ambiguous.has(id)).map(([,v]) => v.entry).slice(0,1000);
}

export async function skillInventory(root, host, env = process.env, signal) {
  const repo = await realpath(root);
  const home = await realpath(env.HOME || homedir());
  const sub = host === "codex" ? ".agents/skills" : ".claude/skills";
  const projectDir = path.join(repo,sub);
  const specs = [{directory:projectDir,within:projectDir,source:"workspace"}];
  if (env.JEV_OPTIMIZER_SKILL_SCOPE === "workspace") return fromDirectories(specs,host,signal);
  const userDir = host === "codex" ? path.join(home,sub) : path.join(env.CLAUDE_CONFIG_DIR || path.join(home,".claude"),"skills");
  specs.push({directory:userDir,within:userDir,userLinks:true,source:"user"});
  const budget = AbortSignal.timeout(2000);
  const deadline = signal ? AbortSignal.any([signal,budget]) : budget;
  if (host === "codex") {
    const catalog = await codexSkills(repo,env,deadline).catch(() => null);
    if (Array.isArray(catalog)) {
      const entries = await Promise.all(catalog.filter(s => s.enabled === true && safeName(s.name) && typeof s.description === "string").slice(0,1500).map(async s => {
        if (typeof s.path === "string" && path.isAbsolute(s.path) && !(await allowsImplicit(path.dirname(s.path)))) return null;
        return {id:s.name,description:s.description.slice(0,550),source:s.pluginId ? "plugin" : s.scope,available:true};
      }));
      return entries.filter(Boolean).slice(0,1000);
    }
  } else {
    specs.push(...await claudePlugins(repo,env,deadline).catch(() => []));
  }
  return fromDirectories(specs,host,signal);
}
