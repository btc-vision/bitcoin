/**
 * Shared worker module exports.
 *
 * Contains all platform-agnostic exports used by browser, Node.js, and generic
 * entry points. Platform-specific entry points re-export from this module and
 * add their own `detectRuntime` and `createSigningPool` implementations.
 *
 * @packageDocumentation
 */

// Type exports
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

// Browser worker pool
export { WorkerSigningPool, getSigningPool } from './WorkerSigningPool.js';

// Worker code generation (for custom implementations)
export { generateWorkerCode, createWorkerBlobUrl, revokeWorkerBlobUrl } from './signing-worker.js';

// ECC bundle (for embedding in custom workers)
export { ECC_BUNDLE, ECC_BUNDLE_SIZE } from './ecc-bundle.js';

// PSBT parallel signing integration
export {
    signPsbtParallel,
    prepareSigningTasks,
    applySignaturesToPsbt,
    type ParallelSignOptions,
    type PsbtParallelKeyPair,
} from './psbt-parallel.js';
