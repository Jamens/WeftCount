import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import prettier from 'eslint-config-prettier'

/**
 * 统一 ESLint 配置（flat config）。
 * - 纯 TS（NestJS / shared / 桌面 main）：node globals + TS 推荐规则
 * - React/TSX（admin / 桌面 renderer）：browser globals + React + Hooks 规则
 * - 末尾接入 eslint-config-prettier，关闭与 Prettier 冲突的规则，避免双标
 *
 * 仅使用语法级规则（不开启需要 type info 的规则），
 * 因此无需安装各 app 运行时依赖即可运行 lint。
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/*.mjs',
      '**/*.js',
      '**/*.cjs',
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-namespace': 'off',
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/*.tsx'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '19' } },
    rules: {
      'react/react-in-jsx-scope': 'off', // React 17+ 新 JSX transform
      'react/prop-types': 'off', // 类型由 TypeScript 负责
      'react/display-name': 'off', // 匿名组件常见，先不强制
      'react/no-unknown-property': 'off', // 容忍 data-*/自定义属性
      'react/jsx-key': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  prettier,
)
