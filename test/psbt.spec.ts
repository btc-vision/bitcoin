import assert from 'assert';
import { BIP32Factory } from '@btc-vision/bip32';
import * as ecc from 'tiny-secp256k1';
import * as crypto from 'crypto';
import { ECPairSigner, createLegacyBackend } from '@btc-vision/ecpair';
import type { MessageHash } from '@btc-vision/ecpair';
import { beforeEach, describe, it } from 'vitest';

import { convertScriptTree } from './payments.utils.js';
import { LEAF_VERSION_TAPSCRIPT } from '../src/payments/bip341.js';
import { tapTreeFromList, tapTreeToList } from '../src/psbt/bip371.js';
import type {
    Bytes32,
    EccLib,
    PublicKey,
    Satoshi,
    Script,
    Signature,
    Taptree,
} from '../src/types.js';
import type { HDSigner, Signer, SignerAsync, ValidateSigFunction } from '../src/index.js';
import { initEccLib, networks as NETWORKS, payments, Psbt } from '../src/index.js';
import { equals } from '../src/io/index.js';
import { bitcoin as defaultNetwork } from '../src/networks.js';

import preFixtures from './fixtures/psbt.json' with { type: 'json' };
import taprootFixtures from './fixtures/p2tr.json' with { type: 'json' };

const backend = createLegacyBackend(ecc);
const bip32 = BIP32Factory(ecc);

const validator: ValidateSigFunction = (pubkey, msghash, signature): boolean =>
    ECPairSigner.fromPublicKey(backend, pubkey, defaultNetwork).verify(msghash as MessageHash, signature as Signature);

const schnorrValidator: ValidateSigFunction = (pubkey, msghash, signature): boolean =>
    ecc.verifySchnorr(msghash, pubkey, signature);

