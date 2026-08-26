/**
 * ESLint flat config — JSDoc enforcement for JS-gen.
 *
 * Focus: require JSDoc on exported functions + validate \@param/\@returns.
 * Private helpers, callbacks, and one-line passthroughs are exempt.
 * ctrl-actions/** is ignored (byte-pinned string fragments, see docs/jsdoc-convention.md).
 */
import jsdoc from 'eslint-plugin-jsdoc';

export default [
  {
    ignores: [
      'node_modules/**',
      'nodejs/**',
      'python/**',
      'src/ctrl-actions/**',
      '.superpowers/**',
      'tmp/**',
      'scripts/_scratch/**',
      'scripts/characterization/**',
      'scripts/smoke/**',
    ],
  },
  jsdoc.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
    rules: {
      // Only require JSDoc on exported functions (publicOnly), not private helpers.
      // ArrowFunctionExpression + FunctionExpression enabled so exported consts are covered.
      'jsdoc/require-jsdoc': ['warn', {
        publicOnly: true,
        require: {
          FunctionDeclaration: true,
          FunctionExpression: true,
          ArrowFunctionExpression: true,
          MethodDefinition: true,
          ClassDeclaration: true,
        },
        exemptEmptyFunctions: true,
        enableFixer: false,
      }],
      'jsdoc/require-param': 'warn',
      'jsdoc/require-returns': 'warn',
      'jsdoc/check-param-names': 'warn',
      'jsdoc/check-types': 'warn',
    },
  },
];
