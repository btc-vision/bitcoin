// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigDirName: import.meta.dirname,
            },
        },
        rules: {
            'no-undef': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            'no-empty': 'off',
            '@typescript-eslint/restrict-template-expressions': 'off',
            '@typescript-eslint/only-throw-error': 'off',
            '@typescript-eslint/no-unnecessary-condition': 'off',
            '@typescript-eslint/unbound-method': 'warn',
            '@typescript-eslint/no-confusing-void-expression': 'off',
            '@typescript-eslint/no-extraneous-class': 'off',
            'no-async-promise-executor': 'off',
            '@typescript-eslint/no-misused-promises': 'off',
            '@typescript-eslint/no-unnecessary-type-parameters': 'off',
            '@typescript-eslint/no-duplicate-enum-values': 'off',
            'prefer-spread': 'off',
            '@typescript-eslint/no-empty-object-type': 'off',
            /** TO FIX */
            '@typescript-eslint/no-unsafe-call': 'warn',
            '@typescript-eslint/no-unsafe-assignment': 'warn',
            'prefer-rest-params': 'warn',
            '@typescript-eslint/restrict-plus-operands': 'warn',
            '@typescript-eslint/no-unsafe-member-access': 'warn',
            '@typescript-eslint/no-unsafe-return': 'warn',
            '@typescript-eslint/no-require-imports': 'warn',
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unsafe-argument': 'warn',
            '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
            '@typescript-eslint/no-non-null-assertion': 'warn',
            '@typescript-eslint/no-invalid-void-type': 'warn',
            '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'warn',
            '@typescript-eslint/no-unnecessary-template-expression': 'warn',
            'no-case-declarations': 'warn',
            '@typescript-eslint/ban-ts-comment': 'warn',
            '@typescript-eslint/no-deprecated': 'warn',

            // Stupid new eslint rule that can cause nice bugs.
            'no-useless-assignment': 'off',
        },
    },
    {
        files: ['**/*.js'],
        ...tseslint.configs.disableTypeChecked,
    },
);
