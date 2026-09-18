#!/usr/bin/env node
// Reads VSCE_PAT from .env (gitignored) and runs `vsce publish` with it, so the token never needs to be typed into a shell or exported by hand. No dependency on dotenv.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envPath = path.join(root, ".env");

if (!existsSync(envPath)) {
  console.error(`Missing ${envPath}. Copy .env.example to .env and fill in VSCE_PAT.`);
  process.exit(1);
}

const env = { ...process.env };
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const match = /^\s*([\w.-]+)\s*=\s*(.*)\s*$/.exec(line);
  if (!match) {
    continue;
  }
  const [, key, rawValue] = match;
  const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");
  env[key] = value;
}

if (!env.VSCE_PAT) {
  console.error("VSCE_PAT is not set in .env");
  process.exit(1);
}

const extensionDir = path.join(root, "packages", "vscode-extension");

// vsce only packages files inside the extension's own directory, so the shared icon/README/
// CHANGELOG at the repo root have to be copied in here before publishing too, same as `npm run package`.
const prepack = spawnSync("node", ["scripts/prepack.mjs"], {
  cwd: extensionDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if ((prepack.status ?? 1) !== 0) {
  process.exit(prepack.status ?? 1);
}

// --no-dependencies: esbuild already bundles every runtime dependency (including @plv/core) into
// dist/extension.js, and without this flag vsce tries to walk node_modules itself — which, now
// that installs are hoisted to the workspace root, pulls in the whole monorepo instead of just
// this package's deps.
const args = ["--no-dependencies", ...process.argv.slice(2)];
const result = spawnSync("npx", ["vsce", "publish", ...args], {
  cwd: extensionDir,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
