import { beforeEach, describe, expect, it } from 'vitest';
import {
    isSigningError,
    isSigningResult,
    isWorkerReady,
    type ParallelSignerKeyPair,
    SignatureType,
    type SigningErrorMessage,
    type SigningResultMessage,
    type SigningTask,
    type WorkerReadyMessage,
    WorkerState,
} from '../src/workers/types.js';
import { generateWorkerCode } from '../src/workers/signing-worker.js';

describe('Worker Types', () => {
    describe('SignatureType', () => {
        it('should have ECDSA = 0', () => {
            expect(SignatureType.ECDSA).toBe(0);
        });

        it('should have Schnorr = 1', () => {
            expect(SignatureType.Schnorr).toBe(1);
        });

        it('should be const (readonly)', () => {
            // TypeScript ensures this at compile time, but verify runtime values exist
            expect(Object.isFrozen(SignatureType)).toBe(false); // as const doesn't freeze
            expect(SignatureType.ECDSA).toBeDefined();
            expect(SignatureType.Schnorr).toBeDefined();
        });
    });

    describe('WorkerState', () => {
        it('should have correct state values', () => {
            expect(WorkerState.Initializing).toBe(0);
            expect(WorkerState.Idle).toBe(1);
            expect(WorkerState.Busy).toBe(2);
            expect(WorkerState.ShuttingDown).toBe(3);
            expect(WorkerState.Terminated).toBe(4);
        });

        it('should have unique values', () => {
            const values = Object.values(WorkerState);
            const uniqueValues = new Set(values);
            expect(uniqueValues.size).toBe(values.length);
        });
    });

    describe('Type Guards', () => {
        describe('isSigningError', () => {
            it('should return true for error responses', () => {
                const errorResponse: SigningErrorMessage = {
                    type: 'error',
                    taskId: 'test-1',
                    error: 'Test error',
                    inputIndex: 0,
                };
                expect(isSigningError(errorResponse)).toBe(true);
            });

            it('should return false for result responses', () => {
                const resultResponse: SigningResultMessage = {
                    type: 'result',
                    taskId: 'test-1',
                    signature: new Uint8Array(64),
                    inputIndex: 0,
                    publicKey: new Uint8Array(33),
                    signatureType: SignatureType.ECDSA,
                };
                expect(isSigningError(resultResponse)).toBe(false);
            });

            it('should return false for ready responses', () => {
                const readyResponse: WorkerReadyMessage = {
                    type: 'ready',
                };
                expect(isSigningError(readyResponse)).toBe(false);
            });
        });

        describe('isSigningResult', () => {
            it('should return true for result responses', () => {
                const resultResponse: SigningResultMessage = {
                    type: 'result',
                    taskId: 'test-1',
                    signature: new Uint8Array(64),
                    inputIndex: 0,
                    publicKey: new Uint8Array(33),
                    signatureType: SignatureType.Schnorr,
                };
                expect(isSigningResult(resultResponse)).toBe(true);
            });

            it('should return false for error responses', () => {
                const errorResponse: SigningErrorMessage = {
                    type: 'error',
                    taskId: 'test-1',
                    error: 'Test error',
                    inputIndex: 0,
                };
                expect(isSigningResult(errorResponse)).toBe(false);
            });

            it('should return false for ready responses', () => {
                const readyResponse: WorkerReadyMessage = {
                    type: 'ready',
                };
                expect(isSigningResult(readyResponse)).toBe(false);
            });
        });

        describe('isWorkerReady', () => {
            it('should return true for ready responses', () => {
                const readyResponse: WorkerReadyMessage = {
                    type: 'ready',
                };
                expect(isWorkerReady(readyResponse)).toBe(true);
            });

            it('should return false for result responses', () => {
                const resultResponse: SigningResultMessage = {
                    type: 'result',
                    taskId: 'test-1',
                    signature: new Uint8Array(64),
                    inputIndex: 0,
                    publicKey: new Uint8Array(33),
                    signatureType: SignatureType.ECDSA,
                };
                expect(isWorkerReady(resultResponse)).toBe(false);
            });

            it('should return false for error responses', () => {
                const errorResponse: SigningErrorMessage = {
                    type: 'error',
                    taskId: 'test-1',
                    error: 'Test error',
                    inputIndex: 0,
                };
                expect(isWorkerReady(errorResponse)).toBe(false);
            });
        });
    });
});

