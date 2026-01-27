/**
 * Worker-based parallel signing pool.
 *
 * Provides secure parallel signature computation using worker threads.
 * Private keys are isolated per-worker and zeroed immediately after signing.
 *
 * SECURITY ARCHITECTURE:
 * - Keys are NEVER shared via SharedArrayBuffer
 * - Each key is cloned to ONE worker via postMessage
 * - Keys are zeroed in worker immediately after signing
 * - Workers can be preserved for performance or terminated for security
 *
 * @example
 * ```typescript
 * import { WorkerSigningPool } from '@btc-vision/bitcoin';
 *
 * // Get singleton pool instance
 * const pool = WorkerSigningPool.getInstance();
 *
 * // Preserve workers for multiple signing operations (faster)
 * pool.preserveWorkers();
 *
 * // Sign multiple inputs in parallel
 * const result = await pool.signBatch(tasks, keyPair);
 *
 * // Shutdown when done (optional - cleans up workers)
 * await pool.shutdown();
 * ```
 *
 * @packageDocumentation
 */

import type {
    WorkerPoolConfig,
    SigningTask,
    ParallelSignerKeyPair,
    ParallelSigningResult,
    SigningResultMessage,
    WorkerResponse,
    SigningTaskMessage,
    PooledWorker,
} from './types.js';
import {
    WorkerState,
    SignatureType,
    isSigningResult,
    isSigningError,
    isWorkerReady,
} from './types.js';
import { createWorkerBlobUrl, revokeWorkerBlobUrl } from './signing-worker.js';

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: Required<WorkerPoolConfig> = {
    workerCount: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4, // Node.js fallback
    taskTimeoutMs: 30000,
    maxKeyHoldTimeMs: 5000,
    verifySignatures: true,
    preserveWorkers: false,
};

/**
 * Pending task awaiting completion.
 */
interface PendingTask {
    readonly taskId: string;
    readonly resolve: (result: SigningResultMessage) => void;
    readonly reject: (error: Error) => void;
    readonly timeoutId: ReturnType<typeof setTimeout>;
    readonly inputIndex: number;
}

/**
 * Worker-based parallel signing pool.
 *
 * Manages a pool of worker threads for parallel signature computation.
 * Provides secure key handling with immediate zeroing after use.
 *
 * @example
 * ```typescript
 * // Initialize pool at app startup
 * const pool = WorkerSigningPool.getInstance({ workerCount: 4 });
 * pool.preserveWorkers();
 *
 * // Use for PSBT signing
 * const tasks = prepareSigningTasks(psbt, keyPair);
 * const result = await pool.signBatch(tasks, keyPair);
 *
 * // Apply signatures to PSBT
 * applySignatures(psbt, result.signatures);
 * ```
 */
export class WorkerSigningPool {
    /**
     * Singleton instance.
     */
    static #instance: WorkerSigningPool | null = null;

    /**
     * Pool configuration.
     */
    readonly #config: Required<WorkerPoolConfig>;

    /**
     * Worker pool.
     */
    readonly #workers: PooledWorker[] = [];

    /**
     * Pending tasks awaiting completion.
     */
    readonly #pendingTasks: Map<string, PendingTask> = new Map();

    /**
     * Worker blob URL (shared across all workers).
     */
    #workerBlobUrl: string | null = null;

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
     * Creates a new WorkerSigningPool.
     *
     * @param config - Pool configuration
     */
    private constructor(config: WorkerPoolConfig = {}) {
        this.#config = { ...DEFAULT_CONFIG, ...config };
        this.#preserveWorkers = this.#config.preserveWorkers;
    }

    /**
     * Gets the singleton pool instance.
     *
     * @param config - Optional configuration (only used on first call)
     * @returns The singleton pool instance
     *
     * @example
     * ```typescript
     * const pool = WorkerSigningPool.getInstance({ workerCount: 8 });
     * ```
     */
    public static getInstance(config?: WorkerPoolConfig): WorkerSigningPool {
        if (!WorkerSigningPool.#instance) {
            WorkerSigningPool.#instance = new WorkerSigningPool(config);
        }
        return WorkerSigningPool.#instance;
    }

