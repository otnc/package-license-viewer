/**
 * Composer version constraints, interpreted the way `composer/semver` does — independently of
 * npm, Cargo and RubyGems ranges. This is a port of `VersionParser::normalize`,
 * `VersionParser::parseConstraints`, `VersionParser::parseStability`, `Constraint::versionCompare`
 * and PHP's `version_compare`, verified against oracles the real library generated
 * (`test/fixtures/lockfiles/composer-provenance.md`).
 */

export type Stability = "dev" | "alpha" | "beta" | "RC" | "stable";

const STABILITY_RANK: Record<Stability, number> = { dev: 0, alpha: 1, beta: 2, RC: 3, stable: 4 };

/** Negative when `a` is less stable than `b`: dev < alpha < beta < RC < stable */
export function compareStability(a: Stability, b: Stability): number {
  return STABILITY_RANK[a] - STABILITY_RANK[b];
}

const MODIFIER = "[._-]?(?:(stable|beta|b|RC|alpha|a|patch|pl|p)((?:[.-]?\\d+)*)?)?([.-]?dev)?";
const STABILITIES = "stable|RC|beta|alpha|dev";
const CLASSICAL = new RegExp(`^v?(\\d{1,5})(\\.\\d+)?(\\.\\d+)?(\\.\\d+)?${MODIFIER}$`, "i");
const DATE_BASED = new RegExp(
  `^v?(\\d{4}(?:[.:-]?\\d{2}){1,6}(?:[.:-]?\\d{1,3}){0,2})${MODIFIER}$`,
  "i"
);
const FLAG_SUFFIX = new RegExp(`@(?:${STABILITIES})$`, "i");
const ALIAS = /^([^,\s]+) +as +([^,\s]+)$/;

function expandStability(stability: string): string {
  switch (stability.toLowerCase()) {
    case "a":
      return "alpha";
    case "b":
      return "beta";
    case "p":
    case "pl":
      return "patch";
    case "rc":
      return "RC";
    default:
      return stability.toLowerCase();
  }
}

function normalizeBranch(name: string): string {
  const trimmed = name.trim();
  const match = /^v?(\d+)(\.(?:\d+|[xX*]))?(\.(?:\d+|[xX*]))?(\.(?:\d+|[xX*]))?$/i.exec(trimmed);
  if (!match) return `dev-${trimmed}`;
  let version = "";
  for (let i = 1; i < 5; i++) {
    version += match[i] !== undefined ? match[i].replace(/[*X]/g, "x") : ".x";
  }
  return `${version.replace(/x/g, "9999999")}-dev`;
}

/**
 * `VersionParser::normalize`: four numeric components plus a canonical stability suffix, e.g.
 * `v1.2-b3` → `1.2.0.0-beta3`, `1.x-dev` → `1.9999999.9999999.9999999-dev`, `dev-main` → `dev-main`.
 * Strips an ` as <alias>` clause, a `@flag` and build metadata. `undefined` where Composer throws.
 */
export function normalizeVersion(input: string): string | undefined {
  let version = input.trim();
  const alias = ALIAS.exec(version);
  if (alias) version = alias[1];
  const flag = FLAG_SUFFIX.exec(version);
  if (flag) version = version.slice(0, version.length - flag[0].length);
  if (version === "master" || version === "trunk" || version === "default") {
    version = `dev-${version}`;
  }
  if (/^dev-/i.test(version)) return `dev-${version.slice(4)}`;
  const build = /^([^,\s+]+)\+[^\s]+$/.exec(version);
  if (build) version = build[1];

  let match = CLASSICAL.exec(version);
  let index: number | undefined;
  if (match) {
    version = match[1] + (match[2] || ".0") + (match[3] || ".0") + (match[4] || ".0");
    index = 5;
  } else if ((match = DATE_BASED.exec(version))) {
    version = match[1].replace(/\D/g, ".");
    index = 2;
  }
  if (match && index !== undefined) {
    if (match[index]) {
      if (match[index] === "stable") return version;
      version += `-${expandStability(match[index])}${(match[index + 1] ?? "").replace(/^[.-]+/, "")}`;
    }
    if (match[index + 2]) version += "-dev";
    return version;
  }

  const branch = /^(.*?)[.-]?dev$/i.exec(version);
  if (branch) {
    const normalized = normalizeBranch(branch[1]);
    // a branch ending with -dev is only valid if it is numeric
    if (!normalized.startsWith("dev-")) return normalized;
  }
  return undefined;
}

