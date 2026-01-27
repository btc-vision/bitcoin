/**
 * Worker-based parallel signing module.
 *
 * Provides secure parallel signature computation using worker threads.
 * Works in both Node.js (worker_threads) and browsers (Web Workers).
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

// Type exports
export {
    SignatureType,
    type SigningTaskMessage,
    type WorkerInitMessage,
    type WorkerShutdownMessage,
    type WorkerMessage,
    type SigningResultMessage,
    type SigningErrorMessage,
    type WorkerReadyMessage,
    type WorkerShutdownAckMessage,
    type WorkerResponse,
    isSigningError,
    isSigningResult,
    isWorkerReady,
    type WorkerEccLib,
    type WorkerPoolConfig,
    type SigningTask,
    type ParallelSignerKeyPair,
    type ParallelSigningResult,
    WorkerState,
    type PooledWorker,
} from './types.js';

// Browser worker pool
export { WorkerSigningPool, getSigningPool } from './WorkerSigningPool.js';

// Worker code generation (for custom implementations)
export { generateWorkerCode, createWorkerBlobUrl, revokeWorkerBlobUrl } from './signing-worker.js';

// ECC bundle (for embedding in custom workers)
export { ECC_BUNDLE, ECC_BUNDLE_SIZE } from './ecc-bundle.js';

// Node.js specific exports (dynamic import recommended for browser builds)
export { NodeEccLibrary, type NodeWorkerPoolConfig } from './WorkerSigningPool.node.js';

// PSBT parallel signing integration
export {
    signPsbtParallel,
    prepareSigningTasks,
    applySignaturesToPsbt,
    type ParallelSignOptions,
    type PsbtParallelKeyPair,
} from './psbt-parallel.js';

/**
 * Detects the runtime environment and returns the appropriate signing pool.
 *
 * @returns 'node' for Node.js, 'browser' for browsers, 'unknown' otherwise
 */
export function detectRuntime(): 'node' | 'browser' | 'unknown' {
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
export async function createSigningPool(config?: import('./types.js').WorkerPoolConfig): Promise<{
    signBatch: (
        tasks: readonly import('./types.js').SigningTask[],
        keyPair: import('./types.js').ParallelSignerKeyPair,
    ) => Promise<import('./types.js').ParallelSigningResult>;
    preserveWorkers: () => void;
    releaseWorkers: () => void;
    shutdown: () => Promise<void>;
    workerCount: number;
    idleWorkerCount: number;
    busyWorkerCount: number;
    isPreservingWorkers: boolean;
}> {
    const runtime = detectRuntime();

    if (runtime === 'node') {
        // Dynamic import for Node.js to avoid bundler issues
        const { NodeWorkerSigningPool } = await import('./WorkerSigningPool.node.js');
        const pool = NodeWorkerSigningPool.getInstance(config);
        await pool.initialize();
        return pool;
    } else if (runtime === 'browser') {
        const { WorkerSigningPool } = await import('./WorkerSigningPool.js');
        const pool = WorkerSigningPool.getInstance(config);
        await pool.initialize();
        return pool;
    } else {
        throw new Error('Unsupported runtime for worker signing pool');
    }
}
