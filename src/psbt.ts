import type {
    KeyValue,
    PsbtGlobalUpdate,
    PsbtInput,
    PsbtInputUpdate,
    PsbtOutput,
    PsbtOutputUpdate,
    TapKeySig,
    TapScriptSig,
} from 'bip174';
import { checkForInput, checkForOutput, Psbt as PsbtBase } from 'bip174';
import { clone, equals, fromBase64, fromHex, toHex } from './io/index.js';

import { fromOutputScript, toOutputScript } from './address.js';
import { bitcoin as btcNetwork } from './networks.js';
import * as payments from './payments/index.js';
import {
    checkTaprootInputFields,
    checkTaprootOutputFields,
    isP2MRInput,
    isTaprootInput,
    serializeTaprootSignature,
    tapScriptFinalizer,
} from './psbt/bip371.js';
import { toXOnly } from './pubkey.js';
import * as bscript from './script.js';
import { Transaction } from './transaction.js';
import type { Bytes32, MessageHash, PublicKey, SchnorrSignature, Script } from './types.js';

import type {
    AllScriptType,
    FinalScriptsFunc,
    FinalTaprootScriptsFunc,
    HDSigner,
    HDSignerAsync,
    PsbtBaseExtended,
    PsbtInputExtended,
    PsbtOpts,
    PsbtOptsOptional,
    PsbtOutputExtended,
    PsbtOutputExtendedAddress,
    PsbtTxInput,
    PsbtTxOutput,
    Signer,
    SignerAsync,
    TaprootHashCheckSigner,
    ValidateSigFunction,
} from './psbt/types.js';
// Import composition classes
import { PsbtCache } from './psbt/PsbtCache.js';
import { PsbtSigner } from './psbt/PsbtSigner.js';
import {
    getFinalScripts as _getFinalScripts,
    prepareFinalScripts as _prepareFinalScripts,
    PsbtFinalizer,
} from './psbt/PsbtFinalizer.js';
import { PsbtTransaction, transactionFromBuffer } from './psbt/PsbtTransaction.js';
import {
    check32Bit,
    checkCache,
    checkInputsForPartialSig,
    checkPartialSigSighashes,
    checkScriptForPubkey,
    checkTxForDupeIns,
    checkTxInputCache,
    isFinalized,
} from './psbt/validation.js';
import { checkInvalidP2WSH, classifyScript, getMeaningfulScript, range } from './psbt/utils.js';
import { witnessStackToScriptWitness } from './psbt/psbtutils.js';

// Re-export types from the types module
export type {
    TransactionInput,
    PsbtTxInput,
    TransactionOutput,
    PsbtTxOutput,
    ValidateSigFunction,
    PsbtBaseExtended,
    PsbtOptsOptional,
    PsbtOpts,
    PsbtInputExtended,
    PsbtOutputExtended,
    PsbtOutputExtendedScript,
    PsbtOutputExtendedAddress,
    HDSigner,
    HDSignerAsync,
    Signer,
    SignerAsync,
    TaprootHashCheckSigner,
    PsbtCacheInterface,
    TxCacheNumberKey,
    ScriptType,
    AllScriptType,
    GetScriptReturn,
    FinalScriptsFunc,
    FinalTaprootScriptsFunc,
} from './psbt/types.js';

// Re-export for backwards compatibility
export { getFinalScripts, prepareFinalScripts };
export { PsbtCache } from './psbt/PsbtCache.js';
export { PsbtSigner } from './psbt/PsbtSigner.js';
export { PsbtFinalizer } from './psbt/PsbtFinalizer.js';
export { PsbtTransaction, transactionFromBuffer } from './psbt/PsbtTransaction.js';

/**
 * These are the default arguments for a Psbt instance.
 */
const DEFAULT_OPTS: PsbtOpts = {
    network: btcNetwork,
    maximumFeeRate: 5000,
};

/** Helper to create a Transaction from a buffer */
function txFromBuffer(buf: Uint8Array): Transaction {
    return Transaction.fromBuffer(buf);
}

// Standalone exports that delegate to PsbtFinalizer
function getFinalScripts(
    inputIndex: number,
    input: PsbtInput,
    script: Script,
    isSegwit: boolean,
    isP2SH: boolean,
    isP2WSH: boolean,
    canRunChecks: boolean = true,
    solution?: Uint8Array[],
): {
    finalScriptSig: Script | undefined;
    finalScriptWitness: Uint8Array | undefined;
} {
    return _getFinalScripts(
        inputIndex,
        input,
        script,
        isSegwit,
        isP2SH,
        isP2WSH,
        canRunChecks,
        solution,
    );
}

function prepareFinalScripts(
    script: Uint8Array,
    scriptType: string,
    partialSig: import('bip174').PartialSig[],
    isSegwit: boolean,
    isP2SH: boolean,
    isP2WSH: boolean,
    solution?: Uint8Array[],
): {
    finalScriptSig: Script | undefined;
    finalScriptWitness: Uint8Array | undefined;
} {
    return _prepareFinalScripts(
        script,
        scriptType,
        partialSig,
        isSegwit,
        isP2SH,
        isP2WSH,
        solution,
    );
}

