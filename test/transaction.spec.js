"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const mocha_1 = require("mocha");
const __1 = require("..");
const bscript = require("../src/script");
const fixtures = require("./fixtures/transaction.json");
(0, mocha_1.describe)('Transaction', () => {
    function fromRaw(raw, noWitness) {
        const tx = new __1.Transaction();
        tx.version = raw.version;
        tx.locktime = raw.locktime;
        raw.ins.forEach((txIn, i) => {
            const txHash = Buffer.from(txIn.hash, 'hex');
            let scriptSig;
            if (txIn.data) {
                scriptSig = Buffer.from(txIn.data, 'hex');
            }
            else if (txIn.script) {
                scriptSig = bscript.fromASM(txIn.script);
            }
            tx.addInput(txHash, txIn.index, txIn.sequence, scriptSig);
            if (!noWitness && txIn.witness) {
                const witness = txIn.witness.map((x) => {
                    return Buffer.from(x, 'hex');
                });
                tx.setWitness(i, witness);
            }
        });
        raw.outs.forEach((txOut) => {
            let script;
            if (txOut.data) {
                script = Buffer.from(txOut.data, 'hex');
            }
            else if (txOut.script) {
                script = bscript.fromASM(txOut.script);
            }
            tx.addOutput(script, txOut.value);
        });
        return tx;
    }
    (0, mocha_1.describe)('fromBuffer/fromHex', () => {
        function importExport(f) {
            const id = f.id || f.hash;
            const txHex = f.hex || f.txHex;
            (0, mocha_1.it)('imports ' + f.description + ' (' + id + ')', () => {
                const actual = __1.Transaction.fromHex(txHex);
                assert.strictEqual(actual.toHex(), txHex);
            });
            if (f.whex) {
                (0, mocha_1.it)('imports ' + f.description + ' (' + id + ') as witness', () => {
                    const actual = __1.Transaction.fromHex(f.whex);
                    assert.strictEqual(actual.toHex(), f.whex);
                });
            }
        }
        fixtures.valid.forEach(importExport);
        fixtures.hashForSignature.forEach(importExport);
        fixtures.hashForWitnessV0.forEach(importExport);
        fixtures.invalid.fromBuffer.forEach(f => {
            (0, mocha_1.it)('throws on ' + f.exception, () => {
                assert.throws(() => {
                    __1.Transaction.fromHex(f.hex);
                }, new RegExp(f.exception));
            });
        });
        (0, mocha_1.it)('.version should be interpreted as an int32le', () => {
            const txHex = 'ffffffff0000ffffffff';
            const tx = __1.Transaction.fromHex(txHex);
            assert.strictEqual(-1, tx.version);
            assert.strictEqual(0xffffffff, tx.locktime);
        });
    });
    (0, mocha_1.describe)('toBuffer/toHex', () => {
        fixtures.valid.forEach(f => {
            (0, mocha_1.it)('exports ' + f.description + ' (' + f.id + ')', () => {
                const actual = fromRaw(f.raw, true);
                assert.strictEqual(actual.toHex(), f.hex);
            });
            if (f.whex) {
                (0, mocha_1.it)('exports ' + f.description + ' (' + f.id + ') as witness', () => {
                    const wactual = fromRaw(f.raw);
                    assert.strictEqual(wactual.toHex(), f.whex);
                });
            }
        });
        (0, mocha_1.it)('accepts target Buffer and offset parameters', () => {
            const f = fixtures.valid[0];
            const actual = fromRaw(f.raw);
            const byteLength = actual.byteLength();
            const target = Buffer.alloc(byteLength * 2);
            const a = actual.toBuffer(target, 0);
            const b = actual.toBuffer(target, byteLength);
            assert.strictEqual(a.length, byteLength);
            assert.strictEqual(b.length, byteLength);
            assert.strictEqual(a.toString('hex'), f.hex);
            assert.strictEqual(b.toString('hex'), f.hex);
            assert.deepStrictEqual(a, b);
            assert.deepStrictEqual(a, target.slice(0, byteLength));
            assert.deepStrictEqual(b, target.slice(byteLength));
        });
    });
    (0, mocha_1.describe)('hasWitnesses', () => {
        fixtures.valid.forEach(f => {
            (0, mocha_1.it)('detects if the transaction has witnesses: ' +
                (f.whex ? 'true' : 'false'), () => {
                assert.strictEqual(__1.Transaction.fromHex(f.whex ? f.whex : f.hex).hasWitnesses(), !!f.whex);
            });
        });
    });
    (0, mocha_1.describe)('weight/virtualSize', () => {
        (0, mocha_1.it)('computes virtual size', () => {
            fixtures.valid.forEach(f => {
                const transaction = __1.Transaction.fromHex(f.whex ? f.whex : f.hex);
                assert.strictEqual(transaction.virtualSize(), f.virtualSize);
            });
        });
        (0, mocha_1.it)('computes weight', () => {
            fixtures.valid.forEach(f => {
                const transaction = __1.Transaction.fromHex(f.whex ? f.whex : f.hex);
                assert.strictEqual(transaction.weight(), f.weight);
            });
        });
    });
    (0, mocha_1.describe)('addInput', () => {
        let prevTxHash;
        (0, mocha_1.beforeEach)(() => {
            prevTxHash = Buffer.from('ffffffff00ffff000000000000000000000000000000000000000000101010ff', 'hex');
        });
        (0, mocha_1.it)('returns an index', () => {
            const tx = new __1.Transaction();
            assert.strictEqual(tx.addInput(prevTxHash, 0), 0);
            assert.strictEqual(tx.addInput(prevTxHash, 0), 1);
        });
        (0, mocha_1.it)('defaults to empty script, witness and 0xffffffff SEQUENCE number', () => {
            const tx = new __1.Transaction();
            tx.addInput(prevTxHash, 0);
            assert.strictEqual(tx.ins[0].script.length, 0);
            assert.strictEqual(tx.ins[0].witness.length, 0);
            assert.strictEqual(tx.ins[0].sequence, 0xffffffff);
        });
        fixtures.invalid.addInput.forEach(f => {
            (0, mocha_1.it)('throws on ' + f.exception, () => {
                const tx = new __1.Transaction();
                const hash = Buffer.from(f.hash, 'hex');
                assert.throws(() => {
                    tx.addInput(hash, f.index);
                }, new RegExp(f.exception));
            });
        });
    });
    (0, mocha_1.describe)('addOutput', () => {
        (0, mocha_1.it)('returns an index', () => {
            const tx = new __1.Transaction();
            assert.strictEqual(tx.addOutput(Buffer.alloc(0), 0), 0);
            assert.strictEqual(tx.addOutput(Buffer.alloc(0), 0), 1);
        });
    });
    (0, mocha_1.describe)('clone', () => {
        fixtures.valid.forEach(f => {
            let actual;
            let expected;
            (0, mocha_1.beforeEach)(() => {
                expected = __1.Transaction.fromHex(f.hex);
                actual = expected.clone();
            });
            (0, mocha_1.it)('should have value equality', () => {
                assert.deepStrictEqual(actual, expected);
            });
            (0, mocha_1.it)('should not have reference equality', () => {
                assert.notStrictEqual(actual, expected);
            });
        });
    });
    (0, mocha_1.describe)('getHash/getId', () => {
        function verify(f) {
            (0, mocha_1.it)('should return the id for ' + f.id + '(' + f.description + ')', () => {
                const tx = __1.Transaction.fromHex(f.whex || f.hex);
                assert.strictEqual(tx.getHash().toString('hex'), f.hash);
                assert.strictEqual(tx.getId(), f.id);
            });
        }
        fixtures.valid.forEach(verify);
    });
    (0, mocha_1.describe)('isCoinbase', () => {
        function verify(f) {
            (0, mocha_1.it)('should return ' +
                f.coinbase +
                ' for ' +
                f.id +
                '(' +
                f.description +
                ')', () => {
                const tx = __1.Transaction.fromHex(f.hex);
                assert.strictEqual(tx.isCoinbase(), f.coinbase);
            });
        }
        fixtures.valid.forEach(verify);
    });
    (0, mocha_1.describe)('hashForSignature', () => {
        (0, mocha_1.it)('does not use Witness serialization', () => {
            const randScript = Buffer.from('6a', 'hex');
            const tx = new __1.Transaction();
            tx.addInput(Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex'), 0);
            tx.addOutput(randScript, 5000000000);
            const original = tx.__toBuffer;
            tx.__toBuffer = function (a, b, c) {
                if (c !== false)
                    throw new Error('hashForSignature MUST pass false');
                return original.call(this, a, b, c);
            };
            assert.throws(() => {
                tx.__toBuffer(undefined, undefined, true);
            }, /hashForSignature MUST pass false/);
            // assert hashForSignature does not pass false
            assert.doesNotThrow(() => {
                tx.hashForSignature(0, randScript, 1);
            });
        });
        fixtures.hashForSignature.forEach(f => {
            (0, mocha_1.it)('should return ' +
                f.hash +
                ' for ' +
                (f.description ? 'case "' + f.description + '"' : f.script), () => {
                const tx = __1.Transaction.fromHex(f.txHex);
                const script = bscript.fromASM(f.script);
                assert.strictEqual(tx
                    .hashForSignature(f.inIndex, script, f.type)
                    .toString('hex'), f.hash);
            });
        });
    });
    (0, mocha_1.describe)('hashForWitnessV0', () => {
        fixtures.hashForWitnessV0.forEach(f => {
            (0, mocha_1.it)('should return ' +
                f.hash +
                ' for ' +
                (f.description ? 'case "' + f.description + '"' : ''), () => {
                const tx = __1.Transaction.fromHex(f.txHex);
                const script = bscript.fromASM(f.script);
                assert.strictEqual(tx
                    .hashForWitnessV0(f.inIndex, script, f.value, f.type)
                    .toString('hex'), f.hash);
            });
        });
    });
    (0, mocha_1.describe)('taprootSigning', () => {
        fixtures.taprootSigning.forEach(f => {
            const tx = __1.Transaction.fromHex(f.txHex);
            const prevOutScripts = f.utxos.map(({ scriptHex }) => Buffer.from(scriptHex, 'hex'));
            const values = f.utxos.map(({ value }) => value);
            f.cases.forEach(c => {
                let hash;
                (0, mocha_1.it)(`should hash to ${c.hash} for ${f.description}:${c.vin}`, () => {
                    const hashType = Buffer.from(c.typeHex, 'hex').readUInt8(0);
                    hash = tx.hashForWitnessV1(c.vin, prevOutScripts, values, hashType);
                    assert.strictEqual(hash.toString('hex'), c.hash);
                });
            });
        });
    });
    (0, mocha_1.describe)('setWitness', () => {
        (0, mocha_1.it)('only accepts a witness stack (Array of Buffers)', () => {
            assert.throws(() => {
                new __1.Transaction().setWitness(0, 'foobar');
            }, /Expected property "1" of type \[Buffer], got String "foobar"/);
        });
    });
});