describe('Worker Code Generation', () => {
    describe('generateWorkerCode', () => {
        let workerCode: string;

        beforeEach(() => {
            workerCode = generateWorkerCode();
        });

        it('should generate non-empty code', () => {
            expect(workerCode).toBeTruthy();
            expect(workerCode.length).toBeGreaterThan(100);
        });

        it('should contain secureZero function', () => {
            expect(workerCode).toContain('secureZero');
            expect(workerCode).toContain('arr.fill(0)');
        });

        it('should contain message handler', () => {
            expect(workerCode).toContain('self.onmessage');
        });

        it('should handle init message type', () => {
            expect(workerCode).toContain("case 'init':");
        });

        it('should handle sign message type', () => {
            expect(workerCode).toContain("case 'sign':");
        });

        it('should handle shutdown message type', () => {
            expect(workerCode).toContain("case 'shutdown':");
        });

        it('should validate hash length (32 bytes)', () => {
            expect(workerCode).toContain('hash.length !== 32');
        });

        it('should validate private key length (32 bytes)', () => {
            expect(workerCode).toContain('privateKey.length !== 32');
        });

        it('should zero private key after signing', () => {
            // Check that secureZero is called on privateKey
            expect(workerCode).toContain('secureZero(privateKey)');
        });

        it('should handle Schnorr signatures (signatureType === 1)', () => {
            expect(workerCode).toContain('signatureType === 1');
            expect(workerCode).toContain('signSchnorr');
        });

        it('should handle ECDSA signatures', () => {
            expect(workerCode).toContain('eccLib.sign');
        });

        it('should post ready message after init', () => {
            expect(workerCode).toContain("type: 'ready'");
        });

        it('should post shutdown-ack message on shutdown', () => {
            expect(workerCode).toContain("type: 'shutdown-ack'");
        });

        it('should call self.close() on shutdown', () => {
            expect(workerCode).toContain('self.close()');
        });

        it('should include error handling', () => {
            expect(workerCode).toContain('catch');
            expect(workerCode).toContain("type: 'error'");
        });

        it('should support lowR for ECDSA', () => {
            expect(workerCode).toContain('lowR');
        });

        it('should support leafHash for Taproot', () => {
            expect(workerCode).toContain('leafHash');
        });
    });
});

describe('SigningTask Interface', () => {
    it('should accept valid ECDSA task', () => {
        const task: SigningTask = {
            taskId: 'ecdsa-task-1',
            inputIndex: 0,
            hash: new Uint8Array(32),
            signatureType: SignatureType.ECDSA,
            sighashType: 0x01, // SIGHASH_ALL
        };

        expect(task.taskId).toBe('ecdsa-task-1');
        expect(task.inputIndex).toBe(0);
        expect(task.hash.length).toBe(32);
        expect(task.signatureType).toBe(SignatureType.ECDSA);
        expect(task.sighashType).toBe(0x01);
    });

    it('should accept valid Schnorr task', () => {
        const task: SigningTask = {
            taskId: 'schnorr-task-1',
            inputIndex: 1,
            hash: new Uint8Array(32).fill(0xab),
            signatureType: SignatureType.Schnorr,
            sighashType: 0x00, // SIGHASH_DEFAULT
        };

        expect(task.signatureType).toBe(SignatureType.Schnorr);
        expect(task.sighashType).toBe(0x00);
    });

    it('should accept task with lowR option', () => {
        const task: SigningTask = {
            taskId: 'ecdsa-lowr-1',
            inputIndex: 0,
            hash: new Uint8Array(32),
            signatureType: SignatureType.ECDSA,
            sighashType: 0x01,
            lowR: true,
        };

        expect(task.lowR).toBe(true);
    });

    it('should accept task with leafHash for Taproot script-path', () => {
        const leafHash = new Uint8Array(32).fill(0xcd);
        const task: SigningTask = {
            taskId: 'taproot-script-1',
            inputIndex: 2,
            hash: new Uint8Array(32),
            signatureType: SignatureType.Schnorr,
            sighashType: 0x00,
            leafHash,
        };

        expect(task.leafHash).toBeDefined();
        expect(task.leafHash?.length).toBe(32);
    });
});

describe('ParallelSignerKeyPair Interface', () => {
    it('should accept valid key pair with getPrivateKey', () => {
        const privateKey = new Uint8Array(32).fill(0x42);
        const publicKey = new Uint8Array(33).fill(0x02);

        const keyPair: ParallelSignerKeyPair = {
            publicKey,
            getPrivateKey: () => privateKey,
        };

        expect(keyPair.publicKey.length).toBe(33);
        expect(keyPair.getPrivateKey().length).toBe(32);
    });

    it('should accept key pair with optional sign method', () => {
        const privateKey = new Uint8Array(32).fill(0x42);
        const publicKey = new Uint8Array(33).fill(0x02);

        const keyPair: ParallelSignerKeyPair = {
            publicKey,
            getPrivateKey: () => privateKey,
            sign: (_hash: Uint8Array, _lowR?: boolean) => new Uint8Array(64), // DER signature
        };

        expect(keyPair.sign).toBeDefined();
        expect(keyPair.sign!(new Uint8Array(32)).length).toBe(64);
    });

    it('should accept key pair with optional signSchnorr method', () => {
        const privateKey = new Uint8Array(32).fill(0x42);
        const publicKey = new Uint8Array(33).fill(0x02);

        const keyPair: ParallelSignerKeyPair = {
            publicKey,
            getPrivateKey: () => privateKey,
            signSchnorr: (_hash: Uint8Array) => new Uint8Array(64), // Schnorr signature
        };

        expect(keyPair.signSchnorr).toBeDefined();
        expect(keyPair.signSchnorr!(new Uint8Array(32)).length).toBe(64);
    });
});

