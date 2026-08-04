# Stint release policy

Candidate version: `1.0.0-next.2`

Stint is not remotely releasable yet. Package identity is now resolved: both manifests
are named `@macworks/stint` and `@macworks/stint-cli`, and the current candidate is
`1.0.0-next.2` (the published `1.0.0-next.1` remains immutable),
and carry MIT license metadata plus `publishConfig.access: public`. What remains
unresolved is environmental — the first npm publication, npm owner, trusted
publisher, protected environment, and (for `latest` only) the public source and
docs URLs. The automation must keep failing closed until those facts are real.

The preflight's `isPlaceholderName` guard still rejects any `@portfolio/*` name. That
guard is deliberate and must not be renamed: it is the sentinel proving the check works,
and `tests/package/release-policy.test.ts` exercises it by contrasting a placeholder
manifest against a publishable one.

## Local candidate

CI installs from the lockfile, lints, runs every currently available workspace test
and build, performs both dry-run packs, runs the packed CLI gate (U7), and finally
runs the repository's protected `npm run build` command. The manual release workflow
additionally demands U11 and the preflight. Both named gate scripts now exist
(`release:verify:u7` and `release:verify:u11`); release dispatches still fail closed
on the unresolved environment facts below.

A local candidate needs the same `1.0.0-next.N` version on both packages plus U7 and U11 evidence
from the same commit, package versions, and workflow run. It may retain private
placeholder package names and does not need npm credentials or public URLs.

The U9 drawer/grid gate no longer exists. It lived in the portfolio repository and
cannot run here; the live docs site plus the `latest` public-URL requirements replace
it, and `STINT_PUBLIC_DOCS_URL` now carries that requirement.

Use the same sequence locally:

```sh
export STINT_GATE_RUN_ID=local
npm ci
npm run lint
npm run test --workspaces --if-present
npm run build --workspaces --if-present
npm run package:dry-run
npm run release:verify:u7
npm run release:verify:u11
npm run release:preflight:local
npm run build
```

Gate evidence is written under `.context/release-gates/` only after the named gate
command succeeds. The preflight rejects missing/malformed evidence and evidence
whose commit, run ID, package names, or versions differ from the current candidate.

## Enabling `next`

Steps 1 and 2 are done. What remains needs npm and GitHub access:

1. ~~Set both package names to their owned npm names, set `private` to `false`, add a
   real license, and set `publishConfig.access` to `public`.~~ Done — both manifests
   are public MIT `@macworks/*` packages with `publishConfig.access: public`.
2. ~~Set both versions, plus the CLI's exact runtime dependency, to
   the current `1.0.0-next.N` candidate.~~ Done. Both names remain in the single Changesets fixed group.
3. Publish under the `@macworks` scope — the npm account is `macworks`, which is why the
   packages are `@macworks/*` while the GitHub repository remains `macnason/stint`.
   The two names are deliberately different; do not "fix" one to match the other.
4. Make `github.com/macnason/stint` public. `STINT_PUBLIC_SOURCE_URL` cannot
   validate against a private repository.
5. Create the GitHub environment `stint-npm-release`, protect it with required
   reviewers and protected-branch deployment rules, and configure npm trusted
   publishing for this repository, `.github/workflows/release.yml`, and that exact
   environment.
6. Add environment variables `STINT_NPM_OWNER` and
   `STINT_TRUSTED_PUBLISHER`. The owner must exactly match both npm package
   scopes (`macworks`, not the GitHub owner). The publisher must equal
   `macnason/stint:.github/workflows/release.yml:stint-npm-release`.
7. Dispatch **Release Stint** from a protected ref with channel `next`.

The workflow has read-only default permissions. Only its protected `publish` job
receives `id-token: write`; candidate and CI jobs never receive OIDC. There is no
long-lived npm token. Checkout, dependency installation, lifecycle scripts, tests,
builds, preflight, and packing all run in the unprivileged candidate job. It uploads
an immutable, one-day artifact containing only both tarballs, a release helper, a
commit/run-bound manifest, and SHA-256 digests. The OIDC job does not check out the
repository or install dependencies: it downloads that artifact, verifies every
digest and manifest binding, then publishes or promotes the exact verified bytes.
For `next`, `npm publish --tag next` performs the tag write in the authenticated
publish request; the helper verifies the resulting registry integrity and tag and
does not issue a separate `npm dist-tag` command.
Until npm confirms matching package identities and registry integrity,
documentation and UI must not claim a published `1.0.0-next.2` version or provenance.

## The bootstrap set `latest`, and that could not be avoided

The bootstrap published both packages with `--tag next`, but npm assigns `latest`
on a package's **first** publish regardless of `--tag`. Both packages therefore
carry `latest: 1.0.0-next.0` and `next: 1.0.0-next.0`, and a plain
`npm install @macworks/stint` resolves to the prerelease.

