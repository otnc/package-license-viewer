/** Cargo requirements are parsed independently of npm ranges. Numeric components use u64. */
interface Version {
  parts: bigint[];
  pre: string;
}
interface Comparator extends Version {
  op: string;
}
export type Requirement = { kind: "valid"; comparators: Comparator[] } | { kind: "invalid" };
const numeric = "(0|[1-9][0-9]*)";
const versionPattern = new RegExp(
  `^${numeric}(?:\\.${numeric})?(?:\\.${numeric})?(?:-([0-9A-Za-z.-]+))?(?:\\+([0-9A-Za-z.-]+))?$`
);

function version(value: string, partial: boolean): Version | undefined {
  const match = versionPattern.exec(value);
  if (!match || match[0] !== value) return undefined;
  const parts = match
    .slice(1, 4)
    .filter((x) => x !== undefined)
    .map(BigInt);
  if ((!partial && parts.length !== 3) || parts.some((n) => n > 18446744073709551615n))
    return undefined;
  if ((match[4] || match[5]) && parts.length !== 3) return undefined;
  for (const [i, identifiers] of [match[4], match[5]].entries()) {
    if (
      identifiers !== undefined &&
      identifiers.split(".").some((s) => !s || (i === 0 && /^0[0-9]+$/.test(s)))
    )
      return undefined;
  }
  return { parts, pre: match[4] ?? "" };
}

export function parseRequirement(input: string): Requirement {
  const text = input.replace(/^ +| +$/g, "");
  if (/^[*xX]$/.test(text)) return { kind: "valid", comparators: [] };
  const comparators: Comparator[] = [];
  for (const item of text.split(",")) {
    const match = /^(>=|<=|>|<|=|\^|~)? *([^ ]+) *$/.exec(item.replace(/^ +/, ""));
    if (!match) return { kind: "invalid" };
    let op = match[1] ?? "^";
    let value = match[2];
    if (/[xX*]/.test(value.split(/[-+]/)[0])) {
      const wildcard = /^(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?\.[xX*](?:\.[xX*])?$/.exec(value);
      if (!wildcard || (wildcard[2] && value.split(".").length > 3)) return { kind: "invalid" };
      value = wildcard[1] + (wildcard[2] === undefined ? "" : `.${wildcard[2]}`);
      if (!match[1]) op = "=";
    }
    const parsed = version(value, true);
    if (!parsed) return { kind: "invalid" };
    comparators.push({ ...parsed, op });
  }
  return comparators.length && comparators.length <= 32
    ? { kind: "valid", comparators }
    : { kind: "invalid" };
}

function comparePre(a: string, b: string): number {
  if (a === b) return 0;
  if (!a || !b) return a ? -1 : 1;
  const aa = a.split("."),
    bb = b.split(".");
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    if (aa[i] === undefined || bb[i] === undefined) return aa[i] === undefined ? -1 : 1;
    if (aa[i] === bb[i]) continue;
    const an = /^[0-9]+$/.test(aa[i]),
      bn = /^[0-9]+$/.test(bb[i]);
    if (an && bn) return BigInt(aa[i]) < BigInt(bb[i]) ? -1 : 1;
    if (an !== bn) return an ? -1 : 1;
    return aa[i] < bb[i] ? -1 : 1;
  }
  return 0;
}

export function compareVersions(a: string, b: string): number {
  const av = version(a, false),
    bv = version(b, false);
  if (!av || !bv) throw new Error("invalid Cargo version");
  for (let i = 0; i < 3; i++) {
    if (av.parts[i] !== bv.parts[i]) return av.parts[i] < bv.parts[i] ? -1 : 1;
  }
  return comparePre(av.pre, bv.pre);
}

export function validVersion(value: string): boolean {
  return version(value, false) !== undefined;
}

export function matchesRequirement(req: Requirement, value: string): boolean {
  const v = version(value, false);
  if (req.kind === "invalid" || !v) return false;
  if (
    v.pre &&
    !req.comparators.some(
      (c) => c.pre && c.parts.length === 3 && c.parts.every((n, i) => n === v.parts[i])
    )
  )
    return false;
  return req.comparators.every((c) => {
    let order = 0;
    for (let i = 0; i < c.parts.length; i++) {
      if (v.parts[i] !== c.parts[i]) {
        order = v.parts[i] < c.parts[i] ? -1 : 1;
        break;
      }
    }
    const exact = order === 0 && v.pre === c.pre;
    const comparison = order || (c.parts.length === 3 ? comparePre(v.pre, c.pre) : 0);
    if (c.op === "=") return exact;
    if (c.op === ">") return comparison > 0;
    if (c.op === "<") return comparison < 0;
    if (c.op === ">=") return exact || comparison > 0;
    if (c.op === "<=") return exact || comparison < 0;
    if (v.parts[0] !== c.parts[0]) return false;
    if (c.op === "~")
      return (
        (c.parts.length < 2 || v.parts[1] === c.parts[1]) &&
        (order > 0 || (order === 0 && comparePre(v.pre, c.pre) >= 0))
      );
    if (c.parts.length === 1) return true;
    if (c.parts[0] === 0n && v.parts[1] !== c.parts[1]) return false;
    if (c.parts.length === 2) return v.parts[1] >= c.parts[1];
    if (c.parts[0] === 0n && c.parts[1] === 0n && v.parts[2] !== c.parts[2]) return false;
    return order > 0 || (order === 0 && comparePre(v.pre, c.pre) >= 0);
  });
}