const initBuffers = (object: typeof preFixtures): typeof preFixtures =>
    JSON.parse(JSON.stringify(object), (_, value) => {
        const regex = new RegExp(/^Buffer.from\(['"](.*)['"], ['"](.*)['"]\)$/);
        const result = regex.exec(value);
        if (!result) return value;

        const data = result[1]!;
        const encoding = result[2]!;

        return Buffer.from(data, encoding as BufferEncoding);
    });

const fixtures = initBuffers(preFixtures);

const toAsyncSigner = (signer: Signer): SignerAsync => {
    return {
        publicKey: signer.publicKey,
        sign: (hash: MessageHash, lowerR: boolean | undefined): Promise<Signature> => {
            return new Promise((resolve, rejects): void => {
                setTimeout(() => {
                    try {
                        const r = signer.sign(hash, lowerR);
                        resolve(r);
                    } catch (e) {
                        rejects(e as Error);
                    }
                }, 10);
            });
        },
    };
};
const failedAsyncSigner = (publicKey: PublicKey): SignerAsync => {
    return {
        publicKey,
        sign: (__: MessageHash): Promise<Signature> => {
            return new Promise((_, reject): void => {
                setTimeout(() => {
                    reject(new Error('sign failed'));
                }, 10);
            });
        },
    };
};
// const b = (hex: string) => Buffer.from(hex, 'hex');

describe(`Psbt`, () => {
    beforeEach(() => {
        // provide the ECC lib only when required
        initEccLib(undefined);
    });
    describe('BIP174 Test Vectors', () => {
        fixtures.bip174.invalid.forEach((f) => {
            it(`Invalid: ${f.description}`, () => {
                assert.throws(() => {
                    Psbt.fromBase64(f.psbt);
                }, new RegExp(f.errorMessage));
            });
        });

        fixtures.bip174.valid.forEach((f) => {
            it(`Valid: ${f.description}`, () => {
                assert.doesNotThrow(() => {
                    Psbt.fromBase64(f.psbt);
                });
            });
        });

        fixtures.bip174.failSignChecks.forEach((f) => {
            const keyPair = ECPairSigner.makeRandom(backend, defaultNetwork);
            it(`Fails Signer checks: ${f.description}`, () => {
                const psbt = Psbt.fromBase64(f.psbt);
                assert.throws(() => {
                    psbt.signInput(f.inputToCheck, keyPair);
                }, new RegExp(f.errorMessage));
            });
        });

        fixtures.bip174.creator.forEach((f) => {
            it('Creates expected PSBT', () => {
                const psbt = new Psbt();
                for (const input of f.inputs) {
                    psbt.addInput(input);
                }
                for (const output of f.outputs) {
                    const script = Buffer.from(output.script, 'hex') as unknown as Script;
                    const value = BigInt(output.value) as Satoshi;
                    psbt.addOutput({ ...output, script, value });
                }
                assert.strictEqual(psbt.toBase64(), f.result);
            });
        });

        fixtures.bip174.updater.forEach((f) => {
            it('Updates PSBT to the expected result', () => {
                if (f.isTaproot) initEccLib(ecc as unknown as EccLib);
                const psbt = Psbt.fromBase64(f.psbt);

                if (f.inputData) {
                    for (const [i, data] of f.inputData.entries()) {
                        psbt.updateInput(i, data as unknown as import('bip174').PsbtInputUpdate);
                    }
                }
                if (f.outputData) {
                    for (const [i, data] of f.outputData.entries()) {
                        psbt.updateOutput(i, data as unknown as import('bip174').PsbtOutputUpdate);
                    }
                }

                assert.strictEqual(psbt.toBase64(), f.result);
            });
        });

        fixtures.bip174.signer.forEach((f) => {
            it('Signs PSBT to the expected result', () => {
                if (f.isTaproot) initEccLib(ecc as unknown as EccLib);
                const psbt = Psbt.fromBase64(f.psbt);

                // @ts-expect-error cannot find tapLeafHashToSign on fixture type
                f.keys.forEach(({ inputToSign, tapLeafHashToSign, WIF }) => {
                    const keyPair = ECPairSigner.fromWIF(backend, WIF, NETWORKS.testnet);
                    if (tapLeafHashToSign)
                        psbt.signTaprootInput(
                            inputToSign,
                            keyPair,
                            Buffer.from(tapLeafHashToSign, 'hex'),
                        );
                    else psbt.signInput(inputToSign, keyPair);
                });

                // Schnorr signatures are non-deterministic (BIP340 uses random aux bytes),
                // so for taproot we just verify signing succeeded (output format differs)
                if (!f.isTaproot) {
                    assert.strictEqual(psbt.toBase64(), f.result);
                }
            });
        });

        fixtures.bip174.combiner.forEach((f) => {
            it('Combines two PSBTs to the expected result', () => {
                const psbts = f.psbts.map((psbt) => Psbt.fromBase64(psbt));

                psbts[0]!.combine(psbts[1]!);

                // Produces a different Base64 string due to implementation specific key-value ordering.
                // That means this test will fail:
                // assert.strictEqual(psbts[0].toBase64(), f.result)
                // Compare the serialized PSBT hex instead - this is deterministic
                assert.strictEqual(psbts[0]!.toHex(), Psbt.fromBase64(f.result).toHex());
            });
        });

        fixtures.bip174.finalizer.forEach((f) => {
            it('Finalizes inputs and gives the expected PSBT', () => {
                if (f.isTaproot) initEccLib(ecc as unknown as EccLib);
                const psbt = Psbt.fromBase64(f.psbt);

                psbt.finalizeAllInputs();

                assert.strictEqual(psbt.toBase64(), f.result);
            });
        });

        fixtures.bip174.extractor.forEach((f) => {
            it('Extracts the expected transaction from a PSBT', () => {
                const psbt1 = Psbt.fromBase64(f.psbt);
                const transaction1 = psbt1.extractTransaction(true).toHex();

                const psbt2 = Psbt.fromBase64(f.psbt);
                const transaction2 = psbt2.extractTransaction().toHex();

                assert.strictEqual(transaction1, transaction2);
                assert.strictEqual(transaction1, f.transaction);

                const psbt3 = Psbt.fromBase64(f.psbt);
                delete psbt3.data.inputs[0]!.finalScriptSig;
                delete psbt3.data.inputs[0]!.finalScriptWitness;
                assert.throws(() => {
                    psbt3.extractTransaction();
                }, new RegExp('Not finalized'));

                const psbt4 = Psbt.fromBase64(f.psbt);
                psbt4.setMaximumFeeRate(1);
                assert.throws(() => {
                    psbt4.extractTransaction();
                }, new RegExp('Warning: You are paying around [\\d.]+ in fees'));

                const psbt5 = Psbt.fromBase64(f.psbt);
                psbt5.extractTransaction(true);
                const fr1 = psbt5.getFeeRate();
                const fr2 = psbt5.getFeeRate();
                assert.strictEqual(fr1, fr2);

                const psbt6 = Psbt.fromBase64(f.psbt);
                const f1 = psbt6.getFee();
                const f2 = psbt6.getFee();
                assert.strictEqual(f1, f2);
            });
        });
    });

    describe('signInputAsync', () => {
        fixtures.signInput.checks.forEach((f) => {
            it(f.description, async () => {
                if (f.isTaproot) initEccLib(ecc as unknown as EccLib);
                if (f.shouldSign) {
                    const psbtThatShouldsign = Psbt.fromBase64(f.shouldSign.psbt);
                    await assert.doesNotReject(async () => {
                        await psbtThatShouldsign.signInputAsync(
                            f.shouldSign.inputToCheck,
                            ECPairSigner.fromWIF(backend, f.shouldSign.WIF, defaultNetwork),
                            f.shouldSign.sighashTypes || undefined,
                        );
                        if (f.shouldSign.result) {
                            // Schnorr signatures are non-deterministic (BIP340 uses random aux bytes),
                            // so for taproot we just verify signing succeeded
                            if (!f.isTaproot) {
                                assert.strictEqual(
                                    psbtThatShouldsign.toBase64(),
                                    f.shouldSign.result,
                                );
                            }
                        }
                    });
                    const failMessage = f.isTaproot
                        ? /Need Schnorr Signer to sign taproot input #0./
                        : /sign failed/;
                    await assert.rejects(async () => {
                        await psbtThatShouldsign.signInputAsync(
                            f.shouldSign.inputToCheck,
                            failedAsyncSigner(ECPairSigner.fromWIF(backend, f.shouldSign.WIF, defaultNetwork).publicKey),
                            f.shouldSign.sighashTypes || undefined,
                        );
                    }, failMessage);
                }

                if (f.shouldThrow) {
                    const psbtThatShouldThrow = Psbt.fromBase64(f.shouldThrow.psbt);
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signInputAsync(
                            f.shouldThrow.inputToCheck,
                            ECPairSigner.fromWIF(backend, f.shouldThrow.WIF, defaultNetwork),
                            undefined,
                        );
                    }, new RegExp(f.shouldThrow.errorMessage));
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signInputAsync(
                            f.shouldThrow.inputToCheck,
                            toAsyncSigner(ECPairSigner.fromWIF(backend, f.shouldThrow.WIF, defaultNetwork)),
                            undefined,
                        );
                    }, new RegExp(f.shouldThrow.errorMessage));
                    await assert.rejects(async () => {
                        // @ts-expect-error Testing missing signer argument
                        await psbtThatShouldThrow.signInputAsync(f.shouldThrow.inputToCheck);
                    }, new RegExp('Need Signer to sign input'));
                }
            });
        });
    });

    describe('signInput', () => {
        fixtures.signInput.checks.forEach((f) => {
            it(f.description, () => {
                if (f.isTaproot) initEccLib(ecc as unknown as EccLib);
                if (f.shouldSign) {
                    const psbtThatShouldsign = Psbt.fromBase64(f.shouldSign.psbt);
                    assert.doesNotThrow(() => {
                        psbtThatShouldsign.signInput(
                            f.shouldSign.inputToCheck,
                            ECPairSigner.fromWIF(backend, f.shouldSign.WIF, defaultNetwork),
                            f.shouldSign.sighashTypes || undefined,
                        );
                    });
                }

                if (f.shouldThrow) {
                    const psbtThatShouldThrow = Psbt.fromBase64(f.shouldThrow.psbt);
                    assert.throws(() => {
                        psbtThatShouldThrow.signInput(
                            f.shouldThrow.inputToCheck,
                            ECPairSigner.fromWIF(backend, f.shouldThrow.WIF, defaultNetwork),
                            undefined,
                        );
                    }, new RegExp(f.shouldThrow.errorMessage));
                    assert.throws(() => {
                        // @ts-expect-error Testing missing signer argument
                        psbtThatShouldThrow.signInput(f.shouldThrow.inputToCheck);
                    }, new RegExp('Need Signer to sign input'));
                }
            });
        });
    });

    describe('signAllInputsAsync', () => {
        fixtures.signInput.checks.forEach((f) => {
            if (f.description === 'checks the input exists') return;
            it(f.description, async () => {
                if (f.isTaproot) initEccLib(ecc as unknown as EccLib);
                if (f.shouldSign) {
                    const psbtThatShouldsign = Psbt.fromBase64(f.shouldSign.psbt);
                    await assert.doesNotReject(async () => {
                        await psbtThatShouldsign.signAllInputsAsync(
                            ECPairSigner.fromWIF(backend, f.shouldSign.WIF, defaultNetwork),
                            f.shouldSign.sighashTypes || undefined,
                        );
                    });
                }

                if (f.shouldThrow) {
                    const psbtThatShouldThrow = Psbt.fromBase64(f.shouldThrow.psbt);
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signAllInputsAsync(
                            ECPairSigner.fromWIF(backend, f.shouldThrow.WIF, defaultNetwork),
                            undefined,
                        );
                    }, new RegExp('No inputs were signed'));
                    await assert.rejects(async () => {
                        // @ts-expect-error Testing missing signer argument
                        await psbtThatShouldThrow.signAllInputsAsync();
                    }, new RegExp('Need Signer to sign input'));
                }
            });
        });
    });

    describe('signAllInputs', () => {
        fixtures.signInput.checks.forEach((f) => {
            if (f.description === 'checks the input exists') return;
            it(f.description, () => {
                if (f.isTaproot) initEccLib(ecc as unknown as EccLib);
                if (f.shouldSign) {
                    const psbtThatShouldsign = Psbt.fromBase64(f.shouldSign.psbt);
                    assert.doesNotThrow(() => {
                        psbtThatShouldsign.signAllInputs(
                            ECPairSigner.fromWIF(backend, f.shouldSign.WIF, defaultNetwork),
                            f.shouldSign.sighashTypes || undefined,
                        );
                    });
                }

                if (f.shouldThrow) {
                    const psbtThatShouldThrow = Psbt.fromBase64(f.shouldThrow.psbt);
                    assert.throws(() => {
                        psbtThatShouldThrow.signAllInputs(
                            ECPairSigner.fromWIF(backend, f.shouldThrow.WIF, defaultNetwork),
                            undefined,
                        );
                    }, new RegExp('No inputs were signed'));
                    assert.throws(() => {
                        // @ts-expect-error Testing missing signer argument
                        psbtThatShouldThrow.signAllInputs();
                    }, new RegExp('Need Signer to sign input'));
                }
            });
        });
    });

    describe('signInputHDAsync', () => {
        fixtures.signInputHD.checks.forEach((f) => {
            it(f.description, async () => {
                if (f.shouldSign) {
                    const psbtThatShouldsign = Psbt.fromBase64(f.shouldSign.psbt);
                    await assert.doesNotReject(async () => {
                        await psbtThatShouldsign.signInputHDAsync(
                            f.shouldSign.inputToCheck,
                            bip32.fromBase58(f.shouldSign.xprv) as unknown as HDSigner,
                            undefined,
                        );
                    });
                }

                if (f.shouldThrow) {
                    const psbtThatShouldThrow = Psbt.fromBase64(f.shouldThrow.psbt);
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signInputHDAsync(
                            f.shouldThrow.inputToCheck,
                            bip32.fromBase58(f.shouldThrow.xprv) as unknown as HDSigner,
                            undefined,
                        );
                    }, new RegExp(f.shouldThrow.errorMessage));
                    await assert.rejects(async () => {
                        // @ts-expect-error Testing missing HDSigner argument
                        await psbtThatShouldThrow.signInputHDAsync(f.shouldThrow.inputToCheck);
                    }, new RegExp('Need HDSigner to sign input'));
                }
            });
        });
    });

    describe('signInputHD', () => {
        fixtures.signInputHD.checks.forEach((f) => {
            it(f.description, () => {
                if (f.shouldSign) {
                    const psbtThatShouldsign = Psbt.fromBase64(f.shouldSign.psbt);
                    assert.doesNotThrow(() => {
                        psbtThatShouldsign.signInputHD(
                            f.shouldSign.inputToCheck,
                            bip32.fromBase58(f.shouldSign.xprv) as unknown as HDSigner,
                            undefined,
                        );
                    });
                }

                if (f.shouldThrow) {
                    const psbtThatShouldThrow = Psbt.fromBase64(f.shouldThrow.psbt);
                    assert.throws(() => {
                        psbtThatShouldThrow.signInputHD(
                            f.shouldThrow.inputToCheck,
                            bip32.fromBase58(f.shouldThrow.xprv) as unknown as HDSigner,
                            undefined,
                        );
                    }, new RegExp(f.shouldThrow.errorMessage));
                    assert.throws(() => {
                        // @ts-expect-error Testing missing HDSigner argument
                        psbtThatShouldThrow.signInputHD(f.shouldThrow.inputToCheck);
                    }, new RegExp('Need HDSigner to sign input'));
                }
            });
        });
    });

    describe('signAllInputsHDAsync', () => {
        fixtures.signInputHD.checks.forEach((f) => {
            it(f.description, async () => {
                if (f.shouldSign) {
                    const psbtThatShouldsign = Psbt.fromBase64(f.shouldSign.psbt);
                    await assert.doesNotReject(async () => {
                        await psbtThatShouldsign.signAllInputsHDAsync(
                            bip32.fromBase58(f.shouldSign.xprv) as unknown as HDSigner,
                            undefined,
                        );
                    });
                }

                if (f.shouldThrow) {
                    const psbtThatShouldThrow = Psbt.fromBase64(f.shouldThrow.psbt);
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signAllInputsHDAsync(
                            bip32.fromBase58(f.shouldThrow.xprv) as unknown as HDSigner,
                            undefined,
                        );
                    }, new RegExp('No inputs were signed'));
                    await assert.rejects(async () => {
                        // @ts-expect-error Testing missing HDSigner argument
                        await psbtThatShouldThrow.signAllInputsHDAsync();
                    }, new RegExp('Need HDSigner to sign input'));
                }
            });
        });
    });

    describe('signAllInputsHD', () => {
        fixtures.signInputHD.checks.forEach((f) => {
            it(f.description, () => {
                if (f.shouldSign) {
                    const psbtThatShouldsign = Psbt.fromBase64(f.shouldSign.psbt);
                    assert.doesNotThrow(() => {
                        psbtThatShouldsign.signAllInputsHD(
                            bip32.fromBase58(f.shouldSign.xprv) as unknown as HDSigner,
                            undefined,
                        );
                    });
                }

                if (f.shouldThrow) {
                    const psbtThatShouldThrow = Psbt.fromBase64(f.shouldThrow.psbt);
                    assert.throws(() => {
                        psbtThatShouldThrow.signAllInputsHD(
                            bip32.fromBase58(f.shouldThrow.xprv) as unknown as HDSigner,
                            undefined,
                        );
                    }, new RegExp('No inputs were signed'));
                    assert.throws(() => {
                        // @ts-expect-error Testing missing HDSigner argument
                        psbtThatShouldThrow.signAllInputsHD();
                    }, new RegExp('Need HDSigner to sign input'));
                }
            });
        });
    });

    describe('finalizeInput', () => {
        it(`Finalizes tapleaf by hash`, () => {
            const f = fixtures.finalizeInput.finalizeTapleafByHash;
            const psbt = Psbt.fromBase64(f.psbt);

            psbt.finalizeTaprootInput(
                f.index,
                Buffer.from(f.leafHash, 'hex') as unknown as Bytes32,
            );

            assert.strictEqual(psbt.toBase64(), f.result);
        });

        it(`fails if tapleaf hash not found`, () => {
            const f = fixtures.finalizeInput.finalizeTapleafByHash;
            const psbt = Psbt.fromBase64(f.psbt);

            assert.throws(() => {
                psbt.finalizeTaprootInput(
                    f.index,
                    Buffer.from(f.leafHash, 'hex').reverse() as unknown as Bytes32,
                );
            }, new RegExp('Can not finalize taproot input #0. Signature for tapleaf script not found.'));
        });

        it(`fails if trying to finalzie non-taproot input`, () => {
            const psbt = new Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            });

            assert.throws(() => {
                psbt.finalizeTaprootInput(0);
            }, new RegExp('Cannot finalize input #0. Not Taproot.'));
        });
    });

    describe('finalizeAllInputs', () => {
        fixtures.finalizeAllInputs.forEach((f) => {
            it(`Finalizes inputs of type "${f.type}"`, () => {
                const psbt = Psbt.fromBase64(f.psbt);

                psbt.finalizeAllInputs();

                assert.strictEqual(psbt.toBase64(), f.result);
            });
        });
        it('fails if no script found', () => {
            const psbt = new Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            });
            assert.throws(() => {
                psbt.finalizeAllInputs();
            }, new RegExp('No script found for input #0'));
            psbt.updateInput(0, {
                witnessUtxo: {
                    script: Buffer.from(
                        '0014d85c2b71d0060b09c9886aeb815e50991dda124d',
                        'hex',
                    ) as unknown as Script,
                    value: 200000n as Satoshi,
                },
            });
            assert.throws(() => {
                psbt.finalizeAllInputs();
            }, new RegExp('Can not finalize input #0'));
        });
    });

    describe('addInput', () => {
        fixtures.addInput.checks.forEach((f) => {
            it(f.description, () => {
                const psbt = new Psbt();
                const inputData =
                    f.inputData as unknown as import('../src/index.js').PsbtInputExtended;

                if (f.exception) {
                    assert.throws(() => {
                        psbt.addInput(inputData);
                    }, new RegExp(f.exception));
                    assert.throws(() => {
                        psbt.addInputs([inputData]);
                    }, new RegExp(f.exception));
                } else {
                    assert.doesNotThrow(() => {
                        psbt.addInputs([inputData]);
                        if (f.equals) {
                            assert.strictEqual(psbt.toBase64(), f.equals);
                        }
                    });
                    assert.throws(() => {
                        psbt.addInput(inputData);
                    }, new RegExp('Duplicate input detected.'));
                }
            });
        });
    });

    describe('updateInput', () => {
        fixtures.updateInput.checks.forEach((f) => {
            it(f.description, () => {
                const psbt = Psbt.fromBase64(f.psbt);

                if (f.exception) {
                    assert.throws(() => {
                        psbt.updateInput(
                            f.index,
                            f.inputData as unknown as import('bip174').PsbtInputUpdate,
                        );
                    }, new RegExp(f.exception));
                }
            });
        });
    });

    describe('addOutput', () => {
        fixtures.addOutput.checks.forEach((f) => {
            it(f.description, () => {
                if (f.isTaproot) initEccLib(ecc as unknown as EccLib);
                const psbt = f.psbt ? Psbt.fromBase64(f.psbt) : new Psbt();

                // Convert numeric value to bigint for valid outputs
                const outputData =
                    f.outputData && typeof f.outputData.value === 'number'
                        ? { ...f.outputData, value: BigInt(f.outputData.value) }
                        : f.outputData;

                type OutputExtended = import('../src/index.js').PsbtOutputExtended;

                if (f.exception) {
                    assert.throws(() => {
                        psbt.addOutput(f.outputData as unknown as OutputExtended);
                    }, new RegExp(f.exception));
                    assert.throws(() => {
                        psbt.addOutputs([f.outputData as unknown as OutputExtended]);
                    }, new RegExp(f.exception));
                } else {
                    assert.doesNotThrow(() => {
                        psbt.addOutput(outputData as unknown as OutputExtended);
                    });
                    if (f.result) {
                        assert.strictEqual(psbt.toBase64(), f.result);
                    }
                    assert.doesNotThrow(() => {
                        psbt.addOutputs([outputData as unknown as OutputExtended]);
                    });
                }
            });
        });
    });

    describe('setVersion', () => {
        it('Sets the version value of the unsigned transaction', () => {
            const psbt = new Psbt();

            assert.strictEqual(psbt.extractTransaction().version, 2);
            psbt.setVersion(1);
            assert.strictEqual(psbt.extractTransaction().version, 1);
        });
    });

    describe('setLocktime', () => {
        it('Sets the nLockTime value of the unsigned transaction', () => {
            const psbt = new Psbt();

            assert.strictEqual(psbt.extractTransaction().locktime, 0);
            psbt.setLocktime(1);
            assert.strictEqual(psbt.extractTransaction().locktime, 1);
        });
    });

    describe('setInputSequence', () => {
        it('Sets the sequence number for a given input', () => {
            const psbt = new Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            });

            assert.strictEqual(psbt.inputCount, 1);
            assert.strictEqual(psbt.txInputs[0]!.sequence, 0xffffffff);
            psbt.setInputSequence(0, 0);
            assert.strictEqual(psbt.txInputs[0]!.sequence, 0);
        });

        it('throws if input index is too high', () => {
            const psbt = new Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            });

            assert.throws(() => {
                psbt.setInputSequence(1, 0);
            }, new RegExp('Input index too high'));
        });
    });

    describe('getInputType', () => {
        const key = ECPairSigner.makeRandom(backend, defaultNetwork);
        const { publicKey } = key;
        const p2wpkhPub = (pubkey: Uint8Array): Script =>
            payments.p2wpkh({
                pubkey: pubkey as PublicKey,
            }).output!;
        const p2pkhPub = (pubkey: Uint8Array): Script =>
            payments.p2pkh({
                pubkey: pubkey as PublicKey,
            }).output!;
        const p2shOut = (output: Uint8Array): Script =>
            payments.p2sh({
                redeem: { output: output as Script },
            }).output!;
        const p2wshOut = (output: Uint8Array): Script =>
            payments.p2wsh({
                redeem: { output: output as Script },
            }).output!;
        const p2shp2wshOut = (output: Uint8Array): Script => p2shOut(p2wshOut(output));
        const noOuter = (output: Uint8Array): Script => output as Script;

        interface InputTypeTestCase {
            innerScript: (pubkey: Uint8Array) => Script;
            outerScript: (output: Uint8Array) => Script;
            redeemGetter: ((pubkey: Uint8Array) => Script) | null;
            witnessGetter: ((pubkey: Uint8Array) => Script) | null;
            expectedType: string;
            finalize?: boolean;
        }

        function getInputTypeTest({
            innerScript,
            outerScript,
            redeemGetter,
            witnessGetter,
            expectedType,
            finalize,
        }: InputTypeTestCase): void {
            const psbt = new Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
                witnessUtxo: {
                    script: outerScript(innerScript(publicKey)),
                    value: 2000n,
                },
                ...(redeemGetter ? { redeemScript: redeemGetter(publicKey) } : {}),
                ...(witnessGetter ? { witnessScript: witnessGetter(publicKey) } : {}),
            }).addOutput({
                script: Buffer.from(
                    '0014d85c2b71d0060b09c9886aeb815e50991dda124d',
                    'hex',
                ) as unknown as Script,
                value: 1800n as Satoshi,
            });
            if (finalize) psbt.signInput(0, key).finalizeInput(0);
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
                redeemGetter: (pk: Uint8Array): Script => p2wshOut(p2pkhPub(pk)),
                witnessGetter: p2pkhPub,
                expectedType: 'p2sh-p2wsh-pubkeyhash',
            },
        ].forEach((testCase) => {
            it(`detects ${testCase.expectedType} input type`, () => {
                getInputTypeTest(testCase);
            });
        });
    });

    describe('inputHasHDKey', () => {
        it('should return true if HD key is present', () => {
            const root = bip32.fromSeed(crypto.randomBytes(32));
            const root2 = bip32.fromSeed(crypto.randomBytes(32));
            const path = "m/0'/0";
            const derived = root.derivePath(path);
            const psbt = new Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
                bip32Derivation: [
                    {
                        masterFingerprint: Buffer.from(root.fingerprint),
                        path,
                        pubkey: Buffer.from(derived.publicKey),
                    },
                ],
            });
            assert.strictEqual(psbt.inputHasHDKey(0, root as unknown as HDSigner), true);
            assert.strictEqual(psbt.inputHasHDKey(0, root2 as unknown as HDSigner), false);
        });
    });

    describe('inputHasPubkey', () => {
        it('should throw', () => {
            // Use a valid 33-byte compressed pubkey for testing
            const testPubkey = ECPairSigner.makeRandom(backend, defaultNetwork).publicKey;

            const psbt = new Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            });

            assert.throws(() => {
                psbt.inputHasPubkey(0, testPubkey);
            }, new RegExp("Can't find pubkey in input without Utxo data"));

            psbt.updateInput(0, {
                witnessUtxo: {
                    value: 1337n as Satoshi,
                    script: payments.p2sh({
                        redeem: { output: Buffer.from([0x51]) as unknown as Script },
                    }).output!,
                },
            });

            assert.throws(() => {
                psbt.inputHasPubkey(0, testPubkey);
            }, new RegExp('scriptPubkey is P2SH but redeemScript missing'));

            delete psbt.data.inputs[0]!.witnessUtxo;

            psbt.updateInput(0, {
                witnessUtxo: {
                    value: 1337n as Satoshi,
                    script: payments.p2wsh({
                        redeem: { output: Buffer.from([0x51]) as unknown as Script },
                    }).output!,
                },
            });

            assert.throws(() => {
                psbt.inputHasPubkey(0, testPubkey);
            }, new RegExp('scriptPubkey or redeemScript is P2WSH but witnessScript missing'));

            delete psbt.data.inputs[0]!.witnessUtxo;

            // Create a script that contains the test pubkey
            const scriptWithPubkey = Buffer.concat([
                Buffer.from([0x21]),
                testPubkey,
                Buffer.from([0xac]),
            ]);

            psbt.updateInput(0, {
                witnessUtxo: {
                    value: 1337n as Satoshi,
                    script: payments.p2sh({
                        redeem: payments.p2wsh({
                            redeem: { output: scriptWithPubkey as unknown as Script },
                        }),
                    }).output!,
                },
                redeemScript: payments.p2wsh({
                    redeem: { output: scriptWithPubkey as unknown as Script },
                }).output!,
            });

            assert.throws(() => {
                psbt.inputHasPubkey(0, testPubkey);
            }, new RegExp('scriptPubkey or redeemScript is P2WSH but witnessScript missing'));

            psbt.updateInput(0, {
                witnessScript: scriptWithPubkey,
            });

            assert.doesNotThrow(() => {
                psbt.inputHasPubkey(0, testPubkey);
            });
        });
    });

    describe('outputHasHDKey', () => {
        it('should return true if HD key is present', () => {
            const root = bip32.fromSeed(crypto.randomBytes(32));
            const root2 = bip32.fromSeed(crypto.randomBytes(32));
            const path = "m/0'/0";
            const derived = root.derivePath(path);
            const psbt = new Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            }).addOutput({
                script: Buffer.from(
                    '0014000102030405060708090a0b0c0d0e0f00010203',
                    'hex',
                ) as unknown as Script,
                value: 2000n as Satoshi,
                bip32Derivation: [
                    {
                        masterFingerprint: Buffer.from(root.fingerprint),
                        path,
                        pubkey: Buffer.from(derived.publicKey),
                    },
                ],
            });
            assert.strictEqual(psbt.outputHasHDKey(0, root as unknown as HDSigner), true);
            assert.strictEqual(psbt.outputHasHDKey(0, root2 as unknown as HDSigner), false);
        });
    });

    describe('outputHasPubkey', () => {
        it('should throw', () => {
            // Use a valid 33-byte compressed pubkey for testing
            const testPubkey = ECPairSigner.makeRandom(backend, defaultNetwork).publicKey;
            // Create a script that contains the test pubkey (P2PK format: <len> <pubkey> OP_CHECKSIG)
            const scriptWithPubkey = Buffer.concat([
                Buffer.from([0x21]),
                testPubkey,
                Buffer.from([0xac]),
            ]);

            const dummyInput = {
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            };

            // Test P2SH without redeemScript
            const psbt = new Psbt();
            psbt.addInput(dummyInput).addOutput({
                script: payments.p2sh({
                    redeem: { output: Buffer.from([0x51]) as unknown as Script },
                }).output!,
                value: 1337n as Satoshi,
            });

            assert.throws(() => {
                psbt.outputHasPubkey(0, testPubkey);
            }, new RegExp('scriptPubkey is P2SH but redeemScript missing'));

            // Test P2WSH without witnessScript
            const psbt2 = new Psbt();
            psbt2.addInput(dummyInput).addOutput({
                script: payments.p2wsh({
                    redeem: { output: Buffer.from([0x51]) as unknown as Script },
                }).output!,
                value: 1337n as Satoshi,
            });

            assert.throws(() => {
                psbt2.outputHasPubkey(0, testPubkey);
            }, new RegExp('scriptPubkey or redeemScript is P2WSH but witnessScript missing'));

            // Test P2SH-P2WSH with redeemScript but no witnessScript
            const psbt3 = new Psbt();
            psbt3.addInput(dummyInput).addOutput({
                script: payments.p2sh({
                    redeem: payments.p2wsh({
                        redeem: { output: scriptWithPubkey as unknown as Script },
                    }),
                }).output!,
                value: 1337n as Satoshi,
            });

            psbt3.updateOutput(0, {
                redeemScript: payments.p2wsh({
                    redeem: { output: scriptWithPubkey as unknown as Script },
                }).output!,
            });

            assert.throws(() => {
                psbt3.outputHasPubkey(0, testPubkey);
            }, new RegExp('scriptPubkey or redeemScript is P2WSH but witnessScript missing'));

            // Test P2SH-P2WSH with witnessScript but no redeemScript
            const psbt4 = new Psbt();
            psbt4.addInput(dummyInput).addOutput({
                script: payments.p2sh({
                    redeem: payments.p2wsh({
                        redeem: { output: scriptWithPubkey as unknown as Script },
                    }),
                }).output!,
                value: 1337n as Satoshi,
            });

            psbt4.updateOutput(0, {
                witnessScript: scriptWithPubkey,
            });

            assert.throws(() => {
                psbt4.outputHasPubkey(0, testPubkey);
            }, new RegExp('scriptPubkey is P2SH but redeemScript missing'));

            // Test P2SH-P2WSH with both redeemScript and witnessScript
            psbt4.updateOutput(0, {
                redeemScript: payments.p2wsh({
                    redeem: { output: scriptWithPubkey as unknown as Script },
                }).output!,
            });

            assert.doesNotThrow(() => {
                psbt4.outputHasPubkey(0, testPubkey);
            });
        });
    });

    describe('clone', () => {
        it('Should clone a psbt exactly with no reference', () => {
            const f = fixtures.clone;
            const psbt = Psbt.fromBase64(f.psbt);
            const notAClone = Object.assign(new Psbt(), psbt); // references still active
            const clone = psbt.clone();

            assert.strictEqual(psbt.validateSignaturesOfAllInputs(validator), true);

            assert.strictEqual(clone.toBase64(), psbt.toBase64());
            assert.strictEqual(clone.toBase64(), notAClone.toBase64());
            assert.strictEqual(psbt.toBase64(), notAClone.toBase64());
            // Mutate psbt data to verify clone independence
            psbt.data.inputs[0]!.sighashType = 0x83;
            assert.notStrictEqual(clone.toBase64(), psbt.toBase64());
            assert.notStrictEqual(clone.toBase64(), notAClone.toBase64());
            assert.strictEqual(psbt.toBase64(), notAClone.toBase64());
        });
    });

    describe('setMaximumFeeRate', () => {
        it('Sets the maximumFeeRate value', () => {
            const f = fixtures.bip174.extractor[0]!;
            // Default rate is 5000. Setting to 1 should make extractTransaction throw.
            const psbt1 = Psbt.fromBase64(f.psbt);
            psbt1.setMaximumFeeRate(1);
            assert.throws(() => {
                psbt1.extractTransaction();
            }, /Warning: You are paying around/);

            // Setting very high should allow extraction.
            const psbt2 = Psbt.fromBase64(f.psbt);
            psbt2.setMaximumFeeRate(1_000_000);
            assert.doesNotThrow(() => {
                psbt2.extractTransaction();
            });
        });
    });

    describe('validateSignaturesOfInput', () => {
        const f = fixtures.validateSignaturesOfInput;
        it('Correctly validates a signature', () => {
            const psbt = Psbt.fromBase64(f.psbt);

            assert.strictEqual(psbt.validateSignaturesOfInput(f.index, validator), true);
            assert.throws(() => {
                psbt.validateSignaturesOfInput(f.nonExistantIndex, validator);
            }, new RegExp('No signatures to validate'));
        });

        it('Correctly validates a signature against a pubkey', () => {
            const psbt = Psbt.fromBase64(f.psbt);
            assert.strictEqual(
                psbt.validateSignaturesOfInput(
                    f.index,
                    validator,
                    f.pubkey as unknown as PublicKey,
                ),
                true,
            );
            assert.throws(() => {
                psbt.validateSignaturesOfInput(
                    f.index,
                    validator,
                    f.incorrectPubkey as unknown as PublicKey,
                );
            }, new RegExp('No signatures for this pubkey'));
        });
    });

    describe('validateSignaturesOfTapKeyInput', () => {
        const f = fixtures.validateSignaturesOfTapKeyInput;
        it('Correctly validates all signatures', () => {
            initEccLib(ecc as unknown as EccLib);
            const psbt = Psbt.fromBase64(f.psbt);
            assert.strictEqual(psbt.validateSignaturesOfInput(f.index, schnorrValidator), true);
        });

        it('Correctly validates a signature against a pubkey', () => {
            initEccLib(ecc as unknown as EccLib);
            const psbt = Psbt.fromBase64(f.psbt);
            assert.strictEqual(
                psbt.validateSignaturesOfInput(
                    f.index,
                    schnorrValidator,
                    f.pubkey as unknown as PublicKey,
                ),
                true,
            );
            assert.throws(() => {
                psbt.validateSignaturesOfInput(
                    f.index,
                    schnorrValidator,
                    f.incorrectPubkey as unknown as PublicKey,
                );
            }, new RegExp('No signatures for this pubkey'));
        });
    });

    describe('validateSignaturesOfTapScriptInput', () => {
        const f = fixtures.validateSignaturesOfTapScriptInput;
        it('Correctly validates all signatures', () => {
            initEccLib(ecc as unknown as EccLib);
            const psbt = Psbt.fromBase64(f.psbt);
            assert.strictEqual(psbt.validateSignaturesOfInput(f.index, schnorrValidator), true);
        });

        it('Correctly validates a signature against a pubkey', () => {
            initEccLib(ecc as unknown as EccLib);
            const psbt = Psbt.fromBase64(f.psbt);
            assert.strictEqual(
                psbt.validateSignaturesOfInput(
                    f.index,
                    schnorrValidator,
                    f.pubkey as unknown as PublicKey,
                ),
                true,
            );
            assert.throws(() => {
                psbt.validateSignaturesOfInput(
                    f.index,
                    schnorrValidator,
                    f.incorrectPubkey as unknown as PublicKey,
                );
            }, new RegExp('No signatures for this pubkey'));
        });
    });

    describe('tapTreeToList/tapTreeFromList', () => {
        it('Correctly converts a Taptree to a Tapleaf list and back', () => {
            taprootFixtures.valid
                .filter((f) => f.arguments.scriptTree)
                .map((f) => f.arguments.scriptTree)
                .forEach((scriptTree) => {
                    const originalTree = convertScriptTree(scriptTree, LEAF_VERSION_TAPSCRIPT);
                    const list = tapTreeToList(originalTree);
                    const treeFromList = tapTreeFromList(list);

                    assert.deepStrictEqual(treeFromList, originalTree);
                });
        });

        it('Throws if too many leaves on a given level', () => {
            const list = Array.from({ length: 5 }).map(() => ({
                depth: 2,
                leafVersion: LEAF_VERSION_TAPSCRIPT,
                script: Buffer.from([]),
            }));
            assert.throws(() => {
                tapTreeFromList(list);
            }, new RegExp('No room left to insert tapleaf in tree'));
        });

        it('Throws if taptree depth is exceeded', () => {
            let tree: Taptree = [{ output: Buffer.from([]) }, { output: Buffer.from([]) }];
            Array.from({ length: 129 }).forEach(() => (tree = [tree, { output: Buffer.from([]) }]));
            assert.throws(() => {
                tapTreeToList(tree as Taptree);
            }, new RegExp('Max taptree depth exceeded.'));
        });

        it('Throws if tapleaf depth is to high', () => {
            const list = [
                {
                    depth: 129,
                    leafVersion: LEAF_VERSION_TAPSCRIPT,
                    script: Buffer.from([]),
                },
            ];
            assert.throws(() => {
                tapTreeFromList(list);
            }, new RegExp('Max taptree depth exceeded.'));
        });

        it('Throws if not a valid taptree structure', () => {
            const tree = Array.from({ length: 3 }).map(() => ({
                output: Buffer.from([]),
            }));

            assert.throws(() => {
                tapTreeToList(tree as unknown as Taptree);
            }, new RegExp('Cannot convert taptree to tapleaf list. Expecting a tapree structure.'));
        });
    });

    describe('getFeeRate', () => {
        it('Throws error if called before inputs are finalized', () => {
            const f = fixtures.getFeeRate;
            const psbt = Psbt.fromBase64(f.psbt);

            assert.throws(() => {
                psbt.getFeeRate();
            }, new RegExp('PSBT must be finalized to calculate fee rate'));

            psbt.finalizeAllInputs();

            assert.strictEqual(psbt.getFeeRate(), f.fee);
            assert.strictEqual(psbt.getFeeRate(), f.fee); // cached path

            const psbt2 = Psbt.fromBase64(f.psbt);
            psbt2.finalizeAllInputs();
            assert.strictEqual(psbt2.getFeeRate(), f.fee); // fresh computation
        });
    });

    describe('create 1-to-1 transaction', () => {
        it('creates and signs a 1-to-1 transaction correctly', () => {
            const alice = ECPairSigner.fromWIF(backend, 'L2uPYXe17xSTqbCjZvL2DsyXPCbXspvcu5mHLDYUgzdUbZGSKrSr', defaultNetwork);
            const psbt = new Psbt();
            psbt.addInput({
                hash: '7d067b4a697a09d2c3cff7d4d9506c9955e93bff41bf82d439da7d030382bc3e',
                index: 0,
                nonWitnessUtxo: Buffer.from(
                    '0200000001f9f34e95b9d5c8abcd20fc5bd4a825d1517be62f0f775e5f36da944d9' +
                        '452e550000000006b483045022100c86e9a111afc90f64b4904bd609e9eaed80d48' +
                        'ca17c162b1aca0a788ac3526f002207bb79b60d4fc6526329bf18a77135dc566020' +
                        '9e761da46e1c2f1152ec013215801210211755115eabf846720f5cb18f248666fec' +
                        '631e5e1e66009ce3710ceea5b1ad13ffffffff01905f0100000000001976a9148bb' +
                        'c95d2709c71607c60ee3f097c1217482f518d88ac00000000',
                    'hex',
                ),
                sighashType: 1,
            });
            psbt.addOutput({
                address: '1KRMKfeZcmosxALVYESdPNez1AP1mEtywp',
                value: 80000n as Satoshi,
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
            assert.strictEqual(
                psbt.extractTransaction().toHex(),
                '02000000013ebc8203037dda39d482bf41ff3be955996c50d9d4f7cfc3d2097a694a7' +
                    'b067d000000006b483045022100931b6db94aed25d5486884d83fc37160f37f3368c0' +
                    'd7f48c757112abefec983802205fda64cff98c849577026eb2ce916a50ea70626a766' +
                    '9f8596dd89b720a26b4d501210365db9da3f8a260078a7e8f8b708a1161468fb2323f' +
                    'fda5ec16b261ec1056f455ffffffff0180380100000000001976a914ca0d36044e0dc' +
                    '08a22724efa6f6a07b0ec4c79aa88ac00000000',
            );
        });
    });

    describe('Method return types', () => {
        it('fromBuffer returns Psbt type (not base class)', () => {
            const psbt = Psbt.fromBuffer(
                Buffer.from(
                    '70736274ff01000a01000000000000000000000000',
                    'hex', // cHNidP8BAAoBAAAAAAAAAAAAAAAA
                ),
            );
            assert.strictEqual(psbt instanceof Psbt, true);
            assert.strictEqual(typeof psbt.version, 'number');
        });
        it('fromBase64 returns Psbt type (not base class)', () => {
            const psbt = Psbt.fromBase64('cHNidP8BAAoBAAAAAAAAAAAAAAAA');
            assert.strictEqual(psbt instanceof Psbt, true);
            assert.strictEqual(typeof psbt.version, 'number');
        });
        it('fromHex returns Psbt type (not base class)', () => {
            const psbt = Psbt.fromHex('70736274ff01000a01000000000000000000000000');
            assert.strictEqual(psbt instanceof Psbt, true);
            assert.strictEqual(typeof psbt.version, 'number');
        });
    });

    describe('Cache', () => {
        it('non-witness UTXOs are cached', () => {
            const f = fixtures.cache.nonWitnessUtxo;
            const psbt = Psbt.fromBase64(f.psbt);
            const index = f.inputIndex;

            assert.strictEqual(psbt.data.inputs[index]!.nonWitnessUtxo, undefined);

            psbt.updateInput(index, {
                nonWitnessUtxo: f.nonWitnessUtxo as unknown as Uint8Array,
            });
            const value = psbt.data.inputs[index]!.nonWitnessUtxo;
            assert.ok(value !== undefined);
            assert.ok(equals(value!, f.nonWitnessUtxo as unknown as Uint8Array));
        });
    });

    describe('Transaction properties', () => {
        it('.version is exposed and is settable', () => {
            const psbt = new Psbt();

            assert.strictEqual(psbt.version, 2);

            psbt.version = 1;
            assert.strictEqual(psbt.version, 1);
        });

        it('.locktime is exposed and is settable', () => {
            const psbt = new Psbt();

            assert.strictEqual(psbt.locktime, 0);

            psbt.locktime = 123;
            assert.strictEqual(psbt.locktime, 123);
        });

        it('.txInputs is exposed as a readonly clone', () => {
            const psbt = new Psbt();
            const hash = Buffer.alloc(32) as unknown as Bytes32;
            const index = 0;
            psbt.addInput({ hash, index });

            // Cast to mutable to test clone independence
            const input1 = psbt.txInputs[0] as {
                hash: Uint8Array;
                index: number;
                sequence: number;
            };
            input1.hash[0] = 123;
            input1.index = 123;
            input1.sequence = 123;

            const input2 = psbt.txInputs[0]!;
            assert.notStrictEqual(input2.hash[0], 123);
            assert.notStrictEqual(input2.index, 123);
            assert.notStrictEqual(input2.sequence, 123);
        });

        it('.txOutputs is exposed as a readonly clone', () => {
            const psbt = new Psbt();
            const address = '1LukeQU5jwebXbMLDVydeH4vFSobRV9rkj';
            const value = 100000n as Satoshi;
            psbt.addOutput({ address, value });

            const output1 = psbt.txOutputs[0]!;
            assert.strictEqual(output1.address, address);

            output1.script[0] = 123;
            (output1 as any).value = 123n;

            const output2 = psbt.txOutputs[0]!; // fresh clone
            assert.notStrictEqual(output2.script[0], 123);
            assert.notStrictEqual(output2.value, 123n);
        });
    });
});
