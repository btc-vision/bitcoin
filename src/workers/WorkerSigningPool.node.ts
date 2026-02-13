/**
 * Node.js-specific worker signing pool implementation.
 *
 * Uses worker_threads module for true parallel execution.
 * Private keys are isolated per-worker and zeroed immediately after signing.
 *
 * @packageDocumentation
 */

import { isMainThread, Worker } from 'worker_threads';
import { cpus } from 'os';
import type {
    BatchSigningMessage,
    BatchSigningResultMessage,
    BatchSigningTask,
    ParallelSignerKeyPair,
    ParallelSigningResult,
    PooledWorker,
    SigningResultMessage,
    SigningTask,
    WorkerPoolConfig,
    WorkerResponse,
} from './types.js';
import { isBatchResult, isWorkerReady, WorkerState } from './types.js';

/**
 * ECC library types for Node.js worker.
 */
export const NodeEccLibrary = {
    /** Pure JS @noble/secp256k1 (default, ~12KB) */
    Noble: 'noble',
    /** WASM-based tiny-secp256k1 (faster, ~1.2MB) */
    TinySecp256k1: 'tiny-secp256k1',
} as const;

export type NodeEccLibrary = (typeof NodeEccLibrary)[keyof typeof NodeEccLibrary];

/**
 * Extended configuration for Node.js worker pool.
 */
export interface NodeWorkerPoolConfig extends WorkerPoolConfig {
    /**
     * ECC library type for signing.
     * - NodeEccLibrary.Noble: Pure JS @noble/secp256k1 (default, ~12KB)
     * - NodeEccLibrary.TinySecp256k1: WASM-based tiny-secp256k1 (faster)
     *
     * Default: NodeEccLibrary.Noble
     */
    readonly eccLibrary?: NodeEccLibrary;
}

/**
 * Default configuration values for Node.js.
 */
const DEFAULT_CONFIG: Required<NodeWorkerPoolConfig> = {
    workerCount: cpus().length,
    taskTimeoutMs: 30000,
    maxKeyHoldTimeMs: 5000,
    verifySignatures: true,
    preserveWorkers: false,
    eccLibrary: NodeEccLibrary.TinySecp256k1,
};

/**
 * Pending batch awaiting completion.
 */
interface PendingBatch {
    readonly batchId: string;
    readonly resolve: (result: BatchSigningResultMessage) => void;
    readonly reject: (error: Error) => void;
    readonly timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Node.js-specific pooled worker.
 */
interface NodePooledWorker extends Omit<PooledWorker, 'worker'> {
    readonly worker: Worker;
}

/**
 * Worker-based parallel signing pool for Node.js.
 *
 * Uses worker_threads for true parallel execution.
 * Provides secure key handling with immediate zeroing after use.
 *
 * @example
 * ```typescript
 * import { NodeWorkerSigningPool } from '@btc-vision/bitcoin/workers';
 *
 * // Initialize pool at app startup
 * const pool = NodeWorkerSigningPool.getInstance({ workerCount: 4 });
 * pool.preserveWorkers();
 *
 * // Sign batch
 * const result = await pool.signBatch(tasks, keyPair);
 *
 * // Cleanup at app shutdown
 * await pool.shutdown();
 * ```
 */
export class NodeWorkerSigningPool {
    /**
     * Singleton instance.
     */
    static #instance: NodeWorkerSigningPool | null = null;

    /**
     * Pool configuration.
     */
    readonly #config: Required<NodeWorkerPoolConfig>;

    /**
     * Worker pool.
     */
    readonly #workers: NodePooledWorker[] = [];

    /**
     * Pending batches awaiting completion.
     */
    readonly #pendingBatches: Map<string, PendingBatch> = new Map();

    /**
     * Worker script as data URL.
     */
    #workerScript: string | null = null;

    /**
     * Whether workers are preserved between batches.
     */
    #preserveWorkers: boolean = false;

    /**
     * Next worker ID counter.
     */
    #nextWorkerId: number = 0;

    /**
     * Next task ID counter.
     */
    #nextTaskId: number = 0;

    /**
     * Whether the pool is initialized.
     */
    #initialized: boolean = false;

