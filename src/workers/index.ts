/**
 * Worker-based parallel signing module (generic entry point).
 *
 * Provides secure parallel signature computation using worker threads.
 * Works in both Node.js (worker_threads) and browsers (Web Workers).
 * Uses runtime detection to select the appropriate pool implementation.
 *
 * @example
 * ```typescript
 * import { WorkerSigningPool, SignatureType } from '@btc-vision/bitcoin/workers';
 *
 * // Get singleton pool
 * const pool = WorkerSigningPool.getInstance({ workerCount: 4 });
 *
 * // Keep workers alive for multiple signing operations
 * pool.preserveWorkers();
 *
 * // Prepare signing tasks (one per input)
 * const tasks = [
 *     {
 *         taskId: 'input-0',
 *         inputIndex: 0,
 *         hash: hash0,
 *         signatureType: SignatureType.ECDSA,
 *         sighashType: 0x01,
 *     },
 *     {
 *         taskId: 'input-1',
 *         inputIndex: 1,
 *         hash: hash1,
 *         signatureType: SignatureType.Schnorr,
 *         sighashType: 0x00,
 *     },
 * ];
 *
 * // Sign ALL inputs in parallel
 * const result = await pool.signBatch(tasks, keyPair);
 *
 * if (result.success) {
 *     console.log(`Signed ${result.signatures.size} inputs in ${result.durationMs}ms`);
 * }
 *
 * // Cleanup when done (optional)
 * await pool.shutdown();
 * ```
 *
 * @packageDocumentation
 */

import type { WorkerPoolConfig, SigningPoolLike } from './types.js';

export * from './index.shared.js';

/**
 * Detects the runtime environment and returns the appropriate signing pool.
 *
 * @returns 'node' for Node.js, 'browser' for browsers, 'unknown' otherwise
 */
export function detectRuntime(): 'node' | 'browser' | 'react-native' | 'unknown' {
    if (typeof navigator !== 'undefined' && (navigator as {product?: string}).product === 'ReactNative') {
        return 'react-native';
    }
    if (typeof process !== 'undefined' && process.versions?.node) {
        return 'node';
    }
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
        return 'browser';
    }
    return 'unknown';
}

/**
 * Creates a signing pool appropriate for the current runtime.
 *
 * In Node.js, uses worker_threads.
 * In browsers, uses Web Workers.
 *
 * @param config - Optional pool configuration
 * @returns A promise resolving to the initialized signing pool
 *
 * @example
 * ```typescript
 * import { createSigningPool } from '@btc-vision/bitcoin/workers';
 *
 * const pool = await createSigningPool({ workerCount: 4 });
 * pool.preserveWorkers();
 *
 * // Use pool...
 *
 * await pool.shutdown();
 * ```
 */
export async function createSigningPool(config?: WorkerPoolConfig): Promise<SigningPoolLike> {
    const runtime = detectRuntime();

    if (runtime === 'node') {
        const { NodeWorkerSigningPool } = await import('./WorkerSigningPool.node.js');
        const pool = NodeWorkerSigningPool.getInstance(config);
        await pool.initialize();
        return pool;
    } else if (runtime === 'browser') {
        const { WorkerSigningPool } = await import('./WorkerSigningPool.js');
        const pool = WorkerSigningPool.getInstance(config);
        await pool.initialize();
        return pool;
    } else if (runtime === 'react-native') {
        const { SequentialSigningPool } = await import('./WorkerSigningPool.sequential.js');
        const pool = SequentialSigningPool.getInstance(config);
        await pool.initialize();
        return pool;
    } else {
        throw new Error('Unsupported runtime for worker signing pool');
    }
}
