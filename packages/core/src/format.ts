import * as vscode from "vscode";
import type { ViewerConfig } from "./config";
import type { DependencyEntry, LicenseInfo } from "./providers";

/**
 * The annotation split around the license value, so the caller can draw `license` in its own colour while `before`/`after` stay in the regular dimmed one. Either side is often empty — the default template (`${license}`) has nothing on either side at all.
 */
export interface AnnotationSegments {
  readonly before: string;
  readonly license: string;
  readonly after: string;
}

/**
 * Split the annotation around the license value. Returns undefined when nothing should be shown.

 * Only the first `${license}` occurrence is split out; a template that doesn't reference `${license}` at all has nothing to colour, so everything lands in `before` instead.
 */
export function formatAnnotationSegments(
  config: ViewerConfig,
  entry: DependencyEntry,
  info: LicenseInfo
): AnnotationSegments | undefined {
  if (!info.license) {
    // Things we never meant to resolve (git dependencies and the like) stay quiet
    if (info.source === "skipped") {
      return undefined;
    }
    return config.unknownText.trim().length > 0
      ? { before: stripBreaks(config.unknownText), license: "", after: "" }
      : undefined;
  }

  const template = config.format
    .replace(/\$\{version\}/g, info.version ?? "")
    .replace(/\$\{name\}/g, entry.name)
    .replace(/\$\{source\}/g, info.source)
    .replace(/\$\{nodeEngine\}/g, info.nodeEngine ?? "")
    .replace(/\$\{rubyVersion\}/g, info.rubyVersion ?? "")
    .replace(/\$\{rustVersion\}/g, info.rustVersion ?? "")
    .replace(/\$\{goVersion\}/g, info.goVersion ?? "")
    .replace(/\$\{phpVersion\}/g, info.phpVersion ?? "");

  const marker = "${license}";
  const markerIndex = template.indexOf(marker);
  const hasLicensePlaceholder = markerIndex !== -1;

  const rawBefore = hasLicensePlaceholder ? template.slice(0, markerIndex) : template;
  const license = hasLicensePlaceholder ? info.license : "";
  // Only the first occurrence gets its own colour; a repeated ${license} still has to resolve to the actual value rather than being left in the text literally.
  let after = hasLicensePlaceholder
    ? template.slice(markerIndex + marker.length).replaceAll(marker, info.license)
    : "";

  if ((rawBefore + license + after).trim().length === 0) {
    return undefined;
  }

  if (config.showResolvedVersion && info.version && !config.format.includes("${version}")) {
    after += ` · ${info.version}`;
  }

  if (config.showNodeEngine && info.nodeEngine && !config.format.includes("${nodeEngine}")) {
    after += ` (Node: ${info.nodeEngine})`;
  }

  if (config.showRubyVersion && info.rubyVersion && !config.format.includes("${rubyVersion}")) {
    after += ` (Ruby: ${info.rubyVersion})`;
  }

  if (config.showRustVersion && info.rustVersion && !config.format.includes("${rustVersion}")) {
    after += ` (Rust: ${info.rustVersion})`;
  }

  if (config.showGoVersion && info.goVersion && !config.format.includes("${goVersion}")) {
    after += ` (Go: ${info.goVersion})`;
  }

  if (config.showPhpVersion && info.phpVersion && !config.format.includes("${phpVersion}")) {
    after += ` (PHP: ${info.phpVersion})`;
  }

  // Trim only the outer edges — a leading/trailing space right next to the license value (as in "${name}: ${license}") is intentional and must survive.
  const before = hasLicensePlaceholder ? rawBefore.trimStart() : rawBefore.trim();
  if (hasLicensePlaceholder) {
    after = after.trimEnd();
  }

  return { before: stripBreaks(before), license: stripBreaks(license), after: stripBreaks(after) };
}

/**
 * Build the dimmed text drawn at the end of the line, as one plain string.
 * Returns undefined when nothing should be shown.
 */
export function formatAnnotation(
  config: ViewerConfig,
  entry: DependencyEntry,
  info: LicenseInfo
): string | undefined {
  const segments = formatAnnotationSegments(config, entry, info);
  return segments ? `${segments.before}${segments.license}${segments.after}` : undefined;
}

// Decoration text cannot contain line breaks
function stripBreaks(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, " ");
}

