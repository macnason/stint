# Contributing to Stint

Thanks for taking a look. Stint is two packages versioned together: the React
runtime (`@macnason/stint`) and the authoring CLI (`@macnason/stint-cli`).

## Setup

```bash
npm install
npm run build   # packages/*/dist is generated, not committed
npm test
npm run lint
```

Node 22 or newer is required.

## The packed tarball is the authority

`tests/package/packed-consumers.test.ts` packs the runtime and installs it into
the clean fixtures under `fixtures/` (Vite + React 18, Vite + React 19, Next App
Router). A broken exports map or an undeclared file fails there rather than in
someone's project. If you touch `exports`, `files`, or anything that changes what
ships, run `npm run test:policy` before opening a PR.

## Changesets

Every user-visible change needs a changeset:

```bash
npm run changeset
```

Both packages are in a single fixed version group, so they always release
together — a changeset for one bumps both. Do not hand-edit versions in
`package.json`; `npm run version:packages` does that.

## Pull requests

- Keep the diff focused; unrelated cleanups belong in their own PR.
- Match the surrounding code — the codebase favours explicit names, small
  modules, and no comments that restate the code.
- CI runs lint, every workspace test, both dry-run packs, and the packed CLI
  gate. All of it must pass.

## Design principles

Before proposing API changes, read the design principles in the
[README](README.md). Three constraints shape most review feedback:

1. The component owns no container — no background, border, or elevation.
2. Data is month-precision and serializable.
3. Integrations stay generic; concrete haptics and text-morphing belong to the
   consumer.

## Releasing

Releases are maintainer-only and run through a protected workflow with npm
trusted publishing. See [docs/release/stint.md](docs/release/stint.md).
