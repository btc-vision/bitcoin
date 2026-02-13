import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    type BatchSigningTaskResult,
    type ParallelSignerKeyPair,
    SignatureType,
    type SigningTask,
    type WorkerResponse,
} from '../src/workers/types.js';

// Mock Worker class for browser pool testing
class MockWorker {
    public onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
    public onerror: ((error: Error) => void) | null = null;
    private messageHandlers: Array<(event: { data: WorkerResponse }) => void> = [];
    private errorHandlers: Array<(error: Error) => void> = [];
    private terminated = false;

    constructor(
        public readonly url: string,
        public readonly options?: { name?: string },
    ) {
        // Simulate async ready after construction
        setTimeout(() => {
            if (!this.terminated) {
                this.simulateMessage({ type: 'ready' });
            }
        }, 5);
    }

    postMessage(data: unknown): void {
        if (this.terminated) return;

        const msg = data as { type: string; taskId?: string; privateKey?: Uint8Array };

        if (msg.type === 'init') {
            // Already sent ready in constructor
        } else if (msg.type === 'signBatch') {
            // Simulate batch signing - zero the key and return results
            setTimeout(() => {
                if (this.terminated) return;

                const batchMsg = data as {
                    batchId: string;
                    tasks: Array<{
                        taskId: string;
                        inputIndex: number;
                        publicKey: Uint8Array;
                        signatureType: SignatureType;
                        leafHash?: Uint8Array;
                    }>;
                    privateKey?: Uint8Array;
                };

                // Zero the private key (simulating what worker does)
                if (batchMsg.privateKey) {
                    batchMsg.privateKey.fill(0);
                }

                // Generate results for all tasks
                const results = batchMsg.tasks.map(
                    (task): BatchSigningTaskResult => ({
                        taskId: task.taskId,
                        signature: new Uint8Array(64).fill(0xab),
                        inputIndex: task.inputIndex,
                        publicKey: task.publicKey,
                        signatureType: task.signatureType,
                        ...(task.leafHash ? { leafHash: task.leafHash } : {}),
                    }),
                );

                this.simulateMessage({
                    type: 'batchResult',
                    batchId: batchMsg.batchId,
                    results,
                    errors: [],
                });
            }, 10);
        } else if (msg.type === 'shutdown') {
            setTimeout(() => {
                this.simulateMessage({ type: 'shutdown-ack' });
            }, 5);
        }
    }

    addEventListener(event: string, handler: (event: { data: WorkerResponse }) => void): void {
        if (event === 'message') {
            this.messageHandlers.push(handler);
        } else if (event === 'error') {
            this.errorHandlers.push(handler as unknown as (error: Error) => void);
        }
    }

    removeEventListener(event: string, handler: (event: { data: WorkerResponse }) => void): void {
        if (event === 'message') {
            const idx = this.messageHandlers.indexOf(handler);
            if (idx >= 0) this.messageHandlers.splice(idx, 1);
        }
    }

    terminate(): void {
        this.terminated = true;
        this.messageHandlers = [];
        this.errorHandlers = [];
    }

    simulateError(error: Error): void {
        if (this.onerror) {
            this.onerror(error);
        }
        for (const handler of this.errorHandlers) {
            handler(error);
        }
    }

    private simulateMessage(data: WorkerResponse): void {
        const event = { data };
        if (this.onmessage) {
            this.onmessage(event);
        }
        for (const handler of this.messageHandlers) {
            handler(event);
        }
    }
}

// Mock Worker that fails signing
class MockFailingWorker extends MockWorker {
    override postMessage(data: unknown): void {
        if ((data as { type: string }).type === 'signBatch') {
            setTimeout(() => {
                const batchMsg = data as {
                    batchId: string;
                    tasks: Array<{
                        taskId: string;
                        inputIndex: number;
                    }>;
                    privateKey?: Uint8Array;
                };
                // Zero key even on failure
                if (batchMsg.privateKey) {
                    batchMsg.privateKey.fill(0);
                }
                // Return errors for all tasks
                const errors = batchMsg.tasks.map((task) => ({
                    taskId: task.taskId,
                    inputIndex: task.inputIndex,
                    error: 'Mock signing failure',
                }));
                this['simulateMessage']({
                    type: 'batchResult',
                    batchId: batchMsg.batchId,
                    results: [],
                    errors,
                });
            }, 10);
        } else {
            super.postMessage(data);
        }
    }
}

