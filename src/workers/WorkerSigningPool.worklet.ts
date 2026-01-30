/**
 * Worklet-based parallel signing pool for React Native.
 *
 * Uses `react-native-worklets` (Software Mansion v0.7+) to run signing
 * operations in parallel across multiple worklet runtimes.
 * Each runtime gets its own ECC module instance via eval of the bundled
 * @noble/secp256k1 IIFE string.
 *
 * SECURITY ARCHITECTURE:
 * - Private keys are cloned per-runtime (structuredClone semantics)
 * - Keys are zeroed inside worklet AND in main thread finally block
 * - Tainted runtimes (timeout) are replaced, not reused
 *
 * @packageDocumentation
 */

import type {
    ParallelSignerKeyPair,
    ParallelSigningResult,
    SigningResultMessage,
    SigningTask,
    WorkerPoolConfig,
} from './types.js';
import { SignatureType } from './types.js';

/**
 * Minimal interface for react-native-worklets runtime.
 * Keeps us decoupled from the actual module types.
 */
interface WorkletRuntime {
    readonly name: string;
}

/**
 * Minimal interface for the react-native-worklets module.
 */
interface WorkletsModule {
    createWorkletRuntime(name: string): WorkletRuntime;
    runOnRuntime<T>(runtime: WorkletRuntime, fn: () => T): Promise<T>;
}

/**
 * Default configuration for the worklet pool.
 */
const DEFAULT_CONFIG: Required<WorkerPoolConfig> = {
    workerCount: 4,
    taskTimeoutMs: 30000,
    maxKeyHoldTimeMs: 5000,
    verifySignatures: true,
    preserveWorkers: false,
};

/**
 * Internal runtime wrapper for pool management.
 */
interface PooledRuntime {
    readonly id: number;
    runtime: WorkletRuntime;
    tainted: boolean;
}

/**
 * Worklet-based parallel signing pool for React Native.
 *
 * Mirrors the API of WorkerSigningPool (browser) but uses
 * `react-native-worklets` runtimes instead of Web Workers.
 * `runOnRuntime()` returns a Promise directly — no postMessage protocol.
 *
 * @example
 * ```typescript
 * import { WorkletSigningPool } from '@btc-vision/bitcoin/workers';
 *
 * const pool = WorkletSigningPool.getInstance();
 * pool.preserveWorkers();
 *
 * const result = await pool.signBatch(tasks, keyPair);
 * await pool.shutdown();
 * ```
 */
export class WorkletSigningPool {
    static #instance: WorkletSigningPool | null = null;

    readonly #config: Required<WorkerPoolConfig>;
    readonly #runtimes: PooledRuntime[] = [];

    #workletsModule: WorkletsModule | null = null;
    #eccBundleCode: string | null = null;
    #preserveWorkers: boolean = false;
    #nextRuntimeId: number = 0;
    #initialized: boolean = false;
    #shuttingDown: boolean = false;

    /**
     * Whether Uint8Array survives worklet boundary.
     * Detected during initialize(); if false, we encode as number[].
     */
    #uint8ArraySupported: boolean = true;

    private constructor(config: WorkerPoolConfig = {}) {
        this.#config = { ...DEFAULT_CONFIG, ...config };
        this.#preserveWorkers = this.#config.preserveWorkers;
    }

    /** Number of active runtimes. */
    public get workerCount(): number {
        return this.#runtimes.length;
    }

    /** Idle runtimes (all non-tainted). */
    public get idleWorkerCount(): number {
        return this.#runtimes.filter((r) => !r.tainted).length;
    }

    /** Busy runtimes — always 0 outside of signBatch. */
    public get busyWorkerCount(): number {
        return 0;
    }

    /** Whether runtimes are preserved between batches. */
    public get isPreservingWorkers(): boolean {
        return this.#preserveWorkers;
    }

