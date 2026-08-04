import { CliError } from "../diagnostics.js";

const LINKEDIN_HOSTS = new Set(["linkedin.com", "www.linkedin.com"]);

function isLinkedInHttpsOrigin(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return url.protocol === "https:"
    && (url.port === "" || url.port === "443")
    && (LINKEDIN_HOSTS.has(hostname) || hostname.endsWith(".licdn.com"));
}

export function validateLinkedInProfileUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new CliError("E_URL", "LinkedIn profile URL must be a valid HTTPS URL.", { cause: error, exitCode: 2 });
  }
  if (!isLinkedInHttpsOrigin(url) || !url.pathname.startsWith("/in/")) {
    throw new CliError("E_URL", "LinkedIn profile URL must use https://www.linkedin.com/in/... .", { exitCode: 2 });
  }
  return url;
}

export function isAllowedLinkedInNavigation(value: string): boolean {
  try {
    const url = new URL(value);
    return isLinkedInHttpsOrigin(url);
  } catch {
    return false;
  }
}