    /**
     * Resets the singleton instance (for testing).
     */
    public static resetInstance(): void {
        if (WorkerSigningPool.#instance) {
            WorkerSigningPool.#instance.shutdown().catch(() => {});
            WorkerSigningPool.#instance = null;
        }
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
     * Enables worker preservation between signing batches.
     *
     * When enabled, workers remain alive after completing a batch,
     * ready for the next signing operation. This is faster but
     * keeps workers in memory.
     *
     * Call shutdown() when done to terminate all workers.
     *
     * @example
     * ```typescript
     * const pool = WorkerSigningPool.getInstance();
     * pool.preserveWorkers(); // Enable at app startup
     *
     * // ... do many signing operations ...
     *
     * await pool.shutdown(); // Cleanup at app shutdown
     * ```
     */
    public preserveWorkers(): void {
        this.#preserveWorkers = true;
    }

    /**
     * Disables worker preservation.
     *
     * Workers will be terminated after each signing batch.
     * More secure (no persistent workers) but slower for multiple batches.
     */
    public releaseWorkers(): void {
        this.#preserveWorkers = false;
    }

    /**
     * Initializes the worker pool.
     *
     * Creates workers and waits for them to be ready.
     * Called automatically on first signBatch() if not called manually.
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

        // Create worker blob URL
        this.#workerBlobUrl = createWorkerBlobUrl();

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
     * SECURITY: Private keys are obtained via keyPair.getPrivateKey() and
     * cloned to workers. Keys are zeroed in workers immediately after signing.
     *
     * @param tasks - Signing tasks (hashes, input indices, etc.)
     * @param keyPair - Key pair with getPrivateKey() method
     * @returns Promise resolving to signing results
     *
     * @example
     * ```typescript
     * const tasks: SigningTask[] = [
     *     { taskId: '1', inputIndex: 0, hash: hash0, signatureType: SignatureType.ECDSA, sighashType: 0x01 },
     *     { taskId: '2', inputIndex: 1, hash: hash1, signatureType: SignatureType.Schnorr, sighashType: 0x00 },
     * ];
     *
     * const result = await pool.signBatch(tasks, keyPair);
     *
     * if (result.success) {
     *     for (const [inputIndex, sig] of result.signatures) {
     *         console.log(`Input ${inputIndex}: ${sig.signature}`);
     *     }
     * }
     * ```
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

        // Sign all tasks
        const results = await Promise.allSettled(
            tasks.map((task) => this.#signSingleTask(task, keyPair)),
        );

        // Collect results
        const signatures = new Map<number, SigningResultMessage>();
        const errors = new Map<number, string>();

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const task = tasks[i];

            if (result.status === 'fulfilled') {
                signatures.set(task.inputIndex, result.value);
            } else {
                errors.set(task.inputIndex, result.reason?.message || 'Unknown error');
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
    }

    /**
     * Shuts down the pool and terminates all workers.
     *
     * Call this when the application is done with signing operations.
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
        this.#pendingTasks.clear();

        // Revoke blob URL
        if (this.#workerBlobUrl) {
            revokeWorkerBlobUrl(this.#workerBlobUrl);
            this.#workerBlobUrl = null;
        }

        this.#initialized = false;
        this.#shuttingDown = false;
    }

    /**
     * Creates a new worker and adds it to the pool.
     */
    async #createWorker(): Promise<void> {
        if (!this.#workerBlobUrl) {
            throw new Error('Worker blob URL not created');
        }

        const workerId = this.#nextWorkerId++;

        // Create worker from blob URL
        const worker = new Worker(this.#workerBlobUrl, {
            name: `signing-worker-${workerId}`,
        });

        const pooledWorker: PooledWorker = {
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

            const messageHandler = (event: MessageEvent<WorkerResponse>): void => {
                if (isWorkerReady(event.data)) {
                    clearTimeout(timeout);
                    worker.removeEventListener('message', messageHandler);
                    pooledWorker.state = WorkerState.Idle;
                    resolve();
                }
            };

            worker.addEventListener('message', messageHandler);
            worker.addEventListener('error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Worker ${workerId} error: ${error.message}`));
            });