    /**
     * Gets the singleton pool instance.
     *
     * @param config - Optional configuration (only used on first call)
     */
    public static getInstance(config?: WorkerPoolConfig): WorkletSigningPool {
        if (!WorkletSigningPool.#instance) {
            WorkletSigningPool.#instance = new WorkletSigningPool(config);
        }
        return WorkletSigningPool.#instance;
    }

    /** Resets the singleton instance (for testing). */
    public static resetInstance(): void {
        if (WorkletSigningPool.#instance) {
            WorkletSigningPool.#instance.shutdown().catch(() => {});
            WorkletSigningPool.#instance = null;
        }
    }

    /** Enable runtime preservation between signing batches. */
    public preserveWorkers(): void {
        this.#preserveWorkers = true;
    }

    /** Disable runtime preservation. */
    public releaseWorkers(): void {
        this.#preserveWorkers = false;
    }

    /**
     * Initializes the worklet pool.
     *
     * Dynamically imports `react-native-worklets`, creates N runtimes,
     * and injects the ECC bundle into each via eval.
     *
     * @throws If `react-native-worklets` is not installed or eval fails
     */
    public async initialize(): Promise<void> {
        if (this.#initialized) {
            return;
        }

        if (this.#shuttingDown) {
            throw new Error('Cannot initialize pool while shutting down');
        }

        // Lazy dynamic import — module loads even without the dep
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const worklets: WorkletsModule = await import('react-native-worklets' as string);
        this.#workletsModule = worklets;

        // Load ECC bundle
        const { ECC_BUNDLE } = await import('./ecc-bundle.js');
        this.#eccBundleCode = ECC_BUNDLE;

        // Create runtimes and inject ECC
        for (let i = 0; i < this.#config.workerCount; i++) {
            await this.#createRuntime();
        }

        // Feature-detect Uint8Array support across worklet boundary
        const firstRuntime = this.#runtimes[0];
        if (firstRuntime) {
            try {
                const result = await this.#workletsModule.runOnRuntime(
                    firstRuntime.runtime,
                    () => {
                        const arr = new Uint8Array([1, 2, 3]);
                        return arr instanceof Uint8Array;
                    },
                );
                this.#uint8ArraySupported = result;
            } catch {
                this.#uint8ArraySupported = false;
            }
        }