/** `VersionParser::parseStability`, which also accepts a bare constraint token such as `^2.0-RC1` */
export function parseStability(version: string): Stability {
  const stripped = version.replace(/#.+$/, "");
  if (stripped.startsWith("dev-") || stripped.endsWith("-dev")) return "dev";
  const match = new RegExp(`${MODIFIER}(?:\\+.*)?$`, "i").exec(stripped.toLowerCase());
  if (match?.[3]) return "dev";
  switch (match?.[1]) {
    case "beta":
    case "b":
      return "beta";
    case "alpha":
    case "a":
      return "alpha";
    case "rc":
      return "RC";
    default:
      return "stable";
  }
}

// --- PHP version_compare -----------------------------------------------------

const isDigit = (c: string) => c >= "0" && c <= "9";
const isAlnum = (c: string) => /[0-9A-Za-z]/.test(c);

/** `php_canonicalize_version`: `-`/`_`/`+` become `.`, and a `.` is inserted between digit and non-digit runs */
function canonicalize(version: string): string[] {
  if (version.length === 0) return [""];
  let out = version[0];
  let last = version[0];
  for (let i = 1; i < version.length; i++) {
    const c = version[i];
    const lq = out[out.length - 1];
    if (c === "-" || c === "_" || c === "+") {
      if (lq !== ".") out += ".";
    } else if (
      (!isDigit(last) && last !== "." && isDigit(c)) ||
      (isDigit(last) && !isDigit(c) && c !== ".")
    ) {
      if (lq !== ".") out += ".";
      out += c;
    } else if (!isAlnum(c)) {
      if (lq !== ".") out += ".";
    } else {
      out += c;
    }
    last = c;
  }
  return out.split(".");
}

const SPECIAL_FORMS: ReadonlyArray<[string, number]> = [
  ["dev", 0],
  ["alpha", 1],
  ["a", 1],
  ["beta", 2],
  ["b", 2],
  ["RC", 3],
  ["rc", 3],
  ["#", 4],
  ["pl", 5],
  ["p", 5],
];

function specialOrder(form: string): number {
  for (const [name, order] of SPECIAL_FORMS) if (form.startsWith(name)) return order;
  return -1;
}

function compareNumeric(a: string, b: string): number {
  const x = a.replace(/^0+(?=\d)/, "");
  const y = b.replace(/^0+(?=\d)/, "");
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  return x < y ? -1 : x > y ? 1 : 0;
}

function compareParts(p1: string, p2: string): number {
  const d1 = isDigit(p1[0] ?? "");
  const d2 = isDigit(p2[0] ?? "");
  if (d1 && d2) return compareNumeric(p1, p2);
  if (!d1 && !d2) return Math.sign(specialOrder(p1) - specialOrder(p2));
  return d1 ? Math.sign(4 - specialOrder(p2)) : Math.sign(specialOrder(p1) - 4);
}

/** PHP's `version_compare` on two canonicalized strings */
function phpVersionCompare(a: string, b: string): number {
  const parts1 = canonicalize(a);
  const parts2 = canonicalize(b);
  let i = 0;
  while (i < parts1.length && i < parts2.length && parts1[i] !== "" && parts2[i] !== "") {
    const compare = compareParts(parts1[i], parts2[i]);
    if (compare !== 0) return compare;
    i++;
  }
  if (i < parts1.length && parts1[i] !== "") {
    return isDigit(parts1[i][0]) ? 1 : phpVersionCompare(parts1.slice(i).join("."), "#N#");
  }
  if (i < parts2.length && parts2[i] !== "") {
    return isDigit(parts2[i][0]) ? -1 : phpVersionCompare("#N#", parts2.slice(i).join("."));
  }
  return 0;
}

/**
 * Order two normalized versions the way Composer's `Constraint` does: `version_compare` for
 * numeric versions, while a `dev-*` branch equals only itself and sorts below every numeric version.
 */
export function compareVersions(a: string, b: string): number {
  const aBranch = a.startsWith("dev-");
  const bBranch = b.startsWith("dev-");
  if (aBranch || bBranch) {
    if (a === b) return 0;
    if (aBranch && bBranch) return a < b ? -1 : 1;
    return aBranch ? -1 : 1;
  }
  return phpVersionCompare(a, b);
}

// --- constraints ---------------------------------------------------------------

type Operator = "==" | "!=" | "<" | "<=" | ">" | ">=";

interface Comparator {
  readonly op: Operator;
  /** Normalized */
  readonly version: string;
}

/** One OR alternative: every comparator must hold. An empty list is `MatchAllConstraint`. */
type Group = readonly Comparator[];

export interface ValidConstraint {
  readonly kind: "valid";
  /** Explicit `@flag` (including `@stable`), the least stable one when several are written */
  readonly stabilityFlag?: Stability;
  /** Stability of a prerelease named by a single-token part (`1.0.0-beta1`, `>=2.0-RC1`), always below "stable" */
  readonly impliedStability?: Stability;
  /** Normalized alias from `X as Y`, when present */
  readonly alias?: string;
  /** Normalized branch when the whole constraint is one `dev-*` / `N.x-dev` branch */
  readonly devBranch?: string;
  /** OR of ANDs, as `parseConstraints` builds it */
  readonly groups: readonly Group[];
}

export type Constraint = ValidConstraint | { readonly kind: "invalid" };

class InvalidConstraint extends Error {}

const OR_SPLIT = /\s*\|\|?\s*/;
const AND_SPLIT = /(?<!^|as|[=>< ,]) *(?<!-)[, ](?!-) *(?!,|as|$)/;
const VERSION =
  "v?(\\d+)(?:\\.(\\d+))?(?:\\.(\\d+))?(?:\\.(\\d+))?(?:" +
  MODIFIER +
  "|\\.([xX*][.-]?dev))(?:\\+[^\\s]+)?";
const TILDE = new RegExp(`^~>?${VERSION}$`, "i");
const CARET = new RegExp(`^\\^${VERSION}($)`, "i");
const X_RANGE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.[xX*])+$/;
const HYPHEN = new RegExp(`^(?<from>${VERSION}) +- +(?<to>${VERSION})($)`, "i");
const MODIFIER_TAIL = new RegExp(`-${MODIFIER}$`, "i");