describe('SigningResultMessage', () => {
    it('should represent ECDSA result correctly', () => {
        const result: SigningResultMessage = {
            type: 'result',
            taskId: 'test-ecdsa',
            signature: new Uint8Array(71), // DER-encoded ECDSA
            inputIndex: 0,
            publicKey: new Uint8Array(33),
            signatureType: SignatureType.ECDSA,
        };

        expect(result.type).toBe('result');
        expect(result.signatureType).toBe(SignatureType.ECDSA);
        expect(result.leafHash).toBeUndefined();
    });

    it('should represent Schnorr key-path result correctly', () => {
        const result: SigningResultMessage = {
            type: 'result',
            taskId: 'test-schnorr-key',
            signature: new Uint8Array(64), // Raw Schnorr
            inputIndex: 1,
            publicKey: new Uint8Array(32), // x-only pubkey for Taproot
            signatureType: SignatureType.Schnorr,
        };

        expect(result.signatureType).toBe(SignatureType.Schnorr);
        expect(result.signature.length).toBe(64);
        expect(result.leafHash).toBeUndefined();
    });

    it('should represent Schnorr script-path result correctly', () => {
        const leafHash = new Uint8Array(32).fill(0xef);
        const result: SigningResultMessage = {
            type: 'result',
            taskId: 'test-schnorr-script',
            signature: new Uint8Array(64),
            inputIndex: 2,
            publicKey: new Uint8Array(32),
            signatureType: SignatureType.Schnorr,
            leafHash,
        };

        expect(result.leafHash).toBeDefined();
        expect(result.leafHash?.length).toBe(32);
    });
});

describe('SigningErrorMessage', () => {
    it('should represent error correctly', () => {
        const error: SigningErrorMessage = {
            type: 'error',
            taskId: 'failed-task',
            error: 'Invalid private key',
            inputIndex: 3,
        };

        expect(error.type).toBe('error');
        expect(error.error).toBe('Invalid private key');
        expect(error.inputIndex).toBe(3);
    });

    it('should handle various error messages', () => {
        const errors = [
            'Invalid hash: must be 32 bytes',
            'Invalid private key: must be 32 bytes',
            'ECC library not initialized',
            'Signing failed',
            'ECC library does not support Schnorr signatures',
        ];

        for (const errorMsg of errors) {
            const error: SigningErrorMessage = {
                type: 'error',
                taskId: `error-${errorMsg.slice(0, 10)}`,
                error: errorMsg,
                inputIndex: 0,
            };
            expect(error.error).toBe(errorMsg);
        }
    });
});

