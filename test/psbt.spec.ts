import assert from 'assert';
import { BIP32Factory } from '@btc-vision/bip32';
import * as ecc from 'tiny-secp256k1';
import * as crypto from 'crypto';
import { beforeEach, describe, it } from 'vitest';

import { convertScriptTree } from './payments.utils.js';
import { LEAF_VERSION_TAPSCRIPT, tapleafHash } from '../src/payments/bip341.js';
import { isTaprootInput, isP2MRInput, tapTreeFromList, tapTreeToList } from '../src/psbt/bip371.js';
import type { Bytes32, EccLib, MessageHash, PrivateKey, PublicKey, Satoshi, Script, Signature, Taptree, } from '../src/types.js';
import type { HDSigner, Signer, SignerAsync, ValidateSigFunction } from '../src/index.js';
import { initEccLib, networks, payments, Psbt } from '../src/index.js';
import { equals } from '../src/io/index.js';

import preFixtures from './fixtures/psbt.json' with { type: 'json' };
import taprootFixtures from './fixtures/p2tr.json' with { type: 'json' };
import { ECPairSigner, createNobleBackend } from '@btc-vision/ecpair';
import type { Network } from '../src/networks.js';

const bip32 = BIP32Factory(ecc);
const backend = createNobleBackend();
const ECPair = {
    makeRandom: (opts?: { network?: Network }) =>
        ECPairSigner.makeRandom(backend, opts?.network ?? networks.bitcoin),
    fromWIF: (wif: string, network?: Network | Network[]) =>
        ECPairSigner.fromWIF(backend, wif, network ?? networks.bitcoin),
    fromPublicKey: (pubkey: Uint8Array, opts?: { network?: Network }) =>
        ECPairSigner.fromPublicKey(backend, pubkey as PublicKey, opts?.network ?? networks.bitcoin),
    fromPrivateKey: (key: Uint8Array, opts?: { network?: Network }) =>
        ECPairSigner.fromPrivateKey(backend, key as PrivateKey, opts?.network ?? networks.bitcoin),
};

const validator: ValidateSigFunction = (pubkey, msghash, signature): boolean =>
    ECPair.fromPublicKey(pubkey).verify(msghash, signature as Signature);

const schnorrValidator: ValidateSigFunction = (pubkey, msghash, signature): boolean =>
    ecc.verifySchnorr(msghash, pubkey, signature);

