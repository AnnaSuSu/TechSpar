import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const unusedVars = ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }]

const typescriptConfig = {
  extends: [
    js.configs.recommended,
    tseslint.configs.recommended,
    reactHooks.configs.flat.recommended,
    reactRefresh.configs.vite,
  ],
  languageOptions: {
    ecmaVersion: 2020,
    globals: globals.browser,
  },
  rules: {
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': unusedVars,
  },
}

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    ignores: ['src/resume/**'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // Track identifiers used from JSX as well as from ordinary expressions.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': unusedVars,
    },
  },
  {
    ...typescriptConfig,
    files: ['**/*.{ts,tsx}'],
    ignores: ['src/resume/**'],
  },
  {
    // shadcn/ui 原语同时导出组件和 cva variants
    files: ['src/components/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    ...typescriptConfig,
    files: ['src/resume/**/*.{ts,tsx}'],
    rules: {
      ...typescriptConfig.rules,
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]' }],
      // 移植代码(magic-resume)存量模式,降为警告逐步清理,不阻塞 lint
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      'react-refresh/only-export-components': 'off',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
])
