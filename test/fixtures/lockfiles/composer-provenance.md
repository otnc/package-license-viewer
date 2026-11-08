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

`composer.composer.lock` and `composer.installed.json` are the `composer.lock`
and `vendor/composer/installed.json` that `composer install` (Composer 2.10.3,
PHP 8.5.12, 2026-11-08) produced for a temporary project named
`plv/composer-fixtures` with this manifest:

```json
{
    "require": { "psr/log": "^3.0", "psr/http-message": "^2.0@dev" },
    "require-dev": { "psr/container": "^2.0" }
}
```

The `@dev` flag makes Composer pick `psr/http-message`'s `dev-master` branch,
which carries `extra.branch-alias` (`dev-master` → `2.0.x-dev`), so the
branch-alias path has a real fixture. None of the three packages has
transitive dependencies. Both files are unmodified Composer output.

## Integration workspace

`test/fixtures/composer-workspace/app/` holds the `composer.lock` and
`vendor/composer/installed.json` that `composer install --no-dev` (same toolchain,
same date) produced for a project requiring `psr/log ^3.0` and, under
`require-dev`, `psr/container ^2.0` — so `installed.json` lists only `psr/log`
while the lock also holds `psr/container`, and the integration test exercises
both lookups. Only `installed.json` is committed from `vendor/`. The committed
`composer.json` was then hand-edited to add `php`, `ext-json` and the
non-existent `acme/missing`; the lock's `content-hash` is therefore stale on
purpose, which the extension never checks.
