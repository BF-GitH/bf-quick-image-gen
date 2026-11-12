import js from '@eslint/js';
import globals from 'globals';

// Host globals are declared ONLY for src/host: using SillyTavern, toastr or jQuery anywhere else
// fails `no-undef`, which backs up the layering rule checked by tests/architecture.test.js.
const hostGlobals = {
    SillyTavern: 'readonly',
    toastr: 'readonly',
    $: 'readonly',
    jQuery: 'readonly',
};

export default [
    { ignores: ['node_modules/**'] },
    js.configs.recommended,
    {
        rules: {
            'eqeqeq': ['error', 'always'],
            'no-var': 'error',
            'prefer-const': 'error',
            'no-alert': 'error',
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
        },
    },
    {
        files: ['index.js', 'src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: { ...globals.browser },
        },
    },
    {
        files: ['src/host/**/*.js'],
        languageOptions: {
            globals: { ...globals.browser, ...hostGlobals },
        },
    },
    {
        files: ['tests/**/*.js', 'dev/**/*.mjs', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: { ...globals.node },
        },
    },
];
