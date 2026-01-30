/**
 * Worker thread types for parallel signing operations.
 *
 * SECURITY NOTES:
 * - Private keys are NEVER shared via SharedArrayBuffer
 * - Keys are cloned via postMessage (isolated per worker)
 * - Keys are zeroed immediately after signing
 * - Workers are pooled for performance but keys don't persist
 *
 * @packageDocumentation
 */

/**
 * Signature type enum for worker operations.
 */
export const SignatureType = {
    /** ECDSA signature (secp256k1) */
    ECDSA: 0,
    /** Schnorr signature (BIP340) */
    Schnorr: 1,
} as const;

export type SignatureType = (typeof SignatureType)[keyof typeof SignatureType];

/**
 * Message sent to worker for signing operation.
 *
 * SECURITY: privateKey is cloned via postMessage, NOT shared.
 * Worker MUST zero the key after signing.
 */
export interface SigningTaskMessage {
    /** Message type discriminator */
    readonly type: 'sign';
    /** Task identifier for correlation */
    readonly taskId: string;
    /** Hash to sign (32 bytes) */
    readonly hash: Uint8Array;
    /** Private key (32 bytes) - WILL BE ZEROED after use */
    readonly privateKey: Uint8Array;
    /** Public key for verification (33 or 65 bytes) */
    readonly publicKey: Uint8Array;
    /** Signature type (ECDSA or Schnorr) */
    readonly signatureType: SignatureType;
    /** Low R signing for ECDSA (optional) */
    readonly lowR?: boolean | undefined;
    /** Input index this signature is for */
    readonly inputIndex: number;
    /** Sighash type for encoding */
    readonly sighashType: number;
    /** Leaf hash for Taproot script-path (optional) */
    readonly leafHash?: Uint8Array | undefined;
}

/**
 * Initialization message for worker with ECC library.
 */
export interface WorkerInitMessage {
    /** Message type discriminator */
    readonly type: 'init';
    /** Serialized ECC library functions (or library identifier) */
    readonly eccLibId: string;
}

/**
 * Shutdown message for worker.
 */
export interface WorkerShutdownMessage {
    /** Message type discriminator */
    readonly type: 'shutdown';
}

/**
 * Individual task in a batch (without privateKey - shared across batch).
 */
export interface BatchSigningTask {
    /** Task identifier */
    readonly taskId: string;
    /** Hash to sign (32 bytes) */
    readonly hash: Uint8Array;
    /** Public key for verification */
    readonly publicKey: Uint8Array;
    /** Signature type */
    readonly signatureType: SignatureType;
    /** Low R for ECDSA */
    readonly lowR?: boolean | undefined;
    /** Input index */
    readonly inputIndex: number;
    /** Sighash type */
    readonly sighashType: number;
    /** Leaf hash for Taproot */
    readonly leafHash?: Uint8Array | undefined;
}

/**
 * Batch signing message - multiple tasks with single private key.
 * More efficient than sending tasks one at a time.
 */
export interface BatchSigningMessage {
    /** Message type discriminator */
    readonly type: 'signBatch';
    /** Batch identifier for correlation */
    readonly batchId: string;
    /** Tasks to sign */
    readonly tasks: readonly BatchSigningTask[];
    /** Private key (32 bytes) - WILL BE ZEROED after all tasks */
    readonly privateKey: Uint8Array;
}

/**
 * Individual result from a batch.
 */
export interface BatchSigningTaskResult {
    /** Task identifier */
    readonly taskId: string;
    /** Signature bytes */
    readonly signature: Uint8Array;
    /** Input index */
    readonly inputIndex: number;
    /** Public key used */
    readonly publicKey: Uint8Array;
    /** Signature type */
    readonly signatureType: SignatureType;
    /** Leaf hash (if applicable) */
    readonly leafHash?: Uint8Array | undefined;
}

/**
 * Individual error from a batch.
 */
export interface BatchSigningTaskError {
    /** Task identifier */
    readonly taskId: string;
    /** Input index */
    readonly inputIndex: number;
    /** Error message */
    readonly error: string;
}

/**
 * Batch result message from worker.
 */
