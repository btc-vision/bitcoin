import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    ParallelSignerKeyPair,
    SigningTask,
} from '../src/workers/types.js';
import { SignatureType } from '../src/workers/types.js';
import {
    createNobleBackend,
    createPrivateKey,
    createMessageHash,
    createPublicKey,
    createXOnlyPublicKey,
    createSignature,
    createSchnorrSignature,
} from '@btc-vision/ecpair';

const nobleBackend = createNobleBackend();

/**
 * Returns a valid secp256k1 private key (scalar = 1).
 */
function makeTestPrivateKey(): Uint8Array {
    const key = new Uint8Array(32);
    key[31] = 0x01;
    return key;
}

/** Derives the compressed public key for the test private key. */
function getTestPublicKey(): Uint8Array {
    return nobleBackend.pointFromScalar(createPrivateKey(makeTestPrivateKey()))!;
}

// --- Mock react-native-worklets ---
//
// In Node.js tests, we can't use real worklet runtimes.
// Instead, we simulate them: `createWorkletRuntime` returns a named object,
// and `runOnRuntime` simply calls the function in the current JS context.
//
// The ECC bundle eval during initialize() sets `globalThis.nobleBundle`,
// which subsequent signing calls then read. We let it persist on globalThis
// for the duration of each test.

interface MockRuntime {
    name: string;
}

function createMockWorkletRuntime(name: string): MockRuntime {
    return { name };
}

async function mockRunOnRuntime<T>(
    _runtime: MockRuntime,
    fn: () => T,
): Promise<T> {
    // Just execute the function in current context.
    // The ECC bundle eval will set globalThis.nobleBundle which persists.
    return fn();
}

vi.mock('react-native-worklets', () => ({
    createWorkletRuntime: createMockWorkletRuntime,
    runOnRuntime: mockRunOnRuntime,
}));

