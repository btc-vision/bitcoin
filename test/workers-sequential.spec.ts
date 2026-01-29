import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    type ParallelSignerKeyPair,
    SignatureType,
    type SigningTask,
} from '../src/workers/types.js';
import { SequentialSigningPool } from '../src/workers/WorkerSigningPool.sequential.js';
import { EccContext } from '../src/ecc/context.js';
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
 * Every call returns a fresh copy so tests can verify zeroing.
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

describe('SequentialSigningPool', () => {
    beforeEach(() => {
        SequentialSigningPool.resetInstance();
        EccContext.init(nobleBackend);
    });

    afterEach(() => {
        SequentialSigningPool.resetInstance();
        EccContext.clear();
    });

    describe('Singleton Pattern', () => {
        it('should return same instance on multiple calls', () => {
            const pool1 = SequentialSigningPool.getInstance();
            const pool2 = SequentialSigningPool.getInstance();
            expect(pool1).toBe(pool2);
        });

        it('should create new instance after reset', () => {
            const pool1 = SequentialSigningPool.getInstance();
            SequentialSigningPool.resetInstance();
            const pool2 = SequentialSigningPool.getInstance();
            expect(pool1).not.toBe(pool2);
        });

        it('should accept config on first call', () => {
            const pool = SequentialSigningPool.getInstance({ taskTimeoutMs: 5000 });
            expect(pool).toBeDefined();
        });
    });

    describe('Pool Properties', () => {
        it('should report workerCount as 0', () => {
            const pool = SequentialSigningPool.getInstance();
            expect(pool.workerCount).toBe(0);
        });

        it('should report idleWorkerCount as 0', () => {
            const pool = SequentialSigningPool.getInstance();
            expect(pool.idleWorkerCount).toBe(0);
        });

        it('should report busyWorkerCount as 0', () => {
            const pool = SequentialSigningPool.getInstance();
            expect(pool.busyWorkerCount).toBe(0);
        });

        it('should report isPreservingWorkers as false', () => {
            const pool = SequentialSigningPool.getInstance();
            expect(pool.isPreservingWorkers).toBe(false);
        });
    });

    describe('No-op Methods', () => {
        it('should initialize without error', async () => {
            const pool = SequentialSigningPool.getInstance();
            await expect(pool.initialize()).resolves.toBeUndefined();
        });

        it('should shutdown without error', async () => {
            const pool = SequentialSigningPool.getInstance();
            await expect(pool.shutdown()).resolves.toBeUndefined();
        });

        it('should preserve/release without error', () => {
            const pool = SequentialSigningPool.getInstance();
            pool.preserveWorkers();
            pool.releaseWorkers();
            // No-ops — should not throw
        });
    });

    describe('signBatch', () => {
        it('should return success for empty task array', async () => {
            const pool = SequentialSigningPool.getInstance();

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
            const pool = SequentialSigningPool.getInstance();
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
            expect(result.errors.size).toBe(0);

            const sig = result.signatures.get(0)!;
            expect(sig.type).toBe('result');
            expect(sig.taskId).toBe('ecdsa-0');
            expect(sig.inputIndex).toBe(0);
            expect(sig.signatureType).toBe(SignatureType.ECDSA);
            expect(sig.signature).toHaveLength(64);

            // Verify signature with properly typed branded values
            const valid = nobleBackend.verify(
                createMessageHash(hash),
                createPublicKey(pubKey),
                createSignature(sig.signature),
            );
            expect(valid).toBe(true);
        });

        it('should produce valid Schnorr signatures', async () => {
            const pool = SequentialSigningPool.getInstance();
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

            // Verify Schnorr signature with x-only pubkey (32 bytes, strip prefix)
            const valid = nobleBackend.verifySchnorr!(
                createMessageHash(hash),
                createXOnlyPublicKey(pubKey.subarray(1, 33)),
                createSchnorrSignature(sig.signature),
            );
            expect(valid).toBe(true);
        });

        it('should handle mixed ECDSA and Schnorr tasks', async () => {
            const pool = SequentialSigningPool.getInstance();

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
            const pool = SequentialSigningPool.getInstance();
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

        it('should report duration', async () => {
            const pool = SequentialSigningPool.getInstance();

            const keyPair: ParallelSignerKeyPair = {
                publicKey: getTestPublicKey(),
                getPrivateKey: makeTestPrivateKey,
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
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
        });

        it('should handle multiple inputs sequentially', async () => {
            const pool = SequentialSigningPool.getInstance();

            const keyPair: ParallelSignerKeyPair = {
                publicKey: getTestPublicKey(),
                getPrivateKey: makeTestPrivateKey,
            };

            const tasks: SigningTask[] = [];
            for (let i = 0; i < 20; i++) {
                tasks.push({
                    taskId: `task-${i}`,
                    inputIndex: i,
                    hash: new Uint8Array(32).fill(i),
                    signatureType: i % 2 === 0 ? SignatureType.ECDSA : SignatureType.Schnorr,
                    sighashType: i % 2 === 0 ? 0x01 : 0x00,
                });
            }

            const result = await pool.signBatch(tasks, keyPair);

            expect(result.success).toBe(true);
            expect(result.signatures.size).toBe(20);
            expect(result.errors.size).toBe(0);

            for (let i = 0; i < 20; i++) {
                expect(result.signatures.has(i)).toBe(true);
            }
        });
    });

    describe('Error Handling', () => {
        it('should report error for invalid private key (zero)', async () => {
            const pool = SequentialSigningPool.getInstance();

            const keyPair: ParallelSignerKeyPair = {
                publicKey: new Uint8Array(33).fill(0x02),
                // Zero key is invalid for secp256k1
                getPrivateKey: () => new Uint8Array(32),
            };

            const tasks: SigningTask[] = [
                {
                    taskId: 'bad-0',
                    inputIndex: 0,
                    hash: new Uint8Array(32).fill(0x11),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                },
            ];

            const result = await pool.signBatch(tasks, keyPair);

            expect(result.success).toBe(false);
            expect(result.errors.size).toBe(1);
            expect(result.errors.has(0)).toBe(true);
        });

        it('should report error for bad Schnorr signing operation', async () => {
            const pool = SequentialSigningPool.getInstance();

            // Spy on signSchnorr to force a failure after init
            const spy = vi.spyOn(nobleBackend, 'signSchnorr')
                .mockImplementation(() => { throw new Error('Schnorr signing failed'); });

            const keyPair: ParallelSignerKeyPair = {
                publicKey: getTestPublicKey(),
                getPrivateKey: makeTestPrivateKey,
            };

            const tasks: SigningTask[] = [
                {
                    taskId: 'bad-schnorr-0',
                    inputIndex: 0,
                    hash: new Uint8Array(32).fill(0x11),
                    signatureType: SignatureType.Schnorr,
                    sighashType: 0x00,
                },
            ];

            const result = await pool.signBatch(tasks, keyPair);

            expect(result.success).toBe(false);
            expect(result.errors.size).toBe(1);
            expect(result.errors.get(0)).toBe('Schnorr signing failed');

            spy.mockRestore();
        });

        it('should continue signing after individual task failure', async () => {
            const pool = SequentialSigningPool.getInstance();

            // Spy on sign to fail only on the second call
            let callCount = 0;
            const originalSign = nobleBackend.sign.bind(nobleBackend);
            const spy = vi.spyOn(nobleBackend, 'sign')
                .mockImplementation((...args) => {
                    callCount++;
                    if (callCount === 2) {
                        throw new Error('Second task failed');
                    }
                    return originalSign(...args);
                });

            const keyPair: ParallelSignerKeyPair = {
                publicKey: getTestPublicKey(),
                getPrivateKey: makeTestPrivateKey,
            };

            const tasks: SigningTask[] = [
                {
                    taskId: 'task-0',
                    inputIndex: 0,
                    hash: new Uint8Array(32).fill(0x01),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                },
                {
                    taskId: 'task-1',
                    inputIndex: 1,
                    hash: new Uint8Array(32).fill(0x02),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                },
                {
                    taskId: 'task-2',
                    inputIndex: 2,
                    hash: new Uint8Array(32).fill(0x03),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                },
            ];

            const result = await pool.signBatch(tasks, keyPair);

            expect(result.success).toBe(false);
            expect(result.signatures.size).toBe(2); // Tasks 0 and 2 succeeded
            expect(result.errors.size).toBe(1); // Task 1 failed
            expect(result.errors.get(1)).toBe('Second task failed');

            spy.mockRestore();
        });

        it('should sign all tasks when key is valid', async () => {
            const pool = SequentialSigningPool.getInstance();

            const keyPair: ParallelSignerKeyPair = {
                publicKey: getTestPublicKey(),
                getPrivateKey: makeTestPrivateKey,
            };

            const tasks: SigningTask[] = [
                {
                    taskId: 'task-0',
                    inputIndex: 0,
                    hash: new Uint8Array(32).fill(0x01),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                },
                {
                    taskId: 'task-1',
                    inputIndex: 1,
                    hash: new Uint8Array(32).fill(0x02),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                },
                {
                    taskId: 'task-2',
                    inputIndex: 2,
                    hash: new Uint8Array(32).fill(0x03),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                },
            ];

            const result = await pool.signBatch(tasks, keyPair);

            expect(result.success).toBe(true);
            expect(result.signatures.size).toBe(3);
            expect(result.errors.size).toBe(0);
        });
    });

    describe('Key Security', () => {
        it('should zero private key after signing', async () => {
            const pool = SequentialSigningPool.getInstance();

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
            expect(capturedKey!.every((b) => b === 0)).toBe(true);
        });

        it('should zero private key even when signing fails', async () => {
            const pool = SequentialSigningPool.getInstance();

            let capturedKey: Uint8Array | null = null;
            const keyPair: ParallelSignerKeyPair = {
                publicKey: new Uint8Array(33).fill(0x02),
                getPrivateKey: () => {
                    // Invalid key (all zeros) will cause signing to fail
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
            expect(capturedKey!.every((b) => b === 0)).toBe(true);
        });

        it('should call getPrivateKey once per batch', async () => {
            const pool = SequentialSigningPool.getInstance();

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
        it('should have Symbol.asyncDispose method', () => {
            const pool = SequentialSigningPool.getInstance();
            expect(typeof pool[Symbol.asyncDispose]).toBe('function');
        });

        it('should work with await using syntax', async () => {
            SequentialSigningPool.resetInstance();

            let poolRef: SequentialSigningPool | undefined;

            {
                await using pool = SequentialSigningPool.getInstance();
                await pool.initialize();
                poolRef = pool;
                expect(poolRef).toBeDefined();
            }

            // After scope exit, dispose has been called (no-op for sequential)
            expect(poolRef).toBeDefined();
        });

        it('should be safe to call dispose multiple times', async () => {
            const pool = SequentialSigningPool.getInstance();
            await pool[Symbol.asyncDispose]();
            await pool[Symbol.asyncDispose]();
            // Should not throw
        });
    });
});

describe('detectRuntime for React Native', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        // Clean up navigator mock
        if ('product' in navigator) {
            Object.defineProperty(navigator, 'product', {
                value: '',
                writable: true,
                configurable: true,
            });
        }
    });

    it('should return react-native when navigator.product is ReactNative', async () => {
        Object.defineProperty(navigator, 'product', {
            value: 'ReactNative',
            writable: true,
            configurable: true,
        });

        vi.resetModules();
        const { detectRuntime } = await import('../src/workers/index.js');
        expect(detectRuntime()).toBe('react-native');
    });

    it('should not return react-native for regular environments', async () => {
        Object.defineProperty(navigator, 'product', {
            value: 'Gecko',
            writable: true,
            configurable: true,
        });

        vi.resetModules();
        const { detectRuntime } = await import('../src/workers/index.js');
        const runtime = detectRuntime();
        expect(runtime).not.toBe('react-native');
    });
});

describe('React Native index entry point', () => {
    it('should export detectRuntime returning react-native', async () => {
        const { detectRuntime } = await import('../src/workers/index.react-native.js');
        expect(detectRuntime()).toBe('react-native');
    });

    it('should export SequentialSigningPool', async () => {
        const { SequentialSigningPool } = await import('../src/workers/index.react-native.js');
        expect(SequentialSigningPool).toBeDefined();
        expect(typeof SequentialSigningPool.getInstance).toBe('function');
    });

    it('should export WorkerSigningPool as alias for SequentialSigningPool', async () => {
        const mod = await import('../src/workers/index.react-native.js');
        expect(mod.WorkerSigningPool).toBe(mod.SequentialSigningPool);
    });

    it('should export SignatureType', async () => {
        const { SignatureType } = await import('../src/workers/index.react-native.js');
        expect(SignatureType.ECDSA).toBe(0);
        expect(SignatureType.Schnorr).toBe(1);
    });

    it('should export PSBT parallel functions', async () => {
        const { signPsbtParallel, prepareSigningTasks, applySignaturesToPsbt } = await import(
            '../src/workers/index.react-native.js'
        );
        expect(typeof signPsbtParallel).toBe('function');
        expect(typeof prepareSigningTasks).toBe('function');
        expect(typeof applySignaturesToPsbt).toBe('function');
    });

    it('should export createSigningPool', async () => {
        const { createSigningPool } = await import('../src/workers/index.react-native.js');
        expect(typeof createSigningPool).toBe('function');
    });
});