    /**
     * Whether the pool is shutting down.
     */
    #shuttingDown: boolean = false;

    /**
     * Creates a new NodeWorkerSigningPool.
     *
     * @param config - Pool configuration
     */
    private constructor(config: NodeWorkerPoolConfig = {}) {
        if (!isMainThread) {
            throw new Error('NodeWorkerSigningPool can only be created in the main thread');
        }
        this.#config = { ...DEFAULT_CONFIG, ...config };
        this.#preserveWorkers = this.#config.preserveWorkers;
    }

    /**
     * Number of workers in the pool.
     */
    public get workerCount(): number {
        return this.#workers.length;
    }

    /**
     * Number of idle workers available.
     */
    public get idleWorkerCount(): number {
        return this.#workers.filter((w) => w.state === WorkerState.Idle).length;
    }

    /**
     * Number of busy workers.
     */
    public get busyWorkerCount(): number {
        return this.#workers.filter((w) => w.state === WorkerState.Busy).length;
    }

    /**
     * Whether workers are being preserved between batches.
     */
    public get isPreservingWorkers(): boolean {
        return this.#preserveWorkers;
    }

    /**
     * Gets the singleton pool instance.
     *
     * @param config - Optional configuration (only used on first call)
     * @returns The singleton pool instance
     */
    public static getInstance(config?: NodeWorkerPoolConfig): NodeWorkerSigningPool {
        if (!NodeWorkerSigningPool.#instance) {
            NodeWorkerSigningPool.#instance = new NodeWorkerSigningPool(config);
        }
        return NodeWorkerSigningPool.#instance;
    }

    /**
     * Resets the singleton instance (for testing).
     */
    public static resetInstance(): void {
        if (NodeWorkerSigningPool.#instance) {
            NodeWorkerSigningPool.#instance.shutdown().catch(() => {});
            NodeWorkerSigningPool.#instance = null;
        }
    }

    /**
     * Enables worker preservation between signing batches.
     */
    public preserveWorkers(): void {
        this.#preserveWorkers = true;
    }

    /**
     * Disables worker preservation.
     */
    public releaseWorkers(): void {
        this.#preserveWorkers = false;
    }

