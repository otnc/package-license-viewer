import "./installVscodeShim";

import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LicenseCache } from "../cache";
import { getConfig } from "../config";
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

// TODO: sync from workspace/configuration once a real client exists to test it against
const clientSettings: Record<string, unknown> = {};
setSettingsSource(() => clientSettings);

const memory = new Map<string, unknown>();
const cache = new LicenseCache({
  get: <T>(key: string, fallback?: T) => (memory.has(key) ? (memory.get(key) as T) : fallback),
  update: async (key: string, value: unknown) => {
    memory.set(key, value);
  },
  keys: () => [...memory.keys()],
});

const providers = createProviders(cache, nodeProviderHost);

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    hoverProvider: true,
  },
}));

connection.onInitialized(() => {
  log.info("Package License Viewer language server initialized");
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

async function publishAnnotations(document: TextDocument): Promise<void> {
  const doc = toTextDocumentLike(document);
  const provider = getConfig().enabled ? findProvider(providers, doc) : undefined;
  if (!provider || !provider.isEnabled()) {
    void connection.sendNotification("packageLicenseViewer/annotations", {
      uri: document.uri,
      entries: [],
    });
    return;
  }

  let entries: DependencyEntry[];
  try {
    entries = provider.parse(doc);
  } catch (error) {
    log.warn(`parse failed for ${document.uri}: ${String(error)}`);
    return;
  }

  const cts = new CancellationTokenSource();
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

  void connection.sendNotification("packageLicenseViewer/annotations", {
    uri: document.uri,
    entries: results.filter((entry) => entry.segments !== undefined),
  });
}

// onDidChangeContent already fires once on open with the full initial content, so a separate onDidOpen handler would resolve everything twice.
documents.onDidChangeContent((event) => void publishAnnotations(event.document));

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
