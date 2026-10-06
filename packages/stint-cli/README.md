# @macworks/stint-cli

Authoring and import tooling for [Stint](https://github.com/macnason/stint)
career timelines. It writes canonical JSON plus a generated, typed TypeScript
literal — atomically, so a failed run leaves no half-written config.

## Start with your agent

Copy the setup prompt from the Stint docs into your coding agent. The agent handles installation, project checks, and connecting the timeline to your page.

1. **Share your history.** Choose or drop a LinkedIn PDF/screenshot in the setup window, attach it in the chat, or share your LinkedIn URL.
2. **Review it.** Correct companies, roles, and dates, then choose **Use this history**.
3. **See your timeline.** Your agent finishes the page and gives you a working preview.

No file paths or terminal commands are needed from the designer. The file picker reads from the designer's computer even when the project runs on a remote host. Files are processed on that host, not sent to Stint servers.

### For agents and developers

```bash
npx @macworks/stint-cli setup --wizard --json
```

Keep the process running in the background. Open the returned link; for remote projects use approved private preview forwarding, preserving the URL fragment. If forwarding is unavailable, use a chat attachment instead. The session expires after one hour. Stop it when finished. The wizard is bundled in the CLI with no additional UI dependencies. Node 22 or newer is required.

The wizard saves history and installs the runtime when needed. The agent then places the component in the page and verifies the result. `doctor` is an optional diagnostic command, not an onboarding step.

## Developer commands

```text
stint guide [--json]
stint extract INPUT [--output draft.json] [--json]
stint setup --wizard [--project DIR] [--port PORT] [--json]
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

## Scripted imports

For scripted workflows outside the designer wizard:

```bash
npx @macworks/stint-cli extract ~/Downloads/Profile.pdf --output draft.json
# Review/edit draft.json, then from your site project:
npx @macworks/stint-cli setup draft.json
npx @macworks/stint-cli setup draft.json --apply
```

You can also preview a PDF or PNG/JPEG screenshot directly with `stint setup FILE`.
The preview shows companies, roles, dates, and warnings; `--json` includes the
canonical draft. `extract` works without a project and never overwrites an existing
output file. If some entries cannot be resolved, direct application is blocked:
extract a draft, check missing entries against the original, and correct it first.
A dry run never applies files, even when `--apply` is also present.

PDF text is extracted first. Image-only pages and screenshots use bundled English
OCR. Both engines and the English model ship inside this npm package, load only
for document imports, and work offline after npm installation. No system OCR,
Python, browser, native canvas, API key, or model download is needed. Nothing is
uploaded. The React runtime does not include the document engines.

Supported document layouts are English LinkedIn profile PDFs and Experience
screenshots. Crop screenshots to the Experience section. Always review OCR:
complex layouts, grouped roles with descriptions, and missing month precision may
need manual correction. This is not a general semantic résumé parser. DOCX and
free-form history still require a canonical JSON draft.

Limits: 8 MiB per document, 20 PDF pages, 16 megapixels per screenshot/rendered
page, and 90 seconds per extraction. Split large inputs into smaller files.
`stint import` also accepts JSON, YAML, LinkedIn CSV, and LinkedIn ZIP archives.

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

## Agent-assisted onboarding

Give your agent a LinkedIn URL or a file you already have. The agent reads
`stint guide --json`, lets setup inspect the project automatically, and
recommends one route using the browser tools it already has.

```bash
stint setup https://www.linkedin.com/in/example --json
```

This returns a capability handoff without opening a browser or changing the
project. The CLI detects local browser executables, but cannot inspect the
agent's tool catalog or confirm login. The agent reports its usable shared
browser, agent-browser, Puppeteer, or Playwright session through
`answers.capabilities.browser`; `stint guide --json` documents the exact payload.
No additional browser package is installed.

An accessible headless session can capture the Experience section. If sign-in
is needed, the person uses an interactive browser. Blocked access or an
inaccessible sign-in falls back to bundled PDF/OCR. Existing files go straight
to local extraction. Agent interpretation of rendered text follows the agent
provider's data boundary; `consent.agentProviderBoundary: false` recommends
local file processing.

The coordinating agent creates one draft, presents the employers/roles/dates,
resolves uncertain entries, then applies the reviewed configuration. Browser
helpers only capture data. The CLI-owned visible-browser command remains
experimental and explicit.

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