/**
 * Psbt class can parse and generate a PSBT binary based off of the BIP174.
 * There are 6 roles that this class fulfills. (Explained in BIP174)
 *
 * Creator: This can be done with `new Psbt()`
 *
 * Updater: This can be done with `psbt.addInput(input)`, `psbt.addInputs(inputs)`,
 *   `psbt.addOutput(output)`, `psbt.addOutputs(outputs)` when you are looking to
 *   add new inputs and outputs to the PSBT, and `psbt.updateGlobal(itemObject)`,
 *   `psbt.updateInput(itemObject)`, `psbt.updateOutput(itemObject)`
 *   addInput requires hash: Uint8Array | string; and index: number; as attributes
 *   and can also include any attributes that are used in updateInput method.
 *   addOutput requires script: Uint8Array; and value: bigint; and likewise can include
 *   data for updateOutput.
 *   For a list of what attributes should be what types. Check the bip174 library.
 *   Also, check the integration tests for some examples of usage.
 *
 * Signer: There are a few methods. signAllInputs and signAllInputsAsync, which will search all input
 *   information for your pubkey or pubkeyhash, and only sign inputs where it finds
 *   your info. Or you can explicitly sign a specific input with signInput and
 *   signInputAsync. For the async methods you can create a SignerAsync object
 *   and use something like a hardware wallet to sign with. (You must implement this)
 *
 * Combiner: psbts can be combined easily with `psbt.combine(psbt2, psbt3, psbt4 ...)`
 *   the psbt calling combine will always have precedence when a conflict occurs.
 *   Combine checks if the internal bitcoin transaction is the same, so be sure that
 *   all sequences, version, locktime, etc. are the same before combining.
 *
 * Input Finalizer: This role is fairly important. Not only does it need to construct
 *   the input scriptSigs and witnesses, but it SHOULD verify the signatures etc.
 *   Before running `psbt.finalizeAllInputs()` please run `psbt.validateSignaturesOfAllInputs()`
 *   Running any finalize method will delete any data in the input(s) that are no longer
 *   needed due to the finalized scripts containing the information.
 *
 * Transaction Extractor: This role will perform some checks before returning a
 *   Transaction object. Such as fee rate not being larger than maximumFeeRate etc.
 */
export class Psbt {
    readonly #cache: PsbtCache;
    #signer: PsbtSigner | undefined;
    #finalizer: PsbtFinalizer | undefined;
    readonly #opts: PsbtOpts;

    public constructor(
        opts: PsbtOptsOptional = {},
        public data: PsbtBaseExtended = new PsbtBase(new PsbtTransaction()),
    ) {
        this.#opts = Object.assign({}, DEFAULT_OPTS, opts);
        const tx = (this.data.globalMap.unsignedTx as PsbtTransaction).tx;
        this.#cache = new PsbtCache(tx);

        if (opts.version === 3) {
            this.setVersionTRUC();
        } else if (this.data.inputs.length === 0) this.setVersion(2);
    }

    public get inputCount(): number {
        return this.data.inputs.length;
    }

    public get version(): number {
        return this.#cache.tx.version;
    }

    public set version(version: number) {
        this.setVersion(version);
    }

    public get locktime(): number {
        return this.#cache.tx.locktime;
    }

    public set locktime(locktime: number) {
        this.setLocktime(locktime);
    }