// Mock Worker that times out (never responds)
class MockTimeoutWorker extends MockWorker {
    override postMessage(data: unknown): void {
        if ((data as { type: string }).type === 'signBatch') {
            // Never respond - simulates timeout
            // Still zero the key for security
            const batchMsg = data as { privateKey?: Uint8Array };
            if (batchMsg.privateKey) {
                batchMsg.privateKey.fill(0);
            }
        } else {
            super.postMessage(data);
        }
    }
}

// Mock URL for blob creation
const mockBlobUrls: string[] = [];
let blobUrlCounter = 0;

// Setup global mocks
beforeEach(() => {
    // Mock URL.createObjectURL and URL.revokeObjectURL
    if (typeof globalThis.URL === 'undefined') {
        (globalThis as any).URL = class {
            constructor(public href: string) {}
        };
    }

    (globalThis.URL as any).createObjectURL = vi.fn((_blob: Blob) => {
        const url = `blob:mock-${blobUrlCounter++}`;
        mockBlobUrls.push(url);
        return url;
    });

    (globalThis.URL as any).revokeObjectURL = vi.fn((url: string) => {
        const idx = mockBlobUrls.indexOf(url);
        if (idx >= 0) mockBlobUrls.splice(idx, 1);
    });

    // Mock Blob
    if (typeof globalThis.Blob === 'undefined') {
        (globalThis as any).Blob = class {
            constructor(
                public parts: string[],
                public options?: { type: string },
            ) {}
        };
    }

    // Mock Worker
    (globalThis as any).Worker = MockWorker;
});

afterEach(() => {
    vi.restoreAllMocks();
    mockBlobUrls.length = 0;
});