/** The detail shown when hovering an annotation */
export function buildHover(
  entry: DependencyEntry,
  info: LicenseInfo
): vscode.MarkdownString | undefined {
  const lines: string[] = [];
  // Backticks, not just bold: "name@1.2.3" is a syntactically valid GFM extended email autolink (numeric domain labels are allowed), so VS Code's hover renderer turns "lodash@4.17.21" into a mailto: link unless it sits inside a code span. Nesting the code span inside a real link (when we know the npmjs.org package name) still renders fine and doesn't reopen the autolink issue — verified against `marked`, the renderer VS Code uses.
  const label = info.version ? `\`${entry.name}@${info.version}\`` : `\`${entry.name}\``;
  // A genuine npm package (registryPackageName) always wins over a generic packagePageUrl — an npm alias could in principle collide with something else setting the latter.
  const titleUrl =
    info.registryPackageName && info.version
      ? npmPackageUrl(info.registryPackageName, info.version)
      : info.packagePageUrl;
  lines.push(titleUrl ? `**[${label}](${titleUrl})**` : `**${label}**`);

  if (info.license) {
    lines.push(`License: \`${info.license}\``);
  } else if (info.detail) {
    lines.push(`License: _unknown_ — ${info.detail}`);
  } else {
    lines.push("License: _unknown_");
  }

  if (info.nodeEngine) {
    lines.push(`Node: \`${info.nodeEngine}\``);
  }

  if (info.rubyVersion) {
    lines.push(`Ruby: \`${info.rubyVersion}\``);
  }

  if (info.rustVersion) {
    lines.push(`Rust: \`${info.rustVersion}\``);
  }

  if (info.goVersion) {
    lines.push(`Go: \`${info.goVersion}\``);
  }

  if (info.phpVersion) {
    lines.push(`PHP: \`${info.phpVersion}\``);
  }

  lines.push(`Resolved from: ${describeSource(info)}`);

  // One line of outbound links: the declared homepage, with the source repository beside
  // it. A link that would just repeat the link the title already has is skipped (JSR has
  // no separately declared homepage, so its package page serves as both), and when the
  // homepage and the repository turn out to be the same URL only the repository link is
  // shown — it says more about where the link goes.
  const repository =
    info.repository && /^https?:\/\//i.test(info.repository) && info.repository !== titleUrl
      ? info.repository
      : undefined;
  const links: string[] = [];
  if (
    info.homepage &&
    /^https?:\/\//i.test(info.homepage) &&
    info.homepage !== titleUrl &&
    info.homepage !== repository
  ) {
    links.push(`[Homepage](${info.homepage})`);
  }
  if (repository) {
    links.push(repositoryLink(repository));
  }
  if (links.length > 0) {
    lines.push(links.join(" · "));
  }

  const markdown = new vscode.MarkdownString(lines.join("\n\n"));
  markdown.isTrusted = false;
  return markdown;
}

/**
 * Build the npmjs.org package page URL, e.g. `https://www.npmjs.com/package/@babel/core/v/7.24.0`.
 * The scope's `@` and `/` are left as-is — npm's own site uses them unencoded in this path.
 */
function npmPackageUrl(name: string, version: string): string {
  return `https://www.npmjs.com/package/${name}/v/${encodeURIComponent(version)}`;
}

/**
 * The hover's repository link. A GitHub repository is labelled "GitHub" and carries the
 * GitHub mark in front of the word; any other host gets a plain "Repository" label.
 */
function repositoryLink(url: string): string {
  let host: string | undefined;
  try {
    host = new URL(url).hostname;
  } catch {
    host = undefined;
  }
  return host === "github.com"
    ? `[![](${GITHUB_MARK_DATA_URI}) GitHub](${url})`
    : `[Repository](${url})`;
}

/**
 * The GitHub mark (Octicons' `mark-github`, MIT-licensed, © GitHub, Inc.) as a data URI
 * the hover's markdown can embed — the hover has no file it could reference instead. The
 * SVG declares its own size, 14×14, the height of the hover's text, because markdown
 * offers no way to size an image. The fill is a mid gray: an image cannot follow the
 * editor's theme the way a codicon's `currentColor` would, and this one stays visible on
 * both the light and the dark hover background.
 */
const GITHUB_MARK_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 16 16'><path fill='#7d8590' d='M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656'/></svg>"
)}`;

function describeSource(info: LicenseInfo): string {
  switch (info.source) {
    case "local":
      return info.via ?? "installed package (`node_modules`)";
    case "lockfile":
      return info.via ?? "lockfile";
    case "registry":
      return info.via ?? "registry";
    case "skipped":
      return info.detail ?? "not applicable";
    default:
      // A provider can know *how* it looked something up (via) even when the lookup itself
      // failed (e.g. Cargo.lock pinned a version but crates.io has no license for it) — the
      // failure reason itself is already shown on the License line above, so prefer via here.
      return info.via ?? info.detail ?? "not resolved";
  }
}