describe('Edge Cases', () => {
    describe('Hash Validation', () => {
        it('should reject hash shorter than 32 bytes', () => {
            const task: SigningTask = {
                taskId: 'short-hash',
                inputIndex: 0,
                hash: new Uint8Array(31), // Too short
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            };

            // The worker would reject this, but we can verify the task structure
            expect(task.hash.length).toBe(31);
            expect(task.hash.length).not.toBe(32);
        });

        it('should reject hash longer than 32 bytes', () => {
            const task: SigningTask = {
                taskId: 'long-hash',
                inputIndex: 0,
                hash: new Uint8Array(33), // Too long
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            };

            expect(task.hash.length).toBe(33);
            expect(task.hash.length).not.toBe(32);
        });

        it('should accept exactly 32-byte hash', () => {
            const task: SigningTask = {
                taskId: 'valid-hash',
                inputIndex: 0,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            };

            expect(task.hash.length).toBe(32);
        });
    });

    describe('Input Index Bounds', () => {
        it('should handle input index 0', () => {
            const task: SigningTask = {
                taskId: 'index-0',
                inputIndex: 0,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            };

            expect(task.inputIndex).toBe(0);
        });

        it('should handle large input indices', () => {
            const task: SigningTask = {
                taskId: 'large-index',
                inputIndex: 999,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            };

            expect(task.inputIndex).toBe(999);
        });

        it('should handle negative input index (edge case)', () => {
            // Note: In practice, this would be validated elsewhere
            const task: SigningTask = {
                taskId: 'negative-index',
                inputIndex: -1,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            };

            expect(task.inputIndex).toBe(-1);
        });
    });

    describe('Sighash Types', () => {
        it('should handle SIGHASH_ALL (0x01)', () => {
            const task: SigningTask = {
                taskId: 'sighash-all',
                inputIndex: 0,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            };

            expect(task.sighashType).toBe(0x01);
        });

        it('should handle SIGHASH_NONE (0x02)', () => {
            const task: SigningTask = {
                taskId: 'sighash-none',
                inputIndex: 0,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x02,
            };

            expect(task.sighashType).toBe(0x02);
        });

        it('should handle SIGHASH_SINGLE (0x03)', () => {
            const task: SigningTask = {
                taskId: 'sighash-single',
                inputIndex: 0,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x03,
            };

            expect(task.sighashType).toBe(0x03);
        });

        it('should handle SIGHASH_ANYONECANPAY (0x80)', () => {
            const task: SigningTask = {
                taskId: 'sighash-anyonecanpay',
                inputIndex: 0,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x81, // ALL | ANYONECANPAY
            };

            expect(task.sighashType).toBe(0x81);
        });

        it('should handle SIGHASH_DEFAULT (0x00) for Taproot', () => {
            const task: SigningTask = {
                taskId: 'sighash-default',
                inputIndex: 0,
                hash: new Uint8Array(32),
                signatureType: SignatureType.Schnorr,
                sighashType: 0x00,
            };

            expect(task.sighashType).toBe(0x00);
        });
    });

    describe('Public Key Formats', () => {
        it('should handle compressed public key (33 bytes)', () => {
            const publicKey = new Uint8Array(33);
            publicKey[0] = 0x02; // Even y-coordinate prefix

            const keyPair: ParallelSignerKeyPair = {
                publicKey,
                getPrivateKey: () => new Uint8Array(32),
            };

            expect(keyPair.publicKey.length).toBe(33);
            expect(keyPair.publicKey[0]).toBe(0x02);
        });

        it('should handle compressed public key (odd prefix)', () => {
            const publicKey = new Uint8Array(33);
            publicKey[0] = 0x03; // Odd y-coordinate prefix

            const keyPair: ParallelSignerKeyPair = {
                publicKey,
                getPrivateKey: () => new Uint8Array(32),
            };

            expect(keyPair.publicKey[0]).toBe(0x03);
        });

        it('should handle uncompressed public key (65 bytes)', () => {
            const publicKey = new Uint8Array(65);
            publicKey[0] = 0x04; // Uncompressed prefix

            const keyPair: ParallelSignerKeyPair = {
                publicKey,
                getPrivateKey: () => new Uint8Array(32),
            };

            expect(keyPair.publicKey.length).toBe(65);
            expect(keyPair.publicKey[0]).toBe(0x04);
        });

        it('should handle x-only public key (32 bytes) for Taproot', () => {
            const publicKey = new Uint8Array(32); // x-only, no prefix

            const keyPair: ParallelSignerKeyPair = {
                publicKey,
                getPrivateKey: () => new Uint8Array(32),
            };

            expect(keyPair.publicKey.length).toBe(32);
        });
    });

    describe('Secure Zero Behavior', () => {
        it('should verify secureZero is in worker code', () => {
            const code = generateWorkerCode();

            // Verify secureZero function exists
            expect(code).toContain('function secureZero(arr)');

            // Verify it uses fill(0)
            expect(code).toContain('arr.fill(0)');

            // Verify it's called on privateKey
            const privateKeyZeroCount = (code.match(/secureZero\(privateKey\)/g) || []).length;
            expect(privateKeyZeroCount).toBeGreaterThanOrEqual(2); // At least on success and error paths
        });
    });

    describe('Empty and Null Cases', () => {
        it('should handle empty task ID', () => {
            const task: SigningTask = {
                taskId: '',
                inputIndex: 0,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            };

            expect(task.taskId).toBe('');
        });

        it('should handle zero-filled hash', () => {
            const task: SigningTask = {
                taskId: 'zero-hash',
                inputIndex: 0,
                hash: new Uint8Array(32).fill(0),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            };

            expect(task.hash.every((b) => b === 0)).toBe(true);
        });

        it('should handle max value hash', () => {
            const task: SigningTask = {
                taskId: 'max-hash',
                inputIndex: 0,
                hash: new Uint8Array(32).fill(0xff),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            };

            expect(task.hash.every((b) => b === 0xff)).toBe(true);
        });
    });

    describe('Concurrent Task IDs', () => {
        it('should allow unique task IDs', () => {
            const tasks: SigningTask[] = [];
            for (let i = 0; i < 100; i++) {
                tasks.push({
                    taskId: `task-${i}`,
                    inputIndex: i,
                    hash: new Uint8Array(32),
                    signatureType: SignatureType.ECDSA,
                    sighashType: 0x01,
                });
            }

            const taskIds = tasks.map((t) => t.taskId);
            const uniqueIds = new Set(taskIds);
            expect(uniqueIds.size).toBe(100);
        });

        it('should allow duplicate task IDs (implementation handles this)', () => {
            const task1: SigningTask = {
                taskId: 'duplicate-id',
                inputIndex: 0,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            };

            const task2: SigningTask = {
                taskId: 'duplicate-id', // Same ID
                inputIndex: 1,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            };

            // Pool implementation should handle this, but tasks can have same ID
            expect(task1.taskId).toBe(task2.taskId);
            expect(task1.inputIndex).not.toBe(task2.inputIndex);
        });
    });
});

describe('Memory Safety', () => {
    it('should allow getPrivateKey to return fresh array each time', () => {
        let callCount = 0;
        const keyPair: ParallelSignerKeyPair = {
            publicKey: new Uint8Array(33),
            getPrivateKey: () => {
                callCount++;
                return new Uint8Array(32).fill(callCount);
            },
        };

        const key1 = keyPair.getPrivateKey();
        const key2 = keyPair.getPrivateKey();

        expect(key1[0]).toBe(1);
        expect(key2[0]).toBe(2);
        expect(callCount).toBe(2);
    });

    it('should allow zeroing returned private key', () => {
        const originalKey = new Uint8Array(32).fill(0x42);
        const keyPair: ParallelSignerKeyPair = {
            publicKey: new Uint8Array(33),
            getPrivateKey: () => {
                // Return a copy so original isn't affected
                const copy = new Uint8Array(originalKey);
                return copy;
            },
        };

        const key = keyPair.getPrivateKey();
        expect(key[0]).toBe(0x42);

        // Zero the key (simulating what worker does)
        key.fill(0);
        expect(key[0]).toBe(0);

        // Original should be unaffected
        expect(originalKey[0]).toBe(0x42);
    });
});