        this.#initialized = true;
    }

    /**
     * Signs a batch of tasks in parallel across worklet runtimes.
     *
     * SECURITY: Private keys are cloned per-runtime and zeroed both
     * inside the worklet and in the main thread finally block.
     */
    public async signBatch(
        tasks: readonly SigningTask[],
        keyPair: ParallelSignerKeyPair,
    ): Promise<ParallelSigningResult> {
        const startTime = performance.now();

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

        // Distribute tasks round-robin
        const runtimeCount = Math.min(this.#runtimes.length, tasks.length);
        const taskBatches: SigningTask[][] = Array.from({ length: runtimeCount }, () => []);

        for (let i = 0; i < tasks.length; i++) {
            const batch = taskBatches[i % runtimeCount];
            const task = tasks[i];
            if (batch && task) {
                batch.push(task);
            }
        }

        const privateKey = keyPair.getPrivateKey();

        try {
            const batchResults = await Promise.allSettled(
                taskBatches.map((batch, index) =>
                    this.#signBatchOnRuntime(
                        batch,
                        privateKey,
                        keyPair.publicKey,
                        index,
                    ),
                ),
            );

            const signatures = new Map<number, SigningResultMessage>();
            const errors = new Map<number, string>();

            for (let i = 0; i < batchResults.length; i++) {
                const result = batchResults[i];
                if (!result) continue;

                if (result.status === 'fulfilled') {
                    for (const sig of result.value.signatures) {
                        signatures.set(sig.inputIndex, sig);
                    }
                    for (const [idx, errMsg] of result.value.errors) {
                        errors.set(idx, errMsg);
                    }
                } else {
                    const reason = result.reason as { message?: string } | undefined;
                    const errorMsg = reason?.message ?? 'Worklet batch signing failed';
                    const failedBatch = taskBatches[i];
                    if (failedBatch) {
                        for (const task of failedBatch) {
                            errors.set(task.inputIndex, errorMsg);
                        }
                    }
                }
            }

            // Cleanup runtimes if not preserving
            if (!this.#preserveWorkers) {
                await this.shutdown();
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

    /** Shuts down all runtimes. */
    // eslint-disable-next-line @typescript-eslint/require-await
    public async shutdown(): Promise<void> {
        if (this.#shuttingDown) {
            return;
        }

        this.#shuttingDown = true;

        // Worklet runtimes don't have a destroy() — clear references for GC
        this.#runtimes.length = 0;
        this.#workletsModule = null;
        this.#eccBundleCode = null;
        this.#initialized = false;
        this.#shuttingDown = false;
    }

    public [Symbol.dispose](): void {
        void this.shutdown();
    }

    public async [Symbol.asyncDispose](): Promise<void> {
        await this.shutdown();
    }

    /**
     * Creates a new worklet runtime and injects the ECC bundle.
     */
    async #createRuntime(): Promise<PooledRuntime> {
        if (!this.#workletsModule || !this.#eccBundleCode) {
            throw new Error('Worklets module or ECC bundle not loaded');
        }

        const id = this.#nextRuntimeId++;
        const runtime = this.#workletsModule.createWorkletRuntime(`signing-runtime-${id}`);

        // Inject ECC bundle into the worklet runtime.
        // The bundle declares `var nobleBundle = (()=>{...})()` with "use strict",
        // so a plain eval won't leak it to globalThis. We use `new Function` to
        // execute the bundle and then explicitly assign the result.
        const bundleCode = this.#eccBundleCode;
        await this.#workletsModule.runOnRuntime(runtime, () => {
            'worklet';
            // eslint-disable-next-line @typescript-eslint/no-implied-eval
            const fn = new Function(bundleCode + '; return nobleBundle;') as () => unknown;
            (globalThis as Record<string, unknown>)['nobleBundle'] = fn();
        });

        const pooled: PooledRuntime = { id, runtime, tainted: false };
        this.#runtimes.push(pooled);
        return pooled;
    }

    /**
     * Replaces a tainted runtime with a fresh one.
     */
    async #replaceRuntime(pooled: PooledRuntime): Promise<void> {
        const idx = this.#runtimes.indexOf(pooled);
        if (idx >= 0) {
            this.#runtimes.splice(idx, 1);
        }

        try {
            await this.#createRuntime();
        } catch {
            // If replacement fails, pool continues with fewer runtimes
        }
    }

    /**
     * Signs a batch of tasks on a specific runtime.
     */
    async #signBatchOnRuntime(
        tasks: readonly SigningTask[],
        privateKey: Uint8Array,
        publicKey: Uint8Array,
        runtimeIndex: number,
    ): Promise<{
        signatures: SigningResultMessage[];
        errors: Map<number, string>;
    }> {
        if (tasks.length === 0) {
            return { signatures: [], errors: new Map() };
        }

        const pooled = this.#runtimes[runtimeIndex];
        if (!pooled || pooled.tainted) {
            throw new Error(`Runtime ${runtimeIndex} unavailable or tainted`);
        }

        if (!this.#workletsModule) {
            throw new Error('Worklets module not loaded');
        }

        // Prepare data for worklet transfer
        const useArrayEncoding = !this.#uint8ArraySupported;
        const keyData: number[] | Uint8Array = useArrayEncoding
            ? Array.from(privateKey)
            : new Uint8Array(privateKey);

        const taskData = tasks.map((t) => ({
            taskId: t.taskId,
            inputIndex: t.inputIndex,
            hash: useArrayEncoding ? Array.from(t.hash) : new Uint8Array(t.hash),
            signatureType: t.signatureType,
            lowR: t.lowR,
            sighashType: t.sighashType,
            leafHash: t.leafHash
                ? (useArrayEncoding ? Array.from(t.leafHash) : new Uint8Array(t.leafHash))
                : undefined,
        }));

        const pubKeyData: number[] | Uint8Array = useArrayEncoding
            ? Array.from(publicKey)
            : new Uint8Array(publicKey);

        // Dispatch to worklet runtime with timeout
        const signingPromise = this.#workletsModule.runOnRuntime(
            pooled.runtime,
            () => {
                'worklet';
                // Inside the worklet runtime, nobleBundle is available from init eval
                // The bundled secp.sign() returns a compact 64-byte Uint8Array directly
                // (not a Signature object). secp.schnorr.sign() also returns Uint8Array.
                const eccModule = (globalThis as Record<string, unknown>)['nobleBundle'] as {
                    secp: {
                        sign(
                            hash: Uint8Array,
                            key: Uint8Array,
                            opts?: { lowS: boolean; prehash: boolean },
                        ): Uint8Array;
                        schnorr: {
                            sign(hash: Uint8Array, key: Uint8Array): Uint8Array;
                        };
                    };
                };

                const toU8 = (data: number[] | Uint8Array): Uint8Array =>
                    data instanceof Uint8Array ? data : new Uint8Array(data);

                const privKey = toU8(keyData);
                const results: Array<{
                    type: 'result';
                    taskId: string;
                    signature: number[];
                    inputIndex: number;
                    publicKey: number[];
                    signatureType: number;
                    leafHash?: number[];
                }> = [];
                const errors: Array<{ inputIndex: number; error: string }> = [];

                try {
                    for (const task of taskData) {
                        try {
                            const hash = toU8(task.hash);
                            let signature: Uint8Array;

                            if (task.signatureType === 1) {
                                signature = eccModule.secp.schnorr.sign(hash, privKey);
                            } else {
                                // prehash: false — input is already a 32-byte hash
                                signature = eccModule.secp.sign(hash, privKey, {
                                    lowS: true,
                                    prehash: false,
                                });
                            }

                            const entry: (typeof results)[number] = {
                                type: 'result' as const,
                                taskId: task.taskId,
                                signature: Array.from(signature),
                                inputIndex: task.inputIndex,
                                publicKey: Array.from(toU8(pubKeyData)),
                                signatureType: task.signatureType,
                            };
                            if (task.leafHash) {
                                entry.leafHash = Array.from(toU8(task.leafHash));
                            }
                            results.push(entry);
                        } catch (err: unknown) {
                            const msg = err instanceof Error ? err.message : 'Signing failed';
                            errors.push({ inputIndex: task.inputIndex, error: msg });
                        }
                    }
                } finally {
                    // SECURITY: Zero key inside worklet
                    privKey.fill(0);
                }

                return { results, errors };
            },
        );

        // Timeout guard
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
            setTimeout(() => {
                pooled.tainted = true;
                this.#replaceRuntime(pooled).catch(() => {});
                reject(new Error(`Worklet signing timeout for ${tasks.length} tasks`));
            }, this.#config.maxKeyHoldTimeMs);
        });

        const raw = await Promise.race([signingPromise, timeoutPromise]);

        // Convert results back to proper types
        const signatures: SigningResultMessage[] = raw.results.map((r) => ({
            type: 'result' as const,
            taskId: r.taskId,
            signature: new Uint8Array(r.signature),
            inputIndex: r.inputIndex,
            publicKey: new Uint8Array(r.publicKey),
            signatureType: r.signatureType as SignatureType,
            leafHash: r.leafHash ? new Uint8Array(r.leafHash) : undefined,
        }));

        const errors = new Map<number, string>();
        for (const e of raw.errors) {
            errors.set(e.inputIndex, e.error);
        }

        return { signatures, errors };
    }
}
