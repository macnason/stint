import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { CliError } from "./diagnostics.js";

export interface ProjectContext {
  readonly root: string;
  readonly manifestPath: string;
  readonly manifest?: Readonly<Record<string, unknown>>;
}

export interface ProjectInspection {
  readonly project: ProjectContext;
  readonly framework: "next" | "vite" | "unknown";
  readonly packageManager: "npm" | "pnpm" | "yarn" | "bun" | "unknown";
  readonly workspaceRoot: string;
  readonly existingStintDependency: boolean;
  readonly likelyConfigPath: string;
  readonly likelyDataPath: string;
  readonly existingFiles: readonly string[];
  readonly ambiguities: readonly string[];
}

export interface PathSnapshot {
  readonly path: string;
  readonly exists: boolean;
  readonly device?: number;
  readonly inode?: number;
}

export interface SafeDestination {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly snapshots: readonly PathSnapshot[];
}

export function resolveProject(projectPath: string): ProjectContext {
  let root: string;
  try {
    root = realpathSync(resolve(projectPath));
  } catch (error) {
    throw new CliError("E_PROJECT", "The selected project directory does not exist.", {
      cause: error,
      path: projectPath,
    });
  }
  if (!statSync(root).isDirectory()) {
    throw new CliError("E_PROJECT", "The selected project path is not a directory.", {
      path: projectPath,
    });
  }

  const manifestPath = join(root, "package.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileNoFollow(manifestPath).toString("utf8"));
  } catch (error) {
    throw new CliError("E_PROJECT", "The project must contain valid package.json JSON.", {
      cause: error,
      path: "package.json",
    });
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new CliError("E_PROJECT", "The project package.json must contain an object.", {
      path: "package.json",
    });
  }

  return {
    root,
    manifestPath,
    manifest: manifest as Readonly<Record<string, unknown>>,
  };
}

