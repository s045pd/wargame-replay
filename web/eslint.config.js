import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Downgrade new React 19 recommendations to warnings (not bugs, just best-practice)
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      // Allow unused vars prefixed with _
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Allow explicit any in pragmatic cases
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
