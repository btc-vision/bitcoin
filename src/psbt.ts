import {
    Psbt as PsbtBase,
    checkForInput,
    checkForOutput,
} from 'bip174';
import type {
    Bip32Derivation,
    KeyValue,
    PartialSig,
    PsbtGlobalUpdate,
    PsbtInput,
    PsbtInputUpdate,
    PsbtOutput,
    PsbtOutputUpdate,
    TapKeySig,
    TapScriptSig,
    Transaction as ITransaction,
    TransactionFromBuffer,
} from 'bip174';
import { clone, reverse, equals, fromHex, toHex, fromBase64 } from './io/index.js';

import type { BIP32Interface } from '@btc-vision/bip32';
import type { ECPairInterface } from 'ecpair';
import { fromOutputScript, isUnknownSegwitVersion, toOutputScript } from './address.js';
import { bitcoin as btcNetwork } from './networks.js';
import * as payments from './payments/index.js';
import type { P2WSHPayment } from './payments/index.js';
import { tapleafHash } from './payments/bip341.js';
import type { P2SHPayment } from './payments/index.js';
import {
    checkTaprootInputFields,
    checkTaprootOutputFields,
    isTaprootInput,
    serializeTaprootSignature,
    tapScriptFinalizer,
} from './psbt/bip371.js';
import { toXOnly } from './pubkey.js';
import {
    isP2TR,
    isP2WPKH,
    pubkeyInScript,
    witnessStackToScriptWitness,
} from './psbt/psbtutils.js';
import {
    check32Bit,
    checkCache,
    checkInputsForPartialSig,
    checkPartialSigSighashes,
    checkScriptForPubkey,
    checkTxEmpty,
    checkTxForDupeIns,
    checkTxInputCache,
    isFinalized,
} from './psbt/validation.js';
import {
    checkInvalidP2WSH,
    classifyScript,
    compressPubkey,
    getMeaningfulScript,
    isPubkeyLike,
    isSigLike,
    range,
    scriptWitnessToWitnessStack,
    sighashTypeToString,
} from './psbt/utils.js';
import * as bscript from './script.js';
import { Transaction } from './transaction.js';
import type { Output } from './transaction.js';
import type { Bytes20, Bytes32, PublicKey, Satoshi, SchnorrSignature, Signature, Script, XOnlyPublicKey } from './types.js';

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
    PsbtOutputExtendedAddress,
    PsbtOutputExtendedScript,
    HDSigner,
    HDSignerAsync,
    SignerAlternative,
    Signer,
    SignerAsync,
    TaprootHashCheckSigner,
    GetScriptReturn,
    FinalScriptsFunc,
    FinalTaprootScriptsFunc,
} from './psbt/types.js';

// Re-export const enum objects (value + type via declaration merging)
export {
    ScriptType,
    AllScriptType,
} from './psbt/types.js';


// Import types for internal use
import type {
    TransactionInput,
    PsbtTxInput,
    TransactionOutput,
    PsbtTxOutput,
    PsbtBaseExtended,
    PsbtOptsOptional,
    PsbtOpts,
    PsbtInputExtended,
    PsbtOutputExtended,
    PsbtOutputExtendedAddress,
    HDSigner,
    HDSignerAsync,
    SignerAlternative,
    Signer,
    SignerAsync,
    TaprootHashCheckSigner,
    PsbtCache,
    AllScriptType,
    GetScriptReturn,
    FinalScriptsFunc,
    FinalTaprootScriptsFunc,
    ValidateSigFunction,
} from './psbt/types.js';

/**
 * These are the default arguments for a Psbt instance.
 */
const DEFAULT_OPTS: PsbtOpts = {
    /**
     * A bitcoinjs Network object. This is only used if you pass an `address`
     * parameter to addOutput. Otherwise it is not needed and can be left default.
     */
    network: btcNetwork,
    /**
     * When extractTransaction is called, the fee rate is checked.
     * THIS IS NOT TO BE RELIED ON.
     * It is only here as a last ditch effort to prevent sending a 500 BTC fee etc.
     */
    maximumFeeRate: 5000, // satoshi per byte
};

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
/**
 * Psbt class can parse and generate a PSBT binary based off of the BIP174.
 */
export class Psbt {
    readonly #cache: PsbtCache;
    readonly #opts: PsbtOpts;

    constructor(
        opts: PsbtOptsOptional = {},
        public data: PsbtBaseExtended = new PsbtBase(new PsbtTransaction()),
    ) {
        this.#opts = Object.assign({}, DEFAULT_OPTS, opts);
        this.#cache = {
            nonWitnessUtxoTxCache: [],
            nonWitnessUtxoBufCache: [],
            txInCache: {},
            // unsignedTx.tx property is dynamically added by PsbtBase
            tx: (this.data.globalMap.unsignedTx as PsbtTransaction).tx,
            unsafeSignNonSegwit: false,
            hasSignatures: false,
        };

