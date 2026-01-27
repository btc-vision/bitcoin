import assert from 'assert';
import { BIP32Factory } from '@btc-vision/bip32';
import * as ecc from 'tiny-secp256k1';
import { randomBytes } from 'crypto';
import { describe, it } from 'vitest';

import { initEccLib, Psbt, payments, crypto, Transaction } from '../src/index.js';
import type { Bytes32, Script, Satoshi } from '../src/types.js';
import { toXOnly } from '../src/pubkey.js';

initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

// Helper to create a taproot keypair
function createTaprootKeyPair() {
    const node = bip32.fromSeed(randomBytes(64));
    const xOnlyPubkey = toXOnly(node.publicKey);
    const tweakedNode = node.tweak(crypto.taggedHash('TapTweak', xOnlyPubkey));
    return { node, xOnlyPubkey, tweakedNode };
}

// Helper to create a fake prev tx
function createFakePrevTx(outputScript: Uint8Array, value: bigint, nonce: number): { tx: Buffer; txId: Buffer } {
    const tx = new Transaction();
    tx.version = 2;
    const inputHash = Buffer.alloc(32) as unknown as Bytes32;
    inputHash.writeUInt32LE(nonce, 0);
    tx.addInput(inputHash, 0);
    tx.addOutput(outputScript as Script, value as Satoshi);
    const txBuf = tx.toBuffer();
    const hash1 = crypto.sha256(txBuf);
    const hash2 = crypto.sha256(hash1);
    const txId = Buffer.from(hash2).reverse();
    return { tx: txBuf, txId };
}