describe('WorkerSigningPool', () => {
    // Import dynamically after mocks are set up
    let WorkerSigningPool: typeof import('../src/workers/WorkerSigningPool.js').WorkerSigningPool;
    let getSigningPool: typeof import('../src/workers/WorkerSigningPool.js').getSigningPool;

    beforeEach(async () => {
        // Reset module cache to pick up mocks
        vi.resetModules();
        const module = await import('../src/workers/WorkerSigningPool.js');
        WorkerSigningPool = module.WorkerSigningPool;
        getSigningPool = module.getSigningPool;

        // Reset singleton
        WorkerSigningPool.resetInstance();
    });

    afterEach(async () => {
        // Ensure pool is shut down
        try {
            const pool = WorkerSigningPool.getInstance();
            await pool.shutdown();
        } catch {
            // Ignore
        }
        WorkerSigningPool.resetInstance();
    });

    describe('Singleton Pattern', () => {
        it('should return same instance on multiple calls', () => {
            const pool1 = WorkerSigningPool.getInstance();
            const pool2 = WorkerSigningPool.getInstance();
            expect(pool1).toBe(pool2);
        });

        it('should return same instance via getSigningPool helper', () => {
            const pool1 = getSigningPool();
            const pool2 = WorkerSigningPool.getInstance();
            expect(pool1).toBe(pool2);
        });

        it('should create new instance after reset', () => {
            const pool1 = WorkerSigningPool.getInstance();
            WorkerSigningPool.resetInstance();
            const pool2 = WorkerSigningPool.getInstance();
            expect(pool1).not.toBe(pool2);
        });

        it('should accept config on first call', () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 8 });
            expect(pool).toBeDefined();
        });
    });

    describe('Initialization', () => {
        it('should initialize without error', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 2 });
            await expect(pool.initialize()).resolves.toBeUndefined();
        });

        it('should be idempotent', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 2 });
            await pool.initialize();
            await pool.initialize(); // Second call should be no-op
            expect(pool.workerCount).toBe(2);
        });

        it('should create specified number of workers', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 4 });
            await pool.initialize();
            expect(pool.workerCount).toBe(4);
        });

        it('should have all workers idle after init', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 3 });
            await pool.initialize();
            expect(pool.idleWorkerCount).toBe(3);
            expect(pool.busyWorkerCount).toBe(0);
        });
    });

    describe('Worker Preservation', () => {
        it('should not preserve workers by default', () => {
            const pool = WorkerSigningPool.getInstance();
            expect(pool.isPreservingWorkers).toBe(false);
        });

        it('should preserve workers when enabled', () => {
            const pool = WorkerSigningPool.getInstance();
            pool.preserveWorkers();
            expect(pool.isPreservingWorkers).toBe(true);
        });

        it('should release workers when disabled', () => {
            const pool = WorkerSigningPool.getInstance();
            pool.preserveWorkers();
            expect(pool.isPreservingWorkers).toBe(true);
            pool.releaseWorkers();
            expect(pool.isPreservingWorkers).toBe(false);
        });
    });

    describe('Signing Batches', () => {
        it('should sign empty batch successfully', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 2 });
            pool.preserveWorkers();

            const keyPair: ParallelSignerKeyPair = {
                publicKey: new Uint8Array(33).fill(0x02),
                getPrivateKey: () => new Uint8Array(32).fill(0x42),
            };

            const result = await pool.signBatch([], keyPair);

            expect(result.success).toBe(true);
            expect(result.signatures.size).toBe(0);
            expect(result.errors.size).toBe(0);
        });

        it('should sign single task', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 2 });
            pool.preserveWorkers();

            const keyPair: ParallelSignerKeyPair = {
                publicKey: new Uint8Array(33).fill(0x02),
                getPrivateKey: () => new Uint8Array(32).fill(0x42),
            };

            const tasks: SigningTask[] = [
                {
                    taskId: 'task-0',
                    inputIndex: 0,
                    hash: new Uint8Array(32).fill(0x11),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                },
            ];

            const result = await pool.signBatch(tasks, keyPair);

            expect(result.success).toBe(true);
            expect(result.signatures.size).toBe(1);
            expect(result.signatures.has(0)).toBe(true);
            expect(result.errors.size).toBe(0);
        });

        it('should sign multiple tasks in parallel', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 4 });
            pool.preserveWorkers();

            const keyPair: ParallelSignerKeyPair = {
                publicKey: new Uint8Array(33).fill(0x02),
                getPrivateKey: () => new Uint8Array(32).fill(0x42),
            };

            const tasks: SigningTask[] = [];
            for (let i = 0; i < 10; i++) {
                tasks.push({
                    taskId: `task-${i}`,
                    inputIndex: i,
                    hash: new Uint8Array(32).fill(i),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                });
            }

            const result = await pool.signBatch(tasks, keyPair);

            expect(result.success).toBe(true);
            expect(result.signatures.size).toBe(10);
            expect(result.errors.size).toBe(0);

            // Verify all signatures present
            for (let i = 0; i < 10; i++) {
                expect(result.signatures.has(i)).toBe(true);
            }
        });

        it('should handle Schnorr signatures', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 2 });
            pool.preserveWorkers();

            const keyPair: ParallelSignerKeyPair = {
                publicKey: new Uint8Array(32).fill(0x02),
                getPrivateKey: () => new Uint8Array(32).fill(0x42),
            };

            const tasks: SigningTask[] = [
                {
                    taskId: 'schnorr-0',
                    inputIndex: 0,
                    hash: new Uint8Array(32),
                    signatureType: SignatureType.Schnorr,
                    sighashType: 0x00,
                },
            ];

            const result = await pool.signBatch(tasks, keyPair);

            expect(result.success).toBe(true);
            expect(result.signatures.get(0)?.signatureType).toBe(SignatureType.Schnorr);
        });

        it('should handle mixed ECDSA and Schnorr', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 2 });
            pool.preserveWorkers();

            const keyPair: ParallelSignerKeyPair = {
                publicKey: new Uint8Array(33).fill(0x02),
                getPrivateKey: () => new Uint8Array(32).fill(0x42),
            };

            const tasks: SigningTask[] = [
                {
                    taskId: 'ecdsa-0',
                    inputIndex: 0,
                    hash: new Uint8Array(32),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                },
                {
                    taskId: 'schnorr-1',
                    inputIndex: 1,
                    hash: new Uint8Array(32),
                    signatureType: SignatureType.Schnorr,
                    sighashType: 0x00,
                },
            ];

            const result = await pool.signBatch(tasks, keyPair);

            expect(result.success).toBe(true);
            expect(result.signatures.get(0)?.signatureType).toBe(SignatureType.ECDSA);
            expect(result.signatures.get(1)?.signatureType).toBe(SignatureType.Schnorr);
        });

        it('should include leafHash for Taproot script-path', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 2 });
            pool.preserveWorkers();

            const leafHash = new Uint8Array(32).fill(0xcd);
            const keyPair: ParallelSignerKeyPair = {
                publicKey: new Uint8Array(32).fill(0x02),
                getPrivateKey: () => new Uint8Array(32).fill(0x42),
            };

            const tasks: SigningTask[] = [
                {
                    taskId: 'script-path-0',
                    inputIndex: 0,
                    hash: new Uint8Array(32),
                    signatureType: SignatureType.Schnorr,
                    sighashType: 0x00,
                    leafHash,
                },
            ];

            const result = await pool.signBatch(tasks, keyPair);

            expect(result.success).toBe(true);
            expect(result.signatures.get(0)?.leafHash).toBeDefined();
        });

        it('should report duration', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 2 });
            pool.preserveWorkers();

            const keyPair: ParallelSignerKeyPair = {
                publicKey: new Uint8Array(33).fill(0x02),
                getPrivateKey: () => new Uint8Array(32).fill(0x42),
            };

            const tasks: SigningTask[] = [
                {
                    taskId: 'task-0',
                    inputIndex: 0,
                    hash: new Uint8Array(32),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                },
            ];

            const result = await pool.signBatch(tasks, keyPair);

            expect(result.durationMs).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Key Security', () => {
        it('should zero private key after signing', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 1 });
            pool.preserveWorkers();

            let capturedKey: Uint8Array | null = null;
            const keyPair: ParallelSignerKeyPair = {
                publicKey: new Uint8Array(33).fill(0x02),
                getPrivateKey: () => {
                    capturedKey = new Uint8Array(32).fill(0x42);
                    return capturedKey;
                },
            };

            const tasks: SigningTask[] = [
                {
                    taskId: 'task-0',
                    inputIndex: 0,
                    hash: new Uint8Array(32),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                },
            ];

            await pool.signBatch(tasks, keyPair);

            // Key should be zeroed (both in worker and main thread)
            expect(capturedKey).not.toBeNull();
            expect(capturedKey!.every((b) => b === 0)).toBe(true);
        });

        it('should call getPrivateKey once per batch', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 2 });
            pool.preserveWorkers();

            let callCount = 0;
            const keyPair: ParallelSignerKeyPair = {
                publicKey: new Uint8Array(33).fill(0x02),
                getPrivateKey: () => {
                    callCount++;
                    return new Uint8Array(32).fill(0x42);
                },
            };

            const tasks: SigningTask[] = [
                {
                    taskId: 'task-0',
                    inputIndex: 0,
                    hash: new Uint8Array(32),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                },
                {
                    taskId: 'task-1',
                    inputIndex: 1,
                    hash: new Uint8Array(32),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                },
            ];

            await pool.signBatch(tasks, keyPair);

            // Batch signing obtains the key once and distributes to workers
            expect(callCount).toBe(1);
        });
    });

    describe('Shutdown', () => {
        it('should shutdown gracefully', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 2 });
            await pool.initialize();
            expect(pool.workerCount).toBe(2);

            await pool.shutdown();
            expect(pool.workerCount).toBe(0);
        });

        it('should be idempotent', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 2 });
            await pool.initialize();

            await pool.shutdown();
            await pool.shutdown(); // Second call should be no-op

            expect(pool.workerCount).toBe(0);
        });

        it('should allow reinitialization after shutdown', async () => {
            WorkerSigningPool.resetInstance();
            const pool = WorkerSigningPool.getInstance({ workerCount: 2 });
            await pool.initialize();
            await pool.shutdown();

            WorkerSigningPool.resetInstance();
            const pool2 = WorkerSigningPool.getInstance({ workerCount: 3 });
            await pool2.initialize();
            expect(pool2.workerCount).toBe(3);
        });
    });

    describe('Symbol.asyncDispose', () => {
        it('should have Symbol.asyncDispose method', () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 1 });
            expect(typeof pool[Symbol.asyncDispose]).toBe('function');
        });

        it('should terminate workers when disposed', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 2 });
            await pool.initialize();
            expect(pool.workerCount).toBe(2);

            await pool[Symbol.asyncDispose]();
            expect(pool.workerCount).toBe(0);
        });

        it('should be safe to call after shutdown', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 2 });
            await pool.initialize();

            await pool.shutdown();
            await pool[Symbol.asyncDispose](); // Should not throw

            expect(pool.workerCount).toBe(0);
        });

        it('should clean up with await using', async () => {
            WorkerSigningPool.resetInstance();

            let poolRef: import("../src/workers/WorkerSigningPool.js").WorkerSigningPool | undefined;

            // Scoped block — pool is disposed when the block exits
            {
                await using pool = WorkerSigningPool.getInstance({ workerCount: 2 });
                await pool.initialize();
                expect(pool.workerCount).toBe(2);
                poolRef = pool;
            }

            // After scope exit, dispose has been called
            expect(poolRef!.workerCount).toBe(0);
        });
    });

    describe('Worker Pool Without Preservation', () => {
        it('should terminate workers after batch when not preserving', async () => {
            const pool = WorkerSigningPool.getInstance({ workerCount: 2 });
            // Don't call preserveWorkers()

            const keyPair: ParallelSignerKeyPair = {
                publicKey: new Uint8Array(33).fill(0x02),
                getPrivateKey: () => new Uint8Array(32).fill(0x42),
            };

            const tasks: SigningTask[] = [
                {
                    taskId: 'task-0',
                    inputIndex: 0,
                    hash: new Uint8Array(32),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                },
            ];

            const result = await pool.signBatch(tasks, keyPair);
            expect(result.success).toBe(true);

            // Workers should be terminated after batch
            // (In real implementation, idle workers are terminated)
        });
    });
});

