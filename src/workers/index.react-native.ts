/**
 * React Native entry point for the workers module.
 *
 * Provides the same public API as the browser/Node.js workers module
 * but uses WorkletSigningPool (parallel via react-native-worklets)
 * when available, falling back to SequentialSigningPool (main-thread).
 *
 * @packageDocumentation
 */

// Type exports (same as main index.ts)
export {
    SignatureType,
    type SigningTaskMessage,
    type BatchSigningMessage,
    type BatchSigningTask,
    type BatchSigningResultMessage,
    type BatchSigningTaskResult,
    type BatchSigningTaskError,
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
    isBatchResult,
    isWorkerReady,
    type WorkerEccLib,
    type WorkerPoolConfig,
    type SigningTask,
    type ParallelSignerKeyPair,
    type ParallelSigningResult,
    type SigningPoolLike,
    WorkerState,
    type PooledWorker,
} from './types.js';

// Sequential pool (React Native fallback)
export { SequentialSigningPool } from './WorkerSigningPool.sequential.js';

// Worklet pool (React Native parallel signing)
export { WorkletSigningPool } from './WorkerSigningPool.worklet.js';

// Alias for API compatibility — consumers using `WorkerSigningPool` get the sequential pool
export { SequentialSigningPool as WorkerSigningPool } from './WorkerSigningPool.sequential.js';

// PSBT parallel signing integration (works with any SigningPoolLike)
export {
    signPsbtParallel,
    prepareSigningTasks,
    applySignaturesToPsbt,
    type ParallelSignOptions,
    type PsbtParallelKeyPair,
} from './psbt-parallel.js';

/**
 * Detects the runtime environment.
 *
 * @returns Always 'react-native' in this entry point.
 */
export function detectRuntime(): 'node' | 'browser' | 'react-native' | 'unknown' {
    return 'react-native';
}

/**
 * Cached result of the worklets availability check.
 * `null` = not yet checked, `true` = available, `false` = unavailable.
 */
let workletsAvailable: boolean | null = null;

/**
 * Creates a signing pool appropriate for the React Native runtime.
 *
 * Tries to use WorkletSigningPool (parallel via react-native-worklets).
 * Falls back to SequentialSigningPool if worklets are not installed.
 */
export async function createSigningPool(
    config?: import('./types.js').WorkerPoolConfig,
): Promise<import('./types.js').SigningPoolLike> {
    // Check worklets availability (cached after first probe)
    if (workletsAvailable === null) {
        try {
            await import('react-native-worklets' as string);
            workletsAvailable = true;
        } catch {
            workletsAvailable = false;
        }
    }

    if (workletsAvailable) {
        try {
            const { WorkletSigningPool } = await import('./WorkerSigningPool.worklet.js');
            const pool = WorkletSigningPool.getInstance(config);
            await pool.initialize();
            return pool;
        } catch {
            // Initialization failed (e.g. eval blocked) — fall through
            workletsAvailable = false;
        }
    }

    const { SequentialSigningPool } = await import('./WorkerSigningPool.sequential.js');
    const pool = SequentialSigningPool.getInstance(config);
    await pool.initialize();
    return pool;
}