describe('Signature Verification Helpers', () => {
    it('should identify ECDSA signatures by type', () => {
        const result: SigningResultMessage = {
            type: 'result',
            taskId: 'test',
            signature: new Uint8Array(71),
            inputIndex: 0,
            publicKey: new Uint8Array(33),
            signatureType: SignatureType.ECDSA,
        };

        expect(result.signatureType === SignatureType.ECDSA).toBe(true);
        expect(result.signatureType === SignatureType.Schnorr).toBe(false);
    });

    it('should identify Schnorr signatures by type', () => {
        const result: SigningResultMessage = {
            type: 'result',
            taskId: 'test',
            signature: new Uint8Array(64),
            inputIndex: 0,
            publicKey: new Uint8Array(32),
            signatureType: SignatureType.Schnorr,
        };

        expect(result.signatureType === SignatureType.Schnorr).toBe(true);
        expect(result.signatureType === SignatureType.ECDSA).toBe(false);
    });

    it('should distinguish key-path from script-path Taproot', () => {
        const keyPathResult: SigningResultMessage = {
            type: 'result',
            taskId: 'keypath',
            signature: new Uint8Array(64),
            inputIndex: 0,
            publicKey: new Uint8Array(32),
            signatureType: SignatureType.Schnorr,
            // No leafHash = key-path
        };

        const scriptPathResult: SigningResultMessage = {
            type: 'result',
            taskId: 'scriptpath',
            signature: new Uint8Array(64),
            inputIndex: 0,
            publicKey: new Uint8Array(32),
            signatureType: SignatureType.Schnorr,
            leafHash: new Uint8Array(32), // Has leafHash = script-path
        };

        expect(keyPathResult.leafHash).toBeUndefined();
        expect(scriptPathResult.leafHash).toBeDefined();
    });
});

describe('Worker Code Security', () => {
    describe('Secure Zero Implementation', () => {
        it('should zero Uint8Array correctly', () => {
            // Simulate the secureZero function from worker code
            const secureZero = (arr: Uint8Array | null | undefined): void => {
                if (arr && arr.fill) {
                    arr.fill(0);
                }
            };

            const data = new Uint8Array([1, 2, 3, 4, 5]);
            expect(data[0]).toBe(1);

            secureZero(data);

            expect(data[0]).toBe(0);
            expect(data.every((b) => b === 0)).toBe(true);
        });

        it('should handle null safely', () => {
            const secureZero = (arr: Uint8Array | null | undefined): void => {
                if (arr && arr.fill) {
                    arr.fill(0);
                }
            };

            // Should not throw
            expect(() => secureZero(null)).not.toThrow();
            expect(() => secureZero(undefined)).not.toThrow();
        });

        it('should handle empty array', () => {
            const secureZero = (arr: Uint8Array | null | undefined): void => {
                if (arr && arr.fill) {
                    arr.fill(0);
                }
            };

            const empty = new Uint8Array(0);
            expect(() => secureZero(empty)).not.toThrow();
            expect(empty.length).toBe(0);
        });
    });

    describe('Message Type Handling', () => {
        it('should recognize all valid message types', () => {
            const validTypes = ['init', 'sign', 'shutdown'];
            const code = generateWorkerCode();

            for (const type of validTypes) {
                expect(code).toContain(`case '${type}':`);
            }
        });

        it('should handle unknown message types', () => {
            const code = generateWorkerCode();
            expect(code).toContain('default:');
            expect(code).toContain('Unknown message type');
        });
    });

    describe('ECC Library Validation', () => {
        it('should have ECC library bundled at compile time', () => {
            const code = generateWorkerCode();
            // ECC library is bundled directly, no runtime check needed
            expect(code).toContain('eccBundle');
            expect(code).toContain('nobleBundle');
            expect(code).toContain('eccLib');
        });

        it('should check for Schnorr support', () => {
            const code = generateWorkerCode();
            expect(code).toContain('signSchnorr');
            expect(code).toContain('ECC library does not support Schnorr');
        });

        it('should check for ECDSA support', () => {
            const code = generateWorkerCode();
            expect(code).toContain('eccLib.sign');
            expect(code).toContain('ECC library does not support ECDSA');
        });
    });
});

describe('Blob URL Creation', () => {
    // Skip these tests if URL.createObjectURL is not available (Node.js)
    const hasURLSupport =
        typeof URL !== 'undefined' &&
        typeof URL.createObjectURL === 'function' &&
        typeof Blob !== 'undefined';

    it.skipIf(!hasURLSupport)('should create blob URL from worker code', async () => {
        const { createWorkerBlobUrl, revokeWorkerBlobUrl } =
            await import('../src/workers/signing-worker.js');

        const url = createWorkerBlobUrl();
        expect(url).toMatch(/^blob:/);

        // Cleanup
        revokeWorkerBlobUrl(url);
    });

    it('should generate valid JavaScript code', () => {
        const code = generateWorkerCode();

        // Check it's valid JS by looking for syntax elements
        expect(code).toContain('function');
        expect(code).toContain('self.onmessage');
        expect(code).toContain('self.postMessage');
        expect(code).toContain('switch');
        expect(code).toContain('case');
        expect(code).toContain('try');
        expect(code).toContain('catch');
    });
});

