# Residual review findings: simplified Stint setup

This file records explicit plan work that is not complete in the current implementation. It is intentionally separate from the implementation plan so the deferred work remains visible to the next resolver.

## P1: incomplete plan requirements

- **R12-R13 / U8:** Browser records are normalized directly into `StintConfig`. There is no private staging model with provenance, field confidence, or field-level review. Date-less browser records are warned and dropped, but uncertain company, location, role grouping, and logo fields are not reviewable before import.
- **R8:** The CLI does not parse PDF or DOCX bytes directly. The guide truthfully routes those sources through a local or agent-produced canonical JSON draft before `setup`.
- **R15 / U9:** Setup writes canonical JSON and a typed module, but it does not generate the narrow Next App Router/Vite component and style integration promised by the plan. The package install receipt is real, but a supported project still needs an agent handoff to render Stint.
- **R16 / U10:** Browser logo URLs are bounded and parsed, but no local asset is copied, no presentation manifest is generated, and no accent color is sampled. The runtime schema remains correctly free of presentation metadata.
- **R28 / U11:** Package install execution is shell-free and script-disabled, but it does not expose a lockfile diff, cancellation hook, integrity digest, or durable resume receipt beyond the current JSON response.
- **R31-R32 / U12:** Browser request interception and temporary profile cleanup are present. There is no persisted checkpoint/resume flow, stale-session expiry, interrupted-process cleanup test, or explicit browser PID checkpoint.
- **R29 / U14:** The portfolio site currently uses a generated local guide adapter because the published package consumed by the site does not expose the guide export at the required release boundary. The adapter is synchronized and version-tested, but exact published-package consumption is still blocked on a package release.
- **R36 / U15:** Browser promotion evidence is not present. The implementation has no ten-fixture corpus, five-run smoke record, owner decision record, or sunset check.

## Testing gaps

- No live LinkedIn smoke run was performed because it requires a person to sign in and complete LinkedIn's human checks. The browser path was exercised only through bounded importer fixtures and a non-TTY consent gate.
- No packed consumer test covers `puppeteer-core`, the visible browser launch, or the browser cleanup lifecycle.
- No Next/Vite integration fixture asserts that setup produces a rendered component with the installed dependency.
- No logo asset download, SVG rejection, image-size limit, or accent sampling test exists because that enrichment path is not yet implemented.

## Decision for the next resolver

Keep browser import experimental and non-blocking for core setup. Prioritize the staging/review boundary, presentation manifest and local logo asset contract, then a packed browser lifecycle fixture before adding broader framework integration or promoting the browser path.