function operator(raw: string | undefined): Operator {
  switch (raw) {
    case undefined:
    case "":
    case "=":
    case "==":
      return "==";
    case "<>":
    case "!=":
      return "!=";
    default:
      return raw as Operator;
  }
}

function mustNormalize(version: string): string {
  const normalized = normalizeVersion(version);
  if (normalized === undefined) throw new InvalidConstraint(`Invalid version string "${version}"`);
  return normalized;
}

/** `VersionParser::manipulateVersionString`: zero everything past `position`, optionally bumping it */
function manipulate(
  match: ReadonlyArray<string | undefined>,
  position: number,
  increment = 0
): string {
  const parts = [match[1], match[2], match[3], match[4]].map((part) => part ?? "");
  for (let i = 4; i > 0; i--) {
    if (i > position) parts[i - 1] = "0";
    else if (i === position && increment) parts[i - 1] = String(Number(parts[i - 1]) + increment);
  }
  return parts.join(".");
}

const present = (value: string | undefined) => value !== undefined && value !== "";

/** `VersionParser::parseConstraint` for one AND item */
function parseOne(item: string): Group {
  let constraint = item;
  let stabilityModifier: string | undefined;

  const alias = ALIAS.exec(constraint);
  if (alias) constraint = alias[1];

  const flag = new RegExp(`^([^,\\s]*?)@(${STABILITIES})$`, "i").exec(constraint);
  if (flag) {
    constraint = flag[1] !== "" ? flag[1] : "*";
    if (flag[2] !== "stable") stabilityModifier = flag[2];
  }

  const ref = /^(dev-[^,\s@]+?|[^,\s@]+?\.x-dev)#.+$/i.exec(constraint);
  if (ref) constraint = ref[1];

  const all = /^(v)?[xX*](\.[xX*])*$/i.exec(constraint);
  if (all) return all[1] || all[2] ? [{ op: ">=", version: "0.0.0.0-dev" }] : [];

  let match = TILDE.exec(constraint);
  if (match) {
    if (constraint.startsWith("~>")) {
      throw new InvalidConstraint(
        'Invalid operator "~>", you probably meant to use the "~" operator'
      );
    }
    let position = present(match[4]) ? 4 : present(match[3]) ? 3 : present(match[2]) ? 2 : 1;
    // when matching 2.x-dev or 3.0.x-dev we have to shift the second or third number
    if (match[8]) position++;
    const suffix = !match[5] && !match[7] && !match[8] ? "-dev" : "";
    const low = mustNormalize((constraint + suffix).slice(1));
    const high = `${manipulate(match, Math.max(1, position - 1), 1)}-dev`;
    return [
      { op: ">=", version: low },
      { op: "<", version: high },
    ];
  }

  match = CARET.exec(constraint);
  if (match) {
    const position =
      match[1] !== "0" || !present(match[2]) ? 1 : match[2] !== "0" || !present(match[3]) ? 2 : 3;
    const suffix = !match[5] && !match[7] && !match[8] ? "-dev" : "";
    const low = mustNormalize((constraint + suffix).slice(1));
    const high = `${manipulate(match, position, 1)}-dev`;
    return [
      { op: ">=", version: low },
      { op: "<", version: high },
    ];
  }

  match = X_RANGE.exec(constraint);
  if (match) {
    const position = present(match[3]) ? 3 : present(match[2]) ? 2 : 1;
    const low = `${manipulate(match, position)}-dev`;
    const high = `${manipulate(match, position, 1)}-dev`;
    if (low === "0.0.0.0-dev") return [{ op: "<", version: high }];
    return [
      { op: ">=", version: low },
      { op: "<", version: high },
    ];
  }

  match = HYPHEN.exec(constraint);
  if (match) {
    // groups: from = 1 (2-5 numbers, 6 stability, 7 its number, 8 dev, 9 x-dev); to = 10 (11-14, 15, 16, 17, 18)
    const lowSuffix = !match[6] && !match[8] && !match[9] ? "-dev" : "";
    const low = mustNormalize(match.groups!.from);
    const lower: Comparator = { op: ">=", version: low + lowSuffix };
    if ((present(match[12]) && present(match[13])) || match[15] || match[17] || match[18]) {
      return [lower, { op: "<=", version: mustNormalize(match.groups!.to) }];
    }
    mustNormalize(match.groups!.to);
    const highMatch = ["", match[11], match[12], match[13], match[14]];
    const high = `${manipulate(highMatch, present(match[12]) ? 2 : 1, 1)}-dev`;
    return [lower, { op: "<", version: high }];
  }

  match = /^(<>|!=|>=?|<=?|==?)?\s*(.*)/.exec(constraint);
  if (match) {
    const raw = match[2];
    let version = normalizeVersion(raw);
    if (version === undefined) {
      // recover from an invalid constraint like foobar-dev which should be dev-foobar
      if (raw.endsWith("-dev") && /^[0-9a-zA-Z-./]+$/.test(raw)) {
        version = mustNormalize(`dev-${raw.slice(0, -4)}`);
      } else {
        throw new InvalidConstraint(`Invalid version string "${raw}"`);
      }
    }
    const op = match[1] || "=";
    if (op !== "==" && op !== "=" && stabilityModifier && parseStability(version) === "stable") {
      version += `-${stabilityModifier}`;
    } else if ((op === "<" || op === ">=") && !MODIFIER_TAIL.test(raw) && !raw.startsWith("dev-")) {
      version += "-dev";
    }
    return [{ op: operator(match[1]), version }];
  }
  throw new InvalidConstraint(`Could not parse version constraint ${constraint}`);
}

