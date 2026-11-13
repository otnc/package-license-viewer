import { record } from "../net";

/**
 * Normalize the shapes a declared source repository takes — npm's `repository`
 * field and Composer's `source` record both end up here — into one browsable URL.
 *
 * npm alone allows all of these for the same repository:
 * - `"owner/repo"` (shorthand for GitHub), `"github:owner/repo"`, `"gitlab:…"`, `"bitbucket:…"`
 * - `"git+https://github.com/owner/repo.git"`, `"git://…"`, `"ssh://git@…"`
 * - `"git@github.com:owner/repo.git"` (the scp-like SSH form)
 * - `{ "type": "git", "url": "<any of the URL forms above>" }`
 *
 * Returns `undefined` for anything that doesn't resolve to an `http(s)` page —
 * a local path, a bare hostname, an unrecognized shorthand — since the result is
 * only ever used as a hover link, and a link that doesn't open is worse than none.
 */
export function normalizeRepositoryUrl(value: unknown): string | undefined {
  const raw =
    typeof value === "string"
      ? value.trim()
      : record(value) && typeof value.url === "string"
        ? value.url.trim()
        : "";
  if (!raw) {
    return undefined;
  }

  // A full URL, possibly with a transport prefix: "git+https://…", "git://…", "ssh://git@…"
  const url = raw.replace(/^git\+/, "");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    return normalizeHttpUrl(
      url.replace(/^git:\/\//i, "https://").replace(/^ssh:\/\/(?:[^@/\s]+@)?/i, "https://")
    );
  }

  // The scp-like SSH form: "git@github.com:owner/repo.git"
  const scp = /^[^@\s/]+@([^:\s/]+):(.+)$/.exec(raw);
  if (scp) {
    return normalizeHttpUrl(`https://${scp[1]}/${scp[2]}`);
  }

  // npm's host shorthands, and the bare "owner/repo", which npm defines as GitHub
  const shorthand = /^(?:(github|gitlab|bitbucket):)?([\w.-]+)\/([\w.-]+)$/.exec(raw);
  if (shorthand) {
    const host =
      shorthand[1] === "gitlab"
        ? "gitlab.com"
        : shorthand[1] === "bitbucket"
          ? "bitbucket.org"
          : "github.com";
    return normalizeHttpUrl(`https://${host}/${shorthand[2]}/${shorthand[3]}`);
  }

  // "gist:<id>" is npm's remaining shorthand
  const gist = /^gist:([\w-]+)$/.exec(raw);
  if (gist) {
    return `https://gist.github.com/${gist[1]}`;
  }

  return undefined;
}

/** Keep only real web URLs, spelled the way a browser should open them (no `.git`, no trailing slash) */
function normalizeHttpUrl(url: string): string | undefined {
  const cleaned = url.replace(/\/+$/, "").replace(/\.git$/i, "");
  if (!/^https?:\/\//i.test(cleaned)) {
    return undefined;
  }
  try {
    new URL(cleaned);
  } catch {
    return undefined;
  }
  return cleaned;
}
