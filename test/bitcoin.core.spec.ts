import assert from 'assert';
import { base58 } from '@scure/base';
import { describe, it } from 'vitest';
import * as bitcoin from '../src/index.js';
import type { Bytes20, Satoshi, Script } from '../src/types.js';
import { fromHex, reverseCopy, toHex } from '../src/io/index.js';
import base58EncodeDecode from './fixtures/core/base58_encode_decode.json' with { type: 'json' };
import base58KeysInvalid from './fixtures/core/base58_keys_invalid.json' with { type: 'json' };
import base58KeysValid from './fixtures/core/base58_keys_valid.json' with { type: 'json' };
import blocksValid from './fixtures/core/blocks.json' with { type: 'json' };
import sigCanonical from './fixtures/core/sig_canonical.json' with { type: 'json' };
import sigNoncanonical from './fixtures/core/sig_noncanonical.json' with { type: 'json' };
import sigHash from './fixtures/core/sighash.json' with { type: 'json' };
import txValid from './fixtures/core/tx_valid.json' with { type: 'json' };

describe('Bitcoin-core', () => {
    // base58EncodeDecode
    describe('base58', () => {
        base58EncodeDecode.forEach((f) => {
            const fhex = f[0];
            const fb58 = f[1];

            it('can decode ' + fb58, () => {
                assert(fb58 !== undefined);
                const buffer = base58.decode(fb58);
                const actual = toHex(new Uint8Array(buffer));

                assert.strictEqual(actual, fhex);
            });

            it('can encode ' + fhex, () => {
                assert(fhex !== undefined);
                const buffer = fromHex(fhex);
                const actual = base58.encode(buffer);

                assert.strictEqual(actual, fb58);
            });
        });
    });

    // base58KeysValid
    describe('address.toBase58Check', () => {
        const typeMap: any = {
            pubkey: 'pubKeyHash',
            script: 'scriptHash',
        };

        base58KeysValid.forEach((f) => {
            const expected = f[0];
            const hash = fromHex(f[1] as any);
            const params = f[2] as any;

            if (params.isPrivkey) return;

            const network: any = params.isTestnet
                ? bitcoin.networks.testnet
                : bitcoin.networks.bitcoin;

            const version = network[typeMap[params.addrType]];

            it(`can export ${expected as string}`, () => {
                assert.strictEqual(
                    bitcoin.address.toBase58Check(hash as Bytes20, version),
                    expected,
                );
            });
        });
    });

    // base58KeysInvalid
    describe('address.fromBase58Check', () => {
        const allowedNetworks = [
            bitcoin.networks.bitcoin.pubKeyHash,
            bitcoin.networks.bitcoin.scriptHash,
            bitcoin.networks.testnet.pubKeyHash,
            bitcoin.networks.testnet.scriptHash,
        ];

        base58KeysInvalid.forEach((f) => {
            const strng = f[0];

            it('throws on ' + strng, () => {
                assert(strng !== undefined);
                assert.throws(() => {
                    const address = bitcoin.address.fromBase58Check(strng);

                    assert.notStrictEqual(
                        allowedNetworks.indexOf(address.version),
                        -1,
                        'Invalid network',
                    );
                }, /(Invalid (checksum|network))|(too (short|long))/);
            });
        });
    });

    describe('Block.fromHex', () => {
        blocksValid.forEach((f) => {
            it('can parse ' + f.id, () => {
                const block = bitcoin.Block.fromHex(f.hex);

                assert.strictEqual(block.getId(), f.id);
                assert.strictEqual(block.transactions!.length, f.transactions);
            });
        });
    });

    // txValid
    describe('Transaction.fromHex', () => {
        txValid.forEach((f) => {
            // Objects that are only a single string are ignored
            if (f.length === 1) return;

            const inputs = f[0];
            const fhex = f[1];
            //      const verifyFlags = f[2] // TODO: do we need to test this?

            it('can decode ' + fhex, () => {
                assert(inputs !== undefined);
                const transaction = bitcoin.Transaction.fromHex(fhex as string);

                transaction.ins.forEach((txIn, i) => {
                    const input = (inputs as unknown[][])[i];
                    assert(input !== undefined);

                    // reverse because test data is reversed
                    const prevOutHash = reverseCopy(fromHex(input[0] as string));
                    const prevOutIndex = input[1];

                    assert.deepStrictEqual(txIn.hash, prevOutHash);

                    // we read UInt32, not Int32
                    assert.strictEqual(txIn.index & 0xffffffff, prevOutIndex);
                });
            });
        });
    });

    // sighash
    describe('Transaction', () => {
        sigHash.forEach((f) => {
            // Objects that are only a single string are ignored
            if (f.length === 1) return;

            const txHex = f[0] as string;
            const scriptHex = f[1] as string;
            const inIndex = f[2] as number;
            const hashType = f[3] as number;
            const expectedHash = f[4];

            const hashTypes = [];
            if ((hashType & 0x1f) === bitcoin.Transaction.SIGHASH_NONE)
                hashTypes.push('SIGHASH_NONE');
            else if ((hashType & 0x1f) === bitcoin.Transaction.SIGHASH_SINGLE)
                hashTypes.push('SIGHASH_SINGLE');
            else hashTypes.push('SIGHASH_ALL');
            if (hashType & bitcoin.Transaction.SIGHASH_ANYONECANPAY)
                hashTypes.push('SIGHASH_ANYONECANPAY');

            const hashTypeName = hashTypes.join(' | ');

            it('should hash ' + txHex.slice(0, 40) + '... (' + hashTypeName + ')', () => {
                const transaction = bitcoin.Transaction.fromHex(txHex);
                assert.strictEqual(transaction.toHex(), txHex);

                const script = fromHex(scriptHex);
                const scriptChunks = bitcoin.script.decompile(script);
                assert.strictEqual(toHex(bitcoin.script.compile(scriptChunks!)), scriptHex);

                const hash = transaction.hashForSignature(inIndex, script as Script, hashType);

                // reverse because test data is reversed
                assert.strictEqual(toHex(reverseCopy(hash)), expectedHash);

                assert.doesNotThrow(() =>
                    transaction.hashForWitnessV0(
                        inIndex,
                        script as Script,
                        0n as Satoshi,
                        // convert to UInt32
                        hashType < 0 ? 0x100000000 + hashType : hashType,
                    ),
                );
            });
        });
    });

    describe('script.signature.decode', () => {
        sigCanonical.forEach((hex) => {
            const buffer = fromHex(hex);

            it('can parse ' + hex, () => {
                const parsed = bitcoin.script.signature.decode(buffer);
                const actual = bitcoin.script.signature.encode(parsed.signature, parsed.hashType);

                assert.strictEqual(toHex(actual), hex);
            });
        });

        sigNoncanonical.forEach((hex, i) => {
            if (i === 0) return;
            if (i % 2 !== 0) return;

            const prev = sigNoncanonical[i - 1];
            assert(prev !== undefined);
            const description = prev.slice(0, -1);
            const buffer = fromHex(hex);

            it('throws on ' + description, () => {
                const reg = new RegExp(
                    'Expected DER (integer|sequence)|(R|S) value (excessively ' +
                        'padded|is negative)|(R|S|DER sequence) length is (zero|too ' +
                        'short|too long|invalid)|Invalid hashType',
                );
                assert.throws(() => {
                    bitcoin.script.signature.decode(buffer);
                }, reg);
            });
        });
    });
});
