# @macnason/stint-cli

Authoring and import tooling for [Stint](https://github.com/macnason/stint)
career timelines. It writes canonical JSON plus a generated, typed TypeScript
literal — atomically, so a failed run leaves no half-written config.

```bash
npx @macnason/stint-cli help
```

Node 22 or newer is required.

## Commands

```text
stint init     --project DIR --config FILE --data FILE --conflict POLICY
stint add employer --id ID --company NAME --start YYYY-MM --end YYYY-MM|current|null \
               --role-id ID --role-title TITLE --role-start YYYY-MM
stint add role --employer-id ID --id ID --title TITLE --start YYYY-MM
stint validate --project DIR --config FILE [--reference-month YYYY-MM]
stint import   INPUT --format auto|json|yaml|linkedin-csv|linkedin-zip
stint help
```

Every mutating command takes `--dry-run` and `--json`.

## Importing

`stint import` reads JSON, YAML, a LinkedIn CSV export, or a LinkedIn ZIP
archive. Imports are local-only — nothing is uploaded, and no network request is
made.

```bash
stint import ~/Downloads/Basic_LinkedIn_Data_Export.zip \
  --format linkedin-zip \
  --project . --config stint.config.json --data stint.data.ts \
  --conflict abort
```

## Conflict policies

`abort` (the default in a TTY), `skip`, or `overwrite`. Non-interactive
mutations require complete path flags and an explicit policy, so a script can
never silently overwrite a config it did not expect to find.

## Dates

Employer starts are inclusive; non-current employer ends are exclusive. `current`
and `null` both mark an entry active through the reference month. `validate`
reports gaps, overlaps, roles outside their employer's span, multiple current
entries, and future-dated entries.

## Not included

Preview, presentation and UI wrappers, themes, tokens, and CSS scaffolding are
deliberately out of scope. The CLI authors data; the runtime renders it.

## License

MIT © Mac Nason