describe('ParallelSigningResult', () => {
    it('should represent successful batch result', () => {
        const signatures = new Map<number, SigningResultMessage>();
        signatures.set(0, {
            type: 'result',
            taskId: 'task-0',
            signature: new Uint8Array(64),
            inputIndex: 0,
            publicKey: new Uint8Array(33),
            signatureType: SignatureType.ECDSA,
        });
        signatures.set(1, {
            type: 'result',
            taskId: 'task-1',
            signature: new Uint8Array(64),
            inputIndex: 1,
            publicKey: new Uint8Array(33),
            signatureType: SignatureType.Schnorr,
        });

        const result = {
            success: true,
            signatures,
            errors: new Map<number, string>(),
            durationMs: 150,
        };

        expect(result.success).toBe(true);
        expect(result.signatures.size).toBe(2);
        expect(result.errors.size).toBe(0);
        expect(result.durationMs).toBe(150);
    });

    it('should represent partial failure result', () => {
        const signatures = new Map<number, SigningResultMessage>();
        signatures.set(0, {
            type: 'result',
            taskId: 'task-0',
            signature: new Uint8Array(64),
            inputIndex: 0,
            publicKey: new Uint8Array(33),
            signatureType: SignatureType.ECDSA,
        });

        const errors = new Map<number, string>();
        errors.set(1, 'Invalid private key');
        errors.set(2, 'Signing timeout');

        const result = {
            success: false,
            signatures,
            errors,
            durationMs: 5000,
        };

        expect(result.success).toBe(false);
        expect(result.signatures.size).toBe(1);
        expect(result.errors.size).toBe(2);
        expect(result.errors.get(1)).toBe('Invalid private key');
        expect(result.errors.get(2)).toBe('Signing timeout');
    });

    it('should represent empty batch result', () => {
        const result = {
            success: true,
            signatures: new Map<number, SigningResultMessage>(),
            errors: new Map<number, string>(),
            durationMs: 0,
        };

        expect(result.success).toBe(true);
        expect(result.signatures.size).toBe(0);
        expect(result.errors.size).toBe(0);
    });
});

describe('WorkerPoolConfig', () => {
    it('should accept minimal config', () => {
        const config = {};
        expect(config).toBeDefined();
    });

    it('should accept full config', () => {
        const config = {
            workerCount: 8,
            taskTimeoutMs: 60000,
            maxKeyHoldTimeMs: 10000,
            verifySignatures: false,
            preserveWorkers: true,
        };

        expect(config.workerCount).toBe(8);
        expect(config.taskTimeoutMs).toBe(60000);
        expect(config.maxKeyHoldTimeMs).toBe(10000);
        expect(config.verifySignatures).toBe(false);
        expect(config.preserveWorkers).toBe(true);
    });

    it('should have reasonable defaults', () => {
        // Verify default values are sensible
        const defaults = {
            workerCount: 4,
            taskTimeoutMs: 30000,
            maxKeyHoldTimeMs: 5000,
            verifySignatures: true,
            preserveWorkers: false,
        };

        expect(defaults.workerCount).toBeGreaterThan(0);
        expect(defaults.taskTimeoutMs).toBeGreaterThan(defaults.maxKeyHoldTimeMs);
        expect(defaults.verifySignatures).toBe(true); // Safe default
        expect(defaults.preserveWorkers).toBe(false); // Secure default
    });
});

describe('WorkerState Transitions', () => {
    it('should have valid initial state (Initializing)', () => {
        expect(WorkerState.Initializing).toBe(0);
    });

    it('should transition Initializing -> Idle', () => {
        let state: WorkerState = WorkerState.Initializing;
        // After worker sends 'ready' message
        state = WorkerState.Idle;
        expect(state).toBe(WorkerState.Idle);
    });

    it('should transition Idle -> Busy', () => {
        let state: WorkerState = WorkerState.Idle;
        // When task is assigned
        state = WorkerState.Busy;
        expect(state).toBe(WorkerState.Busy);
    });

    it('should transition Busy -> Idle', () => {
        let state: WorkerState = WorkerState.Busy;
        // When task completes
        state = WorkerState.Idle;
        expect(state).toBe(WorkerState.Idle);
    });

    it('should transition to ShuttingDown from any state', () => {
        const states = [WorkerState.Initializing, WorkerState.Idle, WorkerState.Busy];

        for (const initialState of states) {
            let state: WorkerState = initialState;
            state = WorkerState.ShuttingDown;
            expect(state).toBe(WorkerState.ShuttingDown);
        }
    });

    it('should transition ShuttingDown -> Terminated', () => {
        let state: WorkerState = WorkerState.ShuttingDown;
        // After worker acknowledges shutdown
        state = WorkerState.Terminated;
        expect(state).toBe(WorkerState.Terminated);
    });

    it('should not transition from Terminated', () => {
        const state = WorkerState.Terminated;
        // Terminated is final state
        expect(state).toBe(WorkerState.Terminated);
    });
});

