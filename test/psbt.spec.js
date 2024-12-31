"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const bip32_1 = require("bip32");
const ecc = require("tiny-secp256k1");
const crypto = require("crypto");
const ecpair_1 = require("ecpair");
const mocha_1 = require("mocha");
const payments_utils_1 = require("./payments.utils");
const bip341_1 = require("../src/payments/bip341");
const bip371_1 = require("../src/psbt/bip371");
const src_1 = require("../src");
const __1 = require("..");
const preFixtures = require("./fixtures/psbt.json");
const taprootFixtures = require("./fixtures/p2tr.json");
const bip32 = (0, bip32_1.default)(ecc);
const ECPair = (0, ecpair_1.default)(ecc);
const validator = (pubkey, msghash, signature) => ECPair.fromPublicKey(pubkey).verify(msghash, signature);
const schnorrValidator = (pubkey, msghash, signature) => ecc.verifySchnorr(msghash, pubkey, signature);
const initBuffers = (object) => JSON.parse(JSON.stringify(object), (_, value) => {
    const regex = new RegExp(/^Buffer.from\(['"](.*)['"], ['"](.*)['"]\)$/);
    const result = regex.exec(value);
    if (!result)
        return value;
    const data = result[1];
    const encoding = result[2];
    return Buffer.from(data, encoding);
});
const fixtures = initBuffers(preFixtures);
const upperCaseFirstLetter = (str) => str.replace(/^./, s => s.toUpperCase());
const toAsyncSigner = (signer) => {
    return {
        publicKey: signer.publicKey,
        sign: (hash, lowerR) => {
            return new Promise((resolve, rejects) => {
                setTimeout(() => {
                    try {
                        const r = signer.sign(hash, lowerR);
                        resolve(r);
                    }
                    catch (e) {
                        rejects(e);
                    }
                }, 10);
            });
        },
    };
};
const failedAsyncSigner = (publicKey) => {
    return {
        publicKey,
        sign: (__) => {
            return new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error('sign failed'));
                }, 10);
            });
        },
    };
};
// const b = (hex: string) => Buffer.from(hex, 'hex');
(0, mocha_1.describe)(`Psbt`, () => {
    beforeEach(() => {
        // provide the ECC lib only when required
        (0, src_1.initEccLib)(undefined);
    });
    (0, mocha_1.describe)('BIP174 Test Vectors', () => {
        fixtures.bip174.invalid.forEach(f => {
            (0, mocha_1.it)(`Invalid: ${f.description}`, () => {
                assert.throws(() => {
                    __1.Psbt.fromBase64(f.psbt);
                }, new RegExp(f.errorMessage));
            });
        });
        fixtures.bip174.valid.forEach(f => {
            (0, mocha_1.it)(`Valid: ${f.description}`, () => {
                assert.doesNotThrow(() => {
                    __1.Psbt.fromBase64(f.psbt);
                });
            });
        });
        fixtures.bip174.failSignChecks.forEach(f => {
            const keyPair = ECPair.makeRandom();
            (0, mocha_1.it)(`Fails Signer checks: ${f.description}`, () => {
                const psbt = __1.Psbt.fromBase64(f.psbt);
                assert.throws(() => {
                    psbt.signInput(f.inputToCheck, keyPair);
                }, new RegExp(f.errorMessage));
            });
        });
        fixtures.bip174.creator.forEach(f => {
            (0, mocha_1.it)('Creates expected PSBT', () => {
                const psbt = new __1.Psbt();
                for (const input of f.inputs) {
                    psbt.addInput(input);
                }
                for (const output of f.outputs) {
                    const script = Buffer.from(output.script, 'hex');
                    psbt.addOutput({ ...output, script });
                }
                assert.strictEqual(psbt.toBase64(), f.result);
            });
        });
        fixtures.bip174.updater.forEach(f => {
            (0, mocha_1.it)('Updates PSBT to the expected result', () => {
                if (f.isTaproot)
                    (0, src_1.initEccLib)(ecc);
                const psbt = __1.Psbt.fromBase64(f.psbt);
                for (const inputOrOutput of ['input', 'output']) {
                    const fixtureData = f[`${inputOrOutput}Data`];
                    if (fixtureData) {
                        for (const [i, data] of fixtureData.entries()) {
                            const txt = upperCaseFirstLetter(inputOrOutput);
                            psbt[`update${txt}`](i, data);
                        }
                    }
                }
                assert.strictEqual(psbt.toBase64(), f.result);
            });
        });
        fixtures.bip174.signer.forEach(f => {
            (0, mocha_1.it)('Signs PSBT to the expected result', () => {
                if (f.isTaproot)
                    (0, src_1.initEccLib)(ecc);
                const psbt = __1.Psbt.fromBase64(f.psbt);
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore // cannot find tapLeafHashToSign
                f.keys.forEach(({ inputToSign, tapLeafHashToSign, WIF }) => {
                    const keyPair = ECPair.fromWIF(WIF, __1.networks.testnet);
                    if (tapLeafHashToSign)
                        psbt.signTaprootInput(inputToSign, keyPair, Buffer.from(tapLeafHashToSign, 'hex'));
                    else
                        psbt.signInput(inputToSign, keyPair);
                });
                assert.strictEqual(psbt.toBase64(), f.result);
            });
        });
        fixtures.bip174.combiner.forEach(f => {
            (0, mocha_1.it)('Combines two PSBTs to the expected result', () => {
                const psbts = f.psbts.map(psbt => __1.Psbt.fromBase64(psbt));
                psbts[0].combine(psbts[1]);
                // Produces a different Base64 string due to implemetation specific key-value ordering.
                // That means this test will fail:
                // assert.strictEqual(psbts[0].toBase64(), f.result)
                // However, if we compare the actual PSBT properties we can see they are logically identical:
                assert.deepStrictEqual(psbts[0], __1.Psbt.fromBase64(f.result));
            });
        });
        fixtures.bip174.finalizer.forEach(f => {
            (0, mocha_1.it)('Finalizes inputs and gives the expected PSBT', () => {
                if (f.isTaproot)
                    (0, src_1.initEccLib)(ecc);
                const psbt = __1.Psbt.fromBase64(f.psbt);
                psbt.finalizeAllInputs();
                assert.strictEqual(psbt.toBase64(), f.result);
            });
        });
        fixtures.bip174.extractor.forEach(f => {
            (0, mocha_1.it)('Extracts the expected transaction from a PSBT', () => {
                const psbt1 = __1.Psbt.fromBase64(f.psbt);
                const transaction1 = psbt1.extractTransaction(true).toHex();
                const psbt2 = __1.Psbt.fromBase64(f.psbt);
                const transaction2 = psbt2.extractTransaction().toHex();
                assert.strictEqual(transaction1, transaction2);
                assert.strictEqual(transaction1, f.transaction);
                const psbt3 = __1.Psbt.fromBase64(f.psbt);
                delete psbt3.data.inputs[0].finalScriptSig;
                delete psbt3.data.inputs[0].finalScriptWitness;
                assert.throws(() => {
                    psbt3.extractTransaction();
                }, new RegExp('Not finalized'));
                const psbt4 = __1.Psbt.fromBase64(f.psbt);
                psbt4.setMaximumFeeRate(1);
                assert.throws(() => {
                    psbt4.extractTransaction();
                }, new RegExp('Warning: You are paying around [\\d.]+ in fees'));
                const psbt5 = __1.Psbt.fromBase64(f.psbt);
                psbt5.extractTransaction(true);
                const fr1 = psbt5.getFeeRate();
                const fr2 = psbt5.getFeeRate();
                assert.strictEqual(fr1, fr2);
                const psbt6 = __1.Psbt.fromBase64(f.psbt);
                const f1 = psbt6.getFee();
                const f2 = psbt6.getFee();
                assert.strictEqual(f1, f2);
            });
        });
    });
    (0, mocha_1.describe)('signInputAsync', () => {
        fixtures.signInput.checks.forEach(f => {
            (0, mocha_1.it)(f.description, async () => {
                if (f.isTaproot)
                    (0, src_1.initEccLib)(ecc);
                if (f.shouldSign) {
                    const psbtThatShouldsign = __1.Psbt.fromBase64(f.shouldSign.psbt);
                    await assert.doesNotReject(async () => {
                        await psbtThatShouldsign.signInputAsync(f.shouldSign.inputToCheck, ECPair.fromWIF(f.shouldSign.WIF), f.shouldSign.sighashTypes || undefined);
                        if (f.shouldSign.result) {
                            assert.strictEqual(psbtThatShouldsign.toBase64(), f.shouldSign.result);
                        }
                    });
                    const failMessage = f.isTaproot
                        ? /Need Schnorr Signer to sign taproot input #0./
                        : /sign failed/;
                    await assert.rejects(async () => {
                        await psbtThatShouldsign.signInputAsync(f.shouldSign.inputToCheck, failedAsyncSigner(ECPair.fromWIF(f.shouldSign.WIF).publicKey), f.shouldSign.sighashTypes || undefined);
                    }, failMessage);
                }
                if (f.shouldThrow) {
                    const psbtThatShouldThrow = __1.Psbt.fromBase64(f.shouldThrow.psbt);
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signInputAsync(f.shouldThrow.inputToCheck, ECPair.fromWIF(f.shouldThrow.WIF), f.shouldThrow.sighashTypes || undefined);
                    }, new RegExp(f.shouldThrow.errorMessage));
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signInputAsync(f.shouldThrow.inputToCheck, toAsyncSigner(ECPair.fromWIF(f.shouldThrow.WIF)), f.shouldThrow.sighashTypes || undefined);
                    }, new RegExp(f.shouldThrow.errorMessage));
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signInputAsync(f.shouldThrow.inputToCheck);
                    }, new RegExp('Need Signer to sign input'));
                }
            });
        });
    });
    (0, mocha_1.describe)('signInput', () => {
        fixtures.signInput.checks.forEach(f => {
            (0, mocha_1.it)(f.description, () => {
                if (f.isTaproot)
                    (0, src_1.initEccLib)(ecc);
                if (f.shouldSign) {
                    const psbtThatShouldsign = __1.Psbt.fromBase64(f.shouldSign.psbt);
                    assert.doesNotThrow(() => {
                        psbtThatShouldsign.signInput(f.shouldSign.inputToCheck, ECPair.fromWIF(f.shouldSign.WIF), f.shouldSign.sighashTypes || undefined);
                    });
                }
                if (f.shouldThrow) {
                    const psbtThatShouldThrow = __1.Psbt.fromBase64(f.shouldThrow.psbt);
                    assert.throws(() => {
                        psbtThatShouldThrow.signInput(f.shouldThrow.inputToCheck, ECPair.fromWIF(f.shouldThrow.WIF), f.shouldThrow.sighashTypes || undefined);
                    }, new RegExp(f.shouldThrow.errorMessage));
                    assert.throws(() => {
                        psbtThatShouldThrow.signInput(f.shouldThrow.inputToCheck);
                    }, new RegExp('Need Signer to sign input'));
                }
            });
        });
    });
    (0, mocha_1.describe)('signAllInputsAsync', () => {
        fixtures.signInput.checks.forEach(f => {
            if (f.description === 'checks the input exists')
                return;
            (0, mocha_1.it)(f.description, async () => {
                if (f.isTaproot)
                    (0, src_1.initEccLib)(ecc);
                if (f.shouldSign) {
                    const psbtThatShouldsign = __1.Psbt.fromBase64(f.shouldSign.psbt);
                    await assert.doesNotReject(async () => {
                        await psbtThatShouldsign.signAllInputsAsync(ECPair.fromWIF(f.shouldSign.WIF), f.shouldSign.sighashTypes || undefined);
                    });
                }
                if (f.shouldThrow) {
                    const psbtThatShouldThrow = __1.Psbt.fromBase64(f.shouldThrow.psbt);
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signAllInputsAsync(ECPair.fromWIF(f.shouldThrow.WIF), f.shouldThrow.sighashTypes || undefined);
                    }, new RegExp('No inputs were signed'));
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signAllInputsAsync();
                    }, new RegExp('Need Signer to sign input'));
                }
            });
        });
    });
    (0, mocha_1.describe)('signAllInputs', () => {
        fixtures.signInput.checks.forEach(f => {
            if (f.description === 'checks the input exists')
                return;
            (0, mocha_1.it)(f.description, () => {
                if (f.isTaproot)
                    (0, src_1.initEccLib)(ecc);
                if (f.shouldSign) {
                    const psbtThatShouldsign = __1.Psbt.fromBase64(f.shouldSign.psbt);
                    assert.doesNotThrow(() => {
                        psbtThatShouldsign.signAllInputs(ECPair.fromWIF(f.shouldSign.WIF), f.shouldSign.sighashTypes || undefined);
                    });
                }
                if (f.shouldThrow) {
                    const psbtThatShouldThrow = __1.Psbt.fromBase64(f.shouldThrow.psbt);
                    assert.throws(() => {
                        psbtThatShouldThrow.signAllInputs(ECPair.fromWIF(f.shouldThrow.WIF), f.shouldThrow.sighashTypes || undefined);
                    }, new RegExp('No inputs were signed'));
                    assert.throws(() => {
                        psbtThatShouldThrow.signAllInputs();
                    }, new RegExp('Need Signer to sign input'));
                }
            });
        });
    });
    (0, mocha_1.describe)('signInputHDAsync', () => {
        fixtures.signInputHD.checks.forEach(f => {
            (0, mocha_1.it)(f.description, async () => {
                if (f.shouldSign) {
                    const psbtThatShouldsign = __1.Psbt.fromBase64(f.shouldSign.psbt);
                    await assert.doesNotReject(async () => {
                        await psbtThatShouldsign.signInputHDAsync(f.shouldSign.inputToCheck, bip32.fromBase58(f.shouldSign.xprv), f.shouldSign.sighashTypes || undefined);
                    });
                }
                if (f.shouldThrow) {
                    const psbtThatShouldThrow = __1.Psbt.fromBase64(f.shouldThrow.psbt);
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signInputHDAsync(f.shouldThrow.inputToCheck, bip32.fromBase58(f.shouldThrow.xprv), f.shouldThrow.sighashTypes || undefined);
                    }, new RegExp(f.shouldThrow.errorMessage));
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signInputHDAsync(f.shouldThrow.inputToCheck);
                    }, new RegExp('Need HDSigner to sign input'));
                }
            });
        });
    });
    (0, mocha_1.describe)('signInputHD', () => {
        fixtures.signInputHD.checks.forEach(f => {
            (0, mocha_1.it)(f.description, () => {
                if (f.shouldSign) {
                    const psbtThatShouldsign = __1.Psbt.fromBase64(f.shouldSign.psbt);
                    assert.doesNotThrow(() => {
                        psbtThatShouldsign.signInputHD(f.shouldSign.inputToCheck, bip32.fromBase58(f.shouldSign.xprv), f.shouldSign.sighashTypes || undefined);
                    });
                }
                if (f.shouldThrow) {
                    const psbtThatShouldThrow = __1.Psbt.fromBase64(f.shouldThrow.psbt);
                    assert.throws(() => {
                        psbtThatShouldThrow.signInputHD(f.shouldThrow.inputToCheck, bip32.fromBase58(f.shouldThrow.xprv), f.shouldThrow.sighashTypes || undefined);
                    }, new RegExp(f.shouldThrow.errorMessage));
                    assert.throws(() => {
                        psbtThatShouldThrow.signInputHD(f.shouldThrow.inputToCheck);
                    }, new RegExp('Need HDSigner to sign input'));
                }
            });
        });
    });
    (0, mocha_1.describe)('signAllInputsHDAsync', () => {
        fixtures.signInputHD.checks.forEach(f => {
            (0, mocha_1.it)(f.description, async () => {
                if (f.shouldSign) {
                    const psbtThatShouldsign = __1.Psbt.fromBase64(f.shouldSign.psbt);
                    await assert.doesNotReject(async () => {
                        await psbtThatShouldsign.signAllInputsHDAsync(bip32.fromBase58(f.shouldSign.xprv), f.shouldSign.sighashTypes || undefined);
                    });
                }
                if (f.shouldThrow) {
                    const psbtThatShouldThrow = __1.Psbt.fromBase64(f.shouldThrow.psbt);
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signAllInputsHDAsync(bip32.fromBase58(f.shouldThrow.xprv), f.shouldThrow.sighashTypes || undefined);
                    }, new RegExp('No inputs were signed'));
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signAllInputsHDAsync();
                    }, new RegExp('Need HDSigner to sign input'));
                }
            });
        });
    });
    (0, mocha_1.describe)('signAllInputsHD', () => {
        fixtures.signInputHD.checks.forEach(f => {
            (0, mocha_1.it)(f.description, () => {
                if (f.shouldSign) {
                    const psbtThatShouldsign = __1.Psbt.fromBase64(f.shouldSign.psbt);
                    assert.doesNotThrow(() => {
                        psbtThatShouldsign.signAllInputsHD(bip32.fromBase58(f.shouldSign.xprv), f.shouldSign.sighashTypes || undefined);
                    });
                }
                if (f.shouldThrow) {
                    const psbtThatShouldThrow = __1.Psbt.fromBase64(f.shouldThrow.psbt);
                    assert.throws(() => {
                        psbtThatShouldThrow.signAllInputsHD(bip32.fromBase58(f.shouldThrow.xprv), f.shouldThrow.sighashTypes || undefined);
                    }, new RegExp('No inputs were signed'));
                    assert.throws(() => {
                        psbtThatShouldThrow.signAllInputsHD();
                    }, new RegExp('Need HDSigner to sign input'));
                }
            });
        });
    });
    (0, mocha_1.describe)('finalizeInput', () => {
        (0, mocha_1.it)(`Finalizes tapleaf by hash`, () => {
            const f = fixtures.finalizeInput.finalizeTapleafByHash;
            const psbt = __1.Psbt.fromBase64(f.psbt);
            psbt.finalizeTaprootInput(f.index, Buffer.from(f.leafHash, 'hex'));
            assert.strictEqual(psbt.toBase64(), f.result);
        });
        (0, mocha_1.it)(`fails if tapleaf hash not found`, () => {
            const f = fixtures.finalizeInput.finalizeTapleafByHash;
            const psbt = __1.Psbt.fromBase64(f.psbt);
            assert.throws(() => {
                psbt.finalizeTaprootInput(f.index, Buffer.from(f.leafHash, 'hex').reverse());
            }, new RegExp('Can not finalize taproot input #0. Signature for tapleaf script not found.'));
        });
        (0, mocha_1.it)(`fails if trying to finalzie non-taproot input`, () => {
            const psbt = new __1.Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            });
            assert.throws(() => {
                psbt.finalizeTaprootInput(0);
            }, new RegExp('Cannot finalize input #0. Not Taproot.'));
        });
    });
    (0, mocha_1.describe)('finalizeAllInputs', () => {
        fixtures.finalizeAllInputs.forEach(f => {
            (0, mocha_1.it)(`Finalizes inputs of type "${f.type}"`, () => {
                const psbt = __1.Psbt.fromBase64(f.psbt);
                psbt.finalizeAllInputs();
                assert.strictEqual(psbt.toBase64(), f.result);
            });
        });
        (0, mocha_1.it)('fails if no script found', () => {
            const psbt = new __1.Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            });
            assert.throws(() => {
                psbt.finalizeAllInputs();
            }, new RegExp('No script found for input #0'));
            psbt.updateInput(0, {
                witnessUtxo: {
                    script: Buffer.from('0014d85c2b71d0060b09c9886aeb815e50991dda124d', 'hex'),
                    value: 2e5,
                },
            });
            assert.throws(() => {
                psbt.finalizeAllInputs();
            }, new RegExp('Can not finalize input #0'));
        });
    });
    (0, mocha_1.describe)('addInput', () => {
        fixtures.addInput.checks.forEach(f => {
            (0, mocha_1.it)(f.description, () => {
                const psbt = new __1.Psbt();
                if (f.exception) {
                    assert.throws(() => {
                        psbt.addInput(f.inputData);
                    }, new RegExp(f.exception));
                    assert.throws(() => {
                        psbt.addInputs([f.inputData]);
                    }, new RegExp(f.exception));
                }
                else {
                    assert.doesNotThrow(() => {
                        psbt.addInputs([f.inputData]);
                        if (f.equals) {
                            assert.strictEqual(psbt.toBase64(), f.equals);
                        }
                    });
                    assert.throws(() => {
                        psbt.addInput(f.inputData);
                    }, new RegExp('Duplicate input detected.'));
                }
            });
        });
    });
    (0, mocha_1.describe)('updateInput', () => {
        fixtures.updateInput.checks.forEach(f => {
            (0, mocha_1.it)(f.description, () => {
                const psbt = __1.Psbt.fromBase64(f.psbt);
                if (f.exception) {
                    assert.throws(() => {
                        psbt.updateInput(f.index, f.inputData);
                    }, new RegExp(f.exception));
                }
            });
        });
    });
    (0, mocha_1.describe)('addOutput', () => {
        fixtures.addOutput.checks.forEach(f => {
            (0, mocha_1.it)(f.description, () => {
                if (f.isTaproot)
                    (0, src_1.initEccLib)(ecc);
                const psbt = f.psbt ? __1.Psbt.fromBase64(f.psbt) : new __1.Psbt();
                if (f.exception) {
                    assert.throws(() => {
                        psbt.addOutput(f.outputData);
                    }, new RegExp(f.exception));
                    assert.throws(() => {
                        psbt.addOutputs([f.outputData]);
                    }, new RegExp(f.exception));
                }
                else {
                    assert.doesNotThrow(() => {
                        psbt.addOutput(f.outputData);
                    });
                    if (f.result) {
                        assert.strictEqual(psbt.toBase64(), f.result);
                    }
                    assert.doesNotThrow(() => {
                        psbt.addOutputs([f.outputData]);
                    });
                }
            });
        });
    });
    (0, mocha_1.describe)('setVersion', () => {
        (0, mocha_1.it)('Sets the version value of the unsigned transaction', () => {
            const psbt = new __1.Psbt();
            assert.strictEqual(psbt.extractTransaction().version, 2);
            psbt.setVersion(1);
            assert.strictEqual(psbt.extractTransaction().version, 1);
        });
    });
    (0, mocha_1.describe)('setLocktime', () => {
        (0, mocha_1.it)('Sets the nLockTime value of the unsigned transaction', () => {
            const psbt = new __1.Psbt();
            assert.strictEqual(psbt.extractTransaction().locktime, 0);
            psbt.setLocktime(1);
            assert.strictEqual(psbt.extractTransaction().locktime, 1);
        });
    });
    (0, mocha_1.describe)('setInputSequence', () => {
        (0, mocha_1.it)('Sets the sequence number for a given input', () => {
            const psbt = new __1.Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            });
            assert.strictEqual(psbt.inputCount, 1);
            assert.strictEqual(psbt.txInputs[0].sequence, 0xffffffff);
            psbt.setInputSequence(0, 0);
            assert.strictEqual(psbt.txInputs[0].sequence, 0);
        });
        (0, mocha_1.it)('throws if input index is too high', () => {
            const psbt = new __1.Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            });
            assert.throws(() => {
                psbt.setInputSequence(1, 0);
            }, new RegExp('Input index too high'));
        });
    });
    (0, mocha_1.describe)('getInputType', () => {
        const key = ECPair.makeRandom();
        const { publicKey } = key;
        const p2wpkhPub = (pubkey) => __1.payments.p2wpkh({
            pubkey,
        }).output;
        const p2pkhPub = (pubkey) => __1.payments.p2pkh({
            pubkey,
        }).output;
        const p2shOut = (output) => __1.payments.p2sh({
            redeem: { output },
        }).output;
        const p2wshOut = (output) => __1.payments.p2wsh({
            redeem: { output },
        }).output;
        const p2shp2wshOut = (output) => p2shOut(p2wshOut(output));
        const noOuter = (output) => output;
        function getInputTypeTest({ innerScript, outerScript, redeemGetter, witnessGetter, expectedType, finalize, }) {
            const psbt = new __1.Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
                witnessUtxo: {
                    script: outerScript(innerScript(publicKey)),
                    value: 2e3,
                },
                ...(redeemGetter
                    ? { redeemScript: redeemGetter(publicKey) }
                    : {}),
                ...(witnessGetter
                    ? { witnessScript: witnessGetter(publicKey) }
                    : {}),
            }).addOutput({
                script: Buffer.from('0014d85c2b71d0060b09c9886aeb815e50991dda124d'),
                value: 1800,
            });
            if (finalize)
                psbt.signInput(0, key).finalizeInput(0);
            const type = psbt.getInputType(0);
            assert.strictEqual(type, expectedType, 'incorrect input type');
        }
        [
            {
                innerScript: p2pkhPub,
                outerScript: noOuter,
                redeemGetter: null,
                witnessGetter: null,
                expectedType: 'pubkeyhash',
            },
            {
                innerScript: p2wpkhPub,
                outerScript: noOuter,
                redeemGetter: null,
                witnessGetter: null,
                expectedType: 'witnesspubkeyhash',
            },
            {
                innerScript: p2pkhPub,
                outerScript: p2shOut,
                redeemGetter: p2pkhPub,
                witnessGetter: null,
                expectedType: 'p2sh-pubkeyhash',
            },
            {
                innerScript: p2wpkhPub,
                outerScript: p2shOut,
                redeemGetter: p2wpkhPub,
                witnessGetter: null,
                expectedType: 'p2sh-witnesspubkeyhash',
                finalize: true,
            },
            {
                innerScript: p2pkhPub,
                outerScript: p2wshOut,
                redeemGetter: null,
                witnessGetter: p2pkhPub,
                expectedType: 'p2wsh-pubkeyhash',
                finalize: true,
            },
            {
                innerScript: p2pkhPub,
                outerScript: p2shp2wshOut,
                redeemGetter: (pk) => p2wshOut(p2pkhPub(pk)),
                witnessGetter: p2pkhPub,
                expectedType: 'p2sh-p2wsh-pubkeyhash',
            },
        ].forEach(getInputTypeTest);
    });
    (0, mocha_1.describe)('inputHasHDKey', () => {
        (0, mocha_1.it)('should return true if HD key is present', () => {
            const root = bip32.fromSeed(crypto.randomBytes(32));
            const root2 = bip32.fromSeed(crypto.randomBytes(32));
            const path = "m/0'/0";
            const psbt = new __1.Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
                bip32Derivation: [
                    {
                        masterFingerprint: root.fingerprint,
                        path,
                        pubkey: root.derivePath(path).publicKey,
                    },
                ],
            });
            assert.strictEqual(psbt.inputHasHDKey(0, root), true);
            assert.strictEqual(psbt.inputHasHDKey(0, root2), false);
        });
    });
    (0, mocha_1.describe)('inputHasPubkey', () => {
        (0, mocha_1.it)('should throw', () => {
            const psbt = new __1.Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            });
            assert.throws(() => {
                psbt.inputHasPubkey(0, Buffer.from([]));
            }, new RegExp("Can't find pubkey in input without Utxo data"));
            psbt.updateInput(0, {
                witnessUtxo: {
                    value: 1337,
                    script: __1.payments.p2sh({
                        redeem: { output: Buffer.from([0x51]) },
                    }).output,
                },
            });
            assert.throws(() => {
                psbt.inputHasPubkey(0, Buffer.from([]));
            }, new RegExp('scriptPubkey is P2SH but redeemScript missing'));
            delete psbt.data.inputs[0].witnessUtxo;
            psbt.updateInput(0, {
                witnessUtxo: {
                    value: 1337,
                    script: __1.payments.p2wsh({
                        redeem: { output: Buffer.from([0x51]) },
                    }).output,
                },
            });
            assert.throws(() => {
                psbt.inputHasPubkey(0, Buffer.from([]));
            }, new RegExp('scriptPubkey or redeemScript is P2WSH but witnessScript missing'));
            delete psbt.data.inputs[0].witnessUtxo;
            psbt.updateInput(0, {
                witnessUtxo: {
                    value: 1337,
                    script: __1.payments.p2sh({
                        redeem: __1.payments.p2wsh({
                            redeem: { output: Buffer.from([0x51]) },
                        }),
                    }).output,
                },
                redeemScript: __1.payments.p2wsh({
                    redeem: { output: Buffer.from([0x51]) },
                }).output,
            });
            assert.throws(() => {
                psbt.inputHasPubkey(0, Buffer.from([]));
            }, new RegExp('scriptPubkey or redeemScript is P2WSH but witnessScript missing'));
            psbt.updateInput(0, {
                witnessScript: Buffer.from([0x51]),
            });
            assert.doesNotThrow(() => {
                psbt.inputHasPubkey(0, Buffer.from([0x51]));
            });
        });
    });
    (0, mocha_1.describe)('outputHasHDKey', () => {
        (0, mocha_1.it)('should return true if HD key is present', () => {
            const root = bip32.fromSeed(crypto.randomBytes(32));
            const root2 = bip32.fromSeed(crypto.randomBytes(32));
            const path = "m/0'/0";
            const psbt = new __1.Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            }).addOutput({
                script: Buffer.from('0014000102030405060708090a0b0c0d0e0f00010203', 'hex'),
                value: 2000,
                bip32Derivation: [
                    {
                        masterFingerprint: root.fingerprint,
                        path,
                        pubkey: root.derivePath(path).publicKey,
                    },
                ],
            });
            assert.strictEqual(psbt.outputHasHDKey(0, root), true);
            assert.strictEqual(psbt.outputHasHDKey(0, root2), false);
        });
    });
    (0, mocha_1.describe)('outputHasPubkey', () => {
        (0, mocha_1.it)('should throw', () => {
            const psbt = new __1.Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            }).addOutput({
                script: __1.payments.p2sh({
                    redeem: { output: Buffer.from([0x51]) },
                }).output,
                value: 1337,
            });
            assert.throws(() => {
                psbt.outputHasPubkey(0, Buffer.from([]));
            }, new RegExp('scriptPubkey is P2SH but redeemScript missing'));
            psbt.__CACHE.__TX.outs[0].script = __1.payments.p2wsh({
                redeem: { output: Buffer.from([0x51]) },
            }).output;
            assert.throws(() => {
                psbt.outputHasPubkey(0, Buffer.from([]));
            }, new RegExp('scriptPubkey or redeemScript is P2WSH but witnessScript missing'));
            psbt.__CACHE.__TX.outs[0].script = __1.payments.p2sh({
                redeem: __1.payments.p2wsh({
                    redeem: { output: Buffer.from([0x51]) },
                }),
            }).output;
            psbt.updateOutput(0, {
                redeemScript: __1.payments.p2wsh({
                    redeem: { output: Buffer.from([0x51]) },
                }).output,
            });
            assert.throws(() => {
                psbt.outputHasPubkey(0, Buffer.from([]));
            }, new RegExp('scriptPubkey or redeemScript is P2WSH but witnessScript missing'));
            delete psbt.data.outputs[0].redeemScript;
            psbt.updateOutput(0, {
                witnessScript: Buffer.from([0x51]),
            });
            assert.throws(() => {
                psbt.outputHasPubkey(0, Buffer.from([]));
            }, new RegExp('scriptPubkey is P2SH but redeemScript missing'));
            psbt.updateOutput(0, {
                redeemScript: __1.payments.p2wsh({
                    redeem: { output: Buffer.from([0x51]) },
                }).output,
            });
            assert.doesNotThrow(() => {
                psbt.outputHasPubkey(0, Buffer.from([0x51]));
            });
        });
    });
    (0, mocha_1.describe)('clone', () => {
        (0, mocha_1.it)('Should clone a psbt exactly with no reference', () => {
            const f = fixtures.clone;
            const psbt = __1.Psbt.fromBase64(f.psbt);
            const notAClone = Object.assign(new __1.Psbt(), psbt); // references still active
            const clone = psbt.clone();
            assert.strictEqual(psbt.validateSignaturesOfAllInputs(validator), true);
            assert.strictEqual(clone.toBase64(), psbt.toBase64());
            assert.strictEqual(clone.toBase64(), notAClone.toBase64());
            assert.strictEqual(psbt.toBase64(), notAClone.toBase64());
            psbt.__CACHE.__TX.version |= 0xff0000;
            assert.notStrictEqual(clone.toBase64(), psbt.toBase64());
            assert.notStrictEqual(clone.toBase64(), notAClone.toBase64());
            assert.strictEqual(psbt.toBase64(), notAClone.toBase64());
        });
    });
    (0, mocha_1.describe)('setMaximumFeeRate', () => {
        (0, mocha_1.it)('Sets the maximumFeeRate value', () => {
            const psbt = new __1.Psbt();
            assert.strictEqual(psbt.opts.maximumFeeRate, 5000);
            psbt.setMaximumFeeRate(6000);
            assert.strictEqual(psbt.opts.maximumFeeRate, 6000);
        });
    });
    (0, mocha_1.describe)('validateSignaturesOfInput', () => {
        const f = fixtures.validateSignaturesOfInput;
        (0, mocha_1.it)('Correctly validates a signature', () => {
            const psbt = __1.Psbt.fromBase64(f.psbt);
            assert.strictEqual(psbt.validateSignaturesOfInput(f.index, validator), true);
            assert.throws(() => {
                psbt.validateSignaturesOfInput(f.nonExistantIndex, validator);
            }, new RegExp('No signatures to validate'));
        });
        (0, mocha_1.it)('Correctly validates a signature against a pubkey', () => {
            const psbt = __1.Psbt.fromBase64(f.psbt);
            assert.strictEqual(psbt.validateSignaturesOfInput(f.index, validator, f.pubkey), true);
            assert.throws(() => {
                psbt.validateSignaturesOfInput(f.index, validator, f.incorrectPubkey);
            }, new RegExp('No signatures for this pubkey'));
        });
    });
    (0, mocha_1.describe)('validateSignaturesOfTapKeyInput', () => {
        const f = fixtures.validateSignaturesOfTapKeyInput;
        (0, mocha_1.it)('Correctly validates all signatures', () => {
            (0, src_1.initEccLib)(ecc);
            const psbt = __1.Psbt.fromBase64(f.psbt);
            assert.strictEqual(psbt.validateSignaturesOfInput(f.index, schnorrValidator), true);
        });
        (0, mocha_1.it)('Correctly validates a signature against a pubkey', () => {
            (0, src_1.initEccLib)(ecc);
            const psbt = __1.Psbt.fromBase64(f.psbt);
            assert.strictEqual(psbt.validateSignaturesOfInput(f.index, schnorrValidator, f.pubkey), true);
            assert.throws(() => {
                psbt.validateSignaturesOfInput(f.index, schnorrValidator, f.incorrectPubkey);
            }, new RegExp('No signatures for this pubkey'));
        });
    });
    (0, mocha_1.describe)('validateSignaturesOfTapScriptInput', () => {
        const f = fixtures.validateSignaturesOfTapScriptInput;
        (0, mocha_1.it)('Correctly validates all signatures', () => {
            (0, src_1.initEccLib)(ecc);
            const psbt = __1.Psbt.fromBase64(f.psbt);
            assert.strictEqual(psbt.validateSignaturesOfInput(f.index, schnorrValidator), true);
        });
        (0, mocha_1.it)('Correctly validates a signature against a pubkey', () => {
            (0, src_1.initEccLib)(ecc);
            const psbt = __1.Psbt.fromBase64(f.psbt);
            assert.strictEqual(psbt.validateSignaturesOfInput(f.index, schnorrValidator, f.pubkey), true);
            assert.throws(() => {
                psbt.validateSignaturesOfInput(f.index, schnorrValidator, f.incorrectPubkey);
            }, new RegExp('No signatures for this pubkey'));
        });
    });
    (0, mocha_1.describe)('tapTreeToList/tapTreeFromList', () => {
        (0, mocha_1.it)('Correctly converts a Taptree to a Tapleaf list and back', () => {
            taprootFixtures.valid
                .filter(f => f.arguments.scriptTree)
                .map(f => f.arguments.scriptTree)
                .forEach(scriptTree => {
                const originalTree = (0, payments_utils_1.convertScriptTree)(scriptTree, bip341_1.LEAF_VERSION_TAPSCRIPT);
                const list = (0, bip371_1.tapTreeToList)(originalTree);
                const treeFromList = (0, bip371_1.tapTreeFromList)(list);
                assert.deepStrictEqual(treeFromList, originalTree);
            });
        });
        (0, mocha_1.it)('Throws if too many leaves on a given level', () => {
            const list = Array.from({ length: 5 }).map(() => ({
                depth: 2,
                leafVersion: bip341_1.LEAF_VERSION_TAPSCRIPT,
                script: Buffer.from([]),
            }));
            assert.throws(() => {
                (0, bip371_1.tapTreeFromList)(list);
            }, new RegExp('No room left to insert tapleaf in tree'));
        });
        (0, mocha_1.it)('Throws if taptree depth is exceeded', () => {
            let tree = [
                { output: Buffer.from([]) },
                { output: Buffer.from([]) },
            ];
            Array.from({ length: 129 }).forEach(() => (tree = [tree, { output: Buffer.from([]) }]));
            assert.throws(() => {
                (0, bip371_1.tapTreeToList)(tree);
            }, new RegExp('Max taptree depth exceeded.'));
        });
        (0, mocha_1.it)('Throws if tapleaf depth is to high', () => {
            const list = [
                {
                    depth: 129,
                    leafVersion: bip341_1.LEAF_VERSION_TAPSCRIPT,
                    script: Buffer.from([]),
                },
            ];
            assert.throws(() => {
                (0, bip371_1.tapTreeFromList)(list);
            }, new RegExp('Max taptree depth exceeded.'));
        });
        (0, mocha_1.it)('Throws if not a valid taptree structure', () => {
            const tree = Array.from({ length: 3 }).map(() => ({
                output: Buffer.from([]),
            }));
            assert.throws(() => {
                (0, bip371_1.tapTreeToList)(tree);
            }, new RegExp('Cannot convert taptree to tapleaf list. Expecting a tapree structure.'));
        });
    });
    (0, mocha_1.describe)('getFeeRate', () => {
        (0, mocha_1.it)('Throws error if called before inputs are finalized', () => {
            const f = fixtures.getFeeRate;
            const psbt = __1.Psbt.fromBase64(f.psbt);
            assert.throws(() => {
                psbt.getFeeRate();
            }, new RegExp('PSBT must be finalized to calculate fee rate'));
            psbt.finalizeAllInputs();
            assert.strictEqual(psbt.getFeeRate(), f.fee);
            psbt.__CACHE.__FEE_RATE = undefined;
            assert.strictEqual(psbt.getFeeRate(), f.fee);
        });
    });
    (0, mocha_1.describe)('create 1-to-1 transaction', () => {
        const alice = ECPair.fromWIF('L2uPYXe17xSTqbCjZvL2DsyXPCbXspvcu5mHLDYUgzdUbZGSKrSr');
        const psbt = new __1.Psbt();
        psbt.addInput({
            hash: '7d067b4a697a09d2c3cff7d4d9506c9955e93bff41bf82d439da7d030382bc3e',
            index: 0,
            nonWitnessUtxo: Buffer.from('0200000001f9f34e95b9d5c8abcd20fc5bd4a825d1517be62f0f775e5f36da944d9' +
                '452e550000000006b483045022100c86e9a111afc90f64b4904bd609e9eaed80d48' +
                'ca17c162b1aca0a788ac3526f002207bb79b60d4fc6526329bf18a77135dc566020' +
                '9e761da46e1c2f1152ec013215801210211755115eabf846720f5cb18f248666fec' +
                '631e5e1e66009ce3710ceea5b1ad13ffffffff01905f0100000000001976a9148bb' +
                'c95d2709c71607c60ee3f097c1217482f518d88ac00000000', 'hex'),
            sighashType: 1,
        });
        psbt.addOutput({
            address: '1KRMKfeZcmosxALVYESdPNez1AP1mEtywp',
            value: 80000,
        });
        psbt.signInput(0, alice);
        assert.throws(() => {
            psbt.setVersion(3);
        }, new RegExp('Can not modify transaction, signatures exist.'));
        psbt.validateSignaturesOfInput(0, validator);
        psbt.finalizeAllInputs();
        assert.throws(() => {
            psbt.setVersion(3);
        }, new RegExp('Can not modify transaction, signatures exist.'));
        assert.strictEqual(psbt.inputHasPubkey(0, alice.publicKey), true);
        assert.strictEqual(psbt.outputHasPubkey(0, alice.publicKey), false);
        assert.strictEqual(psbt.extractTransaction().toHex(), '02000000013ebc8203037dda39d482bf41ff3be955996c50d9d4f7cfc3d2097a694a7' +
            'b067d000000006b483045022100931b6db94aed25d5486884d83fc37160f37f3368c0' +
            'd7f48c757112abefec983802205fda64cff98c849577026eb2ce916a50ea70626a766' +
            '9f8596dd89b720a26b4d501210365db9da3f8a260078a7e8f8b708a1161468fb2323f' +
            'fda5ec16b261ec1056f455ffffffff0180380100000000001976a914ca0d36044e0dc' +
            '08a22724efa6f6a07b0ec4c79aa88ac00000000');
    });
    (0, mocha_1.describe)('Method return types', () => {
        (0, mocha_1.it)('fromBuffer returns Psbt type (not base class)', () => {
            const psbt = __1.Psbt.fromBuffer(Buffer.from('70736274ff01000a01000000000000000000000000', 'hex'));
            assert.strictEqual(psbt instanceof __1.Psbt, true);
            assert.ok(psbt.__CACHE.__TX);
        });
        (0, mocha_1.it)('fromBase64 returns Psbt type (not base class)', () => {
            const psbt = __1.Psbt.fromBase64('cHNidP8BAAoBAAAAAAAAAAAAAAAA');
            assert.strictEqual(psbt instanceof __1.Psbt, true);
            assert.ok(psbt.__CACHE.__TX);
        });
        (0, mocha_1.it)('fromHex returns Psbt type (not base class)', () => {
            const psbt = __1.Psbt.fromHex('70736274ff01000a01000000000000000000000000');
            assert.strictEqual(psbt instanceof __1.Psbt, true);
            assert.ok(psbt.__CACHE.__TX);
        });
    });
    (0, mocha_1.describe)('Cache', () => {
        (0, mocha_1.it)('non-witness UTXOs are cached', () => {
            const f = fixtures.cache.nonWitnessUtxo;
            const psbt = __1.Psbt.fromBase64(f.psbt);
            const index = f.inputIndex;
            // Cache is empty
            assert.strictEqual(psbt.__CACHE.__NON_WITNESS_UTXO_BUF_CACHE[index], undefined);
            // Cache is populated
            psbt.updateInput(index, {
                nonWitnessUtxo: f.nonWitnessUtxo,
            });
            const value = psbt.data.inputs[index].nonWitnessUtxo;
            assert.ok(psbt.__CACHE.__NON_WITNESS_UTXO_BUF_CACHE[index].equals(value));
            assert.ok(psbt.__CACHE.__NON_WITNESS_UTXO_BUF_CACHE[index].equals(f.nonWitnessUtxo));
            // Cache is rebuilt from internal transaction object when cleared
            psbt.data.inputs[index].nonWitnessUtxo = Buffer.from([1, 2, 3]);
            psbt.__CACHE.__NON_WITNESS_UTXO_BUF_CACHE[index] =
                undefined;
            assert.ok(psbt.data.inputs[index].nonWitnessUtxo.equals(value));
        });
    });
    (0, mocha_1.describe)('Transaction properties', () => {
        (0, mocha_1.it)('.version is exposed and is settable', () => {
            const psbt = new __1.Psbt();
            assert.strictEqual(psbt.version, 2);
            assert.strictEqual(psbt.version, psbt.__CACHE.__TX.version);
            psbt.version = 1;
            assert.strictEqual(psbt.version, 1);
            assert.strictEqual(psbt.version, psbt.__CACHE.__TX.version);
        });
        (0, mocha_1.it)('.locktime is exposed and is settable', () => {
            const psbt = new __1.Psbt();
            assert.strictEqual(psbt.locktime, 0);
            assert.strictEqual(psbt.locktime, psbt.__CACHE.__TX.locktime);
            psbt.locktime = 123;
            assert.strictEqual(psbt.locktime, 123);
            assert.strictEqual(psbt.locktime, psbt.__CACHE.__TX.locktime);
        });
        (0, mocha_1.it)('.txInputs is exposed as a readonly clone', () => {
            const psbt = new __1.Psbt();
            const hash = Buffer.alloc(32);
            const index = 0;
            psbt.addInput({ hash, index });
            const input = psbt.txInputs[0];
            const internalInput = psbt.__CACHE.__TX.ins[0];
            assert.ok(input.hash.equals(internalInput.hash));
            assert.strictEqual(input.index, internalInput.index);
            assert.strictEqual(input.sequence, internalInput.sequence);
            input.hash[0] = 123;
            input.index = 123;
            input.sequence = 123;
            assert.ok(!input.hash.equals(internalInput.hash));
            assert.notEqual(input.index, internalInput.index);
            assert.notEqual(input.sequence, internalInput.sequence);
        });
        (0, mocha_1.it)('.txOutputs is exposed as a readonly clone', () => {
            const psbt = new __1.Psbt();
            const address = '1LukeQU5jwebXbMLDVydeH4vFSobRV9rkj';
            const value = 100000;
            psbt.addOutput({ address, value });
            const output = psbt.txOutputs[0];
            const internalInput = psbt.__CACHE.__TX.outs[0];
            assert.strictEqual(output.address, address);
            assert.ok(output.script.equals(internalInput.script));
            assert.strictEqual(output.value, internalInput.value);
            output.script[0] = 123;
            output.value = 123;
            assert.ok(!output.script.equals(internalInput.script));
            assert.notEqual(output.value, internalInput.value);
        });
    });
});
