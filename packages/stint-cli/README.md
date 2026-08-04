# @macworks/stint-cli

Authoring and import tooling for [Stint](https://github.com/macnason/stint)
career timelines. It writes canonical JSON plus a generated, typed TypeScript
literal — atomically, so a failed run leaves no half-written config.

```bash
npx @macworks/stint-cli help
```

Node 22 or newer is required.

## Commands

```text
stint setup [SOURCE] [--answers FILE|-] [--apply] [--json]
stint import INPUT [--json]
stint validate [--json]
stint doctor [--json]
stint help
```

The quick surface infers the project root, canonical config path, generated data
path, input format, current reference month, and abort-on-conflict policy. Use
`stint help --advanced` for legacy path, conflict, format, date, and field flags.

`setup` returns a reviewable plan before writing. Non-TTY choices use one local
`--answers FILE|-` JSON payload; no command prompts in non-TTY mode.

## Importing

`stint import` reads JSON, YAML, a LinkedIn CSV export, or a LinkedIn ZIP
archive. Imports are local-only — nothing is uploaded, and no network request is
made. LinkedIn's supported convenience path is **Save profile as PDF**; PDF,
DOCX, screenshots, and free-form history can be converted to canonical JSON
locally or with an agent before being passed to `setup`.

The experimental browser path is explicit and visible:

```bash
stint setup linkedin \
  --url https://www.linkedin.com/in/example \
  --experimental-browser
```

The person signs in in the visible browser and handles MFA/CAPTCHA themselves.
Stint does not receive credentials or send profile/project data to Stint servers;
browser requests still go directly to LinkedIn.

```bash
stint import ~/Downloads/Basic_LinkedIn_Data_Export.zip \
  --format linkedin-zip \
  --project . --config stint.config.json --data stint.data.ts \
  --conflict abort
```

## Conflict policies

`abort` (the default), `skip`, or `overwrite`. Existing low-level commands keep
explicit path flags for compatibility, but the quick setup/import/validate flow
infers safe defaults and never silently overwrites a changed target.

## Dates

Employer starts are inclusive; non-current employer ends are exclusive. `current`
and `null` both mark an entry active through the reference month. `validate`
reports gaps, overlaps, roles outside their employer's span, multiple current
entries, and future-dated entries.

## Agent guide

The package exports the canonical guide and derived surfaces from
`@macworks/stint-cli/guide`:

```js
import { agentGuideMarkdown, agentPrompt, llmsText } from "@macworks/stint-cli/guide";
```

The website and optional skill wrapper should consume this export rather than
copying an independent setup workflow.

## License

MIT © Mac Nason
