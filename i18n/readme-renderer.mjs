import { markdownRenderer } from "kiritan";
import manifest from "../packages/vscode-extension/package.json" with { type: "json" };
import supportedLanguages from "./supported-languages.json" with { type: "json" };
import editors from "./editors.json" with { type: "json" };
import commands from "./commands.json" with { type: "json" };
import settings from "./settings.json" with { type: "json" };

const requireMatchingIds = (kind, documented, contributed) => {
  const missing = contributed.filter((id) => !documented.includes(id));
  const obsolete = documented.filter((id) => !contributed.includes(id));
  if (missing.length || obsolete.length) {
    throw new Error(
      `Update i18n/${kind}.json: missing [${missing.join(", ")}], obsolete [${obsolete.join(", ")}].`
    );
  }
};

const configuration = manifest.contributes.configuration.properties;
requireMatchingIds("settings", Object.keys(settings.rows), Object.keys(configuration));
requireMatchingIds(
  "commands",
  Object.keys(commands.rows),
  manifest.contributes.commands.map(({ command }) => command)
);

const formatDefault = (value, summary) =>
  summary
    ? Object.fromEntries(
        Object.entries(summary).map(([locale, text]) => [
          locale,
          text.replaceAll("%{count}", String(value.length)),
        ])
      )
    : `\`${value === "" ? '""' : typeof value === "string" ? value : JSON.stringify(value)}\``;

const tables = {
  "supported-languages": supportedLanguages,
  editors,
  commands: {
    ...commands,
    rows: manifest.contributes.commands.map(({ command, title }) => ({
      command: `\`${title}\``,
      description: commands.rows[command].description,
    })),
  },
  settings: {
    ...settings,
    rows: Object.entries(configuration).map(([setting, { default: value }]) => ({
      setting: `\`${setting}\``,
      default: formatDefault(value, settings.rows[setting].defaultSummary),
      description: settings.rows[setting].description,
    })),
  },
};

const localizedCell = (cell, locale) => {
  const text = typeof cell === "string" ? cell : cell[locale];
  if (typeof text !== "string") throw new Error(`Missing ${locale} table cell translation.`);
  return text;
};

const renderTable = (id) => {
  const table = tables[id];
  if (!table) throw new Error(`Unknown documentation table: ${id}`);
  const fields = Object.keys(table.columns);
  return ["en", "ja"]
    .map((locale) => {
      const rows = [
        Object.values(table.columns),
        fields.map(() => "---"),
        ...table.rows.map((row) => fields.map((field) => row[field])),
      ];
      const markdown = rows
        .map((row) => `| ${row.map((cell) => localizedCell(cell, locale)).join(" | ")} |`)
        .join("\n");
      return `:::kiritan{locale=${locale}}\n## ${table.heading[locale]}\n\n${markdown}\n:::`;
    })
    .join("\n\n");
};

/**
 * Expands shared README table directives into locale blocks with Markdown links and code spans.
 * @example
 * defineConfig({ plugins: { renderers: { readme: readmeRenderer } } });
 */
export const readmeRenderer = {
  ...markdownRenderer,
  id: "readme",
  parse: (source) => {
    const tree = markdownRenderer.parse(source);
    return {
      ...tree,
      children: tree.children.flatMap((node) =>
        node.type === "leafDirective" && node.name === "docs-table"
          ? markdownRenderer.parse(renderTable(node.attributes.id)).children
          : [node]
      ),
    };
  },
};