    /**
     * Initializes the worker pool.
     *
     * @returns Promise that resolves when all workers are ready
     */
    public async initialize(): Promise<void> {
        if (this.#initialized) {
            return;
        }

        if (this.#shuttingDown) {
            throw new Error('Cannot initialize pool while shutting down');
        }

        // Create inline worker script
        this.#workerScript = this.#createWorkerScript();

        // Create workers
        const workerPromises: Promise<void>[] = [];
        for (let i = 0; i < this.#config.workerCount; i++) {
            workerPromises.push(this.#createWorker());
        }

        await Promise.all(workerPromises);
        this.#initialized = true;
    }

    /**
     * Signs a batch of tasks in parallel.
     *
     * Tasks are distributed across workers and processed in batches for efficiency.
     *
     * @param tasks - Signing tasks
     * @param keyPair - Key pair with getPrivateKey() method
     * @returns Promise resolving to signing results
     */
    public async signBatch(
        tasks: readonly SigningTask[],
        keyPair: ParallelSignerKeyPair,
    ): Promise<ParallelSigningResult> {
        const startTime = performance.now();

        // Initialize if needed
        if (!this.#initialized) {
            await this.initialize();
        }

        if (tasks.length === 0) {
            return {
                success: true,
                signatures: new Map(),
                errors: new Map(),
                durationMs: performance.now() - startTime,
            };
        }

        // Distribute tasks across workers
        const workerCount = Math.min(this.#workers.length, tasks.length);
        const taskBatches: SigningTask[][] = Array.from({ length: workerCount }, () => []);

        for (let i = 0; i < tasks.length; i++) {
            (taskBatches[i % workerCount] as SigningTask[]).push(tasks[i] as SigningTask);
        }

        // Get private key once
        const privateKey = keyPair.getPrivateKey();

        try {
            // Send batches to workers in parallel
            const batchResults = await Promise.allSettled(
                taskBatches.map((batch, index) =>
                    this.#signBatchOnWorker(batch, privateKey, keyPair.publicKey, index),
                ),
            );

            // Collect all results
            const signatures = new Map<number, SigningResultMessage>();
            const errors = new Map<number, string>();

            for (const result of batchResults) {
                if (result.status === 'fulfilled') {
                    const batchResult = result.value;

                    // Add successful signatures
                    for (const sig of batchResult.results) {
                        signatures.set(sig.inputIndex, {
                            type: 'result',
                            taskId: sig.taskId,
                            signature: sig.signature,
                            inputIndex: sig.inputIndex,
                            publicKey: sig.publicKey,
                            signatureType: sig.signatureType,
                            leafHash: sig.leafHash,
                        });
                    }

                    // Add errors
                    for (const err of batchResult.errors) {
                        errors.set(err.inputIndex, err.error);
                    }
                } else {
                    // Entire batch failed
                    const reason = result.reason as { message?: string } | undefined;
                    const errorMsg = reason?.message ?? 'Batch signing failed';
                    console.error('Batch signing failed:', errorMsg);
                }
            }

            // Cleanup workers if not preserving
            if (!this.#preserveWorkers) {
                await this.#terminateIdleWorkers();
            }

            return {
                success: errors.size === 0,
                signatures,
                errors,
                durationMs: performance.now() - startTime,
            };
        } finally {
            // SECURITY: Zero the key in main thread
            privateKey.fill(0);
        }
    }

    /**
     * Disposes of the pool by shutting down all workers.
     *
     * Enables `await using pool = ...` syntax for automatic cleanup.
     */
    public async [Symbol.asyncDispose](): Promise<void> {
        await this.shutdown();
    }

    /**
     * Shuts down the pool and terminates all workers.
     *
     * @returns Promise that resolves when all workers are terminated
     */
    public async shutdown(): Promise<void> {
        if (this.#shuttingDown) {
            return;
        }

        this.#shuttingDown = true;

        // Terminate all workers
        const terminatePromises = this.#workers.map((worker) => this.#terminateWorker(worker));

        await Promise.all(terminatePromises);

        // Clear state
        this.#workers.length = 0;
        this.#pendingBatches.clear();
        this.#workerScript = null;
        this.#initialized = false;
        this.#shuttingDown = false;
    }

    public [Symbol.dispose](): void {
        void this.shutdown();
    }

    /**
     * Creates the inline worker script for Node.js worker_threads.
     * Supports both @noble/secp256k1 (pure JS) and tiny-secp256k1 (WASM).
     */
    #createWorkerScript(): string {
        // Node.js worker_threads can directly require/import modules
        return `
const { parentPort } = require('worker_threads');

/**
 * Zero out a Uint8Array to clear sensitive data.
 */
function secureZero(arr) {
    if (arr && arr.fill) {
        arr.fill(0);
        // Double-write to prevent optimization
        for (let i = 0; i < arr.length; i++) {
            arr[i] = 0;
        }
    }
}

/**
 * ECC library reference.
 */
let eccLib = null;

/**
 * Initialize ECC library based on type.
 */
async function initEcc(eccType) {
    if (eccType === '${NodeEccLibrary.TinySecp256k1}') {
        // Load tiny-secp256k1 (WASM-based, faster for batch operations)
        const tinysecp = await import('tiny-secp256k1');
        eccLib = {
            sign: (hash, privateKey) => {
                return tinysecp.sign(hash, privateKey);
            },
            signSchnorr: (hash, privateKey) => {
                return tinysecp.signSchnorr(hash, privateKey);
            }
        };
    } else {
        // Default to @noble/secp256k1 (pure JS, no WASM)
        const noble = await import('@noble/secp256k1');
        eccLib = {
            sign: (hash, privateKey) => {
                // noble returns Signature object, we need raw bytes
                const sig = noble.sign(hash, privateKey, { lowS: true });
                return sig.toCompactRawBytes();
            },
            signSchnorr: (hash, privateKey) => {
                return noble.schnorr.sign(hash, privateKey);
            }
        };
    }
}

parentPort.on('message', async (msg) => {
    switch (msg.type) {
        case 'init':
            try {
                await initEcc(msg.eccType || 'tiny-secp256k1');
                parentPort.postMessage({ type: 'ready' });
            } catch (error) {
                parentPort.postMessage({
                    type: 'error',
                    taskId: 'init',
                    error: 'Failed to load ECC library: ' + (error.message || error),
                    inputIndex: -1
                });
            }
            break;

        case 'sign':
            handleSign(msg);
            break;

        case 'signBatch':
            handleSignBatch(msg);
            break;

        case 'shutdown':
            parentPort.postMessage({ type: 'shutdown-ack' });
            process.exit(0);
            break;

        default:
            parentPort.postMessage({
                type: 'error',
                taskId: msg.taskId || 'unknown',
                error: 'Unknown message type: ' + msg.type,
                inputIndex: msg.inputIndex || -1
            });
    }
});

function handleSign(msg) {
    const {
        taskId,
        hash,
        privateKey,
        publicKey,
        signatureType,
        lowR,
        inputIndex,
        sighashType,
        leafHash
    } = msg;

    // Validate inputs
    if (!hash || hash.length !== 32) {
        secureZero(privateKey);
        parentPort.postMessage({
            type: 'error',
            taskId: taskId,
            error: 'Invalid hash: must be 32 bytes',
            inputIndex: inputIndex
        });
        return;
    }

    if (!privateKey || privateKey.length !== 32) {
        secureZero(privateKey);
        parentPort.postMessage({
            type: 'error',
            taskId: taskId,
            error: 'Invalid private key: must be 32 bytes',
            inputIndex: inputIndex
        });
        return;
    }

    if (!eccLib) {
        secureZero(privateKey);
        parentPort.postMessage({
            type: 'error',
            taskId: taskId,
            error: 'ECC library not initialized. Call init first.',
            inputIndex: inputIndex
        });
        return;
    }

    let signature;

    try {
        if (signatureType === 1) {
            // Schnorr signature (BIP340)
            signature = eccLib.signSchnorr(hash, privateKey);
        } else {
            // ECDSA signature
            signature = eccLib.sign(hash, privateKey, { lowR: lowR || false });
        }

        if (!signature) {
            throw new Error('Signing returned null or undefined');
        }

    } catch (error) {
        secureZero(privateKey);
        parentPort.postMessage({
            type: 'error',
            taskId: taskId,
            error: error.message || 'Signing failed',
            inputIndex: inputIndex
        });
        return;
    }

    // CRITICAL: Zero the private key immediately
    secureZero(privateKey);

    const result = {
        type: 'result',
        taskId: taskId,
        signature: signature,
        inputIndex: inputIndex,
        publicKey: publicKey,
        signatureType: signatureType
    };

    if (leafHash) {
        result.leafHash = leafHash;
    }

    parentPort.postMessage(result);
}

function handleSignBatch(msg) {
    const { batchId, tasks, privateKey } = msg;
    const results = [];
    const errors = [];

    // Validate private key once
    if (!privateKey || privateKey.length !== 32) {
        secureZero(privateKey);
        parentPort.postMessage({
            type: 'batchResult',
            batchId: batchId,
            results: [],
            errors: [{ inputIndex: -1, error: 'Invalid private key: must be 32 bytes' }]
        });
        return;
    }

    if (!eccLib) {
        secureZero(privateKey);
        parentPort.postMessage({
            type: 'batchResult',
            batchId: batchId,
            results: [],
            errors: [{ inputIndex: -1, error: 'ECC library not initialized. Call init first.' }]
        });
        return;
    }

    // Process all tasks
    for (const task of tasks) {
        const { taskId, hash, publicKey, signatureType, lowR, inputIndex, sighashType, leafHash } = task;

        // Validate hash
        if (!hash || hash.length !== 32) {
            errors.push({ taskId, inputIndex, error: 'Invalid hash: must be 32 bytes' });
            continue;
        }

        try {
            let signature;
            if (signatureType === 1) {
                // Schnorr signature (BIP340)
                signature = eccLib.signSchnorr(hash, privateKey);
            } else {
                // ECDSA signature
                signature = eccLib.sign(hash, privateKey, { lowR: lowR || false });
            }

            if (!signature) {
                throw new Error('Signing returned null or undefined');
            }

            const result = {
                taskId: taskId,
                signature: signature,
                inputIndex: inputIndex,
                publicKey: publicKey,
                signatureType: signatureType
            };

            if (leafHash) {
                result.leafHash = leafHash;
            }

            results.push(result);
        } catch (error) {
            errors.push({ taskId, inputIndex, error: error.message || 'Signing failed' });
        }
    }

    // CRITICAL: Zero the private key after processing all tasks
    secureZero(privateKey);

    // Send batch result back
    parentPort.postMessage({
        type: 'batchResult',
        batchId: batchId,
        results: results,
        errors: errors
    });
}
`;
    }

    /**
     * Creates a new worker and adds it to the pool.
     */
    async #createWorker(): Promise<void> {
        if (!this.#workerScript) {
            throw new Error('Worker script not created');
        }

        const workerId = this.#nextWorkerId++;

        // Create worker with eval code
        const worker = new Worker(this.#workerScript, {
            eval: true,
            name: `signing-worker-${workerId}`,
        });