This is a deviation from the policy below, which treats `latest` as a separately
approved promotion gated on the docs site. It is a property of npm's first-publish
behaviour, not of the release helper. There is no way to publish a package with no
`latest` tag. Options, none of them free:

- **Accept it.** Reasonable pre-1.0: the only published version is the candidate,
  so `latest` and `next` legitimately point at the same bytes. The `latest`
  promotion gate then first has real meaning at `1.0.0`.
- **Point `latest` elsewhere later.** Once `1.0.0` publishes through the workflow,
  the promotion moves `latest` off the prerelease and normal service resumes.

Do not try to "fix" this by unpublishing. Unpublishing burns the version number
permanently and is explicitly not the rollback mechanism.

## The one-time bootstrap publish

npm cannot configure a trusted publisher for a package name that does not exist
yet, so the very first publish of each package could not come from the OIDC
workflow. It was done once, manually, from a maintainer machine:

```sh
npm publish .context/bootstrap/macworks-stint-1.0.0-next.0.tgz --tag next
npm publish .context/bootstrap/macworks-stint-cli-1.0.0-next.0.tgz --tag next
```

Both published versions were verified against the local candidate bytes:
`@macworks/stint` shasum `d207b40645c205b9850cf4aa1739bc76a78e4027`,
`@macworks/stint-cli` shasum `938b450409f046369c0f528448672a8e1d6535b3`.

This is the only publish in the project's history without provenance, and it must
stay the only one. It must not be used as a reason to add an npm token to CI —
there is no future bootstrap; both names now exist. Every subsequent publish and
promotion goes through the protected workflow.

Because published versions are immutable, dispatching `next` for `1.0.0-next.0`
after the bootstrap does not republish. The release helper reconciles by
comparing registry integrity against the local candidate bytes and completes only
the missing tag operation.

## What a real dispatch has and has not proven

Run 30903618222 (channel `next`, commit `d44d0ac`) published
`@macworks/stint@1.0.0-next.2` with provenance, then exposed two invalid helper
assumptions:

- npm 11's `publish --json` output describes tarball contents rather than returning
  the published package ID; registry integrity is the authoritative success check.
- Trusted publishing authenticates `npm publish`, but a later `npm dist-tag`
  process does not reuse that OIDC credential and fails with `E401`.
- `npm publish --tag next` already updates `next`, so no second tag command is
  required.

The runtime publication proved OIDC publishing and provenance work. Check future
releases with:

```sh
npm view PACKAGE_NAME@VERSION dist.attestations
```

`1.0.0-next.0` has no attestations and never will; it was published by hand.

## `npm dist-tag` is not authenticated by trusted publishing

Trusted publishing is configured on both packages with allowed action `npm publish`
only. `npm stage publish` is deliberately not enabled: the helper never calls it,
and enabling it would route CI publishes through a second 2FA approval that
duplicates the `stint-npm-release` environment reviewer.

npm's trusted-publishing exchange is performed by `npm publish`; a later
`npm dist-tag` process does not reuse that credential. The `next` path therefore
relies on `npm publish --tag next`, verifies each immutable version's registry
integrity and resulting tag, and reconciles partial publication on retry. `latest`
promotion still requires credentials that authorize `npm dist-tag`.

If a `latest` dispatch fails on `dist-tag`, check `npm dist-tag ls PACKAGE_NAME`
before retrying. A maintainer credential that authorizes tag changes is required;
trusted publishing alone cannot perform that promotion.

## Promoting `latest`

`latest` is a separate manual dispatch. It promotes the already published, verified
`1.0.0-next.0` candidate with `npm dist-tag add`; it does not republish bytes.
In addition to every `next` gate, promotion requires:

- `STINT_PUBLIC_RUNTIME_NPM_URL` and `STINT_PUBLIC_CLI_NPM_URL` set to the exact
  npmjs.com pages for their package identities;
- `STINT_PUBLIC_SOURCE_URL` set to the exact GitHub repository from
  `GITHUB_REPOSITORY`, plus `STINT_PUBLIC_DOCS_URL` on a public HTTPS host;
- `approve_latest` checked in the dispatch form; and
- approval from the `stint-npm-release` environment reviewers.

Public npm/source links stay absent from product surfaces until these gates pass.

## Rollback

Never use `npm unpublish` as rollback. For `latest`, the release helper snapshots
both packages' affected tags and restores them on partial failure. A `next` publish
cannot remove an immutable version and cannot restore tags through trusted
publishing, so a retry reconciles existing versions by comparing registry integrity
with the candidate bytes, then publishes only the missing package. For manual
inspection:

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