export interface BatchSigningResultMessage {
    /** Message type discriminator */
    readonly type: 'batchResult';
    /** Batch identifier for correlation */
    readonly batchId: string;
    /** Successful results */
    readonly results: readonly BatchSigningTaskResult[];
    /** Errors */
    readonly errors: readonly BatchSigningTaskError[];
}

/**
 * All possible messages to worker.
 */
export type WorkerMessage =
    | SigningTaskMessage
    | BatchSigningMessage
    | WorkerInitMessage
    | WorkerShutdownMessage;

/**
 * Result from worker after signing.
 */
export interface SigningResultMessage {
    /** Message type discriminator */
    readonly type: 'result';
    /** Task identifier for correlation */
    readonly taskId: string;
    /** Signature bytes (64 bytes raw for Schnorr, or with sighash for ECDSA) */
    readonly signature: Uint8Array;
    /** Input index this signature is for */
    readonly inputIndex: number;
    /** Public key used for signing */
    readonly publicKey: Uint8Array;
    /** Signature type that was used */
    readonly signatureType: SignatureType;
    /** Leaf hash for Taproot script-path spending (if applicable) */
    readonly leafHash?: Uint8Array | undefined;
}

/**
 * Error result from worker.
 */
export interface SigningErrorMessage {
    /** Message type discriminator */
    readonly type: 'error';
    /** Task identifier for correlation */
    readonly taskId: string;
    /** Error message */
    readonly error: string;
    /** Input index that failed */
    readonly inputIndex: number;
}

/**
 * Worker ready message.
 */
export interface WorkerReadyMessage {
    /** Message type discriminator */
    readonly type: 'ready';
}

/**
 * Worker shutdown acknowledgment.
 */
export interface WorkerShutdownAckMessage {
    /** Message type discriminator */
    readonly type: 'shutdown-ack';
}

/**
 * Union of all worker response types.
 */
export type WorkerResponse =
    | SigningResultMessage
    | SigningErrorMessage
    | BatchSigningResultMessage
    | WorkerReadyMessage
    | WorkerShutdownAckMessage;

/**
 * Type guard for error responses.
 */
export function isSigningError(response: WorkerResponse): response is SigningErrorMessage {
    return response.type === 'error';
}

/**
 * Type guard for success responses.
 */
export function isSigningResult(response: WorkerResponse): response is SigningResultMessage {
    return response.type === 'result';
}

/**
 * Type guard for batch result responses.
 */
export function isBatchResult(response: WorkerResponse): response is BatchSigningResultMessage {
    return response.type === 'batchResult';
}

/**
 * Type guard for ready responses.
 */
export function isWorkerReady(response: WorkerResponse): response is WorkerReadyMessage {
    return response.type === 'ready';
}

/**
 * Interface for the ECC library used by workers.
 * Provides signing functions for ECDSA and Schnorr signatures.
 */
export interface WorkerEccLib {
    /**
     * Create an ECDSA signature.
     *
     * @param hash - 32-byte hash to sign
     * @param privateKey - 32-byte private key
     * @param lowR - Optional: grind for low R value
     * @returns 64-byte raw signature (r || s)
     */
    sign(hash: Uint8Array, privateKey: Uint8Array, lowR?: boolean): Uint8Array;

    /**
     * Create a Schnorr signature (BIP340).
     *
     * @param hash - 32-byte hash to sign
     * @param privateKey - 32-byte private key
     * @returns 64-byte Schnorr signature
     */
    signSchnorr(hash: Uint8Array, privateKey: Uint8Array): Uint8Array;
}

/**
 * Configuration for the worker signing pool.
 */
export interface WorkerPoolConfig {
    /**
     * Number of workers to create.
     * Default: number of CPU cores (navigator.hardwareConcurrency or os.cpus().length)
     */
    readonly workerCount?: number;

    /**
     * Timeout per signing operation in milliseconds.
     * Worker is terminated if exceeded (key safety measure).
     * Default: 30000 (30 seconds)
     */
    readonly taskTimeoutMs?: number;

    /**
     * Maximum time a worker can hold a private key in milliseconds.
     * Acts as a safety net - worker is terminated if signing takes too long.
     * Default: 5000 (5 seconds)
     */
    readonly maxKeyHoldTimeMs?: number;