const initBuffers = (object: any): typeof preFixtures =>
    JSON.parse(JSON.stringify(object), (_, value) => {
        const regex = new RegExp(/^Buffer.from\(['"](.*)['"], ['"](.*)['"]\)$/);
        const result = regex.exec(value);
        if (!result) return value;

        const data = result[1] as string;
        const encoding = result[2] as string;

        return Buffer.from(data, encoding as BufferEncoding);
    });

const fixtures = initBuffers(preFixtures);

const upperCaseFirstLetter = (str: string): string => str.replace(/^./, (s) => s.toUpperCase());

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
const failedAsyncSigner = (publicKey: Uint8Array): SignerAsync => {
    return <SignerAsync>{
        publicKey: publicKey as unknown as PublicKey,
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
            const keyPair = ECPair.makeRandom();
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

                for (const inputOrOutput of ['input', 'output']) {
                    const fixtureData = (f as any)[`${inputOrOutput}Data`];
                    if (fixtureData) {
                        for (const [i, data] of fixtureData.entries()) {
                            const txt = upperCaseFirstLetter(inputOrOutput);
                            (psbt as any)[`update${txt}`](i, data);
                        }
                    }
                }

                assert.strictEqual(psbt.toBase64(), f.result);
            });
        });

        fixtures.bip174.signer.forEach((f) => {
            it('Signs PSBT to the expected result', () => {
                if (f.isTaproot) initEccLib(ecc as unknown as EccLib);
                const psbt = Psbt.fromBase64(f.psbt);

                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore // cannot find tapLeafHashToSign
                f.keys.forEach(({ inputToSign, tapLeafHashToSign, WIF }) => {
                    const keyPair = ECPair.fromWIF(WIF, networks.testnet);
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
                const psbt0 = psbts[0];
                const psbt1 = psbts[1];
                assert(psbt0 && psbt1);

                psbt0.combine(psbt1);

                // Produces a different Base64 string due to implementation specific key-value ordering.
                // That means this test will fail:
                // assert.strictEqual(psbts[0].toBase64(), f.result)
                // Compare the serialized PSBT hex instead - this is deterministic
                assert.strictEqual(psbt0.toHex(), Psbt.fromBase64(f.result).toHex());
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
                const psbt3Input0 = psbt3.data.inputs[0];
                assert(psbt3Input0);
                delete psbt3Input0.finalScriptSig;
                delete psbt3Input0.finalScriptWitness;
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
                            ECPair.fromWIF(f.shouldSign.WIF),
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
                            failedAsyncSigner(ECPair.fromWIF(f.shouldSign.WIF).publicKey),
                            f.shouldSign.sighashTypes || undefined,
                        );
                    }, failMessage);
                }

                if (f.shouldThrow) {
                    const psbtThatShouldThrow = Psbt.fromBase64(f.shouldThrow.psbt);
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signInputAsync(
                            f.shouldThrow.inputToCheck,
                            ECPair.fromWIF(f.shouldThrow.WIF),
                            (f.shouldThrow as any).sighashTypes || undefined,
                        );
                    }, new RegExp(f.shouldThrow.errorMessage));
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signInputAsync(
                            f.shouldThrow.inputToCheck,
                            toAsyncSigner(ECPair.fromWIF(f.shouldThrow.WIF)),
                            (f.shouldThrow as any).sighashTypes || undefined,
                        );
                    }, new RegExp(f.shouldThrow.errorMessage));
                    await assert.rejects(async () => {
                        await (psbtThatShouldThrow.signInputAsync as any)(
                            f.shouldThrow.inputToCheck,
                        );
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
                            ECPair.fromWIF(f.shouldSign.WIF),
                            f.shouldSign.sighashTypes || undefined,
                        );
                    });
                }

                if (f.shouldThrow) {
                    const psbtThatShouldThrow = Psbt.fromBase64(f.shouldThrow.psbt);
                    assert.throws(() => {
                        psbtThatShouldThrow.signInput(
                            f.shouldThrow.inputToCheck,
                            ECPair.fromWIF(f.shouldThrow.WIF),
                            (f.shouldThrow as any).sighashTypes || undefined,
                        );
                    }, new RegExp(f.shouldThrow.errorMessage));
                    assert.throws(() => {
                        (psbtThatShouldThrow.signInput as any)(f.shouldThrow.inputToCheck);
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
                            ECPair.fromWIF(f.shouldSign.WIF),
                            f.shouldSign.sighashTypes || undefined,
                        );
                    });
                }

                if (f.shouldThrow) {
                    const psbtThatShouldThrow = Psbt.fromBase64(f.shouldThrow.psbt);
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signAllInputsAsync(
                            ECPair.fromWIF(f.shouldThrow.WIF),
                            (f.shouldThrow as any).sighashTypes || undefined,
                        );
                    }, new RegExp('No inputs were signed'));
                    await assert.rejects(async () => {
                        await (psbtThatShouldThrow.signAllInputsAsync as any)();
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
                            ECPair.fromWIF(f.shouldSign.WIF),
                            f.shouldSign.sighashTypes || undefined,
                        );
                    });
                }

                if (f.shouldThrow) {
                    const psbtThatShouldThrow = Psbt.fromBase64(f.shouldThrow.psbt);
                    assert.throws(() => {
                        psbtThatShouldThrow.signAllInputs(
                            ECPair.fromWIF(f.shouldThrow.WIF),
                            (f.shouldThrow as any).sighashTypes || undefined,
                        );
                    }, new RegExp('No inputs were signed'));
                    assert.throws(() => {
                        (psbtThatShouldThrow.signAllInputs as any)();
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
                            (f.shouldSign as any).sighashTypes || undefined,
                        );
                    });
                }

                if (f.shouldThrow) {
                    const psbtThatShouldThrow = Psbt.fromBase64(f.shouldThrow.psbt);
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signInputHDAsync(
                            f.shouldThrow.inputToCheck,
                            bip32.fromBase58(f.shouldThrow.xprv) as unknown as HDSigner,
                            (f.shouldThrow as any).sighashTypes || undefined,
                        );
                    }, new RegExp(f.shouldThrow.errorMessage));
                    await assert.rejects(async () => {
                        await (psbtThatShouldThrow.signInputHDAsync as any)(
                            f.shouldThrow.inputToCheck,
                        );
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
                            (f.shouldSign as any).sighashTypes || undefined,
                        );
                    });
                }

                if (f.shouldThrow) {
                    const psbtThatShouldThrow = Psbt.fromBase64(f.shouldThrow.psbt);
                    assert.throws(() => {
                        psbtThatShouldThrow.signInputHD(
                            f.shouldThrow.inputToCheck,
                            bip32.fromBase58(f.shouldThrow.xprv) as unknown as HDSigner,
                            (f.shouldThrow as any).sighashTypes || undefined,
                        );
                    }, new RegExp(f.shouldThrow.errorMessage));
                    assert.throws(() => {
                        (psbtThatShouldThrow.signInputHD as any)(f.shouldThrow.inputToCheck);
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
                            (f.shouldSign as any).sighashTypes || undefined,
                        );
                    });
                }

                if (f.shouldThrow) {
                    const psbtThatShouldThrow = Psbt.fromBase64(f.shouldThrow.psbt);
                    await assert.rejects(async () => {
                        await psbtThatShouldThrow.signAllInputsHDAsync(
                            bip32.fromBase58(f.shouldThrow.xprv) as unknown as HDSigner,
                            (f.shouldThrow as any).sighashTypes || undefined,
                        );
                    }, new RegExp('No inputs were signed'));
                    await assert.rejects(async () => {
                        await (psbtThatShouldThrow.signAllInputsHDAsync as any)();
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
                            (f.shouldSign as any).sighashTypes || undefined,
                        );
                    });
                }

                if (f.shouldThrow) {
                    const psbtThatShouldThrow = Psbt.fromBase64(f.shouldThrow.psbt);
                    assert.throws(() => {
                        psbtThatShouldThrow.signAllInputsHD(
                            bip32.fromBase58(f.shouldThrow.xprv) as unknown as HDSigner,
                            (f.shouldThrow as any).sighashTypes || undefined,
                        );
                    }, new RegExp('No inputs were signed'));
                    assert.throws(() => {
                        (psbtThatShouldThrow.signAllInputsHD as any)();
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

                if (f.exception) {
                    assert.throws(() => {
                        psbt.addInput(f.inputData as any);
                    }, new RegExp(f.exception));
                    assert.throws(() => {
                        psbt.addInputs([f.inputData as any]);
                    }, new RegExp(f.exception));
                } else {
                    assert.doesNotThrow(() => {
                        psbt.addInputs([f.inputData as any]);
                        if (f.equals) {
                            assert.strictEqual(psbt.toBase64(), f.equals);
                        }
                    });
                    assert.throws(() => {
                        psbt.addInput(f.inputData as any);
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
                        psbt.updateInput(f.index, f.inputData as any);
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

                if (f.exception) {
                    assert.throws(() => {
                        psbt.addOutput(f.outputData as any);
                    }, new RegExp(f.exception));
                    assert.throws(() => {
                        psbt.addOutputs([f.outputData as any]);
                    }, new RegExp(f.exception));
                } else {
                    assert.doesNotThrow(() => {
                        psbt.addOutput(outputData as any);
                    });
                    if (f.result) {
                        assert.strictEqual(psbt.toBase64(), f.result);
                    }
                    assert.doesNotThrow(() => {
                        psbt.addOutputs([outputData as any]);
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
            const txIn0 = psbt.txInputs[0];
            assert(txIn0);
            assert.strictEqual(txIn0.sequence, 0xffffffff);
            psbt.setInputSequence(0, 0);
            const txIn0After = psbt.txInputs[0];
            assert(txIn0After);
            assert.strictEqual(txIn0After.sequence, 0);
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
        const key = ECPair.makeRandom();
        const { publicKey } = key;
        const p2wpkhPub = (pubkey: Buffer): Script =>
            payments.p2wpkh({
                pubkey: pubkey as unknown as PublicKey,
            }).output!;
        const p2pkhPub = (pubkey: Buffer): Script =>
            payments.p2pkh({
                pubkey: pubkey as unknown as PublicKey,
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

        function getInputTypeTest({
            innerScript,
            outerScript,
            redeemGetter,
            witnessGetter,
            expectedType,
            finalize,
        }: any): void {
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
                redeemGetter: (pk: Buffer): Script => p2wshOut(p2pkhPub(pk)),
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
            const testPubkey = ECPair.makeRandom().publicKey;

            const psbt = new Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            });

            const input0 = psbt.data.inputs[0];
            assert(input0);

            assert.throws(() => {
                psbt.inputHasPubkey(0, testPubkey);
            }, new RegExp("Can't find pubkey in input without Utxo data"));

            psbt.updateInput(0, {
                witnessUtxo: {
                    value: 1337n as Satoshi,
                    script: payments.p2sh({
                        redeem: { output: Buffer.from([0x51]) as unknown as Script },
                    }).output as Script,
                },
            });

            assert.throws(() => {
                psbt.inputHasPubkey(0, testPubkey);
            }, new RegExp('scriptPubkey is P2SH but redeemScript missing'));

            delete input0.witnessUtxo;

            psbt.updateInput(0, {
                witnessUtxo: {
                    value: 1337n as Satoshi,
                    script: payments.p2wsh({
                        redeem: { output: Buffer.from([0x51]) as unknown as Script },
                    }).output as Script,
                },
            });

            assert.throws(() => {
                psbt.inputHasPubkey(0, testPubkey);
            }, new RegExp('scriptPubkey or redeemScript is P2WSH but witnessScript missing'));

            delete input0.witnessUtxo;

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
            const testPubkey = ECPair.makeRandom().publicKey;
            // Create a script that contains the test pubkey (P2PK format: <len> <pubkey> OP_CHECKSIG)
            const scriptWithPubkey = Buffer.concat([
                Buffer.from([0x21]),
                testPubkey,
                Buffer.from([0xac]),
            ]);

            const psbt = new Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            }).addOutput({
                script: payments.p2sh({
                    redeem: payments.p2wsh({
                        redeem: { output: scriptWithPubkey as unknown as Script },
                    }),
                }).output!,
                value: 1337n as Satoshi,
            });

            assert.throws(() => {
                psbt.outputHasPubkey(0, testPubkey);
            }, new RegExp('scriptPubkey is P2SH but redeemScript missing'));

            const psbt2 = new Psbt();
            psbt2.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            }).addOutput({
                script: payments.p2wsh({
                    redeem: { output: Buffer.from([0x51]) as unknown as Script },
                }).output!,
                value: 1337n as Satoshi,
            });

            assert.throws(() => {
                psbt2.outputHasPubkey(0, testPubkey);
            }, new RegExp('scriptPubkey or redeemScript is P2WSH but witnessScript missing'));

            const psbt3 = new Psbt();
            psbt3.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
            }).addOutput({
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

            const psbt3Output0 = psbt3.data.outputs[0];
            assert(psbt3Output0);
            delete psbt3Output0.redeemScript;

            psbt.updateOutput(0, {
                witnessScript: scriptWithPubkey,
            });

            assert.throws(() => {
                psbt.outputHasPubkey(0, testPubkey);
            }, new RegExp('scriptPubkey is P2SH but redeemScript missing'));

            psbt.updateOutput(0, {
                redeemScript: payments.p2wsh({
                    redeem: { output: scriptWithPubkey as unknown as Script },
                }).output!,
            });

            assert.doesNotThrow(() => {
                psbt.outputHasPubkey(0, testPubkey);
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
            // Mutate data layer to prove clone is independent
            const cloneInput0 = psbt.data.inputs[0];
            assert(cloneInput0);
            cloneInput0.partialSig = [];
            assert.notStrictEqual(clone.toBase64(), psbt.toBase64());
            assert.notStrictEqual(clone.toBase64(), notAClone.toBase64());
            assert.strictEqual(psbt.toBase64(), notAClone.toBase64());
        });
    });

    describe('setMaximumFeeRate', () => {
        it('Sets the maximumFeeRate value', () => {
            const psbt = new Psbt();

            assert.strictEqual(psbt.maximumFeeRate, 5000);
            psbt.setMaximumFeeRate(6000);
            assert.strictEqual(psbt.maximumFeeRate, 6000);
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
                psbt.validateSignaturesOfInput(f.index, validator, f.pubkey as any),
                true,
            );
            assert.throws(() => {
                psbt.validateSignaturesOfInput(f.index, validator, f.incorrectPubkey as any);
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
                psbt.validateSignaturesOfInput(f.index, schnorrValidator, f.pubkey as any),
                true,
            );
            assert.throws(() => {
                psbt.validateSignaturesOfInput(f.index, schnorrValidator, f.incorrectPubkey as any);
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
                psbt.validateSignaturesOfInput(f.index, schnorrValidator, f.pubkey as any),
                true,
            );
            assert.throws(() => {
                psbt.validateSignaturesOfInput(f.index, schnorrValidator, f.incorrectPubkey as any);
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
            // Calling again returns the same cached value
            assert.strictEqual(psbt.getFeeRate(), f.fee);
        });
    });

    describe('getFee and getFeeRate return correct values', () => {
        it('computes fee as inputAmount - outputAmount for nonWitnessUtxo', () => {
            // nonWitnessUtxo output[0] = 90,000 sats; we send 80,000 sats => fee = 10,000 sats
            const alice = ECPair.fromWIF('L2uPYXe17xSTqbCjZvL2DsyXPCbXspvcu5mHLDYUgzdUbZGSKrSr');
            const psbt = new Psbt();
            const inputValue = 90_000n;
            const outputValue = 80_000n as Satoshi;

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
                value: outputValue,
            });
            psbt.signInput(0, alice);
            psbt.finalizeAllInputs();

            const expectedFee = Number(inputValue - outputValue); // 10,000
            const fee = psbt.getFee();
            assert.strictEqual(fee, expectedFee, `fee should be ${expectedFee}, got ${fee}`);

            const tx = psbt.extractTransaction(true);
            const vsize = tx.virtualSize();
            const expectedFeeRate = Math.floor(expectedFee / vsize);
            const feeRate = psbt.getFeeRate();
            assert.strictEqual(
                feeRate,
                expectedFeeRate,
                `feeRate should be fee/vsize = ${expectedFee}/${vsize} = ${expectedFeeRate}, got ${feeRate}`,
            );
        });

        it('computes fee as inputAmount - outputAmount for witnessUtxo', () => {
            const alice = ECPair.fromWIF('L2uPYXe17xSTqbCjZvL2DsyXPCbXspvcu5mHLDYUgzdUbZGSKrSr');
            const p2wpkh = payments.p2wpkh({ pubkey: alice.publicKey as PublicKey });
            const inputValue = 50_000n;
            const outputValue = 40_000n as Satoshi;

            const psbt = new Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000001',
                index: 0,
                witnessUtxo: {
                    script: p2wpkh.output! as Script,
                    value: inputValue as Satoshi,
                },
            });
            psbt.addOutput({
                address: '1KRMKfeZcmosxALVYESdPNez1AP1mEtywp',
                value: outputValue,
            });
            psbt.signInput(0, alice);
            psbt.finalizeAllInputs();

            const expectedFee = Number(inputValue - outputValue); // 10,000
            const fee = psbt.getFee();
            assert.strictEqual(fee, expectedFee, `fee should be ${expectedFee}, got ${fee}`);

            const tx = psbt.extractTransaction(true);
            const vsize = tx.virtualSize();
            const expectedFeeRate = Math.floor(expectedFee / vsize);
            const feeRate = psbt.getFeeRate();
            assert.strictEqual(
                feeRate,
                expectedFeeRate,
                `feeRate should be fee/vsize = ${expectedFee}/${vsize} = ${expectedFeeRate}, got ${feeRate}`,
            );
            assert.ok(feeRate > 0, 'feeRate must be positive');
        });

        it('computes fee correctly with multiple inputs and outputs', () => {
            const alice = ECPair.fromWIF('L2uPYXe17xSTqbCjZvL2DsyXPCbXspvcu5mHLDYUgzdUbZGSKrSr');
            const p2wpkh = payments.p2wpkh({ pubkey: alice.publicKey as PublicKey });

            const input1Value = 30_000n;
            const input2Value = 25_000n;
            const output1Value = 20_000n as Satoshi;
            const output2Value = 15_000n as Satoshi;

            const psbt = new Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000001',
                index: 0,
                witnessUtxo: {
                    script: p2wpkh.output! as Script,
                    value: input1Value as Satoshi,
                },
            });
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000002',
                index: 0,
                witnessUtxo: {
                    script: p2wpkh.output! as Script,
                    value: input2Value as Satoshi,
                },
            });
            psbt.addOutput({
                address: '1KRMKfeZcmosxALVYESdPNez1AP1mEtywp',
                value: output1Value,
            });
            psbt.addOutput({
                address: '1KRMKfeZcmosxALVYESdPNez1AP1mEtywp',
                value: output2Value,
            });
            psbt.signAllInputs(alice);
            psbt.finalizeAllInputs();

            const totalIn = input1Value + input2Value; // 55,000
            const totalOut = output1Value + output2Value; // 35,000
            const expectedFee = Number(totalIn - totalOut); // 20,000
            const fee = psbt.getFee();
            assert.strictEqual(fee, expectedFee, `fee should be ${expectedFee}, got ${fee}`);

            const tx = psbt.extractTransaction(true);
            const vsize = tx.virtualSize();
            const expectedFeeRate = Math.floor(expectedFee / vsize);
            const feeRate = psbt.getFeeRate();
            assert.strictEqual(
                feeRate,
                expectedFeeRate,
                `feeRate should be ${expectedFee}/${vsize} = ${expectedFeeRate}, got ${feeRate}`,
            );
            assert.ok(feeRate > 0, 'feeRate must be positive');
        });
    });

    describe('create 1-to-1 transaction', () => {
        it('creates and signs a 1-to-1 transaction correctly', () => {
            const alice = ECPair.fromWIF('L2uPYXe17xSTqbCjZvL2DsyXPCbXspvcu5mHLDYUgzdUbZGSKrSr');
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
        it('non-witness UTXOs are stored after updateInput', () => {
            const f = fixtures.cache.nonWitnessUtxo;
            const psbt = Psbt.fromBase64(f.psbt);
            const index = f.inputIndex;

            const cacheInput = psbt.data.inputs[index];
            assert(cacheInput);

            // nonWitnessUtxo is not set before updateInput
            assert.strictEqual(cacheInput.nonWitnessUtxo, undefined);

            // After updateInput, the nonWitnessUtxo is stored on the input
            psbt.updateInput(index, {
                nonWitnessUtxo: f.nonWitnessUtxo as any,
            });
            assert.ok(cacheInput.nonWitnessUtxo);
            assert.ok(
                equals(
                    cacheInput.nonWitnessUtxo as Uint8Array,
                    f.nonWitnessUtxo as any,
                ),
            );
        });

        it('nonWitnessUtxo remains a plain data property (no defineProperty)', () => {
            const f = fixtures.cache.nonWitnessUtxo;
            const psbt = Psbt.fromBase64(f.psbt);
            const index = f.inputIndex;

            psbt.updateInput(index, {
                nonWitnessUtxo: f.nonWitnessUtxo as any,
            });

            const input = psbt.data.inputs[index];
            assert(input);
            const desc = Object.getOwnPropertyDescriptor(input, 'nonWitnessUtxo');
            assert.ok(desc, 'property should exist');
            assert.strictEqual(desc.get, undefined, 'should not have a getter');
            assert.strictEqual(desc.set, undefined, 'should not have a setter');
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

            const input = psbt.txInputs[0];
            assert(input);
            const originalHash = new Uint8Array(input.hash);
            const originalIndex = input.index;
            const originalSequence = input.sequence;

            // Mutate the returned clone
            input.hash[0] = 123;
            (input as { index: number }).index = 123;
            (input as { sequence: number }).sequence = 123;

            // Internal state should be unchanged
            const fresh = psbt.txInputs[0];
            assert(fresh);
            assert.ok(equals(fresh.hash, originalHash));
            assert.strictEqual(fresh.index, originalIndex);
            assert.strictEqual(fresh.sequence, originalSequence);
        });

        it('.txOutputs is exposed as a readonly clone', () => {
            const psbt = new Psbt();
            const address = '1LukeQU5jwebXbMLDVydeH4vFSobRV9rkj';
            const value = 100000n as Satoshi;
            psbt.addOutput({ address, value });

            const output = psbt.txOutputs[0];
            assert(output);
            assert.strictEqual(output.address, address);

            const originalScript = new Uint8Array(output.script);
            const originalValue = output.value;

            // Mutate the returned clone
            output.script[0] = 123;
            (output as { value: bigint }).value = 123n;

            // Internal state should be unchanged
            const fresh = psbt.txOutputs[0];
            assert(fresh);
            assert.ok(equals(fresh.script, originalScript));
            assert.strictEqual(fresh.value, originalValue);
        });
    });

    describe('P2MR (BIP 360) PSBT spending', () => {
        // P2MR (Pay-to-Merkle-Root) is SegWit v2, script-path only (no key-path).
        // These tests verify the full PSBT sign -> finalize -> extract flow for P2MR inputs.

        const LEAF_VERSION = 0xc0;
        const OP_CHECKSIG = 0xac; // 172
        const OP_PUSHBYTES_32 = 0x20; // 32

        function buildLeafScript(xOnlyPubkey: Uint8Array): Script {
            // <32-byte x-only pubkey> OP_CHECKSIG
            const script = new Uint8Array(34);
            script[0] = OP_PUSHBYTES_32;
            script.set(xOnlyPubkey, 1);
            script[33] = OP_CHECKSIG;
            return script as Script;
        }

        function toXOnly(pubkey: Uint8Array): Uint8Array {
            return pubkey.length === 32 ? pubkey : pubkey.subarray(1, 33);
        }

        it('detects P2MR inputs via isTaprootInput', () => {
            initEccLib(ecc as unknown as EccLib);
            const keyPair = ECPair.makeRandom();
            const xonly = toXOnly(keyPair.publicKey);
            const leafScript = buildLeafScript(xonly);
            const scriptTree = { output: leafScript, version: LEAF_VERSION };

            const p2mrPayment = payments.p2mr({ scriptTree });
            assert(p2mrPayment.output, 'P2MR output should be defined');

            const psbt = new Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000000',
                index: 0,
                witnessUtxo: {
                    value: 100_000n as Satoshi,
                    script: p2mrPayment.output as Script,
                },
            });

            const input = psbt.data.inputs[0];
            assert(input, 'Input should exist');

            assert(isTaprootInput(input), 'P2MR input should be detected as taproot-style');
            assert(isP2MRInput(input), 'P2MR input should be detected as P2MR');
        });

        it('signs and finalizes a single-leaf P2MR script-path spend', () => {
            initEccLib(ecc as unknown as EccLib);
            const keyPair = ECPair.makeRandom();
            const xonly = toXOnly(keyPair.publicKey);
            const leafScript = buildLeafScript(xonly);

            const scriptTree = { output: leafScript, version: LEAF_VERSION };
            const p2mrPayment = payments.p2mr({
                scriptTree,
                redeem: { output: leafScript, redeemVersion: LEAF_VERSION },
            });

            assert(p2mrPayment.output, 'P2MR output should be defined');
            assert(p2mrPayment.witness, 'P2MR witness should be defined');
            assert(p2mrPayment.hash, 'P2MR hash should be defined');

            // Verify the output is SegWit v2 (OP_2 <32-byte hash>)
            assert.strictEqual(p2mrPayment.output[0], 0x52); // OP_2
            assert.strictEqual(p2mrPayment.output[1], 0x20); // PUSHBYTES_32
            assert.strictEqual(p2mrPayment.output.length, 34);

            // Build the P2MR control block: [leafVersion | 0x01] (no merkle path for single leaf)
            const controlBlock = new Uint8Array([LEAF_VERSION | 0x01]);

            // Compute the tapleaf hash
            const leafHash = tapleafHash({ output: leafScript, version: LEAF_VERSION });

            // Create PSBT
            const psbt = new Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000001',
                index: 0,
                witnessUtxo: {
                    value: 100_000n as Satoshi,
                    script: p2mrPayment.output as Script,
                },
                tapLeafScript: [
                    {
                        leafVersion: LEAF_VERSION,
                        script: leafScript,
                        controlBlock,
                    },
                ],
                tapMerkleRoot: p2mrPayment.hash as Uint8Array,
            });

            // Add a dummy output
            psbt.addOutput({
                address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
                value: 90_000n as Satoshi,
            });

            // Sign the taproot input (routes to script-path signing for P2MR)
            psbt.signTaprootInput(0, keyPair, leafHash);

            // Finalize
            psbt.finalizeInput(0);

            // Extract
            const tx = psbt.extractTransaction(true);
            assert(tx, 'Transaction should be extractable');

            // Verify witness structure: [signature, leaf_script, control_block]
            const witness = tx.ins[0]!.witness;
            assert.strictEqual(witness.length, 3, 'P2MR witness should have 3 elements');

            // First element: Schnorr signature (64 or 65 bytes)
            assert(
                witness[0]!.length === 64 || witness[0]!.length === 65,
                `Signature should be 64 or 65 bytes, got ${witness[0]!.length}`,
            );

            // Second element: leaf script
            assert(
                equals(witness[1]!, leafScript),
                'Second witness element should be the leaf script',
            );

            // Third element: P2MR control block (1 byte for single leaf, no merkle path)
            assert.strictEqual(
                witness[2]!.length,
                1,
                'Control block should be 1 byte for single-leaf P2MR',
            );
            assert.strictEqual(
                witness[2]![0],
                LEAF_VERSION | 0x01,
                'Control byte should have parity bit 1',
            );
        });

        it('signs and finalizes a two-leaf P2MR script-path spend', () => {
            initEccLib(ecc as unknown as EccLib);
            const keyPair1 = ECPair.makeRandom();
            const keyPair2 = ECPair.makeRandom();
            const xonly1 = toXOnly(keyPair1.publicKey);
            const xonly2 = toXOnly(keyPair2.publicKey);

            const leafScriptA = buildLeafScript(xonly1);
            const leafScriptB = buildLeafScript(xonly2);

            const scriptTree: [{ output: Script; version: number }, { output: Script; version: number }] = [
                { output: leafScriptA, version: LEAF_VERSION },
                { output: leafScriptB, version: LEAF_VERSION },
            ];

            // Create P2MR payment to get the hash
            const p2mrPayment = payments.p2mr({
                scriptTree,
                redeem: { output: leafScriptB, redeemVersion: LEAF_VERSION },
            });

            assert(p2mrPayment.output, 'P2MR output should be defined');
            assert(p2mrPayment.hash, 'P2MR hash should be defined');
            assert(p2mrPayment.witness, 'P2MR witness (with control block) should be defined');

            // The witness from p2mr() gives us the correct control block for leafB
            // witness = [leafScript, controlBlock]
            const controlBlockB = p2mrPayment.witness![1]!;
            assert(controlBlockB.length === 33, 'Control block for leaf B in 2-leaf tree should be 1 + 32 bytes');

            const leafHashB = tapleafHash({ output: leafScriptB, version: LEAF_VERSION });

            // Create PSBT
            const psbt = new Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000002',
                index: 0,
                witnessUtxo: {
                    value: 100_000n as Satoshi,
                    script: p2mrPayment.output as Script,
                },
                tapLeafScript: [
                    {
                        leafVersion: LEAF_VERSION,
                        script: leafScriptB,
                        controlBlock: controlBlockB,
                    },
                ],
                tapMerkleRoot: p2mrPayment.hash as Uint8Array,
            });

            psbt.addOutput({
                address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
                value: 90_000n as Satoshi,
            });

            // Sign with keyPair2 (matches leafScriptB)
            psbt.signTaprootInput(0, keyPair2, leafHashB);

            // Finalize
            psbt.finalizeInput(0);

            // Extract
            const tx = psbt.extractTransaction(true);
            assert(tx, 'Transaction should be extractable');

            // Verify witness structure: [signature, leaf_script, control_block]
            const witness = tx.ins[0]!.witness;
            assert.strictEqual(witness.length, 3, 'P2MR witness should have 3 elements');

            // Control block: 1 + 32 bytes (control byte + one merkle path element)
            assert.strictEqual(witness[2]!.length, 33, 'Control block should be 33 bytes for 2-leaf tree');
            assert.strictEqual(
                witness[2]![0],
                LEAF_VERSION | 0x01,
                'Control byte should have parity bit 1',
            );
        });

        it('validates signatures of a P2MR input', () => {
            initEccLib(ecc as unknown as EccLib);
            const keyPair = ECPair.makeRandom();
            const xonly = toXOnly(keyPair.publicKey);
            const leafScript = buildLeafScript(xonly);

            const scriptTree = { output: leafScript, version: LEAF_VERSION };
            const p2mrPayment = payments.p2mr({
                scriptTree,
                redeem: { output: leafScript, redeemVersion: LEAF_VERSION },
            });

            const controlBlock = new Uint8Array([LEAF_VERSION | 0x01]);

            const leafHash = tapleafHash({ output: leafScript, version: LEAF_VERSION });

            const psbt = new Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000003',
                index: 0,
                witnessUtxo: {
                    value: 100_000n as Satoshi,
                    script: p2mrPayment.output as Script,
                },
                tapLeafScript: [
                    {
                        leafVersion: LEAF_VERSION,
                        script: leafScript,
                        controlBlock,
                    },
                ],
                tapMerkleRoot: p2mrPayment.hash as Uint8Array,
            });

            psbt.addOutput({
                address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
                value: 90_000n as Satoshi,
            });

            psbt.signTaprootInput(0, keyPair, leafHash);

            // Validate signatures
            const isValid = psbt.validateSignaturesOfInput(0, schnorrValidator);
            assert(isValid, 'P2MR signature should be valid');
        });

        it('rejects key-path finalization for P2MR inputs', () => {
            initEccLib(ecc as unknown as EccLib);
            const keyPair = ECPair.makeRandom();
            const xonly = toXOnly(keyPair.publicKey);
            const leafScript = buildLeafScript(xonly);

            const scriptTree = { output: leafScript, version: LEAF_VERSION };
            const p2mrPayment = payments.p2mr({ scriptTree });

            const psbt = new Psbt();
            psbt.addInput({
                hash: '0000000000000000000000000000000000000000000000000000000000000004',
                index: 0,
                witnessUtxo: {
                    value: 100_000n as Satoshi,
                    script: p2mrPayment.output as Script,
                },
            });

            psbt.addOutput({
                address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
                value: 90_000n as Satoshi,
            });

            // Without tapLeafScript, finalization should fail (no script-path data)
            assert.throws(() => {
                psbt.finalizeInput(0);
            }, /Can not finalize taproot input #0/);
        });
    });
});
