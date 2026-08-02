# Stint

A tactile React timeline for presenting career history — scrub through a
work history by month and watch the active role, company, and location
resolve as you move.

This repository holds two packages, versioned together:

| Package | What it is |
| --- | --- |
| [`@macnason/stint`](packages/stint) | The React component, schema, and timeline utilities |
| [`@macnason/stint-cli`](packages/stint-cli) | Authoring and import tooling for career data |

> **Not yet published.** Both packages are private at `0.0.0` while the public
> name, license, npm owner, and trusted publisher are resolved. The release
> automation fails closed until those are real — see
> [`docs/release/stint.md`](docs/release/stint.md).

## Layout

```text
packages/stint/       React component, structural CSS, optional theme presets
packages/stint-cli/   init / add / import / validate commands
fixtures/             Clean Vite 18, Vite 19, and Next App Router consumers
tests/package/        Packed-tarball, bundle-size, and release-policy gates
scripts/              Release preflight, gate recording, and publish helpers
docs/release/         Release policy and promotion gates
```

## Development

```bash
npm install
npm run build        # build both packages
npm test             # unit, component, accessibility, CLI, and packed gates
npm run lint
```

The packed tarball, not the workspace symlink, is the compatibility authority.
`tests/package/packed-consumers.test.ts` packs the runtime and installs it into
each fixture, so a broken exports map or an undeclared file fails there rather
than in a consumer's project.

## Design principles

- **The component owns no container.** It paints no background, border, or
  elevation. Colour and typography inherit from the host page through
  `currentColor` plus a small namespaced token set, so it drops into any
  surface. Overflow fades are transparency masks, not coloured scrims.
- **Data is month-precision and serializable.** Stable IDs, `YYYY-MM` dates,
  inclusive starts, exclusive normalized ends, and `null` for current roles.
  Overlaps and gaps are preserved rather than flattened.
- **Integrations stay generic.** The package emits feedback events and exposes
  render slots; concrete haptics, text-morphing, and image primitives belong to
  the consumer.

## Consuming from a local checkout

Until the packages are published, a local consumer points at this checkout:

```jsonc
{
  "dependencies": {
    "@macnason/stint": "file:../stint/packages/stint"
  }
}
```

Run `npm run build` here first — `packages/*/dist` is generated, not committed,
so the entry a consumer resolves does not exist until the package is built.
