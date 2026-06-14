import { config } from "@repo/eslint-config/base";
import globals from "globals";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    // Backend runs on Node — make node globals (console, process, fetch, Buffer,
    // URL, timers, …) available so the live-validation .mjs scripts don't trip
    // no-undef. TS files already disable no-undef via typescript-eslint.
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
