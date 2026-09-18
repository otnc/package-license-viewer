import "./installVscodeShim";

import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LicenseCache } from "../cache";
import { getConfig, invalidateConfigCache } from "../config";
import { buildHover, formatAnnotationSegments } from "../format";
import { initLog, log } from "../log";
import { CancellationTokenSource } from "../providers/cancellation";
import {
  createProviders,
  findProvider,
  type CancellationLike,
  type DependencyEntry,
  type LicenseInfo,
} from "../providers";
import { nodeProviderHost } from "./nodeHost";
import { setSettingsSource } from "./vscodeShim";
import { toTextDocumentLike } from "./textDocument";

initLog();

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// The client sends its settings as a nested object matching packageLicenseViewer's own shape (e.g. { enabled: true, npm: { registry: "..." } }), flattened here into the "packageLicenseViewer.<key>" strings vscodeShim's workspace.getConfiguration() expects — the same shape a real vscode.WorkspaceConfiguration would be read through.
let clientSettings: Record<string, unknown> = {};
setSettingsSource(() => clientSettings);

function flattenSettings(prefix: string, value: unknown, out: Record<string, unknown>): void {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flattenSettings(`${prefix}.${key}`, child, out);
    }
  } else {
    out[prefix] = value;
  }
}

/** Applies a fresh settings object from the client, replacing whatever was there before. */
function applySettings(nested: unknown): void {
  const flattened: Record<string, unknown> = {};
  flattenSettings("packageLicenseViewer", nested ?? {}, flattened);
  clientSettings = flattened;
  invalidateConfigCache();
}

const memory = new Map<string, unknown>();
const cache = new LicenseCache({
  get: <T>(key: string, fallback?: T) => (memory.has(key) ? (memory.get(key) as T) : fallback),
  update: async (key: string, value: unknown) => {
    memory.set(key, value);
  },
  keys: () => [...memory.keys()],
});

const providers = createProviders(cache, nodeProviderHost);

connection.onInitialize((params) => {
  const options = params.initializationOptions as { settings?: unknown } | undefined;
  if (options?.settings) {
    applySettings(options.settings);
  }
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      hoverProvider: true,
    },
  };
});

connection.onInitialized(() => {
  log.info("Package License Viewer language server initialized");
});

// Neovim's vim.lsp.start({ settings = ... }) sends this automatically on attach and again on every change; the VimScript client sends it whenever the user updates g:package_license_viewer_settings. Either way, every already-open document is worth re-resolving since a changed setting (npm.registry, format, …) can change every annotation.
connection.onDidChangeConfiguration((params) => {
  applySettings(params.settings);
  for (const document of documents.all()) {
    void publishAnnotations(document);
  }
});

connection.onExit(() => {
  cache.dispose();
});

interface AnnotationEntry {
  readonly line: number;
  readonly name: string;
  readonly segments: { before: string; license: string; after: string } | undefined;
}

async function resolveEntry(
  provider: ReturnType<typeof createProviders>[number],
  entry: DependencyEntry,
  doc: ReturnType<typeof toTextDocumentLike>,
  token: CancellationLike
): Promise<LicenseInfo> {
  try {
    return await provider.resolve(entry, doc, token);
  } catch (error) {
    return { source: "unknown", detail: String(error) };
  }
}

// One in-flight resolution per document at a time. A later edit cancels whatever the previous
// one was still waiting on (aborting its still-pending network requests too, since
// resolveEntry's token reaches all the way into fetchJson's AbortController) and its result is
// dropped even if it manages to finish anyway — otherwise a slow, now-stale resolution could
// still win the race and overwrite the newer, correct annotations with old ones.
const inflightByUri = new Map<string, CancellationTokenSource>();

function startResolution(uri: string): CancellationTokenSource {
  inflightByUri.get(uri)?.cancel();
  const cts = new CancellationTokenSource();
  inflightByUri.set(uri, cts);
  return cts;
}

function finishResolution(uri: string, cts: CancellationTokenSource): boolean {
  if (inflightByUri.get(uri) === cts) {
    inflightByUri.delete(uri);
  }
  cts.dispose();
  return !cts.token.isCancellationRequested;
}

async function publishAnnotations(document: TextDocument): Promise<void> {
  const uri = document.uri;
  const cts = startResolution(uri);
  const doc = toTextDocumentLike(document);
  const provider = getConfig().enabled ? findProvider(providers, doc) : undefined;
  if (!provider || !provider.isEnabled()) {
    if (finishResolution(uri, cts)) {
      void connection.sendNotification("packageLicenseViewer/annotations", { uri, entries: [] });
    }
    return;
  }

  let entries: DependencyEntry[];
  try {
    entries = provider.parse(doc);
  } catch (error) {
    log.warn(`parse failed for ${uri}: ${String(error)}`);
    finishResolution(uri, cts);
    return;
  }

  const config = getConfig();
  const results: AnnotationEntry[] = await Promise.all(
    entries.map(async (entry) => {
      const info = await resolveEntry(provider, entry, doc, cts.token);
      return {
        line: entry.line,
        name: entry.name,
        segments: formatAnnotationSegments(config, entry, info),
      };
    })
  );

  if (finishResolution(uri, cts)) {
    void connection.sendNotification("packageLicenseViewer/annotations", {
      uri,
      entries: results.filter((entry) => entry.segments !== undefined),
    });
  }
}

// onDidChangeContent already fires once on open with the full initial content, so a separate onDidOpen handler would resolve everything twice.
documents.onDidChangeContent((event) => void publishAnnotations(event.document));

documents.onDidClose((event) => {
  inflightByUri.get(event.document.uri)?.cancel();
  inflightByUri.delete(event.document.uri);
});

connection.onHover(async ({ textDocument, position }) => {
  const document = documents.get(textDocument.uri);
  if (!document) {
    return null;
  }
  const doc = toTextDocumentLike(document);
  const provider = findProvider(providers, doc);
  if (!provider || !provider.isEnabled()) {
    return null;
  }
  let entries: DependencyEntry[];
  try {
    entries = provider.parse(doc);
  } catch {
    return null;
  }
  const entry = entries.find((candidate) => candidate.line === position.line);
  if (!entry) {
    return null;
  }
  const cts = new CancellationTokenSource();
  const info = await resolveEntry(provider, entry, doc, cts.token);
  const markdown = buildHover(entry, info);
  return markdown ? { contents: { kind: "markdown" as const, value: markdown.value } } : null;
});

documents.listen(connection);
connection.listen();