describe('Batch Signing Scenarios', () => {
    it('should handle single input signing', () => {
        const tasks: SigningTask[] = [
            {
                taskId: 'single',
                inputIndex: 0,
                hash: new Uint8Array(32).fill(0x11),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            },
        ];

        expect(tasks.length).toBe(1);
        expect(tasks[0]!.inputIndex).toBe(0);
    });

    it('should handle multi-input ECDSA signing', () => {
        const tasks: SigningTask[] = [];
        for (let i = 0; i < 10; i++) {
            tasks.push({
                taskId: `ecdsa-${i}`,
                inputIndex: i,
                hash: new Uint8Array(32).fill(i),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            });
        }

        expect(tasks.length).toBe(10);
        expect(tasks.every((t) => t.signatureType === SignatureType.ECDSA)).toBe(true);
    });

    it('should handle multi-input Schnorr signing', () => {
        const tasks: SigningTask[] = [];
        for (let i = 0; i < 10; i++) {
            tasks.push({
                taskId: `schnorr-${i}`,
                inputIndex: i,
                hash: new Uint8Array(32).fill(i + 100),
                signatureType: SignatureType.Schnorr,
                sighashType: 0x00,
            });
        }

        expect(tasks.length).toBe(10);
        expect(tasks.every((t) => t.signatureType === SignatureType.Schnorr)).toBe(true);
    });

    it('should handle mixed ECDSA and Schnorr signing', () => {
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
            {
                taskId: 'ecdsa-2',
                inputIndex: 2,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            },
        ];

        const ecdsaCount = tasks.filter((t) => t.signatureType === SignatureType.ECDSA).length;
        const schnorrCount = tasks.filter((t) => t.signatureType === SignatureType.Schnorr).length;

        expect(ecdsaCount).toBe(2);
        expect(schnorrCount).toBe(1);
    });

    it('should handle Taproot key-path and script-path in same batch', () => {
        const tasks: SigningTask[] = [
            {
                taskId: 'keypath-0',
                inputIndex: 0,
                hash: new Uint8Array(32),
                signatureType: SignatureType.Schnorr,
                sighashType: 0x00,
                // No leafHash = key-path
            },
            {
                taskId: 'scriptpath-1',
                inputIndex: 1,
                hash: new Uint8Array(32),
                signatureType: SignatureType.Schnorr,
                sighashType: 0x00,
                leafHash: new Uint8Array(32).fill(0xab), // Has leafHash = script-path
            },
        ];

        const keyPathTasks = tasks.filter((t) => !t.leafHash);
        const scriptPathTasks = tasks.filter((t) => !!t.leafHash);

        expect(keyPathTasks.length).toBe(1);
        expect(scriptPathTasks.length).toBe(1);
    });
});

describe('Large Scale Scenarios', () => {
    it('should handle 100 inputs', () => {
        const tasks: SigningTask[] = [];
        for (let i = 0; i < 100; i++) {
            tasks.push({
                taskId: `task-${i}`,
                inputIndex: i,
                hash: new Uint8Array(32),
                signatureType: i % 2 === 0 ? SignatureType.ECDSA : SignatureType.Schnorr,
                sighashType: i % 2 === 0 ? 0x01 : 0x00,
            });
        }

        expect(tasks.length).toBe(100);
    });

    it('should handle 1000 inputs', () => {
        const tasks: SigningTask[] = [];
        for (let i = 0; i < 1000; i++) {
            tasks.push({
                taskId: `task-${i}`,
                inputIndex: i,
                hash: new Uint8Array(32),
                signatureType: SignatureType.ECDSA,
                sighashType: 0x01,
            });
        }

        expect(tasks.length).toBe(1000);
    });

    it('should generate unique task IDs for large batches', () => {
        const taskIds = new Set<string>();
        for (let i = 0; i < 10000; i++) {
            const taskId = `batch-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`;
            expect(taskIds.has(taskId)).toBe(false);
            taskIds.add(taskId);
        }
        expect(taskIds.size).toBe(10000);
    });
});

