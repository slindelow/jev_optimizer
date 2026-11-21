import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export const limits = Object.freeze({
  paths: 8000,
  files: 500,
  fileBytes: 256 * 1024,
  totalBytes: 8 * 1024 * 1024,
  pathsMs: 3000,
  candidates: 24,
});
const deniedDir =
  /^(?:node_modules|vendor|dist|out|build|coverage|target|__pycache__|venv|secrets?|credentials?)$/i;
const deniedName =
  /(?:^\.|\.min\.(?:css|js)$|\.map$|(?:^|[._-])(?:secret|credential|password|token)s?(?:[._-]|$)|\.(?:pem|key|p12|pfx|jks|keystore|env|der|sqlite|db|tfstate|tfvars)$|^(?:id_(?:rsa|dsa|ecdsa|ed25519)|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$)/i;
export const secretLike = (text) =>
  /-----BEGIN [^\n]*PRIVATE KEY-----|(?:jv_(?:live|test)_|vck_|vcp_|gh[pousr]_|github_pat_|sk-(?:proj-|or-v1-)?|AKIA|ASIA)[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{12,}|(?:bearer\s+[A-Za-z0-9_.-]{12,})|(?:api[_-]?key|access[_-]?token|password|secret[_-]?key|client[_-]?secret)\s*["']?\s*[:=]\s*["'][^"'\n]{4,}/i.test(
    text,
  );

function allowed(rel) {
  const segments = rel.split("/");
  return (
    !path.isAbsolute(rel) &&
    !/[\x00-\x1f\x7f]/.test(rel) &&
    segments.every((s) => s && !s.startsWith(".") && !deniedDir.test(s)) &&
    !deniedName.test(segments.at(-1))
  );
}
export function boundedQuery(text) {
  if (typeof text !== "string" || !text.trim() || text.length > 4096)
    throw new TypeError("Expected 1–4096 characters of query text");
  return text.trim();
}
export async function inventory(root, { pathPrefix, extensions, signal } = {}) {
  signal?.throwIfAborted();
  const base = await realpath(root);
  let prefix = "";
  if (pathPrefix) {
    if (
      typeof pathPrefix !== "string" ||
      path.isAbsolute(pathPrefix) ||
      pathPrefix.split(/[\\/]/).includes("..")
    )
      throw new TypeError("Expected a workspace-relative path filter");
    prefix = pathPrefix.replace(/^\.\//, "").replace(/\/$/, "");
  }
  if (
    extensions &&
    (!Array.isArray(extensions) ||
      extensions.some((e) => typeof e !== "string"))
  )
    throw new TypeError("Expected an array of extensions");
  const ext =
    extensions &&
    new Set(extensions.map((e) => "." + e.replace(/^\./, "").toLowerCase()));
  const scope = { listed: 0, scanned: 0, bytes: 0, omitted: 0, limits: [] };
  const paths = [];
  // NUL-delimited rg discovery applies nested ignore rules to untracked and tracked working files.
  const args = [
    "--no-config",
    "--no-require-git",
    "--files",
    "--null",
    "--sort",
    "path",
    "--no-follow",
  ];
  for (const glob of [
    "node_modules",
    "vendor",
    "dist",
    "out",
    "build",
    "coverage",
    "target",
    "venv",
    "__pycache__",
  ])
    args.push("--glob", "!**/" + glob + "/**");
  signal?.throwIfAborted();
  const proc = spawn("rg", args, {
    cwd: base,
    shell: false,
    stdio: ["ignore", "pipe", "ignore"],
    signal,
  });
  let carry = Buffer.alloc(0);
  let stop = false;
  const halt = (reason) => {
    if (!stop) {
      stop = true;
      scope.limits.push(reason);
      proc.kill();
    }
  };
  const timer = setTimeout(
    () => halt("path-discovery-time-limit"),
    limits.pathsMs,
  );
  try {
    await new Promise((resolve, reject) => {
      proc.on("error", () =>
        reject(
          signal?.aborted
            ? signal.reason
            : new Error("File discovery requires ripgrep (rg) on PATH"),
        ),
      );
      proc.stdout.on("data", (chunk) => {
        if (stop) return;
        const data = Buffer.concat([carry, chunk]);
        let begin = 0;
        for (
          let end = data.indexOf(0);
          end !== -1;
          end = data.indexOf(0, begin)
        ) {
          const filename = data.subarray(begin, end).toString("utf8");
          begin = end + 1;
          if (++scope.listed > limits.paths) {
            halt("path-count-limit");
            break;
          }
          if (
            allowed(filename) &&
            (!prefix ||
              filename === prefix ||
              filename.startsWith(prefix + "/")) &&
            (!ext || ext.has(path.extname(filename).toLowerCase()))
          )
            paths.push(filename);
        }
        carry = data.subarray(begin);
        if (carry.length > 16384) halt("invalid-or-overlong-path");
      });
      proc.on("close", (code) => {
        if (code !== 0 && code !== 1 && !stop)
          scope.limits.push("partial-file-discovery");
        resolve();
      });
    });
  } finally {
    clearTimeout(timer);
  }
  signal?.throwIfAborted();
  return { base, paths, scope };
}
export async function readDocument(
  base,
  relative,
  scope,
  recheck = false,
  signal,
) {
  signal?.throwIfAborted();
  if (!allowed(relative)) return null;
  if (
    !recheck &&
    (scope.scanned >= limits.files || scope.bytes >= limits.totalBytes)
  ) {
    if (!scope.limits.includes("scan-budget")) scope.limits.push("scan-budget");
    return null;
  }
  const absolute = path.join(base, relative);
  let handle;
  try {
    if (
      (await realpath(absolute)) !== absolute ||
      !(await lstat(absolute)).isFile()
    )
      return null;
    handle = await open(
      absolute,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW || 0) |
        (constants.O_NONBLOCK || 0),
    );
    const st = await handle.stat();
    const current = await lstat(absolute);
    if (
      !st.isFile() ||
      st.dev !== current.dev ||
      st.ino !== current.ino ||
      (await realpath(absolute)) !== absolute
    )
      return null;
    if (
      st.size > limits.fileBytes ||
      (!recheck && st.size + scope.bytes > limits.totalBytes)
    ) {
      scope.omitted++;
      return null;
    }
    const data = Buffer.alloc(st.size + 1);
    let count = 0;
    while (count < data.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(
        data,
        count,
        data.length - count,
        count,
      );
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (!recheck) {
      scope.scanned++;
      scope.bytes += count;
    }
    const endStat = await handle.stat();
    if (
      count !== st.size ||
      endStat.mtimeMs !== st.mtimeMs ||
      (await realpath(absolute)) !== absolute
    )
      return null;
    const bytes = data.subarray(0, count);
    if (bytes.includes(0)) return null;
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    if (secretLike(text)) {
      scope.omitted++;
      return null;
    }
    return {
      path: relative,
      digest: createHash("sha256").update(bytes).digest("hex"),
      lines: text.split("\n"),
    };
  } catch {
    signal?.throwIfAborted();
    scope.omitted++;
    return null;
  } finally {
    if (handle) await handle.close();
  }
}

export function evidence(doc, start, end = start) {
  return {
    path: doc.path,
    startLine: start + 1,
    endLine: end + 1,
    digest: doc.digest,
    excerpt: doc.lines.slice(start, end + 1).join("\n"),
  };
}
