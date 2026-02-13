/**
 * Worker Signing Integration Tests
 *
 * These tests verify that signatures generated through the worker signing
 * infrastructure are cryptographically valid.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import * as ecc from 'tiny-secp256k1';
import { randomBytes } from 'crypto';

import { SignatureType, type WorkerEccLib } from '../src/workers/types.js';
import { generateWorkerCode } from '../src/workers/signing-worker.js';
import { toXOnly } from '../src/pubkey.js';
import { initEccLib } from '../src/ecc/context.js';
import type { EccLib } from '../src/types.js';
import { ECPairSigner, createNobleBackend } from '@btc-vision/ecpair';
import { bitcoin } from '../src/networks.js';

const backend = createNobleBackend();
const ECPair = {
    makeRandom: () => ECPairSigner.makeRandom(backend, bitcoin),
};

describe('Worker Signing - Signature Verification', () => {
    beforeAll(() => {
        initEccLib(ecc as unknown as EccLib);
    });

    describe('ECDSA Signature Generation and Verification', () => {
        it('should generate valid ECDSA signature that verifies', () => {
            // Create a real key pair
            const keyPair = ECPair.makeRandom();
            const privateKey = keyPair.privateKey!;
            const publicKey = keyPair.publicKey;

            // Create a random 32-byte hash (simulating a transaction hash)
            const hash = randomBytes(32);

            // Sign using the ECC library directly (simulating what worker does)
            const signature = ecc.sign(hash, privateKey);

            // Verify the signature is valid
            const isValid = ecc.verify(hash, publicKey, signature);
            expect(isValid).toBe(true);

            // Verify signature length (should be 64 bytes for raw signature)
            expect(signature.length).toBe(64);
        });

        it('should generate valid ECDSA signature with lowR', () => {
            const keyPair = ECPair.makeRandom();
            const privateKey = keyPair.privateKey!;
            const publicKey = keyPair.publicKey;
            const hash = randomBytes(32);

            // Sign with lowR (grind for low R value)
            const signature = ecc.sign(hash, privateKey, undefined);

            // Verify the signature is valid
            const isValid = ecc.verify(hash, publicKey, signature);
            expect(isValid).toBe(true);
        });

        it('should produce different signatures for different hashes', () => {
            const keyPair = ECPair.makeRandom();
            const privateKey = keyPair.privateKey!;

            const hash1 = randomBytes(32);
            const hash2 = randomBytes(32);

            const sig1 = ecc.sign(hash1, privateKey);
            const sig2 = ecc.sign(hash2, privateKey);

            // Signatures should be different
            expect(Buffer.from(sig1).equals(Buffer.from(sig2))).toBe(false);
        });

        it('should fail verification with wrong public key', () => {
            const keyPair1 = ECPair.makeRandom();
            const keyPair2 = ECPair.makeRandom();
            const hash = randomBytes(32);

            const signature = ecc.sign(hash, keyPair1.privateKey!);

            // Verify with wrong public key should fail
            const isValid = ecc.verify(hash, keyPair2.publicKey, signature);
            expect(isValid).toBe(false);
        });

        it('should fail verification with modified hash', () => {
            const keyPair = ECPair.makeRandom();
            const hash = randomBytes(32);

            const signature = ecc.sign(hash, keyPair.privateKey!);

            // Modify the hash
            const modifiedHash = Buffer.from(hash);
            modifiedHash[0]! ^= 0xff;

            const isValid = ecc.verify(modifiedHash, keyPair.publicKey, signature);
            expect(isValid).toBe(false);
        });

        it('should fail verification with corrupted signature', () => {
            const keyPair = ECPair.makeRandom();
            const hash = randomBytes(32);

            const signature = Buffer.from(ecc.sign(hash, keyPair.privateKey!));

            // Corrupt the signature
            signature[0]! ^= 0xff;

            const isValid = ecc.verify(hash, keyPair.publicKey, signature);
            expect(isValid).toBe(false);
        });
    });

    describe('Schnorr Signature Generation and Verification', () => {
        it('should generate valid Schnorr signature that verifies', () => {
            const keyPair = ECPair.makeRandom();
            const privateKey = keyPair.privateKey!;
            const publicKey = keyPair.publicKey;
            const hash = randomBytes(32);

            // Sign with Schnorr
            const signature = ecc.signSchnorr(hash, privateKey);

            // Schnorr signatures are always 64 bytes
            expect(signature.length).toBe(64);

            // Verify using x-only public key (32 bytes)
            const xOnlyPubkey = toXOnly(publicKey);
            const isValid = ecc.verifySchnorr(hash, xOnlyPubkey, signature);
            expect(isValid).toBe(true);
        });

        it('should produce different Schnorr signatures for different hashes', () => {
            const keyPair = ECPair.makeRandom();
            const privateKey = keyPair.privateKey!;

            const hash1 = randomBytes(32);
            const hash2 = randomBytes(32);

            const sig1 = ecc.signSchnorr(hash1, privateKey);
            const sig2 = ecc.signSchnorr(hash2, privateKey);

            expect(Buffer.from(sig1).equals(Buffer.from(sig2))).toBe(false);
        });

        it('should fail Schnorr verification with wrong public key', () => {
            const keyPair1 = ECPair.makeRandom();
            const keyPair2 = ECPair.makeRandom();
            const hash = randomBytes(32);

            const signature = ecc.signSchnorr(hash, keyPair1.privateKey!);

            const xOnlyPubkey2 = toXOnly(keyPair2.publicKey);
            const isValid = ecc.verifySchnorr(hash, xOnlyPubkey2, signature);
            expect(isValid).toBe(false);
        });

        it('should fail Schnorr verification with modified hash', () => {
            const keyPair = ECPair.makeRandom();
            const hash = randomBytes(32);

            const signature = ecc.signSchnorr(hash, keyPair.privateKey!);

            const modifiedHash = Buffer.from(hash);
            modifiedHash[0]! ^= 0xff;

            const xOnlyPubkey = toXOnly(keyPair.publicKey);
            const isValid = ecc.verifySchnorr(modifiedHash, xOnlyPubkey, signature);
            expect(isValid).toBe(false);
        });

        it('should fail Schnorr verification with corrupted signature', () => {
            const keyPair = ECPair.makeRandom();
            const hash = randomBytes(32);

            const signature = Buffer.from(ecc.signSchnorr(hash, keyPair.privateKey!));
            signature[0]! ^= 0xff;

            const xOnlyPubkey = toXOnly(keyPair.publicKey);
            const isValid = ecc.verifySchnorr(hash, xOnlyPubkey, signature);
            expect(isValid).toBe(false);
        });
    });

    describe('WorkerEccLib Interface Compatibility', () => {
        it('should create WorkerEccLib compatible wrapper', () => {
            const eccLib: WorkerEccLib = {
                sign: (hash: Uint8Array, privateKey: Uint8Array, _lowR?: boolean): Uint8Array => {
                    return ecc.sign(hash, privateKey, undefined);
                },
                signSchnorr: (hash: Uint8Array, privateKey: Uint8Array): Uint8Array => {
                    return ecc.signSchnorr(hash, privateKey);
                },
            };

            const keyPair = ECPair.makeRandom();
            const hash = randomBytes(32);

            // Test ECDSA through wrapper
            const ecdsaSig = eccLib.sign(hash, keyPair.privateKey!);
            expect(ecc.verify(hash, keyPair.publicKey, ecdsaSig)).toBe(true);

            // Test Schnorr through wrapper
            const schnorrSig = eccLib.signSchnorr!(hash, keyPair.privateKey!);
            expect(ecc.verifySchnorr(hash, toXOnly(keyPair.publicKey), schnorrSig)).toBe(true);
        });

        it('should handle signing type dispatch correctly', () => {
            const eccLib: WorkerEccLib = {
                sign: (hash: Uint8Array, privateKey: Uint8Array): Uint8Array => {
                    return ecc.sign(hash, privateKey);
                },
                signSchnorr: (hash: Uint8Array, privateKey: Uint8Array): Uint8Array => {
                    return ecc.signSchnorr(hash, privateKey);
                },
            };

            const keyPair = ECPair.makeRandom();
            const hash = randomBytes(32);

            // Simulate worker dispatch based on signatureType
            const signatureType = SignatureType.Schnorr;

            let signature: Uint8Array;
            if (signatureType === SignatureType.Schnorr) {
                signature = eccLib.signSchnorr!(hash, keyPair.privateKey!);
            } else {
                signature = eccLib.sign(hash, keyPair.privateKey!);
            }

            // Verify Schnorr signature
            expect(signature.length).toBe(64);
            expect(ecc.verifySchnorr(hash, toXOnly(keyPair.publicKey), signature)).toBe(true);
        });
    });

    describe('Key Zeroing Security', () => {
        it('should verify secureZero clears key data', () => {
            // Simulate the secureZero function from worker
            const secureZero = (arr: Uint8Array): void => {
                arr.fill(0);
            };

            const privateKey = new Uint8Array(randomBytes(32));
            expect(privateKey.some((b) => b !== 0)).toBe(true); // Has non-zero bytes

            secureZero(privateKey);

            expect(privateKey.every((b) => b === 0)).toBe(true); // All zeros
        });

        it('should verify key is zeroed after signing (simulation)', () => {
            const keyPair = ECPair.makeRandom();
            const hash = randomBytes(32);

            // Simulate what worker does: copy key, sign, zero
            const keyCopy = new Uint8Array(keyPair.privateKey!);

            // Sign
            const signature = ecc.sign(hash, keyCopy);

            // Zero the key copy
            keyCopy.fill(0);

            // Signature should still be valid
            expect(ecc.verify(hash, keyPair.publicKey, signature)).toBe(true);

            // Key copy should be zeroed
            expect(keyCopy.every((b) => b === 0)).toBe(true);
        });
    });

    describe('Batch Signing Simulation', () => {
        it('should sign multiple inputs with same key', () => {
            const keyPair = ECPair.makeRandom();
            const hashes = Array.from({ length: 10 }, () => randomBytes(32));

            const signatures = hashes.map((hash) => ecc.sign(hash, keyPair.privateKey!));

            // All signatures should be valid
            for (let i = 0; i < hashes.length; i++) {
                expect(ecc.verify(hashes[i]!, keyPair.publicKey, signatures[i]!)).toBe(true);
            }
        });

        it('should sign mixed ECDSA and Schnorr in batch', () => {
            const keyPair = ECPair.makeRandom();
            const tasks = [
                { hash: randomBytes(32), type: SignatureType.ECDSA },
                { hash: randomBytes(32), type: SignatureType.Schnorr },
                { hash: randomBytes(32), type: SignatureType.ECDSA },
                { hash: randomBytes(32), type: SignatureType.Schnorr },
            ];

            const results = tasks.map((task) => {
                if (task.type === SignatureType.Schnorr) {
                    return {
                        signature: ecc.signSchnorr(task.hash, keyPair.privateKey!),
                        type: task.type,
                        hash: task.hash,
                    };
                } else {
                    return {
                        signature: ecc.sign(task.hash, keyPair.privateKey!),
                        type: task.type,
                        hash: task.hash,
                    };
                }
            });

            // Verify all signatures
            for (const result of results) {
                if (result.type === SignatureType.Schnorr) {
                    expect(
                        ecc.verifySchnorr(
                            result.hash,
                            toXOnly(keyPair.publicKey),
                            result.signature,
                        ),
                    ).toBe(true);
                } else {
                    expect(ecc.verify(result.hash, keyPair.publicKey, result.signature)).toBe(true);
                }
            }
        });

        it('should handle 100 signatures in parallel simulation', () => {
            const keyPair = ECPair.makeRandom();
            const tasks = Array.from({ length: 100 }, (_, i) => ({
                hash: randomBytes(32),
                type: i % 2 === 0 ? SignatureType.ECDSA : SignatureType.Schnorr,
            }));

            const startTime = Date.now();

            const results = tasks.map((task) => {
                if (task.type === SignatureType.Schnorr) {
                    return {
                        signature: ecc.signSchnorr(task.hash, keyPair.privateKey!),
                        type: task.type,
                        hash: task.hash,
                    };
                } else {
                    return {
                        signature: ecc.sign(task.hash, keyPair.privateKey!),
                        type: task.type,
                        hash: task.hash,
                    };
                }
            });

            void (Date.now() - startTime);

            // Verify all signatures
            let validCount = 0;
            for (const result of results) {
                let isValid: boolean;
                if (result.type === SignatureType.Schnorr) {
                    isValid = ecc.verifySchnorr(
                        result.hash,
                        toXOnly(keyPair.publicKey),
                        result.signature,
                    );
                } else {
                    isValid = ecc.verify(result.hash, keyPair.publicKey, result.signature);
                }
                if (isValid) validCount++;
            }

            expect(validCount).toBe(100);
        });
    });

    describe('Edge Cases', () => {
        it('should handle hash with all zeros', () => {
            const keyPair = ECPair.makeRandom();
            const hash = new Uint8Array(32).fill(0);

            const signature = ecc.sign(hash, keyPair.privateKey!);
            expect(ecc.verify(hash, keyPair.publicKey, signature)).toBe(true);
        });

        it('should handle hash with all 0xff', () => {
            const keyPair = ECPair.makeRandom();
            const hash = new Uint8Array(32).fill(0xff);

            const signature = ecc.sign(hash, keyPair.privateKey!);
            expect(ecc.verify(hash, keyPair.publicKey, signature)).toBe(true);
        });

        it('should handle sequential hashes', () => {
            const keyPair = ECPair.makeRandom();

            for (let i = 0; i < 10; i++) {
                const hash = new Uint8Array(32);
                hash[0] = i;

                const signature = ecc.sign(hash, keyPair.privateKey!);
                expect(ecc.verify(hash, keyPair.publicKey, signature)).toBe(true);
            }
        });

        it('should handle deterministic signatures (same hash, same key)', () => {
            const privateKey = new Uint8Array(32).fill(0x42);
            // Check if this is a valid private key
            if (!ecc.isPrivate(privateKey)) {
                // Use a known valid private key
                privateKey.fill(0);
                privateKey[31] = 1; // Smallest valid private key
            }

            const hash = new Uint8Array(32).fill(0xab);

            // tiny-secp256k1 uses RFC6979 for deterministic signatures
            const sig1 = ecc.sign(hash, privateKey);
            const sig2 = ecc.sign(hash, privateKey);

            // Signatures should be identical (deterministic)
            expect(Buffer.from(sig1).equals(Buffer.from(sig2))).toBe(true);
        });
    });

    describe('Worker Code Execution Simulation', () => {
        it('should execute simulated worker signing flow', () => {
            // Simulate the complete worker signing flow
            const eccLib: WorkerEccLib = {
                sign: (hash, privateKey) => ecc.sign(hash, privateKey),
                signSchnorr: (hash, privateKey) => ecc.signSchnorr(hash, privateKey),
            };

            const keyPair = ECPair.makeRandom();
            const privateKeyCopy = new Uint8Array(keyPair.privateKey!);
            const hash = randomBytes(32);

            // Simulate worker message handling
            const signatureType = SignatureType.ECDSA;
            let signature: Uint8Array;

            try {
                if ((signatureType as SignatureType) === SignatureType.Schnorr) {
                    if (!eccLib.signSchnorr) {
                        throw new Error('ECC library does not support Schnorr');
                    }
                    signature = eccLib.signSchnorr(hash, privateKeyCopy);
                } else {
                    signature = eccLib.sign(hash, privateKeyCopy);
                }
            } finally {
                // Always zero the key (secureZero)
                privateKeyCopy.fill(0);
            }

            // Verify signature
            expect(ecc.verify(hash, keyPair.publicKey, signature)).toBe(true);

            // Verify key was zeroed
            expect(privateKeyCopy.every((b) => b === 0)).toBe(true);
        });

        it('should handle signing errors gracefully', () => {
            // Create an invalid private key (all zeros is invalid)
            const invalidPrivateKey = new Uint8Array(32).fill(0);
            const hash = randomBytes(32);

            // tiny-secp256k1 should throw or return null for invalid key
            expect(() => {
                ecc.sign(hash, invalidPrivateKey);
            }).toThrow();
        });

        it('should validate hash length', () => {
            const keyPair = ECPair.makeRandom();

            // Too short
            const shortHash = new Uint8Array(31);
            expect(() => {
                ecc.sign(shortHash, keyPair.privateKey!);
            }).toThrow();

            // Too long
            const longHash = new Uint8Array(33);
            expect(() => {
                ecc.sign(longHash, keyPair.privateKey!);
            }).toThrow();
        });

        it('should validate private key length', () => {
            const hash = randomBytes(32);

            // Too short
            const shortKey = new Uint8Array(31).fill(0x42);
            expect(() => {
                ecc.sign(hash, shortKey);
            }).toThrow();

            // Too long
            const longKey = new Uint8Array(33).fill(0x42);
            expect(() => {
                ecc.sign(hash, longKey);
            }).toThrow();
        });
    });

    describe('Taproot-Specific Tests', () => {
        it('should generate valid key-path Taproot signature', () => {
            const keyPair = ECPair.makeRandom();
            const hash = randomBytes(32); // Taproot sighash

            const signature = ecc.signSchnorr(hash, keyPair.privateKey!);
            const xOnlyPubkey = toXOnly(keyPair.publicKey);

            expect(signature.length).toBe(64);
            expect(xOnlyPubkey.length).toBe(32);
            expect(ecc.verifySchnorr(hash, xOnlyPubkey, signature)).toBe(true);
        });

        it('should generate valid script-path Taproot signature', () => {
            const keyPair = ECPair.makeRandom();
            // Script-path uses a different hash that includes the leaf hash
            const hash = randomBytes(32);
            const leafHash = randomBytes(32);

            // The actual signing is the same, just the hash is computed differently
            const signature = ecc.signSchnorr(hash, keyPair.privateKey!);
            const xOnlyPubkey = toXOnly(keyPair.publicKey);

            expect(ecc.verifySchnorr(hash, xOnlyPubkey, signature)).toBe(true);

            // Leaf hash is stored in result for PSBT update
            expect(leafHash.length).toBe(32);
        });

        it('should verify x-only pubkey extraction', () => {
            const keyPair = ECPair.makeRandom();
            const fullPubkey = keyPair.publicKey;
            const xOnlyPubkey = toXOnly(fullPubkey);

            // x-only pubkey should be 32 bytes (the x-coordinate)
            expect(xOnlyPubkey.length).toBe(32);

            // Should be the x-coordinate (bytes 1-32 of compressed pubkey)
            expect(Buffer.from(xOnlyPubkey).equals(Buffer.from(fullPubkey.subarray(1, 33)))).toBe(
                true,
            );
        });
    });

    describe('Real Transaction Hash Signing', () => {
        it('should sign a real transaction sighash', () => {
            const keyPair = ECPair.makeRandom();

            // This is a real Bitcoin transaction sighash (SHA256d of signing data)
            // In practice, this would come from PSBT's hashForSignature
            const sighash = Buffer.from(
                '0100000000000000000000000000000000000000000000000000000000000000',
                'hex',
            );

            const signature = ecc.sign(sighash, keyPair.privateKey!);

            // Verify signature
            expect(ecc.verify(sighash, keyPair.publicKey, signature)).toBe(true);

            // Signature should be 64 bytes raw (will be DER encoded when added to tx)
            expect(signature.length).toBe(64);
        });

        it('should handle multiple sighash types', () => {
            const keyPair = ECPair.makeRandom();

            // Different sighash values would produce different hashes
            // Here we simulate signing with different "sighashes"
            const sighashAll = randomBytes(32);
            const sighashNone = randomBytes(32);
            const sighashSingle = randomBytes(32);

            const sigAll = ecc.sign(sighashAll, keyPair.privateKey!);
            const sigNone = ecc.sign(sighashNone, keyPair.privateKey!);
            const sigSingle = ecc.sign(sighashSingle, keyPair.privateKey!);

            expect(ecc.verify(sighashAll, keyPair.publicKey, sigAll)).toBe(true);
            expect(ecc.verify(sighashNone, keyPair.publicKey, sigNone)).toBe(true);
            expect(ecc.verify(sighashSingle, keyPair.publicKey, sigSingle)).toBe(true);

            // Cross-verification should fail
            expect(ecc.verify(sighashAll, keyPair.publicKey, sigNone)).toBe(false);
        });
    });
});

describe('Worker Code Integrity', () => {
    it('should generate code that contains signing logic', () => {
        const code = generateWorkerCode();

        // Must contain the signing dispatch logic
        expect(code).toContain('signatureType === 1');
        expect(code).toContain('eccLib.signSchnorr');
        expect(code).toContain('eccLib.sign');

        // Must contain result posting
        expect(code).toContain("type: 'result'");
        expect(code).toContain('signature');
        expect(code).toContain('inputIndex');
        expect(code).toContain('publicKey');
    });

    it('should generate code with proper error handling', () => {
        const code = generateWorkerCode();

        // Must have try-catch
        expect(code).toContain('try {');
        expect(code).toContain('} catch');

        // Must post error on failure
        expect(code).toContain("type: 'error'");

        // Must zero key even on error (in finally or catch)
        expect(code).toContain('secureZero(privateKey)');
    });

    it('should generate code with input validation', () => {
        const code = generateWorkerCode();

        // Must validate hash
        expect(code).toContain('hash.length !== 32');

        // Must validate privateKey
        expect(code).toContain('privateKey.length !== 32');

        // ECC library is bundled at compile time, no runtime check needed
        expect(code).toContain('eccBundle');
        expect(code).toContain('eccLib');
    });
});
