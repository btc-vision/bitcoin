import { resolve } from 'path';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import dts from 'vite-plugin-dts';

export default defineConfig({
    build: {
        outDir: 'browser',
        emptyOutDir: true,
        target: 'esnext',
        minify: 'esbuild',
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            formats: ['es'],
            fileName: () => 'index.js',
        },
        rollupOptions: {
            output: {
                chunkFileNames: 'chunks/[name]-[hash].js',
                manualChunks: {
                    'crypto': [
                        'src/crypto.ts',
                        'src/crypto/crypto.ts',
                    ],
                    'psbt': [
                        'src/psbt.ts',
                        'src/psbt/bip371.ts',
                        'src/psbt/psbtutils.ts',
                    ],
                    'payments': [
                        'src/payments/index.ts',
                        'src/payments/p2pkh.ts',
                        'src/payments/p2pk.ts',
                        'src/payments/p2ms.ts',
                        'src/payments/p2sh.ts',
                        'src/payments/p2wpkh.ts',
                        'src/payments/p2wsh.ts',
                        'src/payments/p2tr.ts',
                        'src/payments/p2op.ts',
                        'src/payments/embed.ts',
                        'src/payments/bip341.ts',
                        'src/payments/lazy.ts',
                    ],
                    'transaction': [
                        'src/transaction.ts',
                        'src/block.ts',
                    ],
                    'script': [
                        'src/script.ts',
                        'src/script_number.ts',
                        'src/script_signature.ts',
                        'src/opcodes.ts',
                    ],
                    'utils': [
                        'src/bufferutils.ts',
                        'src/push_data.ts',
                        'src/bip66.ts',
                        'src/merkle.ts',
                        'src/types.ts',
                    ],
                },
            },
        },
    },
    resolve: {
        alias: {
            crypto: resolve(__dirname, 'src/crypto/crypto-browser.js'),
            stream: 'stream-browserify',
            buffer: 'buffer',
            zlib: 'browserify-zlib',
        },
    },
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        global: 'globalThis',
    },
    plugins: [
        nodePolyfills({
            globals: {
                Buffer: true,
                global: true,
                process: true,
            },
        }),
        dts({
            outDir: 'browser',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'test/**/*'],
            insertTypesEntry: true,
            copyDtsFiles: true,
        }),
    ],
});