    public get txInputs(): PsbtTxInput[] {
        return this.#cache.tx.ins.map((input) => ({
            hash: clone(input.hash) as Bytes32,
            index: input.index,
            sequence: input.sequence,
        }));
    }

    public get txOutputs(): PsbtTxOutput[] {
        return this.#cache.tx.outs.map((output) => {
            let address: string | undefined;
            try {
                address = fromOutputScript(output.script, this.#opts.network);
            } catch (_) {
                // Not all scripts can be converted to an address
            }
            return {
                script: clone(output.script) as Script,
                value: output.value,
                address,
            };
        });
    }

    /** Lazily initialized signer - created on first access */
    get #lazySigner(): PsbtSigner {
        if (!this.#signer) {
            this.#signer = new PsbtSigner(this.#cache, txFromBuffer);
        }
        return this.#signer;
    }

    /** Lazily initialized finalizer - created on first access */
    get #lazyFinalizer(): PsbtFinalizer {
        if (!this.#finalizer) {
            this.#finalizer = new PsbtFinalizer(this.#cache, txFromBuffer);
        }
        return this.#finalizer;
    }

    public static fromBase64(data: string, opts: PsbtOptsOptional = {}): Psbt {
        const buffer = fromBase64(data);
        return this.fromBuffer(buffer, opts);
    }

    public static fromHex(data: string, opts: PsbtOptsOptional = {}): Psbt {
        const buffer = fromHex(data);
        return this.fromBuffer(buffer, opts);
    }

    public static fromBuffer(buffer: Uint8Array, opts: PsbtOptsOptional = {}): Psbt {
        const psbtBase = PsbtBase.fromBuffer(buffer, transactionFromBuffer);
        const psbt = new Psbt(opts, psbtBase);
        checkTxForDupeIns(psbt.#cache.tx, psbt.#cache);
        psbt.#cache.hasSignatures = psbt.data.inputs.some(
            (input) =>
                input.partialSig?.length ||
                input.tapKeySig ||
                input.tapScriptSig?.length ||
                input.finalScriptSig ||
                input.finalScriptWitness,
        );
        return psbt;
    }

    public combine(...those: Psbt[]): this {
        this.data.combine(...those.map((o) => o.data));
        return this;
    }

    public clone(): Psbt {
        const clonedOpts = structuredClone(this.#opts) as PsbtOptsOptional;
        return Psbt.fromBuffer(new Uint8Array(this.data.toBuffer()), clonedOpts);
    }

    public get maximumFeeRate(): number {
        return this.#opts.maximumFeeRate;
    }

    public setMaximumFeeRate(satoshiPerByte: number): void {
        check32Bit(satoshiPerByte);
        this.#opts.maximumFeeRate = satoshiPerByte;
    }

    public setVersion(version: number): this {
        check32Bit(version);
        checkInputsForPartialSig(this.data.inputs, 'setVersion', this.#cache.hasSignatures);
        this.#cache.tx.version = version;
        this.#cache.invalidate('outputs');
        return this;
    }

    public setVersionTRUC(): this {
        return this.setVersion(Transaction.TRUC_VERSION);
    }

    public setLocktime(locktime: number): this {
        check32Bit(locktime);
        checkInputsForPartialSig(this.data.inputs, 'setLocktime', this.#cache.hasSignatures);
        this.#cache.tx.locktime = locktime;
        this.#cache.invalidate('outputs');
        return this;
    }

    public setInputSequence(inputIndex: number, sequence: number): this {
        check32Bit(sequence);
        checkInputsForPartialSig(this.data.inputs, 'setInputSequence', this.#cache.hasSignatures);
        if (this.#cache.tx.ins.length <= inputIndex) {
            throw new Error('Input index too high');
        }
        (this.#cache.tx.ins[inputIndex] as { sequence: number }).sequence = sequence;
        this.#cache.invalidate('outputs');
        return this;
    }

    public addInputs(inputDatas: PsbtInputExtended[], checkPartialSigs: boolean = true): this {
        inputDatas.forEach((inputData) => this.addInput(inputData, checkPartialSigs));
        return this;
    }

    public addInput(inputData: PsbtInputExtended, checkPartialSigs: boolean = true): this {
        if (!inputData || inputData.hash === undefined || inputData.index === undefined) {
            throw new Error(
                `Invalid arguments for Psbt.addInput. ` +
                    `Requires single object with at least [hash] and [index]`,
            );
        }

        checkTaprootInputFields(inputData, inputData, 'addInput');

        if (checkPartialSigs) {
            checkInputsForPartialSig(this.data.inputs, 'addInput', this.#cache.hasSignatures);
        }

        if (inputData.witnessScript) checkInvalidP2WSH(inputData.witnessScript);
        const normalizedInputData = inputData.witnessUtxo
            ? {
                  ...inputData,
                  witnessUtxo: {
                      script: inputData.witnessUtxo.script,
                      value:
                          typeof inputData.witnessUtxo.value === 'bigint'
                              ? inputData.witnessUtxo.value
                              : BigInt(inputData.witnessUtxo.value),
                  },
              }
            : inputData;
        this.data.addInput(normalizedInputData);
        const txIn = this.#cache.tx.ins[this.#cache.tx.ins.length - 1] as Transaction['ins'][0];
        checkTxInputCache(this.#cache, txIn);

        const inputIndex = this.data.inputs.length - 1;
        const input = this.data.inputs[inputIndex] as PsbtInput;
        if (input.nonWitnessUtxo) {
            this.#cache.addNonWitnessTxCache(input, inputIndex, txFromBuffer);
        }
        this.#cache.invalidate('full');
        return this;
    }

    public addOutputs(outputDatas: PsbtOutputExtended[], checkPartialSigs: boolean = true): this {
        outputDatas.forEach((outputData) => this.addOutput(outputData, checkPartialSigs));
        return this;
    }

    public addOutput(outputData: PsbtOutputExtended, checkPartialSigs: boolean = true): this {
        const hasAddress = 'address' in outputData;
        const hasScript = 'script' in outputData;
        if (!outputData || outputData.value === undefined || (!hasAddress && !hasScript)) {
            throw new Error(
                `Invalid arguments for Psbt.addOutput. ` +
                    `Requires single object with at least [script or address] and [value]`,
            );
        }
        if (checkPartialSigs) {
            checkInputsForPartialSig(this.data.inputs, 'addOutput', this.#cache.hasSignatures);
        }
        if (hasAddress) {
            const { address } = outputData as PsbtOutputExtendedAddress;
            const { network } = this.#opts;
            const script = toOutputScript(address, network);
            outputData = Object.assign({}, outputData, { script });
        }
        checkTaprootOutputFields(outputData, outputData, 'addOutput');

        this.data.addOutput(outputData);
        this.#cache.invalidate('outputs');
        return this;
    }

    public extractTransaction(
        disableFeeCheck?: boolean,
        disableOutputChecks?: boolean,
    ): Transaction {
        if (disableOutputChecks) {
            (this.data as unknown as { inputs: PsbtInput[] }).inputs = this.data.inputs.filter(
                (i) => !i.partialSig,
            );
        }

        if (!this.data.inputs.every(isFinalized)) throw new Error('Not finalized');
        if (!disableFeeCheck) {
            this.#cache.computeFeeRate(this.data.inputs, disableOutputChecks, txFromBuffer);
            this.#cache.checkFees(this.#opts);
        }
        if (this.#cache.extractedTx) return this.#cache.extractedTx;
        const tx = this.#cache.tx.clone();
        this.#cache.finalizeAndComputeAmounts(
            this.data.inputs,
            tx,
            true,
            disableOutputChecks,
            txFromBuffer,
        );
        return tx;
    }

    public getFeeRate(disableOutputChecks: boolean = false): number {
        return this.#cache.computeFeeRate(this.data.inputs, disableOutputChecks, txFromBuffer);
    }

    public getFee(disableOutputChecks: boolean = false): number {
        return this.#cache.computeFee(this.data.inputs, disableOutputChecks, txFromBuffer);
    }

    public finalizeAllInputs(): this {
        checkForInput(this.data.inputs, 0);
        range(this.data.inputs.length).forEach((idx) => this.finalizeInput(idx));
        return this;
    }

    public finalizeInput(
        inputIndex: number,
        finalScriptsFunc?: FinalScriptsFunc | FinalTaprootScriptsFunc,
        canRunChecks?: boolean,
    ): this {
        const input = checkForInput(this.data.inputs, inputIndex);
        if (isTaprootInput(input)) {
            return this.#finalizeTaprootInput(
                inputIndex,
                input,
                undefined,
                finalScriptsFunc as FinalTaprootScriptsFunc,
            );
        }
        return this.#finalizeInput(
            inputIndex,
            input,
            finalScriptsFunc as FinalScriptsFunc,
            canRunChecks ?? true,
        );
    }

    public finalizeTaprootInput(
        inputIndex: number,
        tapLeafHashToFinalize?: Bytes32,
        finalScriptsFunc: FinalTaprootScriptsFunc = tapScriptFinalizer,
    ): this {
        const input = checkForInput(this.data.inputs, inputIndex);
        if (isTaprootInput(input))
            return this.#finalizeTaprootInput(
                inputIndex,
                input,
                tapLeafHashToFinalize,
                finalScriptsFunc,
            );
        throw new Error(`Cannot finalize input #${inputIndex}. Not Taproot.`);
    }

    public getInputType(inputIndex: number): AllScriptType {
        const input = checkForInput(this.data.inputs, inputIndex);
        const script = this.#cache.getScriptFromUtxo(inputIndex, input, txFromBuffer);
        const result = getMeaningfulScript(
            script,
            inputIndex,
            'input',
            input.redeemScript || this.#cache.redeemFromFinalScriptSig(input.finalScriptSig),
            input.witnessScript ||
                this.#cache.redeemFromFinalWitnessScript(input.finalScriptWitness),
        );
        const type = result.type === 'raw' ? '' : result.type + '-';
        const mainType = classifyScript(result.meaningfulScript);
        return (type + mainType) as AllScriptType;
    }

    public inputHasPubkey(inputIndex: number, pubkey: PublicKey): boolean {
        const input = checkForInput(this.data.inputs, inputIndex);
        return this.#cache.pubkeyInInput(pubkey, input, inputIndex, txFromBuffer);
    }

    public inputHasHDKey(inputIndex: number, root: HDSigner): boolean {
        const input = checkForInput(this.data.inputs, inputIndex);
        const derivationIsMine = this.#lazySigner.bip32DerivationIsMine(root);
        return !!input.bip32Derivation && input.bip32Derivation.some(derivationIsMine);
    }

    public outputHasPubkey(outputIndex: number, pubkey: PublicKey): boolean {
        const output = checkForOutput(this.data.outputs, outputIndex);
        return this.#cache.pubkeyInOutput(pubkey, output, outputIndex);
    }

    public outputHasHDKey(outputIndex: number, root: HDSigner): boolean {
        const output = checkForOutput(this.data.outputs, outputIndex);
        const derivationIsMine = this.#lazySigner.bip32DerivationIsMine(root);
        return !!output.bip32Derivation && output.bip32Derivation.some(derivationIsMine);
    }

    public validateSignaturesOfAllInputs(validator: ValidateSigFunction): boolean {
        checkForInput(this.data.inputs, 0);
        const results = range(this.data.inputs.length).map((idx) =>
            this.validateSignaturesOfInput(idx, validator),
        );
        return results.every((res) => res);
    }

    public validateSignaturesOfInput(
        inputIndex: number,
        validator: ValidateSigFunction,
        pubkey?: PublicKey,
    ): boolean {
        const input = this.data.inputs[inputIndex] as PsbtInput;
        if (isTaprootInput(input))
            return this.#validateSignaturesOfTaprootInput(inputIndex, validator, pubkey);

        return this.#validateSignaturesOfInput(inputIndex, validator, pubkey);
    }

    public signAllInputsHD(
        hdKeyPair: HDSigner,
        sighashTypes: number[] = [Transaction.SIGHASH_ALL],
    ): this {
        if (!hdKeyPair || !hdKeyPair.publicKey || !hdKeyPair.fingerprint) {
            throw new Error('Need HDSigner to sign input');
        }

        const results: boolean[] = [];
        for (const i of range(this.data.inputs.length)) {
            try {
                this.signInputHD(i, hdKeyPair, sighashTypes);
                results.push(true);
            } catch (err) {
                results.push(false);
            }
        }
        if (results.every((v) => !v)) {
            throw new Error('No inputs were signed');
        }
        return this;
    }

    public async signAllInputsHDAsync(
        hdKeyPair: HDSigner | HDSignerAsync,
        sighashTypes: number[] = [Transaction.SIGHASH_ALL],
    ): Promise<void> {
        if (!hdKeyPair || !hdKeyPair.publicKey || !hdKeyPair.fingerprint) {
            throw new Error('Need HDSigner to sign input');
        }

        const results: boolean[] = [];
        const promises: Array<Promise<void>> = [];
        for (const i of range(this.data.inputs.length)) {
            promises.push(
                this.signInputHDAsync(i, hdKeyPair, sighashTypes).then(
                    () => {
                        results.push(true);
                    },
                    () => {
                        results.push(false);
                    },
                ),
            );
        }
        await Promise.all(promises);
        if (results.every((v) => !v)) {
            throw new Error('No inputs were signed');
        }
    }

    public signInputHD(
        inputIndex: number,
        hdKeyPair: HDSigner,
        sighashTypes: number[] = [Transaction.SIGHASH_ALL],
    ): this {
        if (!hdKeyPair || !hdKeyPair.publicKey || !hdKeyPair.fingerprint) {
            throw new Error('Need HDSigner to sign input');
        }
        const signers = this.#lazySigner.getSignersFromHD(inputIndex, this.data.inputs, hdKeyPair);
        signers.forEach((signer) => this.signInput(inputIndex, signer, sighashTypes));
        return this;
    }

    public async signInputHDAsync(
        inputIndex: number,
        hdKeyPair: HDSigner | HDSignerAsync,
        sighashTypes: number[] = [Transaction.SIGHASH_ALL],
    ): Promise<void> {
        if (!hdKeyPair || !hdKeyPair.publicKey || !hdKeyPair.fingerprint) {
            throw new Error('Need HDSigner to sign input');
        }
        const signers = this.#lazySigner.getSignersFromHD(inputIndex, this.data.inputs, hdKeyPair);
        const promises = signers.map((signer) =>
            this.signInputAsync(inputIndex, signer, sighashTypes),
        );
        await Promise.all(promises);
    }

    public signAllInputs(
        keyPair: Signer | HDSigner,
        sighashTypes?: number[],
    ): this {
        if (!keyPair || !keyPair.publicKey) throw new Error('Need Signer to sign input');

        const results: boolean[] = [];
        for (const i of range(this.data.inputs.length)) {
            try {
                this.signInput(i, keyPair, sighashTypes);
                results.push(true);
            } catch (err) {
                results.push(false);
            }
        }
        if (results.every((v) => !v)) {
            throw new Error('No inputs were signed');
        }
        return this;
    }

    public async signAllInputsAsync(
        keyPair: Signer | SignerAsync | HDSigner | HDSignerAsync,
        sighashTypes?: number[],
    ): Promise<void> {
        if (!keyPair || !keyPair.publicKey) throw new Error('Need Signer to sign input');

        const results: boolean[] = [];
        const promises: Array<Promise<void>> = [];
        for (const [i] of this.data.inputs.entries()) {
            promises.push(
                this.signInputAsync(i, keyPair, sighashTypes).then(
                    () => {
                        results.push(true);
                    },
                    () => {
                        results.push(false);
                    },
                ),
            );
        }
        await Promise.all(promises);
        if (results.every((v) => !v)) {
            throw new Error('No inputs were signed');
        }
    }

    public signInput(
        inputIndex: number,
        keyPair: Signer | HDSigner,
        sighashTypes?: number[],
    ): this {
        if (!keyPair || !keyPair.publicKey) {
            throw new Error('Need Signer to sign input');
        }

        const input = checkForInput(this.data.inputs, inputIndex);
        if (isTaprootInput(input)) {
            return this.#signTaprootInput(inputIndex, input, keyPair, undefined, sighashTypes);
        }

        return this.#signInput(inputIndex, keyPair, sighashTypes);
    }

    public signTaprootInput(
        inputIndex: number,
        keyPair: Signer | HDSigner,
        tapLeafHashToSign?: Uint8Array,
        sighashTypes?: number[],
    ): this {
        if (!keyPair || !keyPair.publicKey) {
            throw new Error('Need Signer to sign input');
        }

        const input = checkForInput(this.data.inputs, inputIndex);
        if (isTaprootInput(input)) {
            return this.#signTaprootInput(
                inputIndex,
                input,
                keyPair,
                tapLeafHashToSign,
                sighashTypes,
            );
        }

        throw new Error(`Input #${inputIndex} is not of type Taproot.`);
    }

    public async signInputAsync(
        inputIndex: number,
        keyPair: Signer | SignerAsync | HDSigner | HDSignerAsync,
        sighashTypes?: number[],
    ): Promise<void> {
        if (!keyPair || !keyPair.publicKey) throw new Error('Need Signer to sign input');

        const input = checkForInput(this.data.inputs, inputIndex);
        if (isTaprootInput(input))
            return this.#signTaprootInputAsync(
                inputIndex,
                input,
                keyPair,
                undefined,
                sighashTypes,
            );

        return this.#signInputAsync(inputIndex, keyPair, sighashTypes);
    }

    public async signTaprootInputAsync(
        inputIndex: number,
        keyPair: Signer | SignerAsync | HDSigner | HDSignerAsync,
        tapLeafHash?: Uint8Array,
        sighashTypes?: number[],
    ): Promise<void> {
        if (!keyPair || !keyPair.publicKey) throw new Error('Need Signer to sign input');

        const input = checkForInput(this.data.inputs, inputIndex);
        if (isTaprootInput(input))
            return this.#signTaprootInputAsync(
                inputIndex,
                input,
                keyPair,
                tapLeafHash,
                sighashTypes,
            );

        throw new Error(`Input #${inputIndex} is not of type Taproot.`);
    }

    public toBuffer(): Uint8Array {
        checkCache(this.#cache);
        return new Uint8Array(this.data.toBuffer());
    }

    public toHex(): string {
        checkCache(this.#cache);
        return this.data.toHex();
    }

    public toBase64(): string {
        checkCache(this.#cache);
        return this.data.toBase64();
    }

    public updateGlobal(updateData: PsbtGlobalUpdate): this {
        this.data.updateGlobal(updateData);
        return this;
    }

    public updateInput(inputIndex: number, updateData: PsbtInputUpdate): this {
        if (updateData.witnessScript) checkInvalidP2WSH(updateData.witnessScript);
        checkTaprootInputFields(this.data.inputs[inputIndex] as PsbtInput, updateData, 'updateInput');
        const normalizedUpdate = updateData.witnessUtxo
            ? {
                  ...updateData,
                  witnessUtxo: {
                      script: updateData.witnessUtxo.script,
                      value:
                          typeof updateData.witnessUtxo.value === 'bigint'
                              ? updateData.witnessUtxo.value
                              : BigInt(updateData.witnessUtxo.value),
                  },
              }
            : updateData;
        this.data.updateInput(inputIndex, normalizedUpdate);
        if (updateData.nonWitnessUtxo) {
            this.#cache.addNonWitnessTxCache(
                this.data.inputs[inputIndex] as PsbtInput,
                inputIndex,
                txFromBuffer,
            );
        }
        return this;
    }

    public updateOutput(outputIndex: number, updateData: PsbtOutputUpdate): this {
        const outputData = this.data.outputs[outputIndex] as PsbtOutput;
        checkTaprootOutputFields(outputData, updateData, 'updateOutput');

        this.data.updateOutput(outputIndex, updateData);
        return this;
    }

    public addUnknownKeyValToGlobal(keyVal: KeyValue): this {
        this.data.addUnknownKeyValToGlobal(keyVal);
        return this;
    }

    public addUnknownKeyValToInput(inputIndex: number, keyVal: KeyValue): this {
        this.data.addUnknownKeyValToInput(inputIndex, keyVal);
        return this;
    }

    public addUnknownKeyValToOutput(outputIndex: number, keyVal: KeyValue): this {
        this.data.addUnknownKeyValToOutput(outputIndex, keyVal);
        return this;
    }

    public clearFinalizedInput(inputIndex: number): this {
        this.data.clearFinalizedInput(inputIndex);
        return this;
    }

    public checkTaprootHashesForSig(
        inputIndex: number,
        input: PsbtInput,
        keyPair: Signer | SignerAsync | HDSigner | HDSignerAsync | TaprootHashCheckSigner,
        tapLeafHashToSign?: Uint8Array,
        allowedSighashTypes?: number[],
    ): { hash: MessageHash; leafHash?: Bytes32 }[] {
        if (!('signSchnorr' in keyPair) || typeof keyPair.signSchnorr !== 'function')
            throw new Error(`Need Schnorr Signer to sign taproot input #${inputIndex}.`);

        const pubkey =
            keyPair.publicKey instanceof Uint8Array
                ? keyPair.publicKey
                : new Uint8Array(keyPair.publicKey);

        const hashesForSig = this.#lazySigner.getTaprootHashesForSig(
            inputIndex,
            input,
            this.data.inputs,
            pubkey,
            tapLeafHashToSign,
            allowedSighashTypes,
        );

        if (!hashesForSig || !hashesForSig.length)
            throw new Error(`Can not sign for input #${inputIndex} with the key ${toHex(pubkey)}`);

        return hashesForSig;
    }

    #finalizeInput(
        inputIndex: number,
        input: PsbtInput,
        finalScriptsFunc: FinalScriptsFunc = getFinalScripts,
        canRunChecks: boolean = true,
    ): this {
        const { script, isP2SH, isP2WSH, isSegwit } = this.#lazyFinalizer.getScriptFromInput(
            inputIndex,
            input,
        );
        if (!script) throw new Error(`No script found for input #${inputIndex}`);

        checkPartialSigSighashes(input);

        const { finalScriptSig, finalScriptWitness } = finalScriptsFunc(
            inputIndex,
            input,
            script,
            isSegwit,
            isP2SH,
            isP2WSH,
            canRunChecks,
        );

        if (finalScriptSig) this.data.updateInput(inputIndex, { finalScriptSig });
        if (finalScriptWitness) this.data.updateInput(inputIndex, { finalScriptWitness });
        if (!finalScriptSig && !finalScriptWitness)
            throw new Error(`Unknown error finalizing input #${inputIndex}`);

        this.data.clearFinalizedInput(inputIndex);
        return this;
    }

    #finalizeTaprootInput(
        inputIndex: number,
        input: PsbtInput,
        tapLeafHashToFinalize?: Bytes32,
        finalScriptsFunc: FinalTaprootScriptsFunc = tapScriptFinalizer,
    ): this {
        if (!input.witnessUtxo)
            throw new Error(`Cannot finalize input #${inputIndex}. Missing witness utxo.`);

        // P2MR has no key-path spend — always use script-path finalization
        if (input.tapKeySig && !isP2MRInput(input)) {
            const payment = payments.p2tr({
                output: input.witnessUtxo.script as Script,
                signature: input.tapKeySig as SchnorrSignature,
            });
            if (!payment.witness) throw new Error('Cannot finalize taproot key spend');
            const finalScriptWitness = witnessStackToScriptWitness(payment.witness);
            this.data.updateInput(inputIndex, { finalScriptWitness });
        } else {
            const { finalScriptWitness } = finalScriptsFunc(
                inputIndex,
                input,
                tapLeafHashToFinalize,
            );
            this.data.updateInput(inputIndex, { finalScriptWitness } as PsbtInputUpdate);
        }

        this.data.clearFinalizedInput(inputIndex);

        return this;
    }

    #validateSignaturesOfInput(
        inputIndex: number,
        validator: ValidateSigFunction,
        pubkey?: PublicKey,
    ): boolean {
        const input = this.data.inputs[inputIndex];
        const partialSig = input?.partialSig;
        if (!input || !partialSig || partialSig.length < 1)
            throw new Error('No signatures to validate');
        if (typeof validator !== 'function')
            throw new Error('Need validator function to validate signatures');
        const mySigs = pubkey ? partialSig.filter((sig) => equals(sig.pubkey, pubkey)) : partialSig;
        if (mySigs.length < 1) throw new Error('No signatures for this pubkey');
        const results: boolean[] = [];
        let hashCache: MessageHash | undefined;
        let scriptCache: Script | undefined;
        let sighashCache: number | undefined;
        for (const pSig of mySigs) {
            const pSigSignature = pSig.signature;
            const pSigPubkey = pSig.pubkey as PublicKey;
            const sig = bscript.signature.decode(pSigSignature);
            const { hash, script } =
                sighashCache !== sig.hashType || !hashCache || !scriptCache
                    ? this.#lazySigner.getHashForSig(
                          inputIndex,
                          Object.assign({}, input, {
                              sighashType: sig.hashType,
                          }),
                          true,
                      )
                    : { hash: hashCache, script: scriptCache };
            sighashCache = sig.hashType;
            hashCache = hash;
            scriptCache = script;
            checkScriptForPubkey(pSigPubkey, script, 'verify');
            results.push(validator(pSigPubkey, hash, sig.signature));
        }
        return results.every((res) => res);
    }

    #validateSignaturesOfTaprootInput(
        inputIndex: number,
        validator: ValidateSigFunction,
        pubkey?: PublicKey,
    ): boolean {
        const input = this.data.inputs[inputIndex] as PsbtInput;
        const tapKeySig = input?.tapKeySig;
        const tapScriptSig = input?.tapScriptSig;
        if (!input && !tapKeySig && !(tapScriptSig && !tapScriptSig.length))
            throw new Error('No signatures to validate');
        if (typeof validator !== 'function')
            throw new Error('Need validator function to validate signatures');

        const xPubkey = pubkey ? toXOnly(pubkey) : undefined;
        const allHashses = xPubkey
            ? this.#lazySigner.getTaprootHashesForSig(inputIndex, input, this.data.inputs, xPubkey)
            : this.#lazySigner.getAllTaprootHashesForSig(inputIndex, input, this.data.inputs);

        if (!allHashses.length) throw new Error('No signatures for this pubkey');

        const tapKeyHash = allHashses.find((h) => !h.leafHash);
        let validationResultCount = 0;
        if (tapKeySig && tapKeyHash) {
            const isValidTapkeySig = validator(
                tapKeyHash.pubkey,
                tapKeyHash.hash,
                this.#lazySigner.trimTaprootSig(tapKeySig),
            );
            if (!isValidTapkeySig) return false;
            validationResultCount++;
        }

        if (tapScriptSig) {
            for (const tapSig of tapScriptSig) {
                const tapSigPubkey = tapSig.pubkey as PublicKey;
                const tapSigHash = allHashses.find((h) => equals(tapSigPubkey, h.pubkey));
                if (tapSigHash) {
                    const isValidTapScriptSig = validator(
                        tapSigPubkey,
                        tapSigHash.hash,
                        this.#lazySigner.trimTaprootSig(tapSig.signature),
                    );
                    if (!isValidTapScriptSig) return false;
                    validationResultCount++;
                }
            }
        }

        return validationResultCount > 0;
    }

    #signInput(
        inputIndex: number,
        keyPair: Signer | HDSigner,
        sighashTypes: number[] = [Transaction.SIGHASH_ALL],
    ): this {
        const pubkey =
            keyPair.publicKey instanceof Uint8Array
                ? keyPair.publicKey
                : new Uint8Array(keyPair.publicKey);

        const { hash, sighashType } = this.#lazySigner.getHashAndSighashType(
            this.data.inputs,
            inputIndex,
            pubkey,
            sighashTypes,
        );

        const sig = keyPair.sign(hash);
        const partialSig = [
            {
                pubkey,
                signature: bscript.signature.encode(
                    sig instanceof Uint8Array ? sig : new Uint8Array(sig),
                    sighashType,
                ),
            },
        ];

        this.data.updateInput(inputIndex, { partialSig });
        this.#cache.hasSignatures = true;
        return this;
    }

    #signTaprootInput(
        inputIndex: number,
        input: PsbtInput,
        keyPair: Signer | HDSigner,
        tapLeafHashToSign?: Uint8Array,
        allowedSighashTypes: number[] = [Transaction.SIGHASH_DEFAULT],
    ): this {
        const pubkey = (
            keyPair.publicKey instanceof Uint8Array
                ? keyPair.publicKey
                : new Uint8Array(keyPair.publicKey)
        ) as PublicKey;

        if (!('signSchnorr' in keyPair) || typeof keyPair.signSchnorr !== 'function')
            throw new Error(`Need Schnorr Signer to sign taproot input #${inputIndex}.`);

        const hashesForSig = this.checkTaprootHashesForSig(
            inputIndex,
            input,
            keyPair,
            tapLeafHashToSign,
            allowedSighashTypes,
        );
        const signSchnorr = (keyPair.signSchnorr as (h: MessageHash) => SchnorrSignature).bind(keyPair);

        const tapKeySig = hashesForSig
            .filter((h) => !h.leafHash)
            .map((h) =>
                serializeTaprootSignature(signSchnorr(h.hash), input.sighashType),
            )[0] as TapKeySig;

        const tapScriptSig = hashesForSig
            .filter((h) => !!h.leafHash)
            .map(
                (h) =>
                    ({
                        pubkey: toXOnly(pubkey),
                        signature: serializeTaprootSignature(
                            signSchnorr(h.hash),
                            input.sighashType,
                        ),
                        leafHash: h.leafHash,
                    }) as TapScriptSig,
            );

        if (tapKeySig) {
            this.data.updateInput(inputIndex, { tapKeySig });
            this.#cache.hasSignatures = true;
        }

        if (tapScriptSig.length) {
            this.data.updateInput(inputIndex, { tapScriptSig });
            this.#cache.hasSignatures = true;
        }

        return this;
    }

    async #signInputAsync(
        inputIndex: number,
        keyPair: Signer | SignerAsync | HDSigner | HDSignerAsync,
        sighashTypes: number[] = [Transaction.SIGHASH_ALL],
    ): Promise<void> {
        const pubkey =
            keyPair.publicKey instanceof Uint8Array
                ? keyPair.publicKey
                : new Uint8Array(keyPair.publicKey);

        const { hash, sighashType } = this.#lazySigner.getHashAndSighashType(
            this.data.inputs,
            inputIndex,
            pubkey,
            sighashTypes,
        );

        const signature = await keyPair.sign(hash);
        const sig = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
        const partialSig = [
            {
                pubkey,
                signature: bscript.signature.encode(sig, sighashType),
            },
        ];

        this.data.updateInput(inputIndex, { partialSig });
        this.#cache.hasSignatures = true;
    }

    async #signTaprootInputAsync(
        inputIndex: number,
        input: PsbtInput,
        keyPair: Signer | SignerAsync | HDSigner | HDSignerAsync,
        tapLeafHash?: Uint8Array,
        sighashTypes: number[] = [Transaction.SIGHASH_DEFAULT],
    ): Promise<void> {
        const pubkey = (
            keyPair.publicKey instanceof Uint8Array
                ? keyPair.publicKey
                : new Uint8Array(keyPair.publicKey)
        ) as PublicKey;

        if (!('signSchnorr' in keyPair) || typeof keyPair.signSchnorr !== 'function')
            throw new Error(`Need Schnorr Signer to sign taproot input #${inputIndex}.`);

        const hashesForSig = this.checkTaprootHashesForSig(
            inputIndex,
            input,
            keyPair,
            tapLeafHash,
            sighashTypes,
        );
        const signSchnorr = (
            keyPair.signSchnorr as (hash: MessageHash) => SchnorrSignature | Promise<SchnorrSignature>
        ).bind(keyPair);

        const tapKeyHash = hashesForSig.find((h) => !h.leafHash);
        if (tapKeyHash) {
            const sig = await signSchnorr(tapKeyHash.hash);
            const tapKeySig = serializeTaprootSignature(sig, input.sighashType);
            this.data.updateInput(inputIndex, { tapKeySig });
            this.#cache.hasSignatures = true;
        }

        const tapScriptHashes = hashesForSig.filter(
            (h): h is typeof h & { leafHash: Bytes32 } => !!h.leafHash,
        );
        if (tapScriptHashes.length) {
            const tapScriptSigs = await Promise.all(
                tapScriptHashes.map(async (tsh) => {
                    const signature = await signSchnorr(tsh.hash);
                    return {
                        pubkey: toXOnly(pubkey),
                        signature: serializeTaprootSignature(signature, input.sighashType),
                        leafHash: tsh.leafHash,
                    } as TapScriptSig;
                }),
            );
            this.data.updateInput(inputIndex, { tapScriptSig: tapScriptSigs });
            this.#cache.hasSignatures = true;
        }
    }
}
