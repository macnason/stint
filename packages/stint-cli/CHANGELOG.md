# @macworks/stint-cli

## 1.0.0-next.4

### Minor Changes

- [#6](https://github.com/macnason/stint/pull/6) [`64f6918`](https://github.com/macnason/stint/commit/64f6918e20eddb13fafcad13e408e178e229cf90) Thanks [@macnason](https://github.com/macnason)! - Add capability-aware agent onboarding with a direct LinkedIn URL source, a CLI-readable canonical guide, local browser discovery, and validated browser capability reports. Reuse available shared-browser, agent-browser, Puppeteer, or Playwright sessions; hand sign-in to the person and fall back to local documents when browser access is unavailable or blocked. Keep one coordinating agent responsible for reviewing and applying the draft. Reject credentials and misleading hosts in profile URLs.

- [#6](https://github.com/macnason/stint/pull/6) [`484f3c6`](https://github.com/macnason/stint/commit/484f3c6b6606594cd7f3505cb9f5a33a376584fe) Thanks [@macnason](https://github.com/macnason)! - Bundle a browser file picker and editable history review into setup. Designers can upload from their own computer, review dates and roles, and save without file paths or terminal steps. Keep setup in the agent chat by default, offer the Stint-branded file picker only when attachments are unavailable or requested, and require the agent to finish the working timeline integration.

- [#6](https://github.com/macnason/stint/pull/6) [`64f6918`](https://github.com/macnason/stint/commit/64f6918e20eddb13fafcad13e408e178e229cf90) Thanks [@macnason](https://github.com/macnason)! - Add offline LinkedIn PDF and PNG/JPEG import with bundled text extraction and English OCR, a project-independent extract command, editable canonical drafts, and human-readable history review. Bound document processing and block applying unresolved document entries. Fix setup so --dry-run takes precedence over --apply.

- [#6](https://github.com/macnason/stint/pull/6) [`5939600`](https://github.com/macnason/stint/commit/5939600175b415c2eb821728c0322af3fb6ee059) Thanks [@macnason](https://github.com/macnason)! - Add `stint logos`: find each company's logo from its own site, GitHub, Simple Icons, a favicon service or the person's LinkedIn screenshot, reject parked, redirected and placeholder sources, and render optically normalised 256px tiles with a review sheet before writing. Add a `logos` prop to `<Stint>` that renders the generated artwork, and make the copied prompt hand logo work to the CLI instead of the agent.

### Patch Changes

- Updated dependencies [[`5939600`](https://github.com/macnason/stint/commit/5939600175b415c2eb821728c0322af3fb6ee059)]:
  - @macworks/stint@1.0.0-next.4

## 1.0.0-next.3

### Patch Changes

- Discover Chrome Canary and common Chrome-family browsers when launching the visible LinkedIn import flow.

- Updated dependencies []:
  - @macworks/stint@1.0.0-next.3

## 1.0.0-next.2

### Minor Changes

- Make Stint horizontal by default and add a discovered, resumable CLI setup flow with a canonical agent guide.

### Patch Changes

- Updated dependencies []:
  - @macworks/stint@1.0.0-next.2

## 1.0.0-next.1

### Patch Changes

- Keep horizontal timelines readable and scrollable in narrow containers.

- Updated dependencies []:
  - @macworks/stint@1.0.0-next.1
