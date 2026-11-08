# Composer fixtures

Generated on 2026-11-08 with Composer 2.10.3 (2026-08-27), PHP 8.5.12 and
`composer/semver` 3.6.0. The tests read these saved expectations; they never
invoke PHP or Composer.

## Constraint oracles

`composer-constraints.tsv` records constraint, version and result, one
independent oracle case per row, for the cross product of a constraint list
and a version list. To regenerate a row with `composer/semver` installed:
write `invalid-constraint` if `(new VersionParser)->parseConstraints($constraint)`
throws; otherwise write `invalid-version` if `(new VersionParser)->normalize($version)`
throws; otherwise write `Semver::satisfies($version, $constraint)` as `true` or
`false`. The constraint list covers every operator (`=`, `==`, `!=`, `<>`, `<`,
`<=`, `>`, `>=`, `~`, `^`), wildcards, hyphen ranges, AND via space and comma,
OR via `||` and `|`, `v` prefixes, 1–4 component versions, every stability
suffix spelling, `@stability` flags, `dev-*` and `N.x-dev` branches, `as`
aliases, `#ref` suffixes, and npm-only syntax that Composer rejects. The empty
constraint is intentional.

`composer-normalize.tsv` records input and `(new VersionParser)->normalize($input)`,
or `invalid` when it throws.

`composer-compare.tsv` records two versions and
`version_compare(normalize($a), normalize($b))` for every pair of numeric (non-branch)
versions in the version list.

## Lockfile fixtures

(Added by a later change.)
