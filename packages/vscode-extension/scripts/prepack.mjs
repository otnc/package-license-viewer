// vsce only packages files that live inside this package's own directory — and, for the readme
// and changelog specifically, only recognizes them by matching a file it already collected from
// that directory, not an arbitrary filesystem path — so the repo root's shared icon, README and
// CHANGELOG all have to be copied in here before packaging/publishing rather than referenced in place.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const repoRoot = join(packageRoot, "..", "..");

mkdirSync(join(packageRoot, "images"), { recursive: true });
copyFileSync(join(repoRoot, "images", "icon.png"), join(packageRoot, "images", "icon.png"));
copyFileSync(join(repoRoot, "README.md"), join(packageRoot, "README.md"));
copyFileSync(join(repoRoot, "CHANGELOG.md"), join(packageRoot, "CHANGELOG.md"));