        if (opts.version === 3) {
            this.setVersionTRUC();
        } else if (this.data.inputs.length === 0) this.setVersion(2);
    }

    #clearCachedTx(): void {
        this.#cache.fee = undefined;
        this.#cache.feeRate = undefined;
        this.#cache.extractedTx = undefined;
    }

    #clearCachedSigning(): void {
        this.#cache.prevOuts = undefined;
        this.#cache.signingScripts = undefined;
        this.#cache.values = undefined;
        this.#cache.taprootHashCache = undefined;
    }

    get inputCount(): number {
        return this.data.inputs.length;
    }

    get version(): number {
        return this.#cache.tx.version;
    }

    set version(version: number) {
        this.setVersion(version);
    }

    get locktime(): number {
        return this.#cache.tx.locktime;
    }

    set locktime(locktime: number) {
        this.setLocktime(locktime);
    }

    get txInputs(): PsbtTxInput[] {
        return this.#cache.tx.ins.map((input) => ({
            hash: clone(input.hash) as Bytes32,
            index: input.index,
            sequence: input.sequence,
        }));
    }

    get txOutputs(): PsbtTxOutput[] {
        return this.#cache.tx.outs.map((output) => {
            let address;
            try {
                address = fromOutputScript(output.script, this.#opts.network);
            } catch (_) {}
            return {
                script: clone(output.script) as Script,
                value: output.value,
                address,
            };
        });
    }

    static fromBase64(data: string, opts: PsbtOptsOptional = {}): Psbt {
        const buffer = fromBase64(data);
        return this.fromBuffer(buffer, opts);
    }

    static fromHex(data: string, opts: PsbtOptsOptional = {}): Psbt {
        const buffer = fromHex(data);
        return this.fromBuffer(buffer, opts);
    }

    static fromBuffer(buffer: Uint8Array, opts: PsbtOptsOptional = {}): Psbt {
        const psbtBase = PsbtBase.fromBuffer(buffer, transactionFromBuffer);
        const psbt = new Psbt(opts, psbtBase);
        checkTxForDupeIns(psbt.#cache.tx, psbt.#cache);
        // Check if restored PSBT has any signatures (partial or finalized)
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

    combine(...those: Psbt[]): this {
        this.data.combine(...those.map((o) => o.data));
        return this;
    }

    clone(): Psbt {
        // TODO: more efficient cloning
        const clonedOpts = JSON.parse(JSON.stringify(this.#opts)) as PsbtOptsOptional;
        return Psbt.fromBuffer(new Uint8Array(this.data.toBuffer()), clonedOpts);
    }

    setMaximumFeeRate(satoshiPerByte: number): void {
        check32Bit(satoshiPerByte); // 42.9 BTC per byte IS excessive... so throw
        this.#opts.maximumFeeRate = satoshiPerByte;
    }

    setVersion(version: number): this {
        check32Bit(version);
        checkInputsForPartialSig(this.data.inputs, 'setVersion', this.#cache.hasSignatures);
        this.#cache.tx.version = version;
        this.#clearCachedTx();
        return this;
    }

    setVersionTRUC(): this {
        return this.setVersion(Transaction.TRUC_VERSION);
    }

    setLocktime(locktime: number): this {
        check32Bit(locktime);
        checkInputsForPartialSig(this.data.inputs, 'setLocktime', this.#cache.hasSignatures);
        this.#cache.tx.locktime = locktime;
        this.#clearCachedTx();
        return this;
    }

    setInputSequence(inputIndex: number, sequence: number): this {
        check32Bit(sequence);
        checkInputsForPartialSig(this.data.inputs, 'setInputSequence', this.#cache.hasSignatures);
        if (this.#cache.tx.ins.length <= inputIndex) {
            throw new Error('Input index too high');
        }
        this.#cache.tx.ins[inputIndex]!.sequence = sequence;
        this.#clearCachedTx();
        return this;
    }

    addInputs(inputDatas: PsbtInputExtended[], checkPartialSigs: boolean = true): this {
        inputDatas.forEach((inputData) => this.addInput(inputData, checkPartialSigs));
        return this;
    }

    addInput(inputData: PsbtInputExtended, checkPartialSigs: boolean = true): this {
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
        // Convert witnessUtxo for bip174 v3 compatibility (value: bigint, script: Uint8Array)
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
        const txIn = this.#cache.tx.ins[this.#cache.tx.ins.length - 1]!;
        checkTxInputCache(this.#cache, txIn);

        const inputIndex = this.data.inputs.length - 1;
        const input = this.data.inputs[inputIndex]!;
        if (input.nonWitnessUtxo) {
            addNonWitnessTxCache(this.#cache, input, inputIndex);
        }
        this.#clearCachedTx();
        this.#clearCachedSigning();
        return this;
    }

    addOutputs(outputDatas: PsbtOutputExtended[], checkPartialSigs: boolean = true): this {
        outputDatas.forEach((outputData) => this.addOutput(outputData, checkPartialSigs));
        return this;
    }

    /**
     * Add an output to the PSBT.
     *
     * **PERFORMANCE WARNING:** Passing an `address` string is ~10x slower than passing
     * a `script` directly due to address parsing overhead (bech32 decode, etc.).
     * For high-performance use cases with many outputs, pre-compute the script using
     * `toOutputScript(address, network)` and pass `{ script, value }` instead.
     *
     * @param outputData - Output data with either `address` or `script`, and `value`
     * @param checkPartialSigs - Whether to check for existing signatures (default: true)
     */
    addOutput(outputData: PsbtOutputExtended, checkPartialSigs: boolean = true): this {
        const hasAddress = 'address' in outputData;
        const hasScript = 'script' in outputData;
        if (
            !outputData ||
            outputData.value === undefined ||
            (!hasAddress && !hasScript)
        ) {
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
            const script = toOutputScript(address, network) as Script;
            outputData = Object.assign({}, outputData, { script });
        }
        checkTaprootOutputFields(outputData, outputData, 'addOutput');

        this.data.addOutput(outputData);
        this.#clearCachedTx();
        this.#cache.taprootHashCache = undefined;
        return this;
    }

    extractTransaction(disableFeeCheck?: boolean, disableOutputChecks?: boolean): Transaction {
        if (disableOutputChecks) {
            (this.data as unknown as { inputs: PsbtInput[] }).inputs = this.data.inputs.filter((i) => !i.partialSig);
        }

        if (!this.data.inputs.every(isFinalized)) throw new Error('Not finalized');
        if (!disableFeeCheck) {
            checkFees(this, this.#cache, this.#opts);
        }
        if (this.#cache.extractedTx) return this.#cache.extractedTx;
        const tx = this.#cache.tx.clone();
        inputFinalizeGetAmts(this.data.inputs, tx, this.#cache, true, disableOutputChecks);
        return tx;
    }

    getFeeRate(disableOutputChecks: boolean = false): number {
        if (!this.data.inputs.every(isFinalized))
            throw new Error('PSBT must be finalized to calculate fee rate');
        if (this.#cache.feeRate !== undefined) return this.#cache.feeRate;
        const tx = this.#cache.extractedTx ?? this.#cache.tx.clone();
        const mustFinalize = !this.#cache.extractedTx;
        inputFinalizeGetAmts(this.data.inputs, tx, this.#cache, mustFinalize, disableOutputChecks);
        if (this.#cache.feeRate === undefined)
            throw new Error('Failed to calculate fee rate');
        return this.#cache.feeRate;
    }

    getFee(disableOutputChecks: boolean = false): number {
        if (!this.data.inputs.every(isFinalized))
            throw new Error('PSBT must be finalized to calculate fee');
        if (this.#cache.fee !== undefined) return this.#cache.fee;
        const tx = this.#cache.extractedTx ?? this.#cache.tx.clone();
        const mustFinalize = !this.#cache.extractedTx;
        inputFinalizeGetAmts(this.data.inputs, tx, this.#cache, mustFinalize, disableOutputChecks);
        if (this.#cache.fee === undefined)
            throw new Error('Failed to calculate fee');
        return this.#cache.fee;
    }

    finalizeAllInputs(): this {
        checkForInput(this.data.inputs, 0); // making sure we have at least one
        range(this.data.inputs.length).forEach((idx) => this.finalizeInput(idx));
        return this;
    }

    finalizeInput(
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

    finalizeTaprootInput(
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

    getInputType(inputIndex: number): AllScriptType {
        const input = checkForInput(this.data.inputs, inputIndex);
        const script = getScriptFromUtxo(inputIndex, input, this.#cache);
        const result = getMeaningfulScript(
            script,
            inputIndex,
            'input',
            input.redeemScript ||
                redeemFromFinalScriptSig(input.finalScriptSig),
            input.witnessScript ||
                redeemFromFinalWitnessScript(input.finalScriptWitness),
        );
        const type = result.type === 'raw' ? '' : result.type + '-';
        const mainType = classifyScript(result.meaningfulScript);
        return (type + mainType) as AllScriptType;
    }

    inputHasPubkey(inputIndex: number, pubkey: PublicKey): boolean {
        const input = checkForInput(this.data.inputs, inputIndex);
        return pubkeyInInput(pubkey, input, inputIndex, this.#cache);
    }

    inputHasHDKey(inputIndex: number, root: HDSigner): boolean {
        const input = checkForInput(this.data.inputs, inputIndex);
        const derivationIsMine = bip32DerivationIsMine(root);
        return !!input.bip32Derivation && input.bip32Derivation.some(derivationIsMine);
    }

    outputHasPubkey(outputIndex: number, pubkey: PublicKey): boolean {
        const output = checkForOutput(this.data.outputs, outputIndex);
        return pubkeyInOutput(pubkey, output, outputIndex, this.#cache);
    }

    outputHasHDKey(outputIndex: number, root: HDSigner): boolean {
        const output = checkForOutput(this.data.outputs, outputIndex);
        const derivationIsMine = bip32DerivationIsMine(root);
        return !!output.bip32Derivation && output.bip32Derivation.some(derivationIsMine);
    }

    validateSignaturesOfAllInputs(validator: ValidateSigFunction): boolean {
        checkForInput(this.data.inputs, 0); // making sure we have at least one
        const results = range(this.data.inputs.length).map((idx) =>
            this.validateSignaturesOfInput(idx, validator),
        );
        return results.reduce((final, res) => res && final, true);
    }

    validateSignaturesOfInput(
        inputIndex: number,
        validator: ValidateSigFunction,
        pubkey?: PublicKey,
    ): boolean {
        const input = this.data.inputs[inputIndex]!;
        if (isTaprootInput(input))
            return this.#validateSignaturesOfTaprootInput(inputIndex, validator, pubkey);

        return this.#validateSignaturesOfInput(inputIndex, validator, pubkey);
    }

    signAllInputsHD(hdKeyPair: HDSigner, sighashTypes: number[] = [Transaction.SIGHASH_ALL]): this {
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

    signAllInputsHDAsync(
        hdKeyPair: HDSigner | HDSignerAsync,
        sighashTypes: number[] = [Transaction.SIGHASH_ALL],
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!hdKeyPair || !hdKeyPair.publicKey || !hdKeyPair.fingerprint) {
                return reject(new Error('Need HDSigner to sign input'));
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
            return Promise.all(promises).then(() => {
                if (results.every((v) => !v)) {
                    return reject(new Error('No inputs were signed'));
                }
                resolve();
            });
        });
    }

    signInputHD(
        inputIndex: number,
        hdKeyPair: HDSigner,
        sighashTypes: number[] = [Transaction.SIGHASH_ALL],
    ): this {
        if (!hdKeyPair || !hdKeyPair.publicKey || !hdKeyPair.fingerprint) {
            throw new Error('Need HDSigner to sign input');
        }
        const signers = getSignersFromHD(inputIndex, this.data.inputs, hdKeyPair);
        signers.forEach((signer) => this.signInput(inputIndex, signer, sighashTypes));
        return this;
    }

    signInputHDAsync(
        inputIndex: number,
        hdKeyPair: HDSigner | HDSignerAsync,
        sighashTypes: number[] = [Transaction.SIGHASH_ALL],
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!hdKeyPair || !hdKeyPair.publicKey || !hdKeyPair.fingerprint) {
                return reject(new Error('Need HDSigner to sign input'));
            }
            const signers = getSignersFromHD(inputIndex, this.data.inputs, hdKeyPair);
            const promises = signers.map((signer) =>
                this.signInputAsync(inputIndex, signer, sighashTypes),
            );
            return Promise.all(promises)
                .then(() => {
                    resolve();
                })
                .catch(reject);
        });
    }

    signAllInputs(
        keyPair: Signer | SignerAlternative | BIP32Interface | ECPairInterface,
        sighashTypes?: number[],
    ): this {
        if (!keyPair || !keyPair.publicKey) throw new Error('Need Signer to sign input');

        // TODO: Add a pubkey/pubkeyhash cache to each input
        // as input information is added, then eventually
        // optimize this method.
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

    signAllInputsAsync(
        keyPair: Signer | SignerAlternative | SignerAsync | BIP32Interface | ECPairInterface,
        sighashTypes?: number[],
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!keyPair || !keyPair.publicKey)
                return reject(new Error('Need Signer to sign input'));

            // TODO: Add a pubkey/pubkeyhash cache to each input
            // as input information is added, then eventually
            // optimize this method.
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
            return Promise.all(promises).then(() => {
                if (results.every((v) => !v)) {
                    return reject(new Error('No inputs were signed'));
                }
                resolve();
            });
        });
    }

    signInput(
        inputIndex: number,
        keyPair: Signer | SignerAlternative | HDSigner | BIP32Interface | ECPairInterface,
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

    signTaprootInput(
        inputIndex: number,
        keyPair: Signer | SignerAlternative | HDSigner | BIP32Interface | ECPairInterface,
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

    signInputAsync(
        inputIndex: number,
        keyPair: Signer | SignerAlternative | SignerAsync | HDSigner | HDSignerAsync | BIP32Interface | ECPairInterface,
        sighashTypes?: number[],
    ): Promise<void> {
        return Promise.resolve().then(() => {
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
        });
    }

    signTaprootInputAsync(
        inputIndex: number,
        keyPair: Signer | SignerAlternative | SignerAsync | HDSigner | HDSignerAsync | BIP32Interface | ECPairInterface,
        tapLeafHash?: Uint8Array,
        sighashTypes?: number[],
    ): Promise<void> {
        return Promise.resolve().then(() => {
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
        });
    }

    toBuffer(): Uint8Array {
        checkCache(this.#cache);
        return new Uint8Array(this.data.toBuffer());
    }

    toHex(): string {
        checkCache(this.#cache);
        return this.data.toHex();
    }

    toBase64(): string {
        checkCache(this.#cache);
        return this.data.toBase64();
    }

    updateGlobal(updateData: PsbtGlobalUpdate): this {
        this.data.updateGlobal(updateData);
        return this;
    }

    updateInput(inputIndex: number, updateData: PsbtInputUpdate): this {
        if (updateData.witnessScript) checkInvalidP2WSH(updateData.witnessScript);
        checkTaprootInputFields(this.data.inputs[inputIndex]!, updateData, 'updateInput');
        // Convert witnessUtxo for bip174 v3 compatibility (value: bigint, script: Uint8Array)
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
            addNonWitnessTxCache(this.#cache, this.data.inputs[inputIndex]!, inputIndex);
        }
        return this;
    }

    updateOutput(outputIndex: number, updateData: PsbtOutputUpdate): this {
        const outputData = this.data.outputs[outputIndex]!;
        checkTaprootOutputFields(outputData, updateData, 'updateOutput');

        this.data.updateOutput(outputIndex, updateData);
        return this;
    }

    addUnknownKeyValToGlobal(keyVal: KeyValue): this {
        this.data.addUnknownKeyValToGlobal(keyVal);
        return this;
    }

    addUnknownKeyValToInput(inputIndex: number, keyVal: KeyValue): this {
        this.data.addUnknownKeyValToInput(inputIndex, keyVal);
        return this;
    }

    addUnknownKeyValToOutput(outputIndex: number, keyVal: KeyValue): this {
        this.data.addUnknownKeyValToOutput(outputIndex, keyVal);
        return this;
    }

    clearFinalizedInput(inputIndex: number): this {
        this.data.clearFinalizedInput(inputIndex);
        return this;
    }

    checkTaprootHashesForSig(
        inputIndex: number,
        input: PsbtInput,
        keyPair: Signer | SignerAlternative | SignerAsync | HDSigner | HDSignerAsync | TaprootHashCheckSigner | BIP32Interface | ECPairInterface,
        tapLeafHashToSign?: Uint8Array,
        allowedSighashTypes?: number[],
    ): { hash: Bytes32; leafHash?: Bytes32 }[] {
        if (!('signSchnorr' in keyPair) || typeof keyPair.signSchnorr !== 'function')
            throw new Error(`Need Schnorr Signer to sign taproot input #${inputIndex}.`);

        const pubkey = keyPair.publicKey instanceof Uint8Array
            ? keyPair.publicKey
            : new Uint8Array(keyPair.publicKey);

        const hashesForSig = getTaprootHashesForSig(
            inputIndex,
            input,
            this.data.inputs,
            pubkey,
            this.#cache,
            tapLeafHashToSign,
            allowedSighashTypes,
        );

        if (!hashesForSig || !hashesForSig.length)
            throw new Error(
                `Can not sign for input #${inputIndex} with the key ${toHex(pubkey)}`,
            );

        return hashesForSig;
    }

    #finalizeInput(
        inputIndex: number,
        input: PsbtInput,
        finalScriptsFunc: FinalScriptsFunc = getFinalScripts,
        canRunChecks: boolean = true,
    ): this {
        const { script, isP2SH, isP2WSH, isSegwit } = getScriptFromInput(
            inputIndex,
            input,
            this.#cache,
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

        // Check key spend first. Increased privacy and reduced block space.
        if (input.tapKeySig) {
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
        const partialSig = (input || {}).partialSig;
        if (!input || !partialSig || partialSig.length < 1)
            throw new Error('No signatures to validate');
        if (typeof validator !== 'function')
            throw new Error('Need validator function to validate signatures');
        const mySigs = pubkey
            ? partialSig.filter((sig) => equals(sig.pubkey, pubkey))
            : partialSig;
        if (mySigs.length < 1) throw new Error('No signatures for this pubkey');
        const results: boolean[] = [];
        let hashCache: Bytes32 | undefined;
        let scriptCache: Script | undefined;
        let sighashCache: number | undefined;
        for (const pSig of mySigs) {
            const pSigSignature = pSig.signature;
            const pSigPubkey = pSig.pubkey as PublicKey;
            const sig = bscript.signature.decode(pSigSignature);
            const { hash, script } =
                sighashCache !== sig.hashType || !hashCache || !scriptCache
                    ? getHashForSig(
                          inputIndex,
                          Object.assign({}, input, {
                              sighashType: sig.hashType,
                          }),
                          this.#cache,
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
        const input = this.data.inputs[inputIndex]!;
        const tapKeySig = (input || {}).tapKeySig;
        const tapScriptSig = (input || {}).tapScriptSig;
        if (!input && !tapKeySig && !(tapScriptSig && !tapScriptSig.length))
            throw new Error('No signatures to validate');
        if (typeof validator !== 'function')
            throw new Error('Need validator function to validate signatures');

        const xPubkey = pubkey ? toXOnly(pubkey) : undefined;
        const allHashses = xPubkey
            ? getTaprootHashesForSig(inputIndex, input, this.data.inputs, xPubkey, this.#cache)
            : getAllTaprootHashesForSig(inputIndex, input, this.data.inputs, this.#cache);

        if (!allHashses.length) throw new Error('No signatures for this pubkey');

        const tapKeyHash = allHashses.find((h) => !h.leafHash);
        let validationResultCount = 0;
        if (tapKeySig && tapKeyHash) {
            const isValidTapkeySig = validator(
                tapKeyHash.pubkey,
                tapKeyHash.hash,
                trimTaprootSig(tapKeySig),
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
                        trimTaprootSig(tapSig.signature),
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
        keyPair: Signer | SignerAlternative | HDSigner | BIP32Interface | ECPairInterface,
        sighashTypes: number[] = [Transaction.SIGHASH_ALL],
    ): this {
        const pubkey = keyPair.publicKey instanceof Uint8Array
            ? keyPair.publicKey
            : new Uint8Array(keyPair.publicKey);

        const { hash, sighashType } = getHashAndSighashType(
            this.data.inputs,
            inputIndex,
            pubkey,
            this.#cache,
            sighashTypes,
        );

        const sig = keyPair.sign(hash) as Uint8Array;
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
        keyPair: Signer | SignerAlternative | HDSigner | BIP32Interface | ECPairInterface,
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

        // checkTaprootHashesForSig validates signSchnorr exists
        const hashesForSig = this.checkTaprootHashesForSig(
            inputIndex,
            input,
            keyPair,
            tapLeafHashToSign,
            allowedSighashTypes,
        );
        const signSchnorr = (keyPair.signSchnorr as (h: Uint8Array) => Uint8Array).bind(keyPair);

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

    #signInputAsync(
        inputIndex: number,
        keyPair: Signer | SignerAlternative | SignerAsync | HDSigner | HDSignerAsync | BIP32Interface | ECPairInterface,
        sighashTypes: number[] = [Transaction.SIGHASH_ALL],
    ): Promise<void> {
        const pubkey = keyPair.publicKey instanceof Uint8Array
            ? keyPair.publicKey
            : new Uint8Array(keyPair.publicKey);

        const { hash, sighashType } = getHashAndSighashType(
            this.data.inputs,
            inputIndex,
            pubkey,
            this.#cache,
            sighashTypes,
        );

        return Promise.resolve(keyPair.sign(hash)).then((signature) => {
            const sig = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
            const partialSig = [
                {
                    pubkey,
                    signature: bscript.signature.encode(sig, sighashType),
                },
            ];

            this.data.updateInput(inputIndex, { partialSig });
            this.#cache.hasSignatures = true;
        });
    }

    async #signTaprootInputAsync(
        inputIndex: number,
        input: PsbtInput,
        keyPair: Signer | SignerAlternative | SignerAsync | HDSigner | HDSignerAsync | BIP32Interface | ECPairInterface,
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

        // checkTaprootHashesForSig validates signSchnorr exists
        const hashesForSig = this.checkTaprootHashesForSig(
            inputIndex,
            input,
            keyPair,
            tapLeafHash,
            sighashTypes,
        );
        const signSchnorr = (
            keyPair.signSchnorr as (hash: Uint8Array) => Uint8Array | Promise<Uint8Array>
        ).bind(keyPair);

        type TapSignatureResult = { tapKeySig: Uint8Array } | { tapScriptSig: TapScriptSig[] };
        const signaturePromises: Promise<TapSignatureResult>[] = [];

        const tapKeyHash = hashesForSig.filter((h) => !h.leafHash)[0];
        if (tapKeyHash) {
            const tapKeySigPromise = Promise.resolve(signSchnorr(tapKeyHash.hash)).then((sig) => {
                return {
                    tapKeySig: serializeTaprootSignature(sig, input.sighashType),
                };
            });
            signaturePromises.push(tapKeySigPromise);
        }

        const tapScriptHashes = hashesForSig.filter(
            (h): h is typeof h & { leafHash: Bytes32 } => !!h.leafHash,
        );
        if (tapScriptHashes.length) {
            const tapScriptSigPromises = tapScriptHashes.map(async (tsh) => {
                const signature = await signSchnorr(tsh.hash);

                const tapScriptSig: TapScriptSig[] = [
                    {
                        pubkey: toXOnly(pubkey),
                        signature: serializeTaprootSignature(signature, input.sighashType),
                        leafHash: tsh.leafHash,
                    },
                ];

                return { tapScriptSig };
            });
            signaturePromises.push(...tapScriptSigPromises);
        }

        const results = await Promise.all(signaturePromises);
        for (const v of results) {
            this.data.updateInput(inputIndex, v as PsbtInputUpdate);
            this.#cache.hasSignatures = true;
        }
    }
}

/**
 * This function is needed to pass to the bip174 base class's fromBuffer.
 * It takes the "transaction buffer" portion of the psbt buffer and returns a
 * Transaction (From the bip174 library) interface.
 */
const transactionFromBuffer: TransactionFromBuffer = (buffer: Uint8Array): ITransaction =>
    new PsbtTransaction(buffer);

/**
 * This class implements the Transaction interface from bip174 library.
 * It contains a bitcoinjs-lib Transaction object.
 */
class PsbtTransaction implements ITransaction {
    tx: Transaction;

    constructor(buffer: Uint8Array = new Uint8Array([2, 0, 0, 0, 0, 0, 0, 0, 0, 0])) {
        this.tx = Transaction.fromBuffer(buffer);
        checkTxEmpty(this.tx);
        Object.defineProperty(this, 'tx', {
            enumerable: false,
            writable: true,
        });
    }

    getInputOutputCounts(): {
        inputCount: number;
        outputCount: number;
    } {
        return {
            inputCount: this.tx.ins.length,
            outputCount: this.tx.outs.length,
        };
    }

    addInput(input: TransactionInput): void {
        if (
            input.hash === undefined ||
            input.index === undefined ||
            (!(input.hash instanceof Uint8Array) && typeof input.hash !== 'string') ||
            typeof input.index !== 'number'
        ) {
            throw new Error('Error adding input.');
        }
        const hash = (
            typeof input.hash === 'string' ? reverse(fromHex(input.hash)) : input.hash
        ) as Bytes32;

        this.tx.addInput(hash, input.index, input.sequence);
    }

    addOutput(output: TransactionOutput): void {
        if (
            output.script === undefined ||
            output.value === undefined ||
            !(output.script instanceof Uint8Array) ||
            typeof output.value !== 'bigint'
        ) {
            throw new Error('Error adding output.');
        }
        this.tx.addOutput(output.script, output.value);
    }

    toBuffer(): Uint8Array {
        return this.tx.toBuffer();
    }
}

function canFinalize(input: PsbtInput, script: Uint8Array, scriptType: string): boolean {
    switch (scriptType) {
        case 'pubkey':
        case 'pubkeyhash':
        case 'witnesspubkeyhash':
            return hasSigs(1, input.partialSig);
        case 'multisig': {
            const p2ms = payments.p2ms({
                output: script as Script,
            });
            if (p2ms.m === undefined) throw new Error('Cannot determine m for multisig');
            return hasSigs(p2ms.m, input.partialSig, p2ms.pubkeys);
        }
        case 'nonstandard':
            return true;
        default:
            return false;
    }
}

function hasSigs(neededSigs: number, partialSig?: PartialSig[], pubkeys?: Uint8Array[]): boolean {
    if (!partialSig) return false;
    let sigs: PartialSig[];
    if (pubkeys) {
        sigs = pubkeys
            .map((pkey) => {
                const pubkey = compressPubkey(pkey);
                return partialSig.find((pSig) => equals(pSig.pubkey, pubkey));
            })
            .filter((v): v is PartialSig => !!v);
    } else {
        sigs = partialSig;
    }
    if (sigs.length > neededSigs) throw new Error('Too many signatures');
    return sigs.length === neededSigs;
}

function bip32DerivationIsMine(root: HDSigner): (d: Bip32Derivation) => boolean {
    return (d: Bip32Derivation): boolean => {
        const fingerprint = root.fingerprint instanceof Uint8Array
            ? root.fingerprint
            : new Uint8Array(root.fingerprint);
        if (!equals(d.masterFingerprint, fingerprint)) return false;
        const derivedPubkey = root.derivePath(d.path).publicKey;
        const pubkey = derivedPubkey instanceof Uint8Array ? derivedPubkey : new Uint8Array(derivedPubkey);
        if (!equals(pubkey, d.pubkey)) return false;
        return true;
    };
}

function checkFees(psbt: Psbt, cache: PsbtCache, opts: PsbtOpts): void {
    const feeRate = psbt.getFeeRate();
    if (!cache.extractedTx) throw new Error('Transaction not extracted');
    const vsize = cache.extractedTx.virtualSize();
    const satoshis = feeRate * vsize;
    if (feeRate >= opts.maximumFeeRate) {
        throw new Error(
            `Warning: You are paying around ${(satoshis / 1e8).toFixed(8)} in ` +
                `fees, which is ${feeRate} satoshi per byte for a transaction ` +
                `with a VSize of ${vsize} bytes (segwit counted as 0.25 byte per ` +
                `byte). Use setMaximumFeeRate method to raise your threshold, or ` +
                `pass true to the first arg of extractTransaction.`,
        );
    }
}

export function getFinalScripts(
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
    const scriptType = classifyScript(script);
    if (!canFinalize(input, script, scriptType) && canRunChecks) {
        throw new Error(`Can not finalize input #${inputIndex}`);
    }

    if (!input.partialSig) throw new Error('Input missing partial signatures');
    return prepareFinalScripts(
        script,
        scriptType,
        input.partialSig,
        isSegwit,
        isP2SH,
        isP2WSH,
        solution,
    );
}

export function prepareFinalScripts(
    script: Uint8Array,
    scriptType: string,
    partialSig: PartialSig[],
    isSegwit: boolean,
    isP2SH: boolean,
    isP2WSH: boolean,
    solution?: Uint8Array[],
): {
    finalScriptSig: Script | undefined;
    finalScriptWitness: Uint8Array | undefined;
} {
    let finalScriptSig: Script | undefined;
    let finalScriptWitness: Uint8Array | undefined;

    // Wow, the payments API is very handy
    const payment: payments.Payment = getPayment(script, scriptType, partialSig);
    const p2wsh = !isP2WSH ? null : payments.p2wsh({ redeem: payment } as P2WSHPayment);
    const p2sh = !isP2SH ? null : payments.p2sh({ redeem: p2wsh || payment } as P2SHPayment);

    if (isSegwit) {
        if (p2wsh && p2wsh.witness) {
            finalScriptWitness = witnessStackToScriptWitness(p2wsh.witness);
        } else if (payment && payment.witness) {
            finalScriptWitness = witnessStackToScriptWitness(payment.witness);
        } else {
            // nonstandard segwit script
            finalScriptWitness = witnessStackToScriptWitness(solution ?? [new Uint8Array([0x00])]);
        }
        if (p2sh) {
            finalScriptSig = p2sh?.input as Script | undefined;
        }
    } else {
        if (p2sh) {
            finalScriptSig = p2sh?.input as Script | undefined;
        } else {
            if (!payment) {
                finalScriptSig = (
                    Array.isArray(solution) && solution[0] ? solution[0] : new Uint8Array([0x01])
                ) as Script;
            } else {
                finalScriptSig = payment.input as Script | undefined;
            }
        }
    }
    return {
        finalScriptSig,
        finalScriptWitness,
    };
}

function getHashAndSighashType(
    inputs: PsbtInput[],
    inputIndex: number,
    pubkey: Uint8Array,
    cache: PsbtCache,
    sighashTypes: number[],
): {
    hash: Bytes32;
    sighashType: number;
} {
    const input = checkForInput(inputs, inputIndex);
    const { hash, sighashType, script } = getHashForSig(
        inputIndex,
        input,
        cache,
        false,
        sighashTypes,
    );

    checkScriptForPubkey(pubkey as PublicKey, script, 'sign');
    return {
        hash,
        sighashType,
    };
}

function getHashForSig(
    inputIndex: number,
    input: PsbtInput,
    cache: PsbtCache,
    forValidate: boolean,
    sighashTypes?: number[],
): {
    script: Script;
    hash: Bytes32;
    sighashType: number;
} {
    const unsignedTx = cache.tx;
    const sighashType = input.sighashType || Transaction.SIGHASH_ALL;
    checkSighashTypeAllowed(sighashType, sighashTypes);

    let hash: Bytes32;
    let prevout: Output;

    if (input.nonWitnessUtxo) {
        const nonWitnessUtxoTx = nonWitnessUtxoTxFromCache(cache, input, inputIndex);

        const prevoutHash = unsignedTx.ins[inputIndex]!.hash;
        const utxoHash = nonWitnessUtxoTx.getHash();

        // If a non-witness UTXO is provided, its hash must match the hash specified in the prevout
        if (!equals(prevoutHash, utxoHash)) {
            throw new Error(
                `Non-witness UTXO hash for input #${inputIndex} doesn't match the hash specified in the prevout`,
            );
        }

        const prevoutIndex = unsignedTx.ins[inputIndex]!.index;
        prevout = nonWitnessUtxoTx.outs[prevoutIndex]!;
    } else if (input.witnessUtxo) {
        prevout = {
            script: input.witnessUtxo.script as Script,
            value: input.witnessUtxo.value as Satoshi,
        };
    } else {
        throw new Error('Need a Utxo input item for signing');
    }

    const { meaningfulScript, type } = getMeaningfulScript(
        prevout.script,
        inputIndex,
        'input',
        input.redeemScript,
        input.witnessScript,
    );

    const script = meaningfulScript as Script;

    if (['p2sh-p2wsh', 'p2wsh'].indexOf(type) >= 0) {
        hash = unsignedTx.hashForWitnessV0(
            inputIndex,
            script,
            prevout.value,
            sighashType,
        );
    } else if (isP2WPKH(meaningfulScript)) {
        // P2WPKH uses the P2PKH template for prevoutScript when signing
        const p2pkhPayment = payments.p2pkh({
            hash: meaningfulScript.subarray(2) as Bytes20,
        });
        if (!p2pkhPayment.output) throw new Error('Unable to create signing script');
        hash = unsignedTx.hashForWitnessV0(
            inputIndex,
            p2pkhPayment.output as Script,
            prevout.value,
            sighashType,
        );
    } else {
        // non-segwit
        if (input.nonWitnessUtxo === undefined && !cache.unsafeSignNonSegwit)
            throw new Error(
                `Input #${inputIndex} has witnessUtxo but non-segwit script: ` +
                    toHex(meaningfulScript),
            );
        if (!forValidate && cache.unsafeSignNonSegwit)
            console.warn(
                'Warning: Signing non-segwit inputs without the full parent transaction ' +
                    'means there is a chance that a miner could feed you incorrect information ' +
                    "to trick you into paying large fees. This behavior is the same as Psbt's predecessor " +
                    '(TransactionBuilder - now removed) when signing non-segwit scripts. You are not ' +
                    'able to export this Psbt with toBuffer|toBase64|toHex since it is not ' +
                    'BIP174 compliant.\n*********************\nPROCEED WITH CAUTION!\n' +
                    '*********************',
            );
        hash = unsignedTx.hashForSignature(inputIndex, script, sighashType);
    }

    return {
        script,
        sighashType,
        hash,
    };
}

function getAllTaprootHashesForSig(
    inputIndex: number,
    input: PsbtInput,
    inputs: PsbtInput[],
    cache: PsbtCache,
): { pubkey: PublicKey; hash: Bytes32; leafHash?: Bytes32 }[] {
    const allPublicKeys: Uint8Array[] = [];
    if (input.tapInternalKey) {
        const key = getPrevoutTaprootKey(inputIndex, input, cache);
        if (key) {
            allPublicKeys.push(key);
        }
    }

    if (input.tapScriptSig) {
        const tapScriptPubkeys = input.tapScriptSig.map((tss) => tss.pubkey);
        allPublicKeys.push(...tapScriptPubkeys);
    }

    const allHashes = allPublicKeys.map((pubicKey) =>
        getTaprootHashesForSig(inputIndex, input, inputs, pubicKey, cache),
    );

    return allHashes.flat();
}

function getPrevoutTaprootKey(
    inputIndex: number,
    input: PsbtInput,
    cache: PsbtCache,
): XOnlyPublicKey | null {
    const { script } = getScriptAndAmountFromUtxo(inputIndex, input, cache);
    return isP2TR(script) ? script.subarray(2, 34) as XOnlyPublicKey : null;
}

function trimTaprootSig(signature: Uint8Array): Uint8Array {
    return signature.length === 64 ? signature : signature.subarray(0, 64);
}

function getTaprootHashesForSig(
    inputIndex: number,
    input: PsbtInput,
    inputs: PsbtInput[],
    pubkey: Uint8Array,
    cache: PsbtCache,
    tapLeafHashToSign?: Uint8Array,
    allowedSighashTypes?: number[],
): { pubkey: PublicKey; hash: Bytes32; leafHash?: Bytes32 }[] {
    const unsignedTx = cache.tx;

    const sighashType = input.sighashType || Transaction.SIGHASH_DEFAULT;
    checkSighashTypeAllowed(sighashType, allowedSighashTypes);

    if (!cache.prevOuts) {
        const prevOuts = inputs.map((i, index) =>
            getScriptAndAmountFromUtxo(index, i, cache),
        );
        cache.prevOuts = prevOuts;
        cache.signingScripts = prevOuts.map((o) => o.script);
        cache.values = prevOuts.map((o) => o.value);
    }
    const signingScripts = cache.signingScripts as readonly Script[];
    const values = cache.values as readonly Satoshi[];

    // Compute taproot hash cache once for all inputs (O(n) -> O(1) per input)
    if (!cache.taprootHashCache) {
        cache.taprootHashCache = unsignedTx.getTaprootHashCache(signingScripts, values);
    }
    const taprootCache = cache.taprootHashCache;

    const hashes: { pubkey: PublicKey; hash: Bytes32; leafHash?: Bytes32 }[] = [];
    if (input.tapInternalKey && !tapLeafHashToSign) {
        const outputKey = getPrevoutTaprootKey(inputIndex, input, cache) || new Uint8Array(0);
        if (equals(toXOnly(pubkey as PublicKey), outputKey)) {
            const tapKeyHash = unsignedTx.hashForWitnessV1(
                inputIndex,
                signingScripts,
                values,
                sighashType,
                undefined,
                undefined,
                taprootCache,
            );
            hashes.push({ pubkey: pubkey as PublicKey, hash: tapKeyHash });
        }
    }

    const tapLeafHashes = (input.tapLeafScript || [])
        .filter((tapLeaf) => pubkeyInScript(pubkey, tapLeaf.script))
        .map((tapLeaf) => {
            const hash = tapleafHash({
                output: tapLeaf.script,
                version: tapLeaf.leafVersion,
            });
            return Object.assign({ hash }, tapLeaf);
        })
        .filter((tapLeaf) => !tapLeafHashToSign || equals(tapLeafHashToSign, tapLeaf.hash))
        .map((tapLeaf) => {
            const tapScriptHash = unsignedTx.hashForWitnessV1(
                inputIndex,
                signingScripts,
                values,
                sighashType,
                tapLeaf.hash as Bytes32,
                undefined,
                taprootCache,
            );

            return {
                pubkey: pubkey as PublicKey,
                hash: tapScriptHash,
                leafHash: tapLeaf.hash as Bytes32,
            };
        });

    return hashes.concat(tapLeafHashes);
}

function checkSighashTypeAllowed(sighashType: number, sighashTypes?: number[]): void {
    if (sighashTypes && sighashTypes.indexOf(sighashType) < 0) {
        const str = sighashTypeToString(sighashType);
        throw new Error(
            `Sighash type is not allowed. Retry the sign method passing the ` +
                `sighashTypes array of whitelisted types. Sighash type: ${str}`,
        );
    }
}

function getPayment(
    script: Uint8Array,
    scriptType: string,
    partialSig: PartialSig[],
): payments.Payment {
    const scriptBranded = script as Script;
    switch (scriptType) {
        case 'multisig': {
            const sigs = getSortedSigs(script, partialSig);
            return payments.p2ms({
                output: scriptBranded,
                signatures: sigs as Signature[],
            });
        }
        case 'pubkey':
            return payments.p2pk({
                output: scriptBranded,
                signature: partialSig[0]!.signature as Signature,
            });
        case 'pubkeyhash':
            return payments.p2pkh({
                output: scriptBranded,
                pubkey: partialSig[0]!.pubkey as PublicKey,
                signature: partialSig[0]!.signature as Signature,
            });
        case 'witnesspubkeyhash':
            return payments.p2wpkh({
                output: scriptBranded,
                pubkey: partialSig[0]!.pubkey as PublicKey,
                signature: partialSig[0]!.signature as Signature,
            });
        default:
            throw new Error(`Unknown script type: ${scriptType}`);
    }
}

function getScriptFromInput(
    inputIndex: number,
    input: PsbtInput,
    cache: PsbtCache,
): GetScriptReturn {
    const unsignedTx = cache.tx;
    const res: GetScriptReturn = {
        script: null,
        isSegwit: false,
        isP2SH: false,
        isP2WSH: false,
    };
    res.isP2SH = !!input.redeemScript;
    res.isP2WSH = !!input.witnessScript;
    if (input.witnessScript) {
        res.script = input.witnessScript as Script;
    } else if (input.redeemScript) {
        res.script = input.redeemScript as Script;
    } else {
        if (input.nonWitnessUtxo) {
            const nonWitnessUtxoTx = nonWitnessUtxoTxFromCache(cache, input, inputIndex);
            const prevoutIndex = unsignedTx.ins[inputIndex]!.index;
            res.script = nonWitnessUtxoTx.outs[prevoutIndex]!.script;
        } else if (input.witnessUtxo) {
            res.script = input.witnessUtxo.script as Script;
        }
    }

    if (input.witnessScript || (res.script && isP2WPKH(res.script))) {
        res.isSegwit = true;
    } else {
        try {
            const output = res.script;
            if (!output) throw new TypeError('Invalid script for segwit address');

            res.isSegwit = isUnknownSegwitVersion(output);
        } catch (e) {}
    }

    return res;
}

function getSignersFromHD<T extends HDSigner | HDSignerAsync>(
    inputIndex: number,
    inputs: PsbtInput[],
    hdKeyPair: T,
): T[] {
    const input = checkForInput(inputs, inputIndex);
    if (!input.bip32Derivation || input.bip32Derivation.length === 0) {
        throw new Error('Need bip32Derivation to sign with HD');
    }
    const myDerivations = input.bip32Derivation
        .map((bipDv) => {
            if (equals(bipDv.masterFingerprint, hdKeyPair.fingerprint)) {
                return bipDv;
            } else {
                return;
            }
        })
        .filter((v) => !!v);
    if (myDerivations.length === 0) {
        throw new Error(
            'Need one bip32Derivation masterFingerprint to match the HDSigner fingerprint',
        );
    }

    return myDerivations.map((bipDv) => {
        const node = hdKeyPair.derivePath(bipDv.path) as T;
        if (!equals(bipDv.pubkey, node.publicKey)) {
            throw new Error('pubkey did not match bip32Derivation');
        }
        return node;
    });
}

function getSortedSigs(script: Uint8Array, partialSig: PartialSig[]): Uint8Array[] {
    const p2ms = payments.p2ms({ output: script as Script });
    if (!p2ms.pubkeys) throw new Error('Cannot extract pubkeys from multisig script');
    // for each pubkey in order of p2ms script
    const result: Uint8Array[] = [];
    for (const pk of p2ms.pubkeys) {
        // filter partialSig array by pubkey being equal
        const matched = partialSig.filter((ps) => {
            return equals(ps.pubkey, pk);
        })[0];
        if (matched) {
            result.push(new Uint8Array(matched.signature));
        }
    }
    return result;
}

function addNonWitnessTxCache(cache: PsbtCache, input: PsbtInput, inputIndex: number): void {
    if (!input.nonWitnessUtxo) throw new Error('nonWitnessUtxo is required');
    // Prevent prototype pollution - ensure input is a valid object
    if (input === null || input === Object.prototype) {
        throw new Error('Invalid input object');
    }
    const nonWitnessUtxoBuf = input.nonWitnessUtxo;
    cache.nonWitnessUtxoBufCache[inputIndex] = nonWitnessUtxoBuf;
    cache.nonWitnessUtxoTxCache[inputIndex] = Transaction.fromBuffer(nonWitnessUtxoBuf);

    const self = cache;
    const selfIndex = inputIndex;
    delete input.nonWitnessUtxo;
    // Using Reflect.defineProperty to avoid prototype pollution concerns
    Reflect.defineProperty(input, 'nonWitnessUtxo', {
        enumerable: true,
        get(): Uint8Array {
            const buf = self.nonWitnessUtxoBufCache[selfIndex];
            const txCache = self.nonWitnessUtxoTxCache[selfIndex];
            if (buf !== undefined) {
                return buf;
            } else {
                const newBuf = txCache!.toBuffer();
                self.nonWitnessUtxoBufCache[selfIndex] = newBuf;
                return newBuf;
            }
        },
        set(data: Uint8Array): void {
            self.nonWitnessUtxoBufCache[selfIndex] = data;
        },
    });
}

function inputFinalizeGetAmts(
    inputs: PsbtInput[],
    tx: Transaction,
    cache: PsbtCache,
    mustFinalize: boolean,
    disableOutputChecks?: boolean,
): void {
    let inputAmount = 0n;
    inputs.forEach((input, idx) => {
        if (mustFinalize && input.finalScriptSig)
            tx.ins[idx]!.script = input.finalScriptSig as Script;
        if (mustFinalize && input.finalScriptWitness) {
            tx.ins[idx]!.witness = scriptWitnessToWitnessStack(input.finalScriptWitness);
        }
        if (input.witnessUtxo) {
            inputAmount += input.witnessUtxo.value;
        } else if (input.nonWitnessUtxo) {
            const nwTx = nonWitnessUtxoTxFromCache(cache, input, idx);
            const vout = tx.ins[idx]!.index;
            const out = nwTx.outs[vout]!;
            inputAmount += out.value;
        }
    });
    const outputAmount = tx.outs.reduce((total, o) => total + o.value, 0n);
    const fee = inputAmount - outputAmount;
    if (!disableOutputChecks) {
        if (fee < 0n) {
            throw new Error(
                `Outputs are spending more than Inputs ${inputAmount} < ${outputAmount}`,
            );
        }
    }
    const bytes = tx.virtualSize();
    cache.fee = Number(fee);
    cache.extractedTx = tx;
    cache.feeRate = Math.floor(Number(fee) / bytes);
}

function nonWitnessUtxoTxFromCache(
    cache: PsbtCache,
    input: PsbtInput,
    inputIndex: number,
): Transaction {
    const c = cache.nonWitnessUtxoTxCache;
    if (!c[inputIndex]) {
        addNonWitnessTxCache(cache, input, inputIndex);
    }
    return c[inputIndex]!;
}

function getScriptFromUtxo(inputIndex: number, input: PsbtInput, cache: PsbtCache): Script {
    const { script } = getScriptAndAmountFromUtxo(inputIndex, input, cache);
    return script;
}

function getScriptAndAmountFromUtxo(
    inputIndex: number,
    input: PsbtInput,
    cache: PsbtCache,
): { script: Script; value: Satoshi } {
    if (input.witnessUtxo !== undefined) {
        return {
            script: input.witnessUtxo.script as Script,
            value: input.witnessUtxo.value as Satoshi,
        };
    } else if (input.nonWitnessUtxo !== undefined) {
        const nonWitnessUtxoTx = nonWitnessUtxoTxFromCache(cache, input, inputIndex);
        const o = nonWitnessUtxoTx.outs[cache.tx.ins[inputIndex]!.index]!;
        return { script: o.script, value: o.value };
    } else {
        throw new Error("Can't find pubkey in input without Utxo data");
    }
}

function pubkeyInInput(
    pubkey: PublicKey,
    input: PsbtInput,
    inputIndex: number,
    cache: PsbtCache,
): boolean {
    const script = getScriptFromUtxo(inputIndex, input, cache);
    const { meaningfulScript } = getMeaningfulScript(
        script,
        inputIndex,
        'input',
        input.redeemScript,
        input.witnessScript,
    );
    return pubkeyInScript(pubkey, meaningfulScript);
}

function pubkeyInOutput(
    pubkey: PublicKey,
    output: PsbtOutput,
    outputIndex: number,
    cache: PsbtCache,
): boolean {
    const script = cache.tx.outs[outputIndex]!.script;
    const { meaningfulScript } = getMeaningfulScript(
        script,
        outputIndex,
        'output',
        output.redeemScript,
        output.witnessScript,
    );
    return pubkeyInScript(pubkey, meaningfulScript);
}

function redeemFromFinalScriptSig(finalScript: Uint8Array | undefined): Uint8Array | undefined {
    if (!finalScript) return;
    const decomp = bscript.decompile(finalScript);
    if (!decomp) return;
    const lastItem = decomp[decomp.length - 1]!;
    if (!(lastItem instanceof Uint8Array) || isPubkeyLike(lastItem) || isSigLike(lastItem)) return;
    const sDecomp = bscript.decompile(lastItem);
    if (!sDecomp) return;
    return lastItem;
}

function redeemFromFinalWitnessScript(finalScript: Uint8Array | undefined): Uint8Array | undefined {
    if (!finalScript) return;
    const decomp = scriptWitnessToWitnessStack(finalScript);
    const lastItem = decomp[decomp.length - 1]!;
    if (isPubkeyLike(lastItem)) return;
    const sDecomp = bscript.decompile(lastItem);
    if (!sDecomp) return;
    return lastItem;
}
