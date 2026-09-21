// Flat ESLint config. D-019: eslint runs over the *emitted* JavaScript in `dist/` plus the
// project's own `.js`/`.mjs` files, because parsing TypeScript would require
// `typescript-eslint` — a runtime-free but extra devDependency that D-001 rules out.
// The TypeScript-only checks live in `tsc`'s strict flags (`npm run typecheck`).
// `npm run lint` therefore builds first. G-016 holds the question of what this misses.

export default [
  {
    ignores: ['node_modules/**', 'data/**', 'src/**', 'test/**', 'scripts/**/*.ts'],
  },
  {
    files: ['dist/**/*.js', 'scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-fallthrough': 'error',
      'no-unused-vars': ['error', { args: 'none' }],
      'no-throw-literal': 'error',
      'no-return-assign': 'error',
      'no-self-compare': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
];