        const pooledWorker: NodePooledWorker = {
            id: workerId,
            state: WorkerState.Initializing,
            worker,
            currentTaskId: null,
            taskStartTime: null,
        };

        this.#workers.push(pooledWorker);

        // Wait for worker to be ready
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Worker ${workerId} initialization timeout`));
            }, 10000);

            const messageHandler = (data: WorkerResponse): void => {
                if (isWorkerReady(data)) {
                    clearTimeout(timeout);
                    worker.off('message', messageHandler);
                    pooledWorker.state = WorkerState.Idle;
                    resolve();
                }
            };

            worker.on('message', messageHandler);
            worker.on('error', (error: Error) => {
                clearTimeout(timeout);
                reject(new Error(`Worker ${workerId} error: ${error.message}`));
            });

            // Send init message with ECC library type
            worker.postMessage({
                type: 'init',
                eccType: this.#config.eccLibrary,
            });
        });

        // Set up message handler for signing results
        worker.on('message', (data: WorkerResponse) => {
            this.#handleWorkerMessage(pooledWorker, data);
        });
    }

    /**
     * Signs a batch of tasks on a specific worker.
     */
    async #signBatchOnWorker(
        tasks: readonly SigningTask[],
        privateKey: Uint8Array,
        publicKey: Uint8Array,
        workerIndex: number,
    ): Promise<BatchSigningResultMessage> {
        if (tasks.length === 0) {
            return { type: 'batchResult', batchId: '', results: [], errors: [] };
        }

        // Get worker at index (or wait for idle)
        const worker = this.#workers[workerIndex] ?? (await this.#getIdleWorker());

        // Generate unique batch ID
        const batchId = `batch-${this.#nextTaskId++}`;

        return new Promise<BatchSigningResultMessage>((resolve, reject) => {
            // Set up timeout
            const timeoutId = setTimeout(() => {
                this.#pendingBatches.delete(batchId);
                worker.state = WorkerState.Idle;
                worker.currentTaskId = null;
                worker.taskStartTime = null;

                // SECURITY: Terminate worker that exceeded key hold time
                this.#terminateWorker(worker).catch(() => {});
                this.#createWorker().catch(() => {});

                reject(new Error(`Batch signing timeout for ${tasks.length} tasks`));
            }, this.#config.maxKeyHoldTimeMs);

            // Store pending batch
            const pendingBatch: PendingBatch = {
                batchId,
                resolve,
                reject,
                timeoutId,
            };
            this.#pendingBatches.set(batchId, pendingBatch);

            // Mark worker as busy
            worker.state = WorkerState.Busy;
            worker.currentTaskId = batchId;
            worker.taskStartTime = Date.now();

            // Convert tasks to batch format
            const batchTasks: BatchSigningTask[] = tasks.map((task) => ({
                taskId: task.taskId,
                hash: task.hash,
                publicKey,
                signatureType: task.signatureType,
                lowR: task.lowR,
                inputIndex: task.inputIndex,
                sighashType: task.sighashType,
                leafHash: task.leafHash,
            }));

            // Copy private key for this worker (original shared across workers)
            const workerPrivateKey = new Uint8Array(privateKey);

            // Create batch message
            const message: BatchSigningMessage = {
                type: 'signBatch',
                batchId,
                tasks: batchTasks,
                privateKey: workerPrivateKey,
            };

            // Collect ArrayBuffers for zero-copy transfer.
            // Only transfer buffers unique to this worker batch — NOT publicKey
            // (shared across all worker batches, would detach for other workers).
            const keyBuf = workerPrivateKey.buffer;
            const transferList: ArrayBuffer[] = [keyBuf];
            const seen = new Set<ArrayBuffer>([keyBuf]);
            for (const task of batchTasks) {
                const hashBuf = task.hash.buffer as ArrayBuffer;
                if (!seen.has(hashBuf)) {
                    seen.add(hashBuf);
                    transferList.push(hashBuf);
                }
                if (task.leafHash) {
                    const leafBuf = task.leafHash.buffer as ArrayBuffer;
                    if (!seen.has(leafBuf)) {
                        seen.add(leafBuf);
                        transferList.push(leafBuf);
                    }
                }
            }

            // Send to worker with transfer list (zero-copy)
            worker.worker.postMessage(message, transferList);
        });
    }

    /**
     * Gets an idle worker, creating one if necessary.
     */
    async #getIdleWorker(): Promise<NodePooledWorker> {
        let worker = this.#workers.find((w) => w.state === WorkerState.Idle);

        if (worker) {
            return worker;
        }

        if (this.#workers.length < this.#config.workerCount) {
            await this.#createWorker();
            worker = this.#workers.find((w) => w.state === WorkerState.Idle);
            if (worker) {
                return worker;
            }
        }

        return new Promise<NodePooledWorker>((resolve) => {
            const checkInterval = setInterval(() => {
                const idleWorker = this.#workers.find((w) => w.state === WorkerState.Idle);
                if (idleWorker) {
                    clearInterval(checkInterval);
                    resolve(idleWorker);
                }
            }, 10);
        });
    }

