import { resolve } from "node:path";

import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      entryRoot: "src",
      tsconfigPath: "./tsconfig.json",
    }),
  ],
  // A published library must emit the production JSX runtime. Left to its
  // default, oxc emits `react/jsx-dev-runtime`, which breaks any consumer that
  // resolves the production or server condition — Next's prerender fails with
  // "jsxDEV is not a function". Never infer this from the build mode.
  oxc: {
    jsx: {
      runtime: "automatic",
      development: false,
    },
  },
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: [/^react(?:\/.*)?$/, /^react-dom(?:\/.*)?$/, /^motion(?:\/.*)?$/],
      output: {
        preserveModules: true,
        preserveModulesRoot: "src",
        // Rolldown preserves each module's own "use client" directive, so the
        // client boundary follows the source and the server-safe schema,
        // timeline, and types chunks stay directive-free. Do not add a banner
        // to reinstate it: that emits the directive twice. exports.test.ts
        // enforces the invariant in both directions.
        entryFileNames: "[name].js",
      },
    },
    sourcemap: true,
  },
});