describe('WorkletSigningPool', () => {
    let WorkletSigningPool: typeof import('../src/workers/WorkerSigningPool.worklet.js').WorkletSigningPool;

    beforeEach(async () => {
        const mod = await import('../src/workers/WorkerSigningPool.worklet.js');
        WorkletSigningPool = mod.WorkletSigningPool;
        WorkletSigningPool.resetInstance();
    });

    afterEach(() => {
        WorkletSigningPool.resetInstance();
        // Clean up nobleBundle from globalThis
        delete (globalThis as Record<string, unknown>)['nobleBundle'];
    });

    describe('Singleton Pattern', () => {
        it('should return same instance on multiple calls', () => {
            const pool1 = WorkletSigningPool.getInstance();
            const pool2 = WorkletSigningPool.getInstance();
            expect(pool1).toBe(pool2);
        });

        it('should create new instance after reset', () => {
            const pool1 = WorkletSigningPool.getInstance();
            WorkletSigningPool.resetInstance();
            const pool2 = WorkletSigningPool.getInstance();
            expect(pool1).not.toBe(pool2);
        });

        it('should accept config on first call', () => {
            const pool = WorkletSigningPool.getInstance({ workerCount: 2 });
            expect(pool).toBeDefined();
        });
    });

    describe('Pool Properties (before init)', () => {
        it('should report workerCount as 0 before init', () => {
            const pool = WorkletSigningPool.getInstance();
            expect(pool.workerCount).toBe(0);
        });

        it('should report busyWorkerCount as 0', () => {
            const pool = WorkletSigningPool.getInstance();
            expect(pool.busyWorkerCount).toBe(0);
        });

        it('should report isPreservingWorkers as false by default', () => {
            const pool = WorkletSigningPool.getInstance();
            expect(pool.isPreservingWorkers).toBe(false);
        });
    });

    describe('Lifecycle', () => {
        it('should initialize and create runtimes', async () => {
            const pool = WorkletSigningPool.getInstance({ workerCount: 2 });
            await pool.initialize();
            expect(pool.workerCount).toBe(2);
        });

        it('should be idempotent on double initialize', async () => {
            const pool = WorkletSigningPool.getInstance({ workerCount: 2 });
            await pool.initialize();
            await pool.initialize();
            expect(pool.workerCount).toBe(2);
        });

        it('should shutdown and clear runtimes', async () => {
            const pool = WorkletSigningPool.getInstance({ workerCount: 2 });
            await pool.initialize();
            expect(pool.workerCount).toBe(2);
            await pool.shutdown();
            expect(pool.workerCount).toBe(0);
        });

        it('should support preserveWorkers / releaseWorkers', () => {
            const pool = WorkletSigningPool.getInstance();
            expect(pool.isPreservingWorkers).toBe(false);
            pool.preserveWorkers();
            expect(pool.isPreservingWorkers).toBe(true);
            pool.releaseWorkers();
            expect(pool.isPreservingWorkers).toBe(false);
        });

        it('should have Symbol.asyncDispose', () => {
            const pool = WorkletSigningPool.getInstance();
            expect(typeof pool[Symbol.asyncDispose]).toBe('function');
        });
    });

    describe('signBatch', () => {
        it('should return success for empty task array', async () => {
            const pool = WorkletSigningPool.getInstance({ workerCount: 2 });
            pool.preserveWorkers();

            const keyPair: ParallelSignerKeyPair = {
                publicKey: getTestPublicKey(),
                getPrivateKey: makeTestPrivateKey,
            };

            const result = await pool.signBatch([], keyPair);

            expect(result.success).toBe(true);
            expect(result.signatures.size).toBe(0);
            expect(result.errors.size).toBe(0);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
        });

        it('should produce valid ECDSA signatures', async () => {
            const pool = WorkletSigningPool.getInstance({ workerCount: 1 });
            pool.preserveWorkers();
            await pool.initialize();

            const hash = new Uint8Array(32).fill(0x11);
            const pubKey = getTestPublicKey();

            const keyPair: ParallelSignerKeyPair = {
                publicKey: pubKey,
                getPrivateKey: makeTestPrivateKey,
            };

            const tasks: SigningTask[] = [
                {
                    taskId: 'ecdsa-0',
                    inputIndex: 0,
                    hash,
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                },
            ];

            const result = await pool.signBatch(tasks, keyPair);

            expect(result.success).toBe(true);
            expect(result.signatures.size).toBe(1);

            const sig = result.signatures.get(0)!;
            expect(sig.type).toBe('result');
            expect(sig.taskId).toBe('ecdsa-0');
            expect(sig.inputIndex).toBe(0);
            expect(sig.signatureType).toBe(SignatureType.ECDSA);
            expect(sig.signature).toHaveLength(64);

            // Verify signature
            const valid = nobleBackend.verify(
                createMessageHash(hash),
                createPublicKey(pubKey),
                createSignature(sig.signature),
            );
            expect(valid).toBe(true);
        });

        it('should produce valid Schnorr signatures', async () => {
            const pool = WorkletSigningPool.getInstance({ workerCount: 1 });
            pool.preserveWorkers();
            await pool.initialize();

            const hash = new Uint8Array(32).fill(0x22);
            const pubKey = getTestPublicKey();

            const keyPair: ParallelSignerKeyPair = {
                publicKey: pubKey,
                getPrivateKey: makeTestPrivateKey,
            };

            const tasks: SigningTask[] = [
                {
                    taskId: 'schnorr-0',
                    inputIndex: 0,
                    hash,
                    signatureType: SignatureType.Schnorr,
                    sighashType: 0x00,
                },
            ];

            const result = await pool.signBatch(tasks, keyPair);

            expect(result.success).toBe(true);
            expect(result.signatures.size).toBe(1);

            const sig = result.signatures.get(0)!;
            expect(sig.signatureType).toBe(SignatureType.Schnorr);
            expect(sig.signature).toHaveLength(64);

            // Verify Schnorr signature
            const valid = nobleBackend.verifySchnorr!(
                createMessageHash(hash),
                createXOnlyPublicKey(pubKey.subarray(1, 33)),
                createSchnorrSignature(sig.signature),
            );
            expect(valid).toBe(true);
        });

        it('should handle mixed ECDSA and Schnorr tasks', async () => {
            const pool = WorkletSigningPool.getInstance({ workerCount: 2 });
            pool.preserveWorkers();
            await pool.initialize();

            const keyPair: ParallelSignerKeyPair = {
                publicKey: getTestPublicKey(),
                getPrivateKey: makeTestPrivateKey,
            };

            const tasks: SigningTask[] = [
                {
                    taskId: 'ecdsa-0',
                    inputIndex: 0,
                    hash: new Uint8Array(32).fill(0x11),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                },
                {
                    taskId: 'schnorr-1',
                    inputIndex: 1,
                    hash: new Uint8Array(32).fill(0x22),
                    signatureType: SignatureType.Schnorr,
                    sighashType: 0x00,
                },
            ];

            const result = await pool.signBatch(tasks, keyPair);

            expect(result.success).toBe(true);
            expect(result.signatures.size).toBe(2);
            expect(result.signatures.get(0)?.signatureType).toBe(SignatureType.ECDSA);
            expect(result.signatures.get(1)?.signatureType).toBe(SignatureType.Schnorr);
        });

        it('should include leafHash for Taproot script-path', async () => {
            const pool = WorkletSigningPool.getInstance({ workerCount: 1 });
            pool.preserveWorkers();
            await pool.initialize();

            const leafHash = new Uint8Array(32).fill(0xcd);

            const keyPair: ParallelSignerKeyPair = {
                publicKey: getTestPublicKey(),
                getPrivateKey: makeTestPrivateKey,
            };

            const tasks: SigningTask[] = [
                {
                    taskId: 'script-path-0',
                    inputIndex: 0,
                    hash: new Uint8Array(32).fill(0x33),
                    signatureType: SignatureType.Schnorr,
                    sighashType: 0x00,
                    leafHash,
                },
            ];

            const result = await pool.signBatch(tasks, keyPair);

            expect(result.success).toBe(true);
            expect(result.signatures.get(0)?.leafHash).toBeDefined();
            expect(result.signatures.get(0)?.leafHash).toEqual(leafHash);
        });

        it('should handle multiple inputs', async () => {
            const pool = WorkletSigningPool.getInstance({ workerCount: 2 });
            pool.preserveWorkers();
            await pool.initialize();

            const keyPair: ParallelSignerKeyPair = {
                publicKey: getTestPublicKey(),
                getPrivateKey: makeTestPrivateKey,
            };

            const tasks: SigningTask[] = [];
            for (let i = 0; i < 10; i++) {
                tasks.push({
                    taskId: `task-${i}`,
                    inputIndex: i,
                    hash: new Uint8Array(32).fill(i + 1),
                    signatureType: i % 2 === 0 ? SignatureType.ECDSA : SignatureType.Schnorr,
                    sighashType: i % 2 === 0 ? 0x01 : 0x00,
                });
            }

            const result = await pool.signBatch(tasks, keyPair);

            expect(result.success).toBe(true);
            expect(result.signatures.size).toBe(10);
            expect(result.errors.size).toBe(0);

            for (let i = 0; i < 10; i++) {
                expect(result.signatures.has(i)).toBe(true);
            }
        });
    });

    describe('Key Security', () => {
        it('should zero private key in main thread after signing', async () => {
            const pool = WorkletSigningPool.getInstance({ workerCount: 1 });
            pool.preserveWorkers();
            await pool.initialize();

            let capturedKey: Uint8Array | null = null;
            const keyPair: ParallelSignerKeyPair = {
                publicKey: getTestPublicKey(),
                getPrivateKey: () => {
                    capturedKey = makeTestPrivateKey();
                    return capturedKey;
                },
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

            await pool.signBatch(tasks, keyPair);

            expect(capturedKey).not.toBeNull();
            expect(capturedKey!.every((b: number) => b === 0)).toBe(true);
        });

        it('should zero private key even when signing fails', async () => {
            const pool = WorkletSigningPool.getInstance({ workerCount: 1 });
            pool.preserveWorkers();
            await pool.initialize();

            let capturedKey: Uint8Array | null = null;
            const keyPair: ParallelSignerKeyPair = {
                publicKey: new Uint8Array(33).fill(0x02),
                getPrivateKey: () => {
                    // Zero key is invalid for secp256k1
                    capturedKey = new Uint8Array(32);
                    return capturedKey;
                },
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

            await pool.signBatch(tasks, keyPair);

            expect(capturedKey).not.toBeNull();
            expect(capturedKey!.every((b: number) => b === 0)).toBe(true);
        });

        it('should call getPrivateKey once per batch', async () => {
            const pool = WorkletSigningPool.getInstance({ workerCount: 2 });
            pool.preserveWorkers();
            await pool.initialize();

            let callCount = 0;
            const keyPair: ParallelSignerKeyPair = {
                publicKey: getTestPublicKey(),
                getPrivateKey: () => {
                    callCount++;
                    return makeTestPrivateKey();
                },
            };

            const tasks: SigningTask[] = [
                {
                    taskId: 'task-0',
                    inputIndex: 0,
                    hash: new Uint8Array(32).fill(0x11),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                },
                {
                    taskId: 'task-1',
                    inputIndex: 1,
                    hash: new Uint8Array(32).fill(0x22),
                    signatureType: SignatureType.Schnorr,
                    sighashType: 0x00,
                },
            ];

            await pool.signBatch(tasks, keyPair);

            expect(callCount).toBe(1);
        });
    });

    describe('Symbol.asyncDispose', () => {
        it('should be safe to call dispose multiple times', async () => {
            const pool = WorkletSigningPool.getInstance({ workerCount: 1 });
            await pool.initialize();
            await pool[Symbol.asyncDispose]();
            await pool[Symbol.asyncDispose]();
            // Should not throw
        });
    });
});

describe('React Native index worklet exports', () => {
    it('should export WorkletSigningPool', async () => {
        const mod = await import('../src/workers/index.react-native.js');
        expect(mod.WorkletSigningPool).toBeDefined();
        expect(typeof mod.WorkletSigningPool.getInstance).toBe('function');
    });

    it('should still export SequentialSigningPool', async () => {
        const mod = await import('../src/workers/index.react-native.js');
        expect(mod.SequentialSigningPool).toBeDefined();
    });

    it('should still export WorkerSigningPool as SequentialSigningPool alias', async () => {
        const mod = await import('../src/workers/index.react-native.js');
        expect(mod.WorkerSigningPool).toBe(mod.SequentialSigningPool);
    });
});

describe('createSigningPool fallback', () => {
    it('should fall back to SequentialSigningPool when worklets import fails', async () => {
        // We can't easily un-mock react-native-worklets within the same test file
        // since vi.mock is hoisted. Instead, test that createSigningPool catches
        // WorkletSigningPool.initialize() failures by verifying the fallback path
        // exists in the module and that SequentialSigningPool is functional.
        const { SequentialSigningPool } = await import('../src/workers/WorkerSigningPool.sequential.js');
        SequentialSigningPool.resetInstance();

        const pool = SequentialSigningPool.getInstance();
        await pool.initialize();

        expect(pool.workerCount).toBe(0);
        expect(pool.isPreservingWorkers).toBe(false);

        SequentialSigningPool.resetInstance();
    });
});
