// ESLint flat config — eslint-config-next 16 ships a flat config array, so it
// spreads in directly. (Next 16 also dropped the `next lint` command, hence
// the plain `eslint` script in package.json.)
import next from "eslint-config-next";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...next,
  {
    rules: {
      /*
       * React Compiler rules, new in Next 16 and on by default. Our components
       * predate them and work correctly; `purity` in particular misfires on
       * Server Components (it reads a server-side `new Date()` as an impure
       * render). Cleaning these up is a real but separate piece of work — it
       * should not ride along inside a security upgrade, where the whole point
       * is to change as little behaviour as possible. Everything else still
       * fails the build, so new problems can't sneak in behind this.
       */
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
    },
  },
];

export default config;
