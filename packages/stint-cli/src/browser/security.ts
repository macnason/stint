import { CliError } from "../diagnostics.js";

const LINKEDIN_HOSTS = new Set(["linkedin.com", "www.linkedin.com"]);

export function validateLinkedInProfileUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new CliError("E_URL", "LinkedIn profile URL must be a valid HTTPS URL.", { cause: error, exitCode: 2 });
  }
  if (url.protocol !== "https:" || !LINKEDIN_HOSTS.has(url.hostname.toLowerCase()) || !url.pathname.startsWith("/in/")) {
    throw new CliError("E_URL", "LinkedIn profile URL must use https://www.linkedin.com/in/... .", { exitCode: 2 });
  }
  return url;
}

export function isAllowedLinkedInNavigation(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && LINKEDIN_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