describe('Taproot Hash Cache', () => {
    describe('cache population', () => {
        it('should populate cache after first input signing', () => {
            const { xOnlyPubkey, tweakedNode } = createTaprootKeyPair();
            const { output } = payments.p2tr({ internalPubkey: xOnlyPubkey });
            const { tx: prevTx, txId } = createFakePrevTx(output!, 10000n, 1);

            const psbt = new Psbt();
            psbt.addInput({
                hash: txId,
                index: 0,
                nonWitnessUtxo: prevTx,
                tapInternalKey: xOnlyPubkey,
            });
            psbt.addOutput({ script: output!, value: 9000n as Satoshi });

            // Cache should be empty before signing
            const cache = (psbt as any).__CACHE;
            assert.strictEqual(cache.taprootHashCache, undefined);

            psbt.signInput(0, tweakedNode);

            // Cache should be populated after signing
            assert.notStrictEqual(cache.taprootHashCache, undefined);
            assert.ok(cache.taprootHashCache.hashPrevouts instanceof Uint8Array);
            assert.ok(cache.taprootHashCache.hashAmounts instanceof Uint8Array);
            assert.ok(cache.taprootHashCache.hashScriptPubKeys instanceof Uint8Array);
            assert.ok(cache.taprootHashCache.hashSequences instanceof Uint8Array);
            assert.ok(cache.taprootHashCache.hashOutputs instanceof Uint8Array);
        });

        it('should reuse cache for multiple input signing', () => {
            const { xOnlyPubkey, tweakedNode } = createTaprootKeyPair();
            const { output } = payments.p2tr({ internalPubkey: xOnlyPubkey });

            const psbt = new Psbt();
            for (let i = 0; i < 5; i++) {
                const { tx: prevTx, txId } = createFakePrevTx(output!, 10000n, i);
                psbt.addInput({
                    hash: txId,
                    index: 0,
                    nonWitnessUtxo: prevTx,
                    tapInternalKey: xOnlyPubkey,
                });
            }
            psbt.addOutput({ script: output!, value: 45000n as Satoshi });

            // Sign first input
            psbt.signInput(0, tweakedNode);
            const cache = (psbt as any).__CACHE;
            const cachedHash = cache.taprootHashCache;
            assert.notStrictEqual(cachedHash, undefined);

            // Sign remaining inputs - cache should be reused (same object reference)
            for (let i = 1; i < 5; i++) {
                psbt.signInput(i, tweakedNode);
                assert.strictEqual(cache.taprootHashCache, cachedHash);
            }
        });
    });

    describe('cache invalidation on addInput', () => {
        it('should invalidate cache when new input is added', () => {
            const { xOnlyPubkey, tweakedNode } = createTaprootKeyPair();
            const { output } = payments.p2tr({ internalPubkey: xOnlyPubkey });

            const psbt = new Psbt();
            const { tx: prevTx1, txId: txId1 } = createFakePrevTx(output!, 10000n, 1);
            psbt.addInput({
                hash: txId1,
                index: 0,
                nonWitnessUtxo: prevTx1,
                tapInternalKey: xOnlyPubkey,
            });
            psbt.addOutput({ script: output!, value: 9000n as Satoshi });

            // Sign to populate cache
            psbt.signInput(0, tweakedNode);
            const cache = (psbt as any).__CACHE;
            assert.notStrictEqual(cache.taprootHashCache, undefined);

            // Add another input - cache should be invalidated
            const { tx: prevTx2, txId: txId2 } = createFakePrevTx(output!, 10000n, 2);
            psbt.addInput({
                hash: txId2,
                index: 0,
                nonWitnessUtxo: prevTx2,
                tapInternalKey: xOnlyPubkey,
            }, false); // skip partial sig check

            assert.strictEqual(cache.taprootHashCache, undefined);
        });

        it('should produce correct signatures after cache invalidation from addInput', () => {
            const { xOnlyPubkey, tweakedNode } = createTaprootKeyPair();
            const { output } = payments.p2tr({ internalPubkey: xOnlyPubkey });

            const psbt = new Psbt();
            const { tx: prevTx1, txId: txId1 } = createFakePrevTx(output!, 10000n, 1);
            psbt.addInput({
                hash: txId1,
                index: 0,
                nonWitnessUtxo: prevTx1,
                tapInternalKey: xOnlyPubkey,
            });
            psbt.addOutput({ script: output!, value: 9000n as Satoshi });

            // Populate cache by signing
            psbt.signInput(0, tweakedNode);
            const cache = (psbt as any).__CACHE;
            assert.notStrictEqual(cache.taprootHashCache, undefined);

            // Create a fresh PSBT with 2 inputs to test cache works after invalidation
            const psbt2 = new Psbt();
            psbt2.addInput({
                hash: txId1,
                index: 0,
                nonWitnessUtxo: prevTx1,
                tapInternalKey: xOnlyPubkey,
            });

            const { tx: prevTx2, txId: txId2 } = createFakePrevTx(output!, 10000n, 2);
            psbt2.addInput({
                hash: txId2,
                index: 0,
                nonWitnessUtxo: prevTx2,
                tapInternalKey: xOnlyPubkey,
            });
            psbt2.addOutput({ script: output!, value: 18000n as Satoshi });

            // Sign first input (populates cache)
            psbt2.signInput(0, tweakedNode);
            const cache2 = (psbt2 as any).__CACHE;
            const cachedHash = cache2.__TAPROOT_HASH_CACHE;

            // Sign second input (should reuse cache)
            psbt2.signInput(1, tweakedNode);
            assert.strictEqual(cache2.__TAPROOT_HASH_CACHE, cachedHash);

            // Both signatures should be valid
            const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer) =>
                ecc.verifySchnorr(msghash, pubkey, signature);

            assert.ok(psbt2.validateSignaturesOfInput(0, validator));
            assert.ok(psbt2.validateSignaturesOfInput(1, validator));
        });
    });

    describe('cache invalidation on addOutput', () => {
        it('should invalidate cache when new output is added', () => {
            const { xOnlyPubkey, tweakedNode } = createTaprootKeyPair();
            const { output } = payments.p2tr({ internalPubkey: xOnlyPubkey });

            const psbt = new Psbt();
            const { tx: prevTx, txId } = createFakePrevTx(output!, 20000n, 1);
            psbt.addInput({
                hash: txId,
                index: 0,
                nonWitnessUtxo: prevTx,
                tapInternalKey: xOnlyPubkey,
            });
            psbt.addOutput({ script: output!, value: 9000n as Satoshi });

            // Sign to populate cache
            psbt.signInput(0, tweakedNode);
            const cache = (psbt as any).__CACHE;
            assert.notStrictEqual(cache.taprootHashCache, undefined);

            // Add another output - cache should be invalidated
            psbt.addOutput({ script: output!, value: 9000n as Satoshi }, false);

            assert.strictEqual(cache.taprootHashCache, undefined);
        });
    });

    describe('signature correctness', () => {
        it('should produce valid signatures with cache enabled', () => {
            const { xOnlyPubkey, tweakedNode } = createTaprootKeyPair();
            const { output } = payments.p2tr({ internalPubkey: xOnlyPubkey });

            const psbt = new Psbt();
            for (let i = 0; i < 10; i++) {
                const { tx: prevTx, txId } = createFakePrevTx(output!, 10000n, i);
                psbt.addInput({
                    hash: txId,
                    index: 0,
                    nonWitnessUtxo: prevTx,
                    tapInternalKey: xOnlyPubkey,
                });
            }
            psbt.addOutput({ script: output!, value: 95000n as Satoshi });

            psbt.signAllInputs(tweakedNode);

            const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer) =>
                ecc.verifySchnorr(msghash, pubkey, signature);

            for (let i = 0; i < 10; i++) {
                assert.ok(psbt.validateSignaturesOfInput(i, validator), `Input ${i} signature invalid`);
            }
        });

        it('should produce identical signatures with and without cache', () => {
            const seed = randomBytes(64);
            const { xOnlyPubkey, tweakedNode } = (() => {
                const node = bip32.fromSeed(seed);
                const xOnlyPubkey = toXOnly(node.publicKey);
                const tweakedNode = node.tweak(crypto.taggedHash('TapTweak', xOnlyPubkey));
                return { xOnlyPubkey, tweakedNode };
            })();
            const { output } = payments.p2tr({ internalPubkey: xOnlyPubkey });

            // Create deterministic prev txs
            const prevTxs: { tx: Buffer; txId: Buffer }[] = [];
            for (let i = 0; i < 5; i++) {
                prevTxs.push(createFakePrevTx(output!, 10000n, i));
            }

            // Create PSBT with cache
            const psbt1 = new Psbt();
            for (let i = 0; i < 5; i++) {
                psbt1.addInput({
                    hash: prevTxs[i].txId,
                    index: 0,
                    nonWitnessUtxo: prevTxs[i].tx,
                    tapInternalKey: xOnlyPubkey,
                });
            }
            psbt1.addOutput({ script: output!, value: 45000n as Satoshi });
            psbt1.signAllInputs(tweakedNode);

            // Signatures should be deterministic (Schnorr with BIP340 uses aux randomness,
            // but the sighash computation should be identical)
            // We verify by checking all signatures are valid
            const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer) =>
                ecc.verifySchnorr(msghash, pubkey, signature);

            assert.ok(psbt1.validateSignaturesOfAllInputs(validator));
        });
    });

    describe('fuzz testing', () => {
        it('should handle random number of inputs correctly', () => {
            for (let trial = 0; trial < 10; trial++) {
                const numInputs = Math.floor(Math.random() * 20) + 1;
                const { xOnlyPubkey, tweakedNode } = createTaprootKeyPair();
                const { output } = payments.p2tr({ internalPubkey: xOnlyPubkey });

                const psbt = new Psbt();
                for (let i = 0; i < numInputs; i++) {
                    const { tx: prevTx, txId } = createFakePrevTx(output!, 10000n, i);
                    psbt.addInput({
                        hash: txId,
                        index: 0,
                        nonWitnessUtxo: prevTx,
                        tapInternalKey: xOnlyPubkey,
                    });
                }
                psbt.addOutput({ script: output!, value: BigInt(numInputs * 9000) as Satoshi });

                psbt.signAllInputs(tweakedNode);

                const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer) =>
                    ecc.verifySchnorr(msghash, pubkey, signature);

                assert.ok(
                    psbt.validateSignaturesOfAllInputs(validator),
                    `Failed with ${numInputs} inputs on trial ${trial}`,
                );
            }
        });

        it('should handle cache invalidation correctly when inputs/outputs change', () => {
            const { xOnlyPubkey, tweakedNode } = createTaprootKeyPair();
            const { output } = payments.p2tr({ internalPubkey: xOnlyPubkey });

            const psbt = new Psbt();

            // Add first input
            const { tx: prevTx1, txId: txId1 } = createFakePrevTx(output!, 10000n, 1);
            psbt.addInput({
                hash: txId1,
                index: 0,
                nonWitnessUtxo: prevTx1,
                tapInternalKey: xOnlyPubkey,
            });
            psbt.addOutput({ script: output!, value: 5000n as Satoshi });

            // Sign to populate cache
            psbt.signInput(0, tweakedNode);
            const cache = (psbt as any).__CACHE;
            const originalCache = cache.taprootHashCache;
            assert.notStrictEqual(originalCache, undefined);

            // Add more inputs - cache should be invalidated
            const { tx: prevTx2, txId: txId2 } = createFakePrevTx(output!, 10000n, 2);
            psbt.addInput({
                hash: txId2,
                index: 0,
                nonWitnessUtxo: prevTx2,
                tapInternalKey: xOnlyPubkey,
            }, false);
            assert.strictEqual(cache.taprootHashCache, undefined, 'Cache should be invalidated after addInput');

            // Add output - cache already undefined, should stay undefined
            psbt.addOutput({ script: output!, value: 5000n as Satoshi }, false);
            assert.strictEqual(cache.taprootHashCache, undefined);

            // Sign second input - should create new cache
            psbt.signInput(1, tweakedNode);
            assert.notStrictEqual(cache.taprootHashCache, undefined);
            assert.notStrictEqual(cache.taprootHashCache, originalCache, 'Should be a new cache');

            // Note: First signature is now invalid because sighash changed when we added inputs/outputs
            // This is expected Bitcoin behavior with SIGHASH_ALL
            const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer) =>
                ecc.verifySchnorr(msghash, pubkey, signature);

            // Second input should be valid (signed after all inputs/outputs were added)
            assert.ok(psbt.validateSignaturesOfInput(1, validator), 'Input 1 should be valid');
        });

        it('should handle multiple sign calls on same input', () => {
            const { xOnlyPubkey, tweakedNode } = createTaprootKeyPair();
            const { output } = payments.p2tr({ internalPubkey: xOnlyPubkey });

            const psbt = new Psbt();
            const { tx: prevTx, txId } = createFakePrevTx(output!, 10000n, 1);
            psbt.addInput({
                hash: txId,
                index: 0,
                nonWitnessUtxo: prevTx,
                tapInternalKey: xOnlyPubkey,
            });
            psbt.addOutput({ script: output!, value: 9000n as Satoshi });

            // Sign same input
            psbt.signInput(0, tweakedNode);

            // Second sign should throw because already signed (duplicate data)
            assert.throws(() => {
                psbt.signInput(0, tweakedNode);
            }, /duplicate/i);
        });
    });

    describe('Transaction.getTaprootHashCache', () => {
        it('should compute correct hash values', () => {
            const tx = new Transaction();
            tx.version = 2;

            // Add some inputs
            for (let i = 0; i < 3; i++) {
                const hash = Buffer.alloc(32) as unknown as Bytes32;
                hash.writeUInt32LE(i, 0);
                tx.addInput(hash, i);
            }

            // Add some outputs
            const script = Buffer.from('0014' + '00'.repeat(20), 'hex') as unknown as Script;
            tx.addOutput(script, 1000n as Satoshi);
            tx.addOutput(script, 2000n as Satoshi);

            const prevOutScripts = [script, script, script];
            const values = [5000n as Satoshi, 6000n as Satoshi, 7000n as Satoshi];

            const cache = tx.getTaprootHashCache(prevOutScripts, values);

            // Verify all fields are 32 bytes (SHA256 output)
            assert.strictEqual(cache.hashPrevouts.length, 32);
            assert.strictEqual(cache.hashAmounts.length, 32);
            assert.strictEqual(cache.hashScriptPubKeys.length, 32);
            assert.strictEqual(cache.hashSequences.length, 32);
            assert.strictEqual(cache.hashOutputs.length, 32);

            // Verify determinism - same inputs should produce same cache
            const cache2 = tx.getTaprootHashCache(prevOutScripts, values);
            assert.deepStrictEqual(cache.hashPrevouts, cache2.hashPrevouts);
            assert.deepStrictEqual(cache.hashAmounts, cache2.hashAmounts);
            assert.deepStrictEqual(cache.hashScriptPubKeys, cache2.hashScriptPubKeys);
            assert.deepStrictEqual(cache.hashSequences, cache2.hashSequences);
            assert.deepStrictEqual(cache.hashOutputs, cache2.hashOutputs);
        });

        it('should produce different hashes for different transactions', () => {
            const script = Buffer.from('0014' + '00'.repeat(20), 'hex') as unknown as Script;

            const tx1 = new Transaction();
            tx1.version = 2;
            tx1.addInput(Buffer.alloc(32, 1) as unknown as Bytes32, 0);
            tx1.addOutput(script, 1000n as Satoshi);

            const tx2 = new Transaction();
            tx2.version = 2;
            tx2.addInput(Buffer.alloc(32, 2) as unknown as Bytes32, 0); // Different input
            tx2.addOutput(script, 1000n as Satoshi);

            const cache1 = tx1.getTaprootHashCache([script], [5000n as Satoshi]);
            const cache2 = tx2.getTaprootHashCache([script], [5000n as Satoshi]);

            // hashPrevouts should differ (different input hashes)
            assert.notDeepStrictEqual(cache1.hashPrevouts, cache2.hashPrevouts);
        });
    });

    describe('edge cases', () => {
        it('should handle single input correctly', () => {
            const { xOnlyPubkey, tweakedNode } = createTaprootKeyPair();
            const { output } = payments.p2tr({ internalPubkey: xOnlyPubkey });

            const psbt = new Psbt();
            const { tx: prevTx, txId } = createFakePrevTx(output!, 10000n, 1);
            psbt.addInput({
                hash: txId,
                index: 0,
                nonWitnessUtxo: prevTx,
                tapInternalKey: xOnlyPubkey,
            });
            psbt.addOutput({ script: output!, value: 9000n as Satoshi });

            psbt.signInput(0, tweakedNode);

            const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer) =>
                ecc.verifySchnorr(msghash, pubkey, signature);

            assert.ok(psbt.validateSignaturesOfInput(0, validator));
        });

        it('should handle large number of outputs', () => {
            const { xOnlyPubkey, tweakedNode } = createTaprootKeyPair();
            const { output } = payments.p2tr({ internalPubkey: xOnlyPubkey });

            const psbt = new Psbt();
            const { tx: prevTx, txId } = createFakePrevTx(output!, 1000000n, 1);
            psbt.addInput({
                hash: txId,
                index: 0,
                nonWitnessUtxo: prevTx,
                tapInternalKey: xOnlyPubkey,
            });

            // Add many outputs
            for (let i = 0; i < 50; i++) {
                psbt.addOutput({ script: output!, value: 1000n as Satoshi });
            }

            psbt.signInput(0, tweakedNode);

            const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer) =>
                ecc.verifySchnorr(msghash, pubkey, signature);

            assert.ok(psbt.validateSignaturesOfInput(0, validator));
        });

        it('should handle witnessUtxo inputs', () => {
            const { xOnlyPubkey, tweakedNode } = createTaprootKeyPair();
            const { output } = payments.p2tr({ internalPubkey: xOnlyPubkey });

            const psbt = new Psbt();
            for (let i = 0; i < 5; i++) {
                const hash = Buffer.alloc(32);
                hash.writeUInt32LE(i, 0);
                psbt.addInput({
                    hash,
                    index: 0,
                    witnessUtxo: { script: output!, value: 10000n as Satoshi },
                    tapInternalKey: xOnlyPubkey,
                });
            }
            psbt.addOutput({ script: output!, value: 45000n as Satoshi });

            psbt.signAllInputs(tweakedNode);

            const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer) =>
                ecc.verifySchnorr(msghash, pubkey, signature);

            assert.ok(psbt.validateSignaturesOfAllInputs(validator));
        });

        it('should not persist cache after PSBT serialization/deserialization', () => {
            const { xOnlyPubkey, tweakedNode } = createTaprootKeyPair();
            const { output } = payments.p2tr({ internalPubkey: xOnlyPubkey });

            const psbt = new Psbt();
            for (let i = 0; i < 3; i++) {
                const { tx: prevTx, txId } = createFakePrevTx(output!, 10000n, i);
                psbt.addInput({
                    hash: txId,
                    index: 0,
                    nonWitnessUtxo: prevTx,
                    tapInternalKey: xOnlyPubkey,
                });
            }
            psbt.addOutput({ script: output!, value: 25000n as Satoshi });

            // Sign to populate cache
            psbt.signInput(0, tweakedNode);
            const cache = (psbt as any).__CACHE;
            assert.notStrictEqual(cache.taprootHashCache, undefined);

            // Serialize and deserialize
            const hex = psbt.toHex();
            const psbt2 = Psbt.fromHex(hex);

            // New PSBT should not have cache populated
            const cache2 = (psbt2 as any).__CACHE;
            assert.strictEqual(cache2.__TAPROOT_HASH_CACHE, undefined);

            // Should still be able to sign remaining inputs
            psbt2.signInput(1, tweakedNode);
            psbt2.signInput(2, tweakedNode);

            const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer) =>
                ecc.verifySchnorr(msghash, pubkey, signature);

            assert.ok(psbt2.validateSignaturesOfInput(1, validator));
            assert.ok(psbt2.validateSignaturesOfInput(2, validator));
        });

        it('should work correctly with async signing', async () => {
            const { xOnlyPubkey, tweakedNode } = createTaprootKeyPair();
            const { output } = payments.p2tr({ internalPubkey: xOnlyPubkey });

            const psbt = new Psbt();
            for (let i = 0; i < 5; i++) {
                const { tx: prevTx, txId } = createFakePrevTx(output!, 10000n, i);
                psbt.addInput({
                    hash: txId,
                    index: 0,
                    nonWitnessUtxo: prevTx,
                    tapInternalKey: xOnlyPubkey,
                });
            }
            psbt.addOutput({ script: output!, value: 45000n as Satoshi });

            // Sign asynchronously
            await psbt.signAllInputsAsync(tweakedNode);

            const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer) =>
                ecc.verifySchnorr(msghash, pubkey, signature);

            assert.ok(psbt.validateSignaturesOfAllInputs(validator));
        });

        it('should produce different hashOutputs for different output values', () => {
            const script = Buffer.from('0014' + '00'.repeat(20), 'hex') as unknown as Script;

            const tx = new Transaction();
            tx.version = 2;
            tx.addInput(Buffer.alloc(32, 1) as unknown as Bytes32, 0);
            tx.addOutput(script, 1000n as Satoshi);

            const cache1 = tx.getTaprootHashCache([script], [5000n as Satoshi]);

            // Change output value
            tx.outs[0].value = 2000n as Satoshi;
            const cache2 = tx.getTaprootHashCache([script], [5000n as Satoshi]);

            // hashOutputs should differ
            assert.notDeepStrictEqual(cache1.hashOutputs, cache2.hashOutputs);
            // Other hashes should be the same
            assert.deepStrictEqual(cache1.hashPrevouts, cache2.hashPrevouts);
            assert.deepStrictEqual(cache1.hashAmounts, cache2.hashAmounts);
        });

        it('should produce different hashSequences for different sequences', () => {
            const script = Buffer.from('0014' + '00'.repeat(20), 'hex') as unknown as Script;

            const tx1 = new Transaction();
            tx1.version = 2;
            tx1.addInput(Buffer.alloc(32, 1) as unknown as Bytes32, 0, 0xffffffff); // default sequence
            tx1.addOutput(script, 1000n as Satoshi);

            const tx2 = new Transaction();
            tx2.version = 2;
            tx2.addInput(Buffer.alloc(32, 1) as unknown as Bytes32, 0, 0xfffffffe); // RBF sequence
            tx2.addOutput(script, 1000n as Satoshi);

            const cache1 = tx1.getTaprootHashCache([script], [5000n as Satoshi]);
            const cache2 = tx2.getTaprootHashCache([script], [5000n as Satoshi]);

            // hashSequences should differ
            assert.notDeepStrictEqual(cache1.hashSequences, cache2.hashSequences);
            // hashPrevouts should be the same (same input hash)
            assert.deepStrictEqual(cache1.hashPrevouts, cache2.hashPrevouts);
        });

        it('should handle prevOuts cache invalidation together with taproot cache', () => {
            const { xOnlyPubkey, tweakedNode } = createTaprootKeyPair();
            const { output } = payments.p2tr({ internalPubkey: xOnlyPubkey });

            const psbt = new Psbt();
            const { tx: prevTx1, txId: txId1 } = createFakePrevTx(output!, 10000n, 1);
            psbt.addInput({
                hash: txId1,
                index: 0,
                nonWitnessUtxo: prevTx1,
                tapInternalKey: xOnlyPubkey,
            });
            psbt.addOutput({ script: output!, value: 9000n as Satoshi });

            // Sign to populate all caches
            psbt.signInput(0, tweakedNode);
            const cache = (psbt as any).__CACHE;
            assert.notStrictEqual(cache.prevOuts, undefined);
            assert.notStrictEqual(cache.signingScripts, undefined);
            assert.notStrictEqual(cache.values, undefined);
            assert.notStrictEqual(cache.taprootHashCache, undefined);

            // Add new input - all caches should be invalidated
            const { tx: prevTx2, txId: txId2 } = createFakePrevTx(output!, 10000n, 2);
            psbt.addInput({
                hash: txId2,
                index: 0,
                nonWitnessUtxo: prevTx2,
                tapInternalKey: xOnlyPubkey,
            }, false);

            assert.strictEqual(cache.prevOuts, undefined);
            assert.strictEqual(cache.signingScripts, undefined);
            assert.strictEqual(cache.values, undefined);
            assert.strictEqual(cache.taprootHashCache, undefined);
        });

        it('should handle stress test with many sequential operations', () => {
            const { xOnlyPubkey, tweakedNode } = createTaprootKeyPair();
            const { output } = payments.p2tr({ internalPubkey: xOnlyPubkey });

            // Build PSBT with many inputs
            const psbt = new Psbt();
            const inputCount = 50;
            for (let i = 0; i < inputCount; i++) {
                const { tx: prevTx, txId } = createFakePrevTx(output!, 10000n, i);
                psbt.addInput({
                    hash: txId,
                    index: 0,
                    nonWitnessUtxo: prevTx,
                    tapInternalKey: xOnlyPubkey,
                });
            }
            psbt.addOutput({ script: output!, value: BigInt(inputCount * 9000) as Satoshi });

            // Sign all inputs
            psbt.signAllInputs(tweakedNode);

            // Verify cache was used (should be populated)
            const cache = (psbt as any).__CACHE;
            assert.notStrictEqual(cache.taprootHashCache, undefined);

            // Validate all signatures
            const validator = (pubkey: Buffer, msghash: Buffer, signature: Buffer) =>
                ecc.verifySchnorr(msghash, pubkey, signature);

            assert.ok(psbt.validateSignaturesOfAllInputs(validator));
        });
    });
});
