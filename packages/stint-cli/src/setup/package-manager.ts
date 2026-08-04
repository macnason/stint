import { CliError } from "../diagnostics.js";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface PackageInstallPlan {
  readonly manager: PackageManager;
  readonly command: string;
  readonly argv: readonly string[];
  readonly packageName: string;
  readonly version: string;
  readonly registry: string;
  readonly scripts: "disabled";
}

export interface InstallReceipt {
  readonly packageName: string;
  readonly version: string;
  readonly manager: PackageManager;
  readonly status: "planned" | "succeeded" | "failed";
  readonly resumeAction: "rerun-install" | "continue-integration" | "inspect-lockfile";
}

export function planPackageInstall(
  manager: PackageManager,
  packageName: string,
  version: string,
  registry = "https://registry.npmjs.org/",
): PackageInstallPlan {
  if (!/^@?[a-z0-9][a-z0-9._/-]*$/.test(packageName) || packageName.includes("..")) {
    throw new CliError("E_OPTION", "Package names must be exact registry package names.");
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new CliError("E_OPTION", "Package versions must be exact semver values.");
  }
  const parsedRegistry = new URL(registry);
  if (parsedRegistry.protocol !== "https:" || parsedRegistry.username || parsedRegistry.password) {
    throw new CliError("E_SECURITY", "Package installs require an HTTPS registry without credentials.");
  }
  const spec = `${packageName}@${version}`;
  const args = {
    npm: ["install", "--save-exact", "--ignore-scripts", "--no-audit", "--no-fund", "--registry", parsedRegistry.toString(), spec],
    pnpm: ["add", "--save-exact", "--ignore-scripts", "--registry", parsedRegistry.toString(), spec],
    yarn: ["add", "--exact", "--ignore-scripts", "--registry", parsedRegistry.toString(), spec],
    bun: ["add", "--exact", "--no-save", "--registry", parsedRegistry.toString(), spec],
  }[manager];
  if (!args) throw new CliError("E_OPTION", `Unsupported package manager: ${manager}.`);
  return {
    manager,
    command: manager,
    argv: args,
    packageName,
    version,
    registry: parsedRegistry.toString(),
    scripts: "disabled",
  };
}

export function installReceipt(
  plan: PackageInstallPlan,
  status: InstallReceipt["status"],
): InstallReceipt {
  return {
    packageName: plan.packageName,
    version: plan.version,
    manager: plan.manager,
    status,
    resumeAction: status === "succeeded" ? "continue-integration" : "inspect-lockfile",
  };
}