/** Find the nearest package project without requiring callers to supply paths. */
export function discoverProject(startPath = process.cwd()): ProjectContext {
  let current = realpathSync(resolve(startPath));
  if (!statSync(current).isDirectory()) current = dirname(current);
  for (;;) {
    const candidate = join(current, "package.json");
    try {
      return resolveProject(current);
    } catch (error) {
      if (!(error instanceof CliError) || !isMissing(error.cause)) throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new CliError("E_PROJECT", "No package.json project was found in the current directory or its ancestors.");
}

export function inspectProject(startPath = process.cwd()): ProjectInspection {
  const project = discoverProject(startPath);
  const manifest = project.manifest ?? {};
  const dependencies = {
    ...asRecord(manifest.dependencies),
    ...asRecord(manifest.devDependencies),
  };
  const framework =
    typeof dependencies.next === "string"
      ? "next"
      : typeof dependencies.vite === "string"
        ? "vite"
        : "unknown";
  const packageManager = detectPackageManager(project.root);
  const existingStintDependency =
    typeof dependencies["@macworks/stint"] === "string" ||
    typeof dependencies["@macworks/stint-cli"] === "string";
  const likelyConfigPath = "stint.config.json";
  const likelyDataPath = "src/stint.data.ts";
  const existingFiles = [likelyConfigPath, likelyDataPath].filter((path) => {
    try {
      return lstatSync(join(project.root, path)).isFile();
    } catch {
      return false;
    }
  });
  const ambiguities = framework === "unknown" ? ["framework"] : [];
  return {
    project,
    framework,
    packageManager,
    workspaceRoot: project.root,
    existingStintDependency,
    likelyConfigPath,
    likelyDataPath,
    existingFiles,
    ambiguities,
  };
}

function detectPackageManager(root: string): ProjectInspection["packageManager"] {
  for (const [name, manager] of [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
    ["package-lock.json", "npm"],
  ] as const) {
    try {
      if (lstatSync(join(root, name)).isFile()) return manager;
    } catch {
      // Continue through the lockfile candidates.
    }
  }
  return "npm";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function prepareDestination(
  projectRoot: string,
  destinationPath: string,
): SafeDestination {
  if (!destinationPath || isAbsolute(destinationPath) || destinationPath.includes("\0")) {
    throw new CliError("E_SECURITY", "Destination paths must be relative to the project.", {
      path: destinationPath,
    });
  }
  const root = realpathSync(projectRoot);
  const absolutePath = resolve(root, destinationPath);
  assertContained(root, absolutePath, destinationPath);

  const relativePath = relative(root, absolutePath).split(sep).join("/");
  const snapshots = snapshotPath(root, absolutePath, relativePath);
  return { absolutePath, relativePath, snapshots };
}

export function recheckDestination(
  projectRoot: string,
  destination: SafeDestination,
  options: { readonly ignoreLeaf?: boolean } = {},
): void {
  const current = snapshotPath(
    projectRoot,
    destination.absolutePath,
    destination.relativePath,
  );
  if (current.length !== destination.snapshots.length) {
    throw changedPath(destination.relativePath);
  }
  const checkedLength = options.ignoreLeaf
    ? Math.max(0, current.length - 1)
    : current.length;
  for (let index = 0; index < checkedLength; index += 1) {
    const expected = destination.snapshots[index];
    const actual = current[index];
    if (
      !expected ||
      !actual ||
      expected.exists !== actual.exists ||
      expected.device !== actual.device ||
      expected.inode !== actual.inode
    ) {
      throw changedPath(destination.relativePath);
    }
  }
}

export function assertCurrentDestinationSafe(
  projectRoot: string,
  absolutePath: string,
  relativePath: string,
): void {
  snapshotPath(projectRoot, absolutePath, relativePath);
}

export function readFileNoFollow(path: string): Buffer {
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | noFollow);
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) {
      throw new CliError("E_SECURITY", "Expected a regular file.");
    }
    return readFileSync(descriptor);
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

function snapshotPath(
  projectRoot: string,
  absolutePath: string,
  displayPath: string,
): PathSnapshot[] {
  const root = realpathSync(projectRoot);
  assertContained(root, absolutePath, displayPath);
  const relativePath = relative(root, absolutePath);
  const segments = relativePath ? relativePath.split(sep) : [];
  const snapshots: PathSnapshot[] = [];
  let current = root;

  for (const segment of segments) {
    current = join(current, segment);
    try {
      const metadata = lstatSync(current);
      if (metadata.isSymbolicLink()) {
        throw new CliError("E_SECURITY", "Destination paths cannot contain symlinks.", {
          path: displayPath,
        });
      }
      if (current !== absolutePath && !metadata.isDirectory()) {
        throw new CliError("E_SECURITY", "A destination ancestor is not a directory.", {
          path: displayPath,
        });
      }
      const resolved = realpathSync(current);
      assertContained(root, resolved, displayPath);
      snapshots.push({
        path: current,
        exists: true,
        device: metadata.dev,
        inode: metadata.ino,
      });
    } catch (error) {
      if (error instanceof CliError) throw error;
      if (isMissing(error)) {
        snapshots.push({ path: current, exists: false });
        for (const remaining of segments.slice(snapshots.length)) {
          current = join(current, remaining);
          snapshots.push({ path: current, exists: false });
        }
        break;
      }
      throw new CliError("E_IO", "A destination path could not be inspected.", {
        cause: error,
        path: displayPath,
      });
    }
  }
  return snapshots;
}

function assertContained(root: string, path: string, displayPath: string): void {
  const fromRoot = relative(root, path);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new CliError("E_SECURITY", "Destination escapes the selected project root.", {
      path: displayPath,
    });
  }
}

function changedPath(path: string): CliError {
  return new CliError(
    "E_SECURITY",
    "A destination path changed after the transaction was planned.",
    { path },
  );
}

export function isMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
