/** Canonical agent-facing setup contract. Keep downstream surfaces derived from this module. */
export const stintCliVersion = "1.0.0-next.1" as const;

export const agentPrompt = `Set up Stint from the project root with:

npx @macworks/stint-cli setup --json

Let the CLI inspect the project and report its inferred paths. Do not invent config or data locations.

Offer these source goals in order:
1. Import a file (LinkedIn PDF, CSV/ZIP, JSON/YAML, DOCX, or résumé PDF).
2. Paste or enter history (canonical JSON, stdin, or manual entry).
3. LinkedIn browser (experimental, visible, opt-in).

For LinkedIn browser import, tell the person: “We don't send your profile or project data to Stint servers; setup runs on your device.” Explain that the visible browser connects directly to LinkedIn, the person signs in there, and Stint never receives credentials. Never enter passwords, MFA, or CAPTCHA for them.

Use one local answers payload for non-TTY decisions: setup --answers answers.json. Review the plan before rerunning with --apply. Use complete_with_handoff when the project is unsupported instead of guessing paths.

Guide version: ${stintCliVersion}`;

export const agentGuideMarkdown = `# Stint setup guide

## Primary command

\`npx @macworks/stint-cli setup --json\` discovers the project, presents a compact source menu, and returns resumable state codes. File imports are local-only and do not call Stint servers.

## Source choices

- **Import a file:** LinkedIn “Save profile as PDF”, résumé PDF/DOCX, LinkedIn CSV/ZIP, JSON, or YAML. The CLI auto-detects supported formats.
- **Paste or enter history:** canonical JSON via stdin or \`add employer\` / \`add role\` prompts.
- **LinkedIn browser (experimental):** use \`setup linkedin --url https://www.linkedin.com/in/... --experimental-browser\`. This opens a visible browser only after consent. The person signs in and handles MFA/CAPTCHA themselves.

Privacy: we don't send your profile or project data to Stint servers; setup runs on your device. Browser mode necessarily connects to LinkedIn. Agent-assisted screenshots, résumé text, and free-form extraction may cross the agent provider boundary; offer local canonical JSON as an alternative.

## Non-TTY answers

Pass one versioned local payload with \`setup --answers answers.json\` (or \`--answers -\`). Omitted safe values are inferred. Review the returned \`ready_to_apply\` plan, then set \`apply: true\` or rerun with \`--apply\`.

## Recovery

States include \`needs_project_choice\`, \`needs_source_choice\`, \`needs_linkedin_consent\`, \`waiting_for_browser_sign_in\`, \`needs_review\`, \`ready_to_apply\`, \`complete\`, \`complete_with_handoff\`, and \`failed_recoverably\`. Unsupported frameworks return a concrete handoff. Do not search until you guess a path.

## Advanced compatibility

Use \`npx @macworks/stint-cli help --advanced\` for legacy path, conflict, format, reference-month, and field flags. The quick surface is \`setup\`, \`import\`, \`validate\`, and \`doctor\`.

Guide version: ${stintCliVersion}
`;

export const llmsText = `# Stint\n\n${agentPrompt}\n\nRead the full guide at the package guide export.\n`;

export function guideBundle(): {
  readonly version: string;
  readonly prompt: string;
  readonly markdown: string;
  readonly llms: string;
} {
  return { version: stintCliVersion, prompt: agentPrompt, markdown: agentGuideMarkdown, llms: llmsText };
}
