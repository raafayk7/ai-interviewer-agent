import { config } from "@repo/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    // TypeScript validates prop types; react/prop-types is redundant in TS codebases.
    rules: {
      "react/prop-types": "off",
    },
  },
];
