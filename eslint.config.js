/**
 * ESLint flat config — JSDoc enforcement + core correctness for JS-gen.
 *
 * Focus: require JSDoc on exported functions + validate \@param/\@returns.
 * Private helpers, callbacks, and one-line passthroughs are exempt.
 *
 * no-undef is an error gate: merge/orphan reference bugs (2026-09-16 'gated'
 * incident, trajectory-recording-runner.js) are exactly the class it catches,
 * and pre-commit hooks do not run on merge commits. Globals below are the
 * hand-maintained minimum for this repo's Node runtime code plus a browser
 * override for the /api/docs dashboard modules (loaded via <script type=module>,
 * never imported server-side).
 */
import jsdoc from 'eslint-plugin-jsdoc';

export default [
  {
    ignores: [
      'node_modules/**',
      'nodejs/**',
      'python/**',
      '.superpowers/**',
      'tmp/**',
      'scripts/_scratch/**',
      'scripts/characterization/**',
      'scripts/smoke/**',
      'scripts/vendor/**',
      'migrations/**',
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
        // Node 18+/19+ globals relied on across src/, executor/, scripts/.
        fetch: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        crypto: 'readonly',
        setImmediate: 'readonly',
        queueMicrotask: 'readonly',
        WebSocket: 'readonly',
      },
    },
    rules: {
      // Merge-commit orphan references (see header) are invisible to text pins.
      'no-undef': 'error',
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
  {
    files: ['src/dashboard/api-docs/**'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        location: 'readonly',
        navigator: 'readonly',
        alert: 'readonly',
        Blob: 'readonly',
        localStorage: 'readonly',
      },
    },
  },
  {
    // CommonJS scripts (playwright-runner) parse under the commonjs source
    // type; the wrapper-level globals (__dirname/__filename/require) are
    // declared explicitly because flat config's commonjs sourceType does not
    // provide them in every eslint version.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },
];
