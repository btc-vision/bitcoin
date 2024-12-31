"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const mocha_1 = require("mocha");
const bscript = require("../src/script");
const fixtures = require("./fixtures/script.json");
const minimalData = require('minimaldata');
(0, mocha_1.describe)('script', () => {
    // TODO
    (0, mocha_1.describe)('isCanonicalPubKey', () => {
        (0, mocha_1.it)('rejects if not provided a Buffer', () => {
            assert.strictEqual(false, bscript.isCanonicalPubKey(0));
        });
        (0, mocha_1.it)('rejects smaller than 33', () => {
            for (let i = 0; i < 33; i++) {
                assert.strictEqual(false, bscript.isCanonicalPubKey(Buffer.allocUnsafe(i)));
            }
        });
    });
    mocha_1.describe.skip('isCanonicalScriptSignature', () => {
        assert.ok(true);
    });
    (0, mocha_1.describe)('fromASM/toASM', () => {
        fixtures.valid.forEach(f => {
            (0, mocha_1.it)('encodes/decodes ' + f.asm, () => {
                const script = bscript.fromASM(f.asm);
                assert.strictEqual(bscript.toASM(script), f.asm);
            });
        });
        fixtures.invalid.fromASM.forEach(f => {
            (0, mocha_1.it)('throws ' + f.description, () => {
                assert.throws(() => {
                    bscript.fromASM(f.script);
                }, new RegExp(f.description));
            });
        });
    });
    (0, mocha_1.describe)('toASM', () => {
        const OP_RETURN = bscript.OPS.OP_RETURN;
        (0, mocha_1.it)('encodes empty buffer as OP_0', () => {
            const chunks = [OP_RETURN, Buffer.from([])];
            assert.strictEqual(bscript.toASM(chunks), 'OP_RETURN OP_0');
        });
        for (let i = 1; i <= 16; i++) {
            (0, mocha_1.it)(`encodes one byte buffer [${i}] as OP_${i}`, () => {
                const chunks = [OP_RETURN, Buffer.from([i])];
                assert.strictEqual(bscript.toASM(chunks), 'OP_RETURN OP_' + i);
            });
        }
    });
    (0, mocha_1.describe)('fromASM/toASM (templates)', () => {
        fixtures.valid2.forEach(f => {
            if (f.inputHex) {
                const ih = bscript.toASM(Buffer.from(f.inputHex, 'hex'));
                (0, mocha_1.it)('encodes/decodes ' + ih, () => {
                    const script = bscript.fromASM(f.input);
                    assert.strictEqual(script.toString('hex'), f.inputHex);
                    assert.strictEqual(bscript.toASM(script), f.input);
                });
            }
            if (f.outputHex) {
                (0, mocha_1.it)('encodes/decodes ' + f.output, () => {
                    const script = bscript.fromASM(f.output);
                    assert.strictEqual(script.toString('hex'), f.outputHex);
                    assert.strictEqual(bscript.toASM(script), f.output);
                });
            }
        });
    });
    (0, mocha_1.describe)('isPushOnly', () => {
        fixtures.valid.forEach(f => {
            (0, mocha_1.it)('returns ' + !!f.stack + ' for ' + f.asm, () => {
                const script = bscript.fromASM(f.asm);
                const chunks = bscript.decompile(script);
                assert.strictEqual(bscript.isPushOnly(chunks), !!f.stack);
            });
        });
    });
    (0, mocha_1.describe)('toStack', () => {
        fixtures.valid.forEach(f => {
            (0, mocha_1.it)('returns ' + !!f.stack + ' for ' + f.asm, () => {
                if (!f.stack || !f.asm)
                    return;
                const script = bscript.fromASM(f.asm);
                const stack = bscript.toStack(script);
                assert.deepStrictEqual(stack.map(x => {
                    return x.toString('hex');
                }), f.stack);
                assert.strictEqual(bscript.toASM(bscript.compile(stack)), f.asm, 'should rebuild same script from stack');
            });
        });
    });
    (0, mocha_1.describe)('compile (via fromASM)', () => {
        fixtures.valid.forEach(f => {
            (0, mocha_1.it)('compiles ' + f.asm, () => {
                const scriptSig = bscript.fromASM(f.asm);
                assert.strictEqual(scriptSig.toString('hex'), f.script);
                if (f.nonstandard) {
                    const scriptSigNS = bscript.fromASM(f.nonstandard.scriptSig);
                    assert.strictEqual(scriptSigNS.toString('hex'), f.script);
                }
            });
        });
    });
    (0, mocha_1.describe)('decompile', () => {
        fixtures.valid.forEach(f => {
            (0, mocha_1.it)('decompiles ' + f.asm, () => {
                const chunks = bscript.decompile(Buffer.from(f.script, 'hex'));
                assert.strictEqual(bscript.compile(chunks).toString('hex'), f.script);
                assert.strictEqual(bscript.toASM(chunks), f.asm);
                if (f.nonstandard) {
                    const chunksNS = bscript.decompile(Buffer.from(f.nonstandard.scriptSigHex, 'hex'));
                    assert.strictEqual(bscript.compile(chunksNS).toString('hex'), f.script);
                    // toASM converts verbatim, only `compile` transforms the script to a minimalpush compliant script
                    assert.strictEqual(bscript.toASM(chunksNS), f.nonstandard.scriptSig);
                }
            });
        });
        fixtures.invalid.decompile.forEach(f => {
            (0, mocha_1.it)('fails to decompile ' +
                f.script +
                ',  because "' +
                f.description +
                '"', () => {
                const chunks = bscript.decompile(Buffer.from(f.script, 'hex'));
                assert.strictEqual(chunks, null);
            });
        });
    });
    (0, mocha_1.describe)('SCRIPT_VERIFY_MINIMALDATA policy', () => {
        fixtures.valid.forEach(f => {
            (0, mocha_1.it)('compliant for scriptSig ' + f.asm, () => {
                const script = Buffer.from(f.script, 'hex');
                assert(minimalData(script));
            });
        });
        function testEncodingForSize(num) {
            (0, mocha_1.it)('compliant for data PUSH of length ' + num, () => {
                const buffer = Buffer.alloc(num);
                const script = bscript.compile([buffer]);
                assert(minimalData(script), 'Failed for ' +
                    num +
                    ' length script: ' +
                    script.toString('hex'));
            });
        }
        for (let i = 0; i < 520; ++i) {
            testEncodingForSize(i);
        }
    });
});
