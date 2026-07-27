import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/.turbo/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
];
