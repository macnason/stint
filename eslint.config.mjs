import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "fixtures/**",
      "coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The CLI, the release scripts, and every test run under Node.
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Only the React component and its hooks touch the DOM.
    files: ["packages/stint/src/**", "packages/stint/test/**"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // These four surface 12 real findings in the component internals —
      // refs written during render, mutation of values React treats as
      // immutable, incomplete effect deps, and a setState inside an effect.
      // The portfolio's eslint-config-next never ran these rules, so the code
      // predates them. They are warnings rather than errors only until the
      // U3/U4 reconciliation rewrites this code against main's design; that
      // work should clear them and these lines should then be deleted.
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // The CLI matches control characters on purpose: it strips ANSI escapes
    // and C0 control bytes out of imported career data and its own output so a
    // hostile file cannot smuggle terminal escape sequences through a log line.
    // Matching them is the sanitisation, not a mistake.
    files: ["packages/stint-cli/**"],
    rules: {
      "no-control-regex": "off",
    },
  },
  {
    rules: {
      // The public API deliberately re-exports types that are not all used
      // internally; unused *arguments* prefixed with _ are also intentional.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