function normalizeStability(flag: string): Stability {
  const lower = flag.toLowerCase();
  return lower === "rc" ? "RC" : (lower as Stability);
}

const lessStable = (a: Stability | undefined, b: Stability): Stability =>
  a === undefined || compareStability(b, a) < 0 ? b : a;

/**
 * `VersionParser::parseConstraints`, plus what `RootPackageLoader::extractStabilityFlags` reads off
 * the same string: the least stable explicit `@flag`, or failing that the stability of any
 * single-token part naming a prerelease.
 */
export function parseConstraint(input: string): Constraint {
  const items: string[] = [];
  const groups: Group[] = [];
  try {
    for (const orPart of input.trim().split(OR_SPLIT)) {
      const group: Comparator[] = [];
      let matchAll = false;
      for (const andPart of orPart.split(AND_SPLIT)) {
        items.push(andPart);
        const comparators = parseOne(andPart);
        if (comparators.length === 0) matchAll = true;
        group.push(...comparators);
      }
      groups.push(matchAll && group.length === 0 ? [] : group);
    }
  } catch (error) {
    if (error instanceof InvalidConstraint) return { kind: "invalid" };
    throw error;
  }

  let stabilityFlag: Stability | undefined;
  let impliedStability: Stability | undefined;
  for (const item of items) {
    const flag = new RegExp(`^[^@]*?@(${STABILITIES})$`, "i").exec(item);
    if (flag) stabilityFlag = lessStable(stabilityFlag, normalizeStability(flag[1]));
  }
  if (stabilityFlag === undefined) {
    for (const item of items) {
      const token = item.replace(/^([^,\s@]+) as .+$/, "$1");
      if (!/^[^,\s@]+$/.test(token)) continue;
      const stability = parseStability(token);
      if (stability !== "stable") impliedStability = lessStable(impliedStability, stability);
    }
  }

  const aliasMatch = ALIAS.exec(input.trim());
  const alias = aliasMatch ? normalizeVersion(aliasMatch[2]) : undefined;

  const single = groups.length === 1 && groups[0].length === 1 ? groups[0][0] : undefined;
  const devBranch =
    single &&
    single.op === "==" &&
    (single.version.startsWith("dev-") || /(^|\.)9999999(\.9999999)*-dev$/.test(single.version))
      ? single.version
      : undefined;

  return {
    kind: "valid",
    ...(stabilityFlag ? { stabilityFlag } : {}),
    ...(impliedStability ? { impliedStability } : {}),
    ...(alias ? { alias } : {}),
    ...(devBranch ? { devBranch } : {}),
    groups,
  };
}

function holds(op: Operator, a: string, b: string): boolean {
  const aBranch = a.startsWith("dev-");
  const bBranch = b.startsWith("dev-");
  if (op === "!=" && (aBranch || bBranch)) return a !== b;
  if (aBranch && bBranch) return op === "==" && a === b;
  // dev branches never match anything numeric
  if (aBranch || bBranch) return false;
  const compare = phpVersionCompare(a, b);
  switch (op) {
    case "==":
      return compare === 0;
    case "!=":
      return compare !== 0;
    case "<":
      return compare < 0;
    case "<=":
      return compare <= 0;
    case ">":
      return compare > 0;
    case ">=":
      return compare >= 0;
  }
}

/** `Semver::satisfies(version, constraint)`; false for an invalid constraint or version */
export function satisfies(constraint: Constraint, version: string): boolean {
  if (constraint.kind !== "valid") return false;
  const normalized = normalizeVersion(version);
  if (normalized === undefined) return false;
  return constraint.groups.some((group) => group.every((c) => holds(c.op, normalized, c.version)));
}
