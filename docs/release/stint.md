# Stint release policy

Candidate version: `1.0.0-next.0`

Stint is not remotely releasable yet. Both manifests are now named `@macnason/stint`
and `@macnason/stint-cli`, but they remain private at `0.0.0`; the license, npm owner,
trusted publisher, public source, package-specific npm URLs, and public docs URL are
unresolved. The automation must keep failing closed until those facts are real.

The preflight's `isPlaceholderName` guard still rejects any `@portfolio/*` name. That
guard is deliberate and must not be renamed: it is the sentinel proving the check works,
and `tests/package/release-policy.test.ts` exercises it by contrasting a placeholder
manifest against a publishable one.

## Local candidate

CI installs from the lockfile, lints, runs every currently available workspace test
and build, performs both dry-run packs, runs the packed CLI gate (U7), and finally
runs the repository's protected `npm run build` command. The manual release workflow
additionally demands U11 and the local preflight. Until U11 provides its named gate
script, release dispatches fail closed while ordinary CI remains useful.

A local candidate needs `1.0.0-next.0` on both packages plus U7 and U11 evidence
from the same commit, package versions, and workflow run. It may retain private
placeholder package names and does not need npm credentials, U9, or public URLs.

Use the same sequence locally:

```sh
export STINT_GATE_RUN_ID=local
npm ci
npm run lint
npm run test --workspaces --if-present
npm run build --workspaces --if-present
npm run package:dry-run
npm run release:verify:u7
# Available only after the packed-runtime U11 slice lands:
npm run release:verify:u11
npm run release:preflight:local
npm run build
```

Gate evidence is written under `.context/release-gates/` only after the named gate
command succeeds. The preflight rejects missing/malformed evidence and evidence
whose commit, run ID, package names, or versions differ from the current candidate.

## Enabling `next`

Do not change package identity speculatively. Once the names and ownership exist:

1. Set both package names to their owned npm names, set `private` to `false`, add a
   real license, and set `publishConfig.access` to `public`.
2. Set both versions, plus the CLI's exact runtime dependency, to
   `1.0.0-next.0`. Keep both names in the single Changesets fixed group.
3. Create the GitHub environment `stint-npm-release`, protect it with required
   reviewers and protected-branch deployment rules, and configure npm trusted
   publishing for this repository, `.github/workflows/release.yml`, and that exact
   environment.
4. Add environment variables `STINT_NPM_OWNER` and
   `STINT_TRUSTED_PUBLISHER`. The owner must exactly match both npm package
   scopes. The publisher must equal
   `OWNER/REPOSITORY:.github/workflows/release.yml:stint-npm-release`.
5. Dispatch **Release Stint** from a protected ref with channel `next`.

The workflow has read-only default permissions. Only its protected `publish` job
receives `id-token: write`; candidate and CI jobs never receive OIDC. There is no
long-lived npm token. Checkout, dependency installation, lifecycle scripts, tests,
builds, preflight, and packing all run in the unprivileged candidate job. It uploads
an immutable, one-day artifact containing only both tarballs, a release helper, a
commit/run-bound manifest, and SHA-256 digests. The OIDC job does not check out the
repository or install dependencies: it downloads that artifact, verifies every
digest and manifest binding, then publishes or promotes the exact verified bytes.
Until npm confirms matching package identities and registry integrity,
documentation and UI must not claim a published version or provenance.

## Promoting `latest`

`latest` is a separate manual dispatch. It promotes the already published, verified
`1.0.0-next.0` candidate with `npm dist-tag add`; it does not republish bytes.
In addition to every `next` gate, promotion requires:

- passing U9 drawer/grid evidence from the same protected run;
- `STINT_PUBLIC_RUNTIME_NPM_URL` and `STINT_PUBLIC_CLI_NPM_URL` set to the exact
  npmjs.com pages for their package identities;
- `STINT_PUBLIC_SOURCE_URL` set to the exact GitHub repository from
  `GITHUB_REPOSITORY`, plus `STINT_PUBLIC_DOCS_URL` on a public HTTPS host;
- `approve_latest` checked in the dispatch form; and
- approval from the `stint-npm-release` environment reviewers.

Public npm/source links stay absent from product surfaces until these gates pass.

## Rollback

Never use `npm unpublish` as rollback. The release helper snapshots both packages'
affected tags before changing either package. On partial failure it restores both
snapshots. A retry reconciles already-published immutable versions by comparing
their registry integrity with the local candidate bytes, then completes only the
missing publish/tag operation. For manual inspection:

```sh
npm dist-tag ls PACKAGE_NAME
npm view PACKAGE_NAME@next version
npm view PACKAGE_NAME@latest version
```

If `next` is bad, move `next` back to the last verified version (or remove only that
tag if there was no previous candidate), then pin the portfolio to the last verified
package version and rebuild it:

```sh
npm dist-tag add PACKAGE_NAME@PREVIOUS_VERSION next
npm install --save-exact PACKAGE_NAME@PREVIOUS_VERSION
npm run build
```

If a `latest` promotion is bad, restore each package's previous stable tag and the
portfolio pin:

```sh
npm dist-tag add PACKAGE_NAME@PREVIOUS_STABLE latest
npm install --save-exact PACKAGE_NAME@PREVIOUS_STABLE
npm run build
```

Apply rollback to runtime and CLI together. A partial two-package publish or tag
change is treated as failed: restore both tags/pins to the recorded versions before
retrying. Published versions remain immutable and auditable.