            // Send init message
            worker.postMessage({ type: 'init', eccLibId: 'default' });
        });

        // Set up message handler for signing results
        worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
            this.#handleWorkerMessage(pooledWorker, event.data);
        });
    }

    /**
     * Signs a single task using an available worker.
     */
    async #signSingleTask(
        task: SigningTask,
        keyPair: ParallelSignerKeyPair,
    ): Promise<SigningResultMessage> {
        // Get an idle worker
        const worker = await this.#getIdleWorker();

        // Generate unique task ID
        const taskId = `${this.#nextTaskId++}-${task.inputIndex}`;

        // Get private key from key pair
        // SECURITY: This is the only place we access the private key
        const privateKey = keyPair.getPrivateKey();

        try {
            return await new Promise<SigningResultMessage>((resolve, reject) => {
                // Set up timeout
                const timeoutId = setTimeout(() => {
                    this.#pendingTasks.delete(taskId);
                    worker.state = WorkerState.Idle;
                    worker.currentTaskId = null;
                    worker.taskStartTime = null;

                    // SECURITY: Terminate worker that exceeded key hold time
                    this.#terminateWorker(worker).catch(() => {});
                    this.#createWorker().catch(() => {});

                    reject(new Error(`Signing timeout for input ${task.inputIndex}`));
                }, this.#config.maxKeyHoldTimeMs);

                // Store pending task
                const pendingTask: PendingTask = {
                    taskId,
                    resolve,
                    reject,
                    timeoutId,
                    inputIndex: task.inputIndex,
                };
                this.#pendingTasks.set(taskId, pendingTask);

                // Mark worker as busy
                worker.state = WorkerState.Busy;
                worker.currentTaskId = taskId;
                worker.taskStartTime = Date.now();

                // Create signing message
                // SECURITY: privateKey is cloned via postMessage, NOT shared
                const message: SigningTaskMessage = {
                    type: 'sign',
                    taskId,
                    hash: task.hash,
                    privateKey, // Cloned to worker, zeroed there after signing
                    publicKey: keyPair.publicKey,
                    signatureType: task.signatureType,
                    lowR: task.lowR,
                    inputIndex: task.inputIndex,
                    sighashType: task.sighashType,
                    leafHash: task.leafHash,
                };

                // Send to worker
                worker.worker.postMessage(message);
            });
        } finally {
            // SECURITY: Zero the key in main thread as well
            // Note: The cloned copy in worker is zeroed by the worker
            privateKey.fill(0);
        }
    }

    /**
     * Gets an idle worker, creating one if necessary.
     */
    async #getIdleWorker(): Promise<PooledWorker> {
        // Find idle worker
        let worker = this.#workers.find((w) => w.state === WorkerState.Idle);

        if (worker) {
            return worker;
        }

        // No idle workers - wait for one to become available
        // or create a new one if under limit
        if (this.#workers.length < this.#config.workerCount) {
            await this.#createWorker();
            worker = this.#workers.find((w) => w.state === WorkerState.Idle);
            if (worker) {
                return worker;
            }
        }

        // Wait for any worker to become idle
        return new Promise<PooledWorker>((resolve) => {
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
    #handleWorkerMessage(worker: PooledWorker, response: WorkerResponse): void {
        if (isSigningResult(response)) {
            const pending = this.#pendingTasks.get(response.taskId);
            if (pending) {
                clearTimeout(pending.timeoutId);
                this.#pendingTasks.delete(response.taskId);
                worker.state = WorkerState.Idle;
                worker.currentTaskId = null;
                worker.taskStartTime = null;
                pending.resolve(response);
            }
        } else if (isSigningError(response)) {
            const pending = this.#pendingTasks.get(response.taskId);
            if (pending) {
                clearTimeout(pending.timeoutId);
                this.#pendingTasks.delete(response.taskId);
                worker.state = WorkerState.Idle;
                worker.currentTaskId = null;
                worker.taskStartTime = null;
                pending.reject(new Error(response.error));
            }
        }
        // Ignore ready and shutdown-ack messages here (handled elsewhere)
    }

    /**
     * Terminates a worker.
     */
    async #terminateWorker(worker: PooledWorker): Promise<void> {
        if (worker.state === WorkerState.Terminated) {
            return;
        }

        worker.state = WorkerState.ShuttingDown;

        // Send shutdown message
        worker.worker.postMessage({ type: 'shutdown' });

        // Wait briefly for acknowledgment, then terminate
        await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
                worker.worker.terminate();
                worker.state = WorkerState.Terminated;
                resolve();
            }, 1000);

            const handler = (event: MessageEvent<WorkerResponse>): void => {
                if (event.data.type === 'shutdown-ack') {
                    clearTimeout(timeout);
                    worker.worker.removeEventListener('message', handler);
                    worker.worker.terminate();
                    worker.state = WorkerState.Terminated;
                    resolve();
                }
            };

            worker.worker.addEventListener('message', handler);
        });

        // Remove from pool
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
 *
 * @param config - Optional configuration
 * @returns The singleton pool instance
 */
export function getSigningPool(config?: WorkerPoolConfig): WorkerSigningPool {
    return WorkerSigningPool.getInstance(config);
}
