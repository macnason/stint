import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const out = resolve("packages/stint-cli/dist/documents");
mkdirSync(out, { recursive: true });
mkdirSync(resolve("packages/stint-cli/dist/wizard"), { recursive: true });
copyFileSync("packages/stint-cli/src/wizard/index.html", "packages/stint-cli/dist/wizard/index.html");
const core = require.resolve(
  "tesseract.js-core/tesseract-core-simd-lstm.wasm.js"
);
const settings = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  minify: true,
  metafile: true,
  legalComments: "eof",
  define: { "import.meta.url": "__bundleUrl" },
  banner: {
    js: "const __bundleUrl = require('node:url').pathToFileURL(__filename).href; globalThis.fetch = async () => { throw new Error('Document extraction is offline'); };",
  },
};
const engine = await build({
  ...settings,
  entryPoints: ["packages/stint-cli/src/documents/engine.ts"],
  outfile: join(out, "engine.cjs"),
});
const ocr = await build({
  ...settings,
  entryPoints: [
    require.resolve("tesseract.js/src/worker-script/node/index.js"),
  ],
  outfile: join(out, "ocr.cjs"),
  plugins: [
    {
      name: "single-lstm-core",
      setup(builder) {
        builder.onResolve({ filter: /^tesseract\.js-core\// }, () => ({
          path: core,
        }));
      },
    },
  ],
});
copyFileSync(
  require.resolve("@hyzyla/pdfium/pdfium.wasm"),
  join(out, "pdfium.wasm")
);
copyFileSync(
  join(
    dirname(require.resolve("@tesseract.js-data/eng")),
    "4.0.0_best_int/eng.traineddata.gz"
  ),
  join(out, "eng.traineddata.gz")
);
// Preserve upstream licenses for the code and data included in this package.
const licenses = new Map();
for (const file of [
  ...Object.keys(engine.metafile.inputs),
  ...Object.keys(ocr.metafile.inputs),
  require.resolve("@tesseract.js-data/eng"),
]) {
  if (!file.includes("node_modules/")) continue;
  let dir = dirname(resolve(file));
  while (dir !== dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (!licenses.has(pkg.name)) {
        let license = "";
        for (const name of [
          "LICENSE",
          "LICENSE.md",
          "LICENSE.txt",
          "LICENSE-MIT",
          "license",
        ]) {
          try {
            license = readFileSync(join(dir, name), "utf8");
            break;
          } catch {
            /* Try the next conventional license filename. */
          }
        }
        licenses.set(
          pkg.name,
          `${pkg.name} ${pkg.version} (${pkg.license})\n${license}`
        );
      }
      break;
    } catch {
      dir = dirname(dir);
    }
  }
}
writeFileSync(
  join(out, "THIRD-PARTY-NOTICES.txt"),
  [...licenses.values()].join("\n\n-----\n\n")
);
