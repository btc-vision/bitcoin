import assert from 'assert';
import { describe, it } from 'vitest';
import { signature as bscriptSig } from '../src/script.js';
import { concat, fromHex, toHex } from '../src/io/index.js';
import fixtures from './fixtures/signature.json' with { type: 'json' };

describe('Script Signatures', () => {
    function fromRaw(signature: { r: string; s: string }): Uint8Array {
        return concat([fromHex(signature.r), fromHex(signature.s)]);
    }

    function toRaw(signature: Uint8Array): {
        r: string;
        s: string;
    } {
        return {
            r: toHex(signature.slice(0, 32)),
            s: toHex(signature.slice(32, 64)),
        };
    }

    describe('encode', () => {
        fixtures.valid.forEach((f) => {
            it('encodes ' + f.hex, () => {
                const buffer = bscriptSig.encode(fromRaw(f.raw), f.hashType);

                assert.strictEqual(toHex(buffer), f.hex);
            });
        });

        fixtures.invalid.forEach((f) => {
            if (!f.raw) return;

            it('throws ' + f.exception, () => {
                const signature = fromRaw(f.raw);

                assert.throws(() => {
                    bscriptSig.encode(signature, f.hashType);
                }, new RegExp(f.exception));
            });
        });
    });

    describe('decode', () => {
        fixtures.valid.forEach((f) => {
            it('decodes ' + f.hex, () => {
                const decode = bscriptSig.decode(fromHex(f.hex));

                assert.deepStrictEqual(toRaw(decode.signature), f.raw);
                assert.strictEqual(decode.hashType, f.hashType);
            });
        });

        fixtures.invalid.forEach((f) => {
            it('throws on ' + f.hex, () => {
                const buffer = fromHex(f.hex);

                assert.throws(() => {
                    bscriptSig.decode(buffer);
                }, new RegExp(f.exception));
            });
        });
    });
});
