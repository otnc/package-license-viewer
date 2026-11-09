#!/usr/bin/env node
import "../../lsp-server/src/installVscodeShim";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  CancellationTokenSource,
  LicenseCache,
  createProviders,
  findProvider,
  getConfig,
  runWithConcurrency,
} from "@plv/core";
import { nodeProviderHost } from "../../lsp-server/src/nodeHost";
import { toTextDocumentLike } from "../../lsp-server/src/textDocument";
import { setSettingsSource } from "../../lsp-server/src/vscodeShim";
import { openCacheState } from "./cache";

const usage = `Usage: plv [options] <manifest>

  --format <text|json>      Output format (default: text)
  --stdin                  Read manifest contents from stdin
  --ignore-unsupported     Treat unsupported manifests as empty results
  --allow <license>        Allow a license expression (repeatable)
  --deny <license>         Deny a license expression (repeatable)
  --cache-ttl-hours <n>    Cache lifetime in hours (0 disables caching)
  -h, --help               Show usage`;

const readStdin = async () => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const run = async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      format: { type: "string", default: "text" },
      stdin: { type: "boolean" },
      "ignore-unsupported": { type: "boolean" },
      allow: { type: "string", multiple: true, default: [] },
      deny: { type: "string", multiple: true, default: [] },
      "cache-ttl-hours": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(usage);
    return 0;
  }
  if (positionals.length !== 1 || !positionals[0]) {
    throw new Error("Expected one manifest path. See --help.");
  }
  if (values.format !== "text" && values.format !== "json") {
    throw new Error("--format must be text or json.");
  }
  const cacheTtl = values["cache-ttl-hours"];
  if (cacheTtl !== undefined) {
    const hours = Number(cacheTtl);
    if (!cacheTtl.trim() || !Number.isFinite(hours) || hours < 0) {
      throw new Error("--cache-ttl-hours must be a non-negative number.");
    }
    setSettingsSource(() => ({ "packageLicenseViewer.cacheTtlHours": hours }));
  }

  const allowed = new Set(values.allow.map((license) => license.trim()));
  const denied = new Set(values.deny.map((license) => license.trim()));
  if (allowed.has("") || denied.has("")) {
    throw new Error("License expressions must be non-empty.");
  }
  const lint = allowed.size > 0 || denied.size > 0;
  const path = resolve(positionals[0]);
  const uri = pathToFileURL(path).href;
  const config = getConfig();
  const cache = new LicenseCache(
    config.cacheTtlHours > 0
      ? await openCacheState(path)
      : {
          get: (_key, fallback) => fallback,
          keys: () => [],
          update: async () => {},
        }
  );
  const cancellation = new CancellationTokenSource();

  try {
    const providers = createProviders(cache, nodeProviderHost);
    const manifest = toTextDocumentLike(TextDocument.create(uri, "", 0, ""));
    const provider = findProvider(providers, manifest);
    if (!provider) {
      if (!values["ignore-unsupported"]) throw new Error(`Unsupported manifest: ${path}`);
      if (values.format === "json") console.log("[]");
      return 0;
    }
    const input = values.stdin ? await readStdin() : await readFile(path, "utf8");
    const document = toTextDocumentLike(TextDocument.create(uri, "", 0, input));
    const entries = provider.parse(document);
    const results = new Array<Awaited<ReturnType<typeof provider.resolve>>>(entries.length);
    const failures: unknown[] = [];
    await runWithConcurrency(
      entries.map((entry, index) => async () => {
        try {
          results[index] = await provider.resolve(entry, document, cancellation.token);
        } catch (error) {
          failures.push(error);
        }
      }),
      config.maxConcurrentRequests
    );
    if (failures.length) {
      throw new AggregateError(failures, failures.map(String).join("\n"));
    }

    const diagnostics = entries.flatMap((entry, index) => {
      const info = results[index];
      if (info.source === "skipped") return [];
      const license = info.license?.trim();
      const problem = license
        ? denied.has(license)
          ? `license ${license} is denied`
          : allowed.size > 0 && !allowed.has(license)
            ? `license ${license} is outside the allowlist`
            : undefined
        : "license could not be determined";
      if (lint && !problem) return [];
      const severity = lint ? "warning" : "info";
      const message = `${entry.name}: ${lint ? problem : license || "license unknown"}`.replace(
        /[\r\n]+/g,
        " "
      );
      return [{ ...entry, ...info, path, line: entry.line + 1, column: 1, severity, message }];
    });
    if (values.format === "json") {
      console.log(JSON.stringify(diagnostics, null, 2));
    } else {
      for (const { path, line, column, severity, message } of diagnostics) {
        console.log(`${path}:${line}:${column}: ${severity}: ${message}`);
      }
    }
    return lint && diagnostics.length > 0 ? 1 : 0;
  } finally {
    cancellation.dispose();
    await cache.flush();
    cache.dispose();
  }
};

run().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error: Error) => {
    console.error(`plv: ${error.message}`);
    process.exitCode = 2;
  }
);