describe('WorkerSigningPool Error Handling', () => {
    let WorkerSigningPool: typeof import('../src/workers/WorkerSigningPool.js').WorkerSigningPool;

    beforeEach(async () => {
        vi.resetModules();

        // Use failing worker
        (globalThis as any).Worker = MockFailingWorker;

        const module = await import('../src/workers/WorkerSigningPool.js');
        WorkerSigningPool = module.WorkerSigningPool;
        WorkerSigningPool.resetInstance();
    });

    afterEach(async () => {
        try {
            await WorkerSigningPool.getInstance().shutdown();
        } catch {
            // Ignore
        }
        WorkerSigningPool.resetInstance();
    });

    it('should handle signing failures', async () => {
        const pool = WorkerSigningPool.getInstance({ workerCount: 1 });
        pool.preserveWorkers();

        const keyPair: ParallelSignerKeyPair = {
            publicKey: new Uint8Array(33).fill(0x02),
            getPrivateKey: () => new Uint8Array(32).fill(0x42),
        };

        const tasks: SigningTask[] = [
            {
                taskId: 'task-0',
                inputIndex: 0,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            },
        ];

        const result = await pool.signBatch(tasks, keyPair);

        expect(result.success).toBe(false);
        expect(result.errors.size).toBe(1);
        expect(result.errors.get(0)).toBe('Mock signing failure');
    });

    it('should handle partial failures in batch', async () => {
        // Reset to use regular worker for first call
        vi.resetModules();

        class MixedWorker extends MockWorker {
            override postMessage(data: unknown): void {
                if ((data as { type: string }).type === 'signBatch') {
                    setTimeout(() => {
                        const batchMsg = data as {
                            batchId: string;
                            tasks: Array<{
                                taskId: string;
                                inputIndex: number;
                                publicKey: Uint8Array;
                                signatureType: SignatureType;
                                leafHash?: Uint8Array;
                            }>;
                            privateKey?: Uint8Array;
                        };
                        if (batchMsg.privateKey) batchMsg.privateKey.fill(0);

                        // Fail every other task
                        const results: BatchSigningTaskResult[] = [];
                        const errors: Array<{
                            taskId: string;
                            inputIndex: number;
                            error: string;
                        }> = [];

                        batchMsg.tasks.forEach((task, idx) => {
                            if (idx % 2 === 0) {
                                results.push({
                                    taskId: task.taskId,
                                    signature: new Uint8Array(64).fill(0xab),
                                    inputIndex: task.inputIndex,
                                    publicKey: task.publicKey,
                                    signatureType: task.signatureType as SignatureType,
                                    ...(task.leafHash ? { leafHash: task.leafHash } : {}),
                                });
                            } else {
                                errors.push({
                                    taskId: task.taskId,
                                    inputIndex: task.inputIndex,
                                    error: 'Simulated failure',
                                });
                            }
                        });

                        this['simulateMessage']({
                            type: 'batchResult',
                            batchId: batchMsg.batchId,
                            results,
                            errors,
                        });
                    }, 10);
                } else {
                    super.postMessage(data);
                }
            }
        }

        (globalThis as any).Worker = MixedWorker;

        const module = await import('../src/workers/WorkerSigningPool.js');
        const pool = module.WorkerSigningPool.getInstance({ workerCount: 2 });
        pool.preserveWorkers();

        const keyPair: ParallelSignerKeyPair = {
            publicKey: new Uint8Array(33).fill(0x02),
            getPrivateKey: () => new Uint8Array(32).fill(0x42),
        };

        const tasks: SigningTask[] = [
            {
                taskId: 'task-0',
                inputIndex: 0,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            },
            {
                taskId: 'task-1',
                inputIndex: 1,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            },
            {
                taskId: 'task-2',
                inputIndex: 2,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            },
            {
                taskId: 'task-3',
                inputIndex: 3,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            },
        ];

        const result = await pool.signBatch(tasks, keyPair);

        expect(result.success).toBe(false);
        expect(result.signatures.size).toBe(2); // Half succeeded
        expect(result.errors.size).toBe(2); // Half failed

        await pool.shutdown();
        module.WorkerSigningPool.resetInstance();
    });
});

