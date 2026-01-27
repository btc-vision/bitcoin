import assert from 'assert';
import { describe, it } from 'vitest';
import * as types from '../src/types.js';

describe('types', () => {
    describe('Buffer validation', () => {
        const buffer20byte = new Uint8Array(20);
        const buffer32byte = new Uint8Array(32);

        it('isBytes20 returns true for 20-byte buffer', () => {
            assert(types.isBytes20(buffer20byte));
        });

        it('isBytes32 returns true for 32-byte buffer', () => {
            assert(types.isBytes32(buffer32byte));
        });

        it('isBytes20 returns false for wrong size', () => {
            assert.strictEqual(types.isBytes20(buffer32byte), false);
        });

        it('isBytes32 returns false for wrong size', () => {
            assert.strictEqual(types.isBytes32(buffer20byte), false);
        });

        it('toBytes20 throws for invalid size', () => {
            assert.throws(() => {
                types.toBytes20(buffer32byte);
            }, /Expected 20-byte Uint8Array/);
        });

        it('toBytes32 throws for invalid size', () => {
            assert.throws(() => {
                types.toBytes32(buffer20byte);
            }, /Expected 32-byte Uint8Array/);
        });
    });

    describe('Satoshi', () => {
        [
            { value: -1n, result: false },
            { value: 0n, result: true },
            { value: 1n, result: true },
            { value: 20999999n * 100000000n, result: true },
            { value: 21000000n * 100000000n, result: true },
            { value: 21000001n * 100000000n, result: false },
        ].forEach((f) => {
            it('returns ' + f.result + ' for value ' + f.value, () => {
                assert.strictEqual(types.isSatoshi(f.value), f.result);
            });
        });
    });

    describe('Type guards', () => {
        it('isUInt8 validates correctly', () => {
            assert.strictEqual(types.isUInt8(0), true);
            assert.strictEqual(types.isUInt8(255), true);
            assert.strictEqual(types.isUInt8(256), false);
            assert.strictEqual(types.isUInt8(-1), false);
            assert.strictEqual(types.isUInt8(1.5), false);
        });

        it('isUInt32 validates correctly', () => {
            assert.strictEqual(types.isUInt32(0), true);
            assert.strictEqual(types.isUInt32(0xffffffff), true);
            assert.strictEqual(types.isUInt32(0x100000000), false);
            assert.strictEqual(types.isUInt32(-1), false);
        });

        it('isHex validates correctly', () => {
            assert.strictEqual(types.isHex('abcd'), true);
            assert.strictEqual(types.isHex('ABCD'), true);
            assert.strictEqual(types.isHex('1234'), true);
            assert.strictEqual(types.isHex('abc'), false); // odd length
            assert.strictEqual(types.isHex('ghij'), false); // invalid chars
        });

        it('isUint8Array validates correctly', () => {
            assert.strictEqual(types.isUint8Array(new Uint8Array(10)), true);
            assert.strictEqual(types.isUint8Array(Buffer.alloc(10)), true);
            assert.strictEqual(types.isUint8Array([1, 2, 3]), false);
            assert.strictEqual(types.isUint8Array('hello'), false);
        });

        it('isPoint validates public keys', () => {
            // Compressed pubkey (33 bytes, prefix 0x02 or 0x03)
            const compressedKey = new Uint8Array(33);
            compressedKey[0] = 0x02;
            compressedKey[1] = 0x01; // non-zero x coordinate

            // Invalid: all zeros
            const zeroKey = new Uint8Array(33);
            zeroKey[0] = 0x02;

            assert.strictEqual(types.isPoint(zeroKey), false);
        });
    });
});