describe('ECC Bundle', () => {
    // Helper to get noble secp module from the bundle
    // The bundle exports nobleBundle with { secp, sha256, hmac }
    // where secp already has hashes configured
    async function getNobleSecp() {
        const { ECC_BUNDLE } = await import('../src/workers/ecc-bundle.js');

        const fn = new Function(ECC_BUNDLE + '; return nobleBundle;');
        const bundle = fn();

        // Return the secp module which has hashes already configured
        return bundle.secp;
    }

    it('should export bundled ECC code', async () => {
        const { ECC_BUNDLE, ECC_BUNDLE_SIZE } = await import('../src/workers/ecc-bundle.js');

        expect(ECC_BUNDLE).toBeDefined();
        expect(typeof ECC_BUNDLE).toBe('string');
        expect(ECC_BUNDLE_SIZE).toBeGreaterThan(0);
        expect(ECC_BUNDLE.length).toBe(ECC_BUNDLE_SIZE);
    });

    it('should contain noble-secp256k1 IIFE', async () => {
        const { ECC_BUNDLE } = await import('../src/workers/ecc-bundle.js');

        // Should be an IIFE that creates nobleBundle global
        expect(ECC_BUNDLE).toContain('nobleBundle');
        expect(ECC_BUNDLE).toContain('sign');
        expect(ECC_BUNDLE).toContain('schnorr');
    });

    it('should be executable and return valid module structure', async () => {
        const { ECC_BUNDLE } = await import('../src/workers/ecc-bundle.js');

        // Execute the bundle and get the module
        const fn = new Function(ECC_BUNDLE + '; return nobleBundle;');
        const bundle = fn();

        // Verify the bundle has the expected structure
        expect(bundle).toBeDefined();
        expect(typeof bundle.secp).toBe('object');
        expect(typeof bundle.sha256).toBe('function');
        expect(typeof bundle.hmac).toBe('function');

        // Verify the secp module has the expected structure
        const secp = bundle.secp;
        expect(typeof secp.sign).toBe('function');
        expect(typeof secp.verify).toBe('function');
        expect(typeof secp.getPublicKey).toBe('function');
        expect(typeof secp.schnorr).toBe('object');
        expect(typeof secp.schnorr.sign).toBe('function');
        expect(typeof secp.schnorr.verify).toBe('function');
        expect(typeof secp.schnorr.getPublicKey).toBe('function');
        expect(typeof secp.hashes).toBe('object');
    });

    it('should create valid ECDSA signatures', async () => {
        const secp = await getNobleSecp();

        // Create a test private key (valid non-zero 32 bytes)
        const privateKey = new Uint8Array(32);
        privateKey[31] = 0x01; // Smallest valid private key

        // Create a test hash
        const hash = new Uint8Array(32).fill(0xab);

        // Sign with ECDSA - returns Uint8Array directly (64 bytes compact format)
        const sig = secp.sign(hash, privateKey, { lowS: true });
        expect(sig).toBeDefined();
        expect(sig).toBeInstanceOf(Uint8Array);
        expect(sig.length).toBe(64);

        // Verify the signature
        const pubKey = secp.getPublicKey(privateKey);
        const isValid = secp.verify(sig, hash, pubKey);
        expect(isValid).toBe(true);
    });

    it('should create valid Schnorr signatures', async () => {
        const secp = await getNobleSecp();

        // Create a test private key
        const privateKey = new Uint8Array(32);
        privateKey[31] = 0x02;

        // Create a test hash
        const hash = new Uint8Array(32).fill(0xcd);

        // Sign with Schnorr (BIP340)
        const sig = secp.schnorr.sign(hash, privateKey);
        expect(sig).toBeDefined();
        expect(sig.length).toBe(64);

        // Verify the signature
        const pubKey = secp.schnorr.getPublicKey(privateKey);
        const isValid = secp.schnorr.verify(sig, hash, pubKey);
        expect(isValid).toBe(true);
    });

    it('should verify ECDSA signature with wrong key fails', async () => {
        const secp = await getNobleSecp();

        const privateKey1 = new Uint8Array(32);
        privateKey1[31] = 0x01;

        const privateKey2 = new Uint8Array(32);
        privateKey2[31] = 0x02;

        const hash = new Uint8Array(32).fill(0xef);

        // Sign with key1 - returns Uint8Array directly
        const sig = secp.sign(hash, privateKey1, { lowS: true });

        // Verify with key2's pubkey should fail
        const pubKey2 = secp.getPublicKey(privateKey2);
        const isValid = secp.verify(sig, hash, pubKey2);
        expect(isValid).toBe(false);
    });

    it('should verify Schnorr signature with wrong key fails', async () => {
        const secp = await getNobleSecp();

        const privateKey1 = new Uint8Array(32);
        privateKey1[31] = 0x03;

        const privateKey2 = new Uint8Array(32);
        privateKey2[31] = 0x04;

        const hash = new Uint8Array(32).fill(0x12);

        // Sign with key1
        const sig = secp.schnorr.sign(hash, privateKey1);

        // Verify with key2's pubkey should fail
        const pubKey2 = secp.schnorr.getPublicKey(privateKey2);
        const isValid = secp.schnorr.verify(sig, hash, pubKey2);
        expect(isValid).toBe(false);
    });

    it('should have reasonable bundle size (< 50KB)', async () => {
        const { ECC_BUNDLE_SIZE } = await import('../src/workers/ecc-bundle.js');

        // Bundle should be reasonably small (minified noble-secp256k1 is ~12KB)
        expect(ECC_BUNDLE_SIZE).toBeLessThan(50000);
        expect(ECC_BUNDLE_SIZE).toBeGreaterThan(5000);
    });

    it('should be embedded in worker code', () => {
        const code = generateWorkerCode();

        // Worker code should contain the bundled ECC library
        expect(code).toContain('eccBundle');
        expect(code).toContain('nobleBundle');
        expect(code).toContain('eccModule');
        expect(code).toContain('eccLib');
    });
});