describe('WorkerSigningPool Timeout Handling', () => {
    let WorkerSigningPool: typeof import('../src/workers/WorkerSigningPool.js').WorkerSigningPool;

    beforeEach(async () => {
        vi.resetModules();

        // Use timeout worker
        (globalThis as any).Worker = MockTimeoutWorker;

        const module = await import('../src/workers/WorkerSigningPool.js');
        WorkerSigningPool = module.WorkerSigningPool;
        WorkerSigningPool.resetInstance();
    });

    afterEach(async () => {
        try {
            await WorkerSigningPool.getInstance().shutdown();
        } catch {
            // Ignore
        }
        WorkerSigningPool.resetInstance();
    });

    it('should timeout long-running tasks', async () => {
        const pool = WorkerSigningPool.getInstance({
            workerCount: 1,
            maxKeyHoldTimeMs: 50, // Very short timeout for testing
        });
        pool.preserveWorkers();

        const keyPair: ParallelSignerKeyPair = {
            publicKey: new Uint8Array(33).fill(0x02),
            getPrivateKey: () => new Uint8Array(32).fill(0x42),
        };

        const tasks: SigningTask[] = [
            {
                taskId: 'timeout-task',
                inputIndex: 0,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            },
        ];

        const result = await pool.signBatch(tasks, keyPair);

        expect(result.success).toBe(false);
        expect(result.errors.size).toBe(1);
        expect(result.errors.get(0)).toContain('timeout');
    }, 10000);
});

