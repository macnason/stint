# Stint lab

Before/after review of proposed fixes to `@macworks/stint`. Each suggestion
renders the shipped component beside `StintLab`, a copy of `Stint.tsx` with
that one fix switched on, plus a replay that drives both panes at once.

```bash
npm run playground
```

Approve or deny each card; decisions persist in localStorage. **Copy
decisions** puts a markdown checklist on the clipboard to hand to whoever ports
the approved fixes into `packages/stint`.

- `src/lab/fixes.ts` — the suggestions.
- `src/lab/StintLab.tsx` — the shipped component plus fix flags.
- `src/lab/lab.css` — CSS-only fixes, scoped by `data-lab-*`.
- `src/designers.ts` — approximate public career outlines used as data.

Nothing here ships: the playground is outside the npm workspaces and the
package `files` list.
