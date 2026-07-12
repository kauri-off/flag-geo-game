// ESLint flat config: typescript-eslint recommended + React hooks rules.
// Generated protocol types are excluded (they're buf output, not hand-written).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'build', 'node_modules', 'src/online/gen'] },
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    // Just the two classic hooks rules. The v7 "recommended" preset also ships
    // the React-Compiler-derived rules (refs/immutability/set-state-in-effect),
    // which reject the deliberate imperative escape hatches WorldMap uses for
    // its animation hot path.
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
