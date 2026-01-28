/**
 * Browser-adapted version of test/script.spec.ts
 * Removes minimaldata native module dependency and its test section.
 */
import assert from 'assert';
import { describe, it } from 'vitest';
import * as bscript from '../../src/script.js';
import { toHex } from '../../src/io/index.js';
import fixtures from '../fixtures/script.json' with { type: 'json' };

describe('script', () => {
    describe('isCanonicalPubKey', () => {
        it('rejects if not provided a Buffer', () => {
            assert.strictEqual(bscript.isCanonicalPubKey(0 as any), false);
            assert.strictEqual(bscript.isCanonicalPubKey('string' as any), false);
            assert.strictEqual(bscript.isCanonicalPubKey(null as any), false);
        });

        it('rejects smaller than 33 bytes', () => {
            for (let i = 0; i < 33; i++) {
                assert.strictEqual(bscript.isCanonicalPubKey(Buffer.allocUnsafe(i)), false);
            }
        });

        it('accepts valid compressed pubkey (33 bytes, starts with 0x02)', () => {
            const compressedEven = Buffer.from(
                '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
                'hex',
            );
            assert.strictEqual(bscript.isCanonicalPubKey(compressedEven), true);
        });

        it('accepts valid compressed pubkey (33 bytes, starts with 0x03)', () => {
            const compressedOdd = Buffer.from(
                '03df51984d6b8b8b1cc693e239491f77a36c9e9dfe4a486e9972a18e03610a0d22',
                'hex',
            );
            assert.strictEqual(bscript.isCanonicalPubKey(compressedOdd), true);
        });

        it('accepts valid uncompressed pubkey (65 bytes, starts with 0x04)', () => {
            const uncompressed = Buffer.from(
                '0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8',
                'hex',
            );
            assert.strictEqual(bscript.isCanonicalPubKey(uncompressed), true);
        });

        it('rejects invalid format indicator', () => {
            const invalidFormat = Buffer.from(
                '0579be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
                'hex',
            );
            assert.strictEqual(bscript.isCanonicalPubKey(invalidFormat), false);
        });
    });

    describe('isCanonicalScriptSignature', () => {
        it('rejects if not provided a Buffer', () => {
            assert.strictEqual(bscript.isCanonicalScriptSignature(0 as any), false);
            assert.strictEqual(bscript.isCanonicalScriptSignature('string' as any), false);
            assert.strictEqual(bscript.isCanonicalScriptSignature(null as any), false);
        });

        it('rejects if hash type is invalid', () => {
            const sigWithBadHashType = Buffer.from(
                '3044022047ac8e878352d3ebbde1c94ce3a10d057c24175747116f8288e5d794d12d482f0220217f36a485cae903c713331d877c1f64677e3622ad4010726870540656fe9dcb00',
                'hex',
            );
            assert.strictEqual(bscript.isCanonicalScriptSignature(sigWithBadHashType), false);
        });

        it('accepts valid canonical signature with SIGHASH_ALL', () => {
            const validSig = Buffer.from(
                '3044022047ac8e878352d3ebbde1c94ce3a10d057c24175747116f8288e5d794d12d482f0220217f36a485cae903c713331d877c1f64677e3622ad4010726870540656fe9dcb01',
                'hex',
            );
            assert.strictEqual(bscript.isCanonicalScriptSignature(validSig), true);
        });

        it('rejects signature with invalid DER encoding', () => {
            const invalidDer = Buffer.from('3045022047ac8e8701', 'hex');
            assert.strictEqual(bscript.isCanonicalScriptSignature(invalidDer), false);
        });
    });

    describe('fromASM/toASM', () => {
        fixtures.valid.forEach((f) => {
            it('encodes/decodes ' + f.asm, () => {
                const script = bscript.fromASM(f.asm);
                assert.strictEqual(bscript.toASM(script), f.asm);
            });
        });

        fixtures.invalid.fromASM.forEach((f) => {
            it('throws ' + f.description, () => {
                assert.throws(() => {
                    bscript.fromASM(f.script);
                }, new RegExp(f.description));
            });
        });
    });

    describe('toASM', () => {
        const OP_RETURN = bscript.opcodes.OP_RETURN;
        it('encodes empty buffer as OP_0', () => {
            const chunks = [OP_RETURN, Buffer.from([])];
            assert.strictEqual(bscript.toASM(chunks), 'OP_RETURN OP_0');
        });

        for (let i = 1; i <= 16; i++) {
            it(`encodes one byte buffer [${i}] as OP_${i}`, () => {
                const chunks = [OP_RETURN, Buffer.from([i])];
                assert.strictEqual(bscript.toASM(chunks), 'OP_RETURN OP_' + i);
            });
        }
    });

    describe('fromASM/toASM (templates)', () => {
        fixtures.valid2.forEach((f) => {
            if (f.inputHex) {
                const ih = bscript.toASM(Buffer.from(f.inputHex, 'hex'));

                it('encodes/decodes ' + ih, () => {
                    const script = bscript.fromASM(f.input);
                    assert.strictEqual(toHex(script), f.inputHex);
                    assert.strictEqual(bscript.toASM(script), f.input);
                });
            }

            if (f.outputHex) {
                it('encodes/decodes ' + f.output, () => {
                    const script = bscript.fromASM(f.output);
                    assert.strictEqual(toHex(script), f.outputHex);
                    assert.strictEqual(bscript.toASM(script), f.output);
                });
            }
        });
    });

    describe('isPushOnly', () => {
        fixtures.valid.forEach((f) => {
            it('returns ' + !!f.stack + ' for ' + f.asm, () => {
                const script = bscript.fromASM(f.asm);
                const chunks = bscript.decompile(script);

                assert.strictEqual(bscript.isPushOnly(chunks!), !!f.stack);
            });
        });
    });

    describe('toStack', () => {
        fixtures.valid.forEach((f) => {
            it('returns ' + !!f.stack + ' for ' + f.asm, () => {
                if (!f.stack || !f.asm) return;

                const script = bscript.fromASM(f.asm);

                const stack = bscript.toStack(script);
                assert.deepStrictEqual(
                    stack.map((x) => {
                        return toHex(x);
                    }),
                    f.stack,
                );

                assert.strictEqual(
                    bscript.toASM(bscript.compile(stack)),
                    f.asm,
                    'should rebuild same script from stack',
                );
            });
        });
    });

    describe('compile (via fromASM)', () => {
        fixtures.valid.forEach((f) => {
            it('compiles ' + f.asm, () => {
                const scriptSig = bscript.fromASM(f.asm);

                assert.strictEqual(toHex(scriptSig), f.script);

                if (f.nonstandard) {
                    const scriptSigNS = bscript.fromASM(f.nonstandard.scriptSig);

                    assert.strictEqual(toHex(scriptSigNS), f.script);
                }
            });
        });
    });

    describe('decompile', () => {
        fixtures.valid.forEach((f) => {
            it('decompiles ' + f.asm, () => {
                const chunks = bscript.decompile(Buffer.from(f.script, 'hex'));

                assert.strictEqual(toHex(bscript.compile(chunks!)), f.script);
                assert.strictEqual(bscript.toASM(chunks!), f.asm);

                if (f.nonstandard) {
                    const chunksNS = bscript.decompile(
                        Buffer.from(f.nonstandard.scriptSigHex, 'hex'),
                    );

                    assert.strictEqual(toHex(bscript.compile(chunksNS!)), f.script);

                    assert.strictEqual(bscript.toASM(chunksNS!), f.nonstandard.scriptSig);
                }
            });
        });

        fixtures.invalid.decompile.forEach((f) => {
            it('fails to decompile ' + f.script + ',  because "' + f.description + '"', () => {
                const chunks = bscript.decompile(Buffer.from(f.script, 'hex'));

                assert.strictEqual(chunks, null);
            });
        });
    });

    // NOTE: SCRIPT_VERIFY_MINIMALDATA tests excluded in browser build
    // because the 'minimaldata' package is a native Node.js module
});