    /**
     * Whether to verify signatures after signing.
     * Adds overhead but ensures correctness.
     * Default: true
     */
    readonly verifySignatures?: boolean;

    /**
     * Whether to preserve workers between signing batches.
     * true = workers stay alive (faster for multiple batches)
     * false = workers terminated after each batch (more secure)
     * Default: true (use preserveWorkers() to enable)
     */
    readonly preserveWorkers?: boolean;
}

/**
 * Signing task for the worker queue.
 */
export interface SigningTask {
    /** Task identifier */
    readonly taskId: string;
    /** Input index */
    readonly inputIndex: number;
    /** Hash to sign (32 bytes) */
    readonly hash: Uint8Array;
    /** Signature type */
    readonly signatureType: SignatureType;
    /** Low R for ECDSA */
    readonly lowR?: boolean | undefined;
    /** Sighash type */
    readonly sighashType: number;
    /** Leaf hash for Taproot script-path */
    readonly leafHash?: Uint8Array | undefined;
}

/**
 * Signer key pair interface for parallel signing.
 *
 * SECURITY: getPrivateKey() is only called when dispatching to worker.
 * The returned bytes are cloned to the worker and then the original
 * should be considered potentially compromised (in main thread memory).
 *
 * For maximum security, use a hardware wallet that never exposes keys.
 */
export interface ParallelSignerKeyPair {
    /** Public key (compressed 33 bytes or uncompressed 65 bytes) */
    readonly publicKey: Uint8Array;

    /**
     * Get private key bytes (32 bytes).
     *
     * SECURITY WARNING: This exposes the raw private key.
     * - Called only when dispatching to worker
     * - Key is cloned to worker via postMessage
     * - Original in main thread should be zeroed by caller if possible
     *
     * For high-security applications, use hardware wallets instead.
     */
    getPrivateKey(): Uint8Array;

    /**
     * Optional: Sign ECDSA directly (fallback if workers unavailable).
     */
    sign?(hash: Uint8Array, lowR?: boolean): Uint8Array;

    /**
     * Optional: Sign Schnorr directly (fallback if workers unavailable).
     */
    signSchnorr?(hash: Uint8Array): Uint8Array;
}

/**
 * Result of a parallel signing batch.
 */
export interface ParallelSigningResult {
    /** Whether all signatures were created successfully */
    readonly success: boolean;
    /** Signatures indexed by input index */
    readonly signatures: ReadonlyMap<number, SigningResultMessage>;
    /** Errors indexed by input index */
    readonly errors: ReadonlyMap<number, string>;
    /** Total time taken in milliseconds */
    readonly durationMs: number;
}

/**
 * Worker state for pool management.
 */
export const WorkerState = {
    /** Worker is initializing */
    Initializing: 0,
    /** Worker is ready and idle */
    Idle: 1,
    /** Worker is processing a task */
    Busy: 2,
    /** Worker is shutting down */
    ShuttingDown: 3,
    /** Worker has terminated */
    Terminated: 4,
} as const;

export type WorkerState = (typeof WorkerState)[keyof typeof WorkerState];

/**
 * Minimum contract for any signing pool implementation.
 *
 * Implemented by WorkerSigningPool (browser), NodeWorkerSigningPool (Node.js),
 * and SequentialSigningPool (React Native / fallback).
 */
export interface SigningPoolLike extends Disposable, AsyncDisposable {
    signBatch(
        tasks: readonly SigningTask[],
        keyPair: ParallelSignerKeyPair,
    ): Promise<ParallelSigningResult>;
    preserveWorkers(): void;
    releaseWorkers(): void;
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    readonly workerCount: number;
    readonly idleWorkerCount: number;
    readonly busyWorkerCount: number;
    readonly isPreservingWorkers: boolean;
}

/**
 * Internal worker wrapper for pool management.
 */
export interface PooledWorker {
    /** Unique worker identifier */
    readonly id: number;
    /** Current worker state */
    state: WorkerState;
    /** The actual worker instance */
    readonly worker: Worker;
    /** Current task ID (if busy) */
    currentTaskId: string | null;
    /** Timestamp when current task started */
    taskStartTime: number | null;
}
