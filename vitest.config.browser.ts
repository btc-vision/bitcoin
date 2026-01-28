import { resolve } from 'path';
import { defineConfig } from 'vitest/config';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
    resolve: {
        alias: {
            crypto: resolve(__dirname, 'src/crypto/crypto-browser.js'),
            stream: 'stream-browserify',
            buffer: 'buffer',
            zlib: 'browserify-zlib',
        },
    },
    plugins: [
        wasm(),
        topLevelAwait(),
        nodePolyfills({
            globals: {
                Buffer: true,
                global: true,
                process: true,
            },
        }),
    ],
    optimizeDeps: {
        exclude: ['tiny-secp256k1'],
    },
    test: {
        globals: true,
        include: [
            // Browser-compatible existing tests (no Node.js deps)
            'test/address.spec.ts',
            'test/block.spec.ts',
            'test/bufferutils.spec.ts',
            'test/crypto.spec.ts',
            'test/bitcoin.core.spec.ts',
            'test/transaction.spec.ts',
            'test/types.spec.ts',
            'test/script_number.spec.ts',
            'test/script_signature.spec.ts',
            'test/workers.spec.ts',
            'test/workers-pool.spec.ts',
            // Browser-adapted versions
            'test/browser/payments.spec.ts',
            'test/browser/psbt.spec.ts',
            'test/browser/workers-signing.spec.ts',
            'test/browser/script.spec.ts',
        ],
        exclude: [
            'test/integration/**/*.ts',
            // Originals that need Node.js APIs
            'test/payments.spec.ts',
            'test/psbt.spec.ts',
            'test/workers-signing.spec.ts',
            'test/script.spec.ts',
        ],
        testTimeout: 30000,
        browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            headless: true,
        },
    },
});
