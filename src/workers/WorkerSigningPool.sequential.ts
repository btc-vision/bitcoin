/**
 * Sequential signing pool for environments without worker support (React Native).
 *
 * Signs inputs one-by-one on the main thread using the CryptoBackend
 * from EccContext. Same API shape as WorkerSigningPool so consumers
 * can swap transparently.
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
import { EccContext } from '../ecc/context.js';
import type { MessageHash, PrivateKey } from '@btc-vision/ecpair';

/**
 * Sequential signing pool — signs inputs one-by-one on the main thread.
 *
 * Provides the same public API as WorkerSigningPool but without any
 * threading. Intended for React Native or other environments where
 * Web Workers and worker_threads are unavailable.
 *
 * @example
 * ```typescript
 * import { SequentialSigningPool } from '@btc-vision/bitcoin/workers';
 *
 * const pool = SequentialSigningPool.getInstance();
 * const result = await pool.signBatch(tasks, keyPair);
 * ```
 */
export class SequentialSigningPool {
    static #instance: SequentialSigningPool | null = null;

    private constructor(_config: WorkerPoolConfig = {}) {
        // Config accepted for API compatibility but not used —
        // sequential pool has no workers to configure.
    }

    /**
     * Number of workers — always 0 for sequential pool.
     */
    public get workerCount(): number {
        return 0;
    }

    /**
     * Idle workers — always 0.
     */
    public get idleWorkerCount(): number {
        return 0;
    }

    /**
     * Busy workers — always 0.
     */
    public get busyWorkerCount(): number {
        return 0;
    }

    /**
     * Whether workers are preserved — always false (no workers to preserve).
     */
    public get isPreservingWorkers(): boolean {
        return false;
    }

    /**
     * Gets the singleton instance.
     */
    public static getInstance(config?: WorkerPoolConfig): SequentialSigningPool {
        if (!SequentialSigningPool.#instance) {
            SequentialSigningPool.#instance = new SequentialSigningPool(config);
        }
        return SequentialSigningPool.#instance;
    }

    /**
     * Resets the singleton instance (for testing).
     */
    public static resetInstance(): void {
        SequentialSigningPool.#instance = null;
    }

    /**
     * No-op — no workers to preserve.
     */
    public preserveWorkers(): void {
        // No-op: no workers to preserve
    }

    /**
     * No-op — no workers to release.
     */
    public releaseWorkers(): void {
        // No-op
    }

    /**
     * No-op — no initialization required.
     */
    public async initialize(): Promise<void> {
        // No-op: nothing to initialize
    }

    /**
     * Signs tasks sequentially on the main thread.
     */
    // eslint-disable-next-line @typescript-eslint/require-await
    public async signBatch(
        tasks: readonly SigningTask[],
        keyPair: ParallelSignerKeyPair,
    ): Promise<ParallelSigningResult> {
        const startTime = performance.now();

        if (tasks.length === 0) {
            return {
                success: true,
                signatures: new Map(),
                errors: new Map(),
                durationMs: performance.now() - startTime,
            };
        }

        const ecc = EccContext.get().lib;
        const privateKey = keyPair.getPrivateKey();

        const signatures = new Map<number, SigningResultMessage>();
        const errors = new Map<number, string>();

        try {
            for (const task of tasks) {
                try {
                    let signature: Uint8Array;

                    const hash = task.hash as MessageHash;
                    const key = privateKey as PrivateKey;

                    if (task.signatureType === SignatureType.Schnorr) {
                        if (!ecc.signSchnorr) throw new Error('Schnorr signing not supported');
                        signature = ecc.signSchnorr(hash, key);
                    } else {
                        signature = ecc.sign(hash, key);
                    }

                    signatures.set(task.inputIndex, {
                        type: 'result',
                        taskId: task.taskId,
                        signature,
                        inputIndex: task.inputIndex,
                        publicKey: keyPair.publicKey,
                        signatureType: task.signatureType,
                        leafHash: task.leafHash,
                    });
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : 'Signing failed';
                    errors.set(task.inputIndex, message);
                }
            }
        } finally {
            // SECURITY: Zero the private key
            privateKey.fill(0);
        }

        return {
            success: errors.size === 0,
            signatures,
            errors,
            durationMs: performance.now() - startTime,
        };
    }

    /**
     * No-op — no workers to shut down.
     */
    public async shutdown(): Promise<void> {
        // No-op: nothing to shut down
    }

    public [Symbol.dispose](): void {
        void this.shutdown();
    }

    public async [Symbol.asyncDispose](): Promise<void> {
        await this.shutdown();
    }
}