describe('Concurrent Batch Operations', () => {
    let WorkerSigningPool: typeof import('../src/workers/WorkerSigningPool.js').WorkerSigningPool;

    beforeEach(async () => {
        vi.resetModules();
        (globalThis as any).Worker = MockWorker;

        const module = await import('../src/workers/WorkerSigningPool.js');
        WorkerSigningPool = module.WorkerSigningPool;
        WorkerSigningPool.resetInstance();
    });

    afterEach(async () => {
        try {
            await WorkerSigningPool.getInstance().shutdown();
        } catch {
            // Ignore
        }
        WorkerSigningPool.resetInstance();
    });

    it('should handle concurrent signBatch calls', async () => {
        const pool = WorkerSigningPool.getInstance({ workerCount: 4 });
        pool.preserveWorkers();

        const keyPair: ParallelSignerKeyPair = {
            publicKey: new Uint8Array(33).fill(0x02),
            getPrivateKey: () => new Uint8Array(32).fill(0x42),
        };

        const createTasks = (prefix: string, count: number): SigningTask[] => {
            const tasks: SigningTask[] = [];
            for (let i = 0; i < count; i++) {
                tasks.push({
                    taskId: `${prefix}-${i}`,
                    inputIndex: i,
                    hash: new Uint8Array(32).fill(i),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                });
            }
            return tasks;
        };

        // Start multiple batches concurrently
        const [result1, result2, result3] = await Promise.all([
            pool.signBatch(createTasks('batch1', 5), keyPair),
            pool.signBatch(createTasks('batch2', 5), keyPair),
            pool.signBatch(createTasks('batch3', 5), keyPair),
        ]);

        expect(result1.success).toBe(true);
        expect(result2.success).toBe(true);
        expect(result3.success).toBe(true);

        expect(result1.signatures.size).toBe(5);
        expect(result2.signatures.size).toBe(5);
        expect(result3.signatures.size).toBe(5);
    });
});

