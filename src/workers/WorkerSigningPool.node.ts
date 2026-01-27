/**
 * Node.js-specific worker signing pool implementation.
 *
 * Uses worker_threads module for true parallel execution.
 * Private keys are isolated per-worker and zeroed immediately after signing.
 *
 * @packageDocumentation
 */

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { cpus } from 'os';
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
import { WorkerState, isSigningResult, isSigningError, isWorkerReady } from './types.js';
import { generateWorkerCode } from './signing-worker.js';

/**
 * Default configuration values for Node.js.
 */
const DEFAULT_CONFIG: Required<WorkerPoolConfig> = {
    workerCount: cpus().length,
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
    readonly #config: Required<WorkerPoolConfig>;

    /**
     * Worker pool.
     */
    readonly #workers: NodePooledWorker[] = [];

    /**
     * Pending tasks awaiting completion.
     */
    readonly #pendingTasks: Map<string, PendingTask> = new Map();

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
    private constructor(config: WorkerPoolConfig = {}) {
        if (!isMainThread) {
            throw new Error('NodeWorkerSigningPool can only be created in the main thread');
        }
        this.#config = { ...DEFAULT_CONFIG, ...config };
        this.#preserveWorkers = this.#config.preserveWorkers;
    }

    /**
     * Gets the singleton pool instance.
     *
     * @param config - Optional configuration (only used on first call)
     * @returns The singleton pool instance
     */
    public static getInstance(config?: WorkerPoolConfig): NodeWorkerSigningPool {
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
        this.#workerScript = null;
        this.#initialized = false;
        this.#shuttingDown = false;
    }

    /**
     * Creates the inline worker script for Node.js worker_threads.
     */
    #createWorkerScript(): string {
        // Node.js worker_threads require different syntax
        const workerCode = `
const { parentPort } = require('worker_threads');

/**
 * Zero out a Uint8Array to clear sensitive data.
 */
function secureZero(arr) {
    if (arr && arr.fill) {
        arr.fill(0);
    }
}

let eccLib = null;

parentPort.on('message', (msg) => {
    switch (msg.type) {
        case 'init':
            // ECC library would be loaded here
            parentPort.postMessage({ type: 'ready' });
            break;

        case 'sign':
            handleSign(msg);
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

    let signature;

    try {
        if (!eccLib) {
            throw new Error('ECC library not initialized');
        }

        if (signatureType === 1) {
            signature = eccLib.signSchnorr(hash, privateKey);
        } else {
            signature = eccLib.sign(hash, privateKey, { lowR: lowR || false });
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
`;
        return workerCode;
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

            // Send init message
            worker.postMessage({ type: 'init', eccLibId: 'default' });
        });

        // Set up message handler for signing results
        worker.on('message', (data: WorkerResponse) => {
            this.#handleWorkerMessage(pooledWorker, data);
        });
    }

    /**
     * Signs a single task using an available worker.
     */
    async #signSingleTask(
        task: SigningTask,
        keyPair: ParallelSignerKeyPair,
    ): Promise<SigningResultMessage> {
        const worker = await this.#getIdleWorker();
        const taskId = `${this.#nextTaskId++}-${task.inputIndex}`;
        const privateKey = keyPair.getPrivateKey();

        try {
            return await new Promise<SigningResultMessage>((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    this.#pendingTasks.delete(taskId);
                    worker.state = WorkerState.Idle;
                    worker.currentTaskId = null;
                    worker.taskStartTime = null;

                    // Terminate worker that exceeded key hold time
                    this.#terminateWorker(worker).catch(() => {});
                    this.#createWorker().catch(() => {});

                    reject(new Error(`Signing timeout for input ${task.inputIndex}`));
                }, this.#config.maxKeyHoldTimeMs);

                const pendingTask: PendingTask = {
                    taskId,
                    resolve,
                    reject,
                    timeoutId,
                    inputIndex: task.inputIndex,
                };
                this.#pendingTasks.set(taskId, pendingTask);

                worker.state = WorkerState.Busy;
                worker.currentTaskId = taskId;
                worker.taskStartTime = Date.now();

                const message: SigningTaskMessage = {
                    type: 'sign',
                    taskId,
                    hash: task.hash,
                    privateKey,
                    publicKey: keyPair.publicKey,
                    signatureType: task.signatureType,
                    lowR: task.lowR,
                    inputIndex: task.inputIndex,
                    sighashType: task.sighashType,
                    leafHash: task.leafHash,
                };

                worker.worker.postMessage(message);
            });
        } finally {
            // Zero key in main thread
            privateKey.fill(0);
        }
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
export function getNodeSigningPool(config?: WorkerPoolConfig): NodeWorkerSigningPool {
    return NodeWorkerSigningPool.getInstance(config);
}
