import { resolve } from 'path';
import { defineConfig, type Plugin } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import dts from 'vite-plugin-dts';

const BROWSER_WORKERS_INDEX = resolve(__dirname, 'src/workers/index.browser.ts');

// Redirect all imports of workers/index to the browser-specific entry
// which never references Node.js modules (worker_threads, os, etc.)
function browserWorkersRedirect(): Plugin {
    const workersIndex = resolve(__dirname, 'src/workers/index.ts');
    return {
        name: 'browser-workers-redirect',
        enforce: 'pre',
        resolveId(source, importer) {
            if (!importer) return null;
            // Match resolved path to workers/index.ts (from relative ./workers/index.js imports)
            if (source === './workers/index.js' || source === './workers/index.ts') {
                const resolvedDir = resolve(importer, '..');
                const resolved = resolve(resolvedDir, 'workers/index.ts');
                if (resolved === workersIndex) {
                    return BROWSER_WORKERS_INDEX;
                }
            }
            return null;
        },
    };
}

export default defineConfig({
    build: {
        outDir: 'browser',
        emptyOutDir: true,
        target: 'esnext',
        minify: 'esbuild',
        lib: {
            entry: {
                index: resolve(__dirname, 'src/index.ts'),
                'workers/index': BROWSER_WORKERS_INDEX,
            },
            formats: ['es'],
            fileName: (_format, entryName) => `${entryName}.js`,
        },
        rollupOptions: {
            output: {
                chunkFileNames: 'chunks/[name]-[hash].js',
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
        browserWorkersRedirect(),
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