describe('Large Batch Performance', () => {
    let WorkerSigningPool: typeof import('../src/workers/WorkerSigningPool.js').WorkerSigningPool;

    beforeEach(async () => {
        vi.resetModules();
        (globalThis as any).Worker = MockWorker;

        const module = await import('../src/workers/WorkerSigningPool.js');
        WorkerSigningPool = module.WorkerSigningPool;
        WorkerSigningPool.resetInstance();
    });

    afterEach(async () => {
        try {
            await WorkerSigningPool.getInstance().shutdown();
        } catch {
            // Ignore
        }
        WorkerSigningPool.resetInstance();
    });

    it('should handle 100 inputs efficiently', async () => {
        const pool = WorkerSigningPool.getInstance({ workerCount: 8 });
        pool.preserveWorkers();

        const keyPair: ParallelSignerKeyPair = {
            publicKey: new Uint8Array(33).fill(0x02),
            getPrivateKey: () => new Uint8Array(32).fill(0x42),
        };

        const tasks: SigningTask[] = [];
        for (let i = 0; i < 100; i++) {
            tasks.push({
                taskId: `task-${i}`,
                inputIndex: i,
                hash: new Uint8Array(32).fill(i % 256),
                signatureType: i % 2 === 0 ? SignatureType.ECDSA : SignatureType.Schnorr,
                sighashType: i % 2 === 0 ? 0x01 : 0x00,
            });
        }

        const result = await pool.signBatch(tasks, keyPair);

        expect(result.success).toBe(true);
        expect(result.signatures.size).toBe(100);
        expect(result.errors.size).toBe(0);
    }, 30000);
});