    /**
     * Handles a message from a worker.
     */
    #handleWorkerMessage(worker: NodePooledWorker, response: WorkerResponse): void {
        if (isBatchResult(response)) {
            const pending = this.#pendingBatches.get(response.batchId);
            if (pending) {
                clearTimeout(pending.timeoutId);
                this.#pendingBatches.delete(response.batchId);
                worker.state = WorkerState.Idle;
                worker.currentTaskId = null;
                worker.taskStartTime = null;
                pending.resolve(response);
            }
        }
        // Ignore ready and shutdown-ack messages here (handled elsewhere)
    }

    /**
     * Terminates a worker.
     */
    async #terminateWorker(worker: NodePooledWorker): Promise<void> {
        if (worker.state === WorkerState.Terminated) {
            return;
        }

        worker.state = WorkerState.ShuttingDown;
        worker.worker.postMessage({ type: 'shutdown' });

        await new Promise<void>((resolve) => {
            const timeout = setTimeout(async () => {
                await worker.worker.terminate();
                worker.state = WorkerState.Terminated;
                resolve();
            }, 1000);

            const handler = (data: WorkerResponse): void => {
                if (data.type === 'shutdown-ack') {
                    clearTimeout(timeout);
                    worker.worker.off('message', handler);
                    void worker.worker.terminate().then(() => {
                        worker.state = WorkerState.Terminated;
                        resolve();
                    });
                }
            };

            worker.worker.on('message', handler);
        });

        const index = this.#workers.indexOf(worker);
        if (index >= 0) {
            this.#workers.splice(index, 1);
        }
    }

    /**
     * Terminates all idle workers.
     */
    async #terminateIdleWorkers(): Promise<void> {
        const idleWorkers = this.#workers.filter((w) => w.state === WorkerState.Idle);
        await Promise.all(idleWorkers.map((w) => this.#terminateWorker(w)));
    }
}

/**
 * Convenience function to get the singleton pool instance.
 */
export function getNodeSigningPool(config?: NodeWorkerPoolConfig): NodeWorkerSigningPool {
    return NodeWorkerSigningPool.getInstance(config);
}
