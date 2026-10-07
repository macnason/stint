import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { CliError } from "../diagnostics.js";
import type { LogoEngineRequest, LogoEngineResponse } from "./types.js";

/** Runs the bundled, offline logo engine in a worker with bounded time and memory. */
export function runLogoEngine(request: Omit<LogoEngineRequest, "resvgWasm">): Promise<LogoEngineResponse> {
  let resvgWasm: Uint8Array;
  try {
    resvgWasm = readFileSync(new URL("../../dist/logos/resvg.wasm", import.meta.url));
  } catch (error) {
    throw new CliError("E_IO", "The bundled logo engine is missing. Reinstall the CLI and try again.", { cause: error });
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../../dist/logos/engine.cjs", import.meta.url), {
      workerData: { logoEngine: true },
      resourceLimits: { maxOldGenerationSizeMb: 1024 },
      stdout: true,
      stderr: true,
    });
    let finished = false;
    const finish = (error?: Error, response?: LogoEngineResponse) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(response!);
    };
    const timer = setTimeout(
      () => finish(new CliError("E_IMPORT_LIMIT", "Logo processing exceeded 120 seconds. Try fewer companies.")),
      120_000,
    );
    worker.stdout.resume();
    worker.stderr.resume();
    worker.once("message", (message: { response?: LogoEngineResponse; error?: string }) => {
      if (message.response) finish(undefined, message.response);
      else finish(new CliError("E_IMPORT_PARSE", "The logo engine could not process these images."));
    });
    worker.once("error", (error) =>
      finish(new CliError("E_IMPORT_PARSE", "The bundled logo engine could not start. Reinstall the CLI and try again.", { cause: error })),
    );
    worker.once("exit", () => finish(new CliError("E_IMPORT_PARSE", "Logo processing stopped before completion.")));
    worker.postMessage({ ...request, resvgWasm });
  });
}
