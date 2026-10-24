import tseslint from 'typescript-eslint';

export default tseslint.config(
  // site/ is a separate sub-project (the marketing site) with its own build
  // tooling — the mailman package lint must not scan its source or dist bundle.
  // .remember/ is git-ignored assistant scratch state, not source.
  { ignores: ['dist/**', 'node_modules/**', 'site/**', '.remember/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
