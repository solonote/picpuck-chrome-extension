import globals from 'globals';

/**
 * core 内源文件禁止 import agents（R16、§12.1）。
 * 例外：仓库根目录 background.js 仅作 MV3 入口，可 import 各 agents 目录下的 register.js。
 */
export default [
  {
    ignores: ['node_modules/**', 'dist/**'],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.es2021,
        chrome: 'readonly',
      },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/agents/**', '../agents/**', './agents/**'],
              message: 'core 禁止 import agents/*（R16）；注册仅由根目录 background.js 拉取。',
            },
          ],
        },
      ],
    },
    files: ['src/core/**/*.js'],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.es2021,
        chrome: 'readonly',
      },
    },
    files: ['src/agents/**/*.js', 'src/content/**/*.js', 'background.js', 'scripts/**/*.mjs'],
  },
];
