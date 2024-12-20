/// <reference types="node" />
import { Psbt as PsbtBase } from 'bip174';
import { KeyValue, PartialSig, PsbtGlobal, PsbtGlobalUpdate, PsbtInput, PsbtInputUpdate, PsbtOutput, PsbtOutputUpdate } from 'bip174/src/lib/interfaces';
import { Network } from './networks';
import { Transaction } from './transaction';
import { BIP32Interface } from 'bip32';
import { ECPairInterface } from 'ecpair';
export interface TransactionInput {
    hash: string | Buffer;
    index: number;
    sequence?: number;
}
export interface PsbtTxInput extends TransactionInput {
    hash: Buffer;
}
export interface TransactionOutput {
    script: Buffer;
    value: number;
}
export interface PsbtTxOutput extends TransactionOutput {
    address: string | undefined;
}
export type ValidateSigFunction = (pubkey: Buffer, msghash: Buffer, signature: Buffer) => boolean;
export interface PsbtBaseExtended extends Omit<PsbtBase, 'inputs'> {
    inputs: PsbtInput[];
    globalMap: PsbtGlobal;
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
 *   addInput requires hash: Buffer | string; and index: number; as attributes
 *   and can also include any attributes that are used in updateInput method.
 *   addOutput requires script: Buffer; and value: number; and likewise can include
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
export declare class Psbt {
    data: PsbtBaseExtended;
    private readonly __CACHE;
    private readonly opts;
    constructor(opts?: PsbtOptsOptional, data?: PsbtBaseExtended);
    get inputCount(): number;
    get version(): number;
    set version(version: number);
    get locktime(): number;
    set locktime(locktime: number);
    get txInputs(): PsbtTxInput[];
    get txOutputs(): PsbtTxOutput[];
    static fromBase64(data: string, opts?: PsbtOptsOptional): Psbt;
    static fromHex(data: string, opts?: PsbtOptsOptional): Psbt;
    static fromBuffer(buffer: Buffer, opts?: PsbtOptsOptional): Psbt;
    combine(...those: Psbt[]): this;
    clone(): Psbt;
    setMaximumFeeRate(satoshiPerByte: number): void;
    setVersion(version: number): this;
    setLocktime(locktime: number): this;
    setInputSequence(inputIndex: number, sequence: number): this;
    addInputs(inputDatas: PsbtInputExtended[], checkPartialSigs?: boolean): this;
    addInput(inputData: PsbtInputExtended, checkPartialSigs?: boolean): this;
    addOutputs(outputDatas: PsbtOutputExtended[]): this;
    addOutput(outputData: PsbtOutputExtended): this;
    extractTransaction(disableFeeCheck?: boolean, disableOutputChecks?: boolean): Transaction;
    getFeeRate(disableOutputChecks?: boolean): number;
    getFee(disableOutputChecks?: boolean): number;
    finalizeAllInputs(): this;
    finalizeInput(inputIndex: number, finalScriptsFunc?: FinalScriptsFunc | FinalTaprootScriptsFunc): this;
    finalizeTaprootInput(inputIndex: number, tapLeafHashToFinalize?: Buffer, finalScriptsFunc?: FinalTaprootScriptsFunc): this;
    getInputType(inputIndex: number): AllScriptType;
    inputHasPubkey(inputIndex: number, pubkey: Buffer): boolean;
    inputHasHDKey(inputIndex: number, root: HDSigner): boolean;
    outputHasPubkey(outputIndex: number, pubkey: Buffer): boolean;
    outputHasHDKey(outputIndex: number, root: HDSigner): boolean;
    validateSignaturesOfAllInputs(validator: ValidateSigFunction): boolean;
    validateSignaturesOfInput(inputIndex: number, validator: ValidateSigFunction, pubkey?: Buffer): boolean;
    signAllInputsHD(hdKeyPair: HDSigner, sighashTypes?: number[]): this;
    signAllInputsHDAsync(hdKeyPair: HDSigner | HDSignerAsync, sighashTypes?: number[]): Promise<void>;
    signInputHD(inputIndex: number, hdKeyPair: HDSigner, sighashTypes?: number[]): this;
    signInputHDAsync(inputIndex: number, hdKeyPair: HDSigner | HDSignerAsync, sighashTypes?: number[]): Promise<void>;
    signAllInputs(keyPair: Signer | SignerAlternative | BIP32Interface | ECPairInterface, sighashTypes?: number[]): this;
    signAllInputsAsync(keyPair: Signer | SignerAlternative | SignerAsync | BIP32Interface | ECPairInterface, sighashTypes?: number[]): Promise<void>;
    signInput(inputIndex: number, keyPair: Signer | SignerAlternative | BIP32Interface | ECPairInterface, sighashTypes?: number[]): this;
    signTaprootInput(inputIndex: number, keyPair: Signer | SignerAlternative | BIP32Interface | ECPairInterface, tapLeafHashToSign?: Buffer, sighashTypes?: number[]): this;
    signInputAsync(inputIndex: number, keyPair: Signer | SignerAlternative | SignerAsync | BIP32Interface | ECPairInterface, sighashTypes?: number[]): Promise<void>;
    signTaprootInputAsync(inputIndex: number, keyPair: Signer | SignerAlternative | SignerAsync | BIP32Interface | ECPairInterface, tapLeafHash?: Buffer, sighashTypes?: number[]): Promise<void>;
    toBuffer(): Buffer;
    toHex(): string;
    toBase64(): string;
    updateGlobal(updateData: PsbtGlobalUpdate): this;
    updateInput(inputIndex: number, updateData: PsbtInputUpdate): this;
    updateOutput(outputIndex: number, updateData: PsbtOutputUpdate): this;
    addUnknownKeyValToGlobal(keyVal: KeyValue): this;
    addUnknownKeyValToInput(inputIndex: number, keyVal: KeyValue): this;
    addUnknownKeyValToOutput(outputIndex: number, keyVal: KeyValue): this;
    clearFinalizedInput(inputIndex: number): this;
    checkTaprootHashesForSig(inputIndex: number, input: PsbtInput, keyPair: Signer | SignerAlternative | SignerAsync | BIP32Interface | ECPairInterface, tapLeafHashToSign?: Buffer, allowedSighashTypes?: number[]): {
        hash: Buffer;
        leafHash?: Buffer;
    }[];
    private _finalizeInput;
    private _finalizeTaprootInput;
    private _validateSignaturesOfInput;
    private validateSignaturesOfTaprootInput;
    private _signInput;
    private _signTaprootInput;
    private _signInputAsync;
    private _signTaprootInputAsync;
}
export interface PsbtOptsOptional {
    network?: Network;
    maximumFeeRate?: number;
}
export interface PsbtOpts {
    network: Network;
    maximumFeeRate: number;
}
export interface PsbtInputExtended extends PsbtInput, TransactionInput {
}
export type PsbtOutputExtended = PsbtOutputExtendedAddress | PsbtOutputExtendedScript;
export interface PsbtOutputExtendedAddress extends PsbtOutput {
    address: string;
    value: number;
}
export interface PsbtOutputExtendedScript extends PsbtOutput {
    script: Buffer;
    value: number;
}
interface HDSignerBase {
    /**
     * DER format compressed publicKey buffer
     */
    publicKey: Buffer;
    /**
     * The first 4 bytes of the sha256-ripemd160 of the publicKey
     */
    fingerprint: Buffer;
}
export interface HDSigner extends HDSignerBase {
    /**
     * The path string must match /^m(\/\d+'?)+$/
     * ex. m/44'/0'/0'/1/23 levels with ' must be hard derivations
     */
    derivePath(path: string): HDSigner;
    /**
     * Input hash (the "message digest") for the signature algorithm
     * Return a 64 byte signature (32 byte r and 32 byte s in that order)
     */
    sign(hash: Buffer): Buffer;
}
/**
 * Same as above but with async sign method
 */
export interface HDSignerAsync extends HDSignerBase {
    derivePath(path: string): HDSignerAsync;
    sign(hash: Buffer): Promise<Buffer>;
}
export interface SignerAlternative {
    publicKey: Buffer;
    lowR: boolean;
    sign(hash: Buffer, lowR?: boolean): Buffer;
    verify(hash: Buffer, signature: Buffer): boolean;
    signSchnorr(hash: Buffer): Buffer;
    verifySchnorr(hash: Buffer, signature: Buffer): boolean;
}
export interface Signer {
    publicKey: Buffer;
    network?: Network;
    sign(hash: Buffer, lowR?: boolean): Buffer;
    signSchnorr?(hash: Buffer): Buffer;
    getPublicKey?(): Buffer;
}
export interface SignerAsync {
    publicKey: Buffer;
    network?: Network;
    sign(hash: Buffer, lowR?: boolean): Promise<Buffer>;
    signSchnorr?(hash: Buffer): Promise<Buffer>;
    getPublicKey?(): Buffer;
}
/**
 * This function must do two things:
 * 1. Check if the `input` can be finalized. If it can not be finalized, throw.
 *   ie. `Can not finalize input #${inputIndex}`
 * 2. Create the finalScriptSig and finalScriptWitness Buffers.
 */
type FinalScriptsFunc = (inputIndex: number, // Which input is it?
input: PsbtInput, // The PSBT input contents
script: Buffer, // The "meaningful" locking script Buffer (redeemScript for P2SH etc.)
isSegwit: boolean, // Is it segwit?
isP2SH: boolean, // Is it P2SH?
isP2WSH: boolean) => {
    finalScriptSig: Buffer | undefined;
    finalScriptWitness: Buffer | undefined;
};
type FinalTaprootScriptsFunc = (inputIndex: number, // Which input is it?
input: PsbtInput, // The PSBT input contents
tapLeafHashToFinalize?: Buffer) => {
    finalScriptWitness: Buffer | undefined;
};
export declare function getFinalScripts(inputIndex: number, input: PsbtInput, script: Buffer, isSegwit: boolean, isP2SH: boolean, isP2WSH: boolean): {
    finalScriptSig: Buffer | undefined;
    finalScriptWitness: Buffer | undefined;
};
export declare function prepareFinalScripts(script: Buffer, scriptType: string, partialSig: PartialSig[], isSegwit: boolean, isP2SH: boolean, isP2WSH: boolean): {
    finalScriptSig: Buffer | undefined;
    finalScriptWitness: Buffer | undefined;
};
type AllScriptType = 'witnesspubkeyhash' | 'pubkeyhash' | 'multisig' | 'pubkey' | 'nonstandard' | 'p2sh-witnesspubkeyhash' | 'p2sh-pubkeyhash' | 'p2sh-multisig' | 'p2sh-pubkey' | 'p2sh-nonstandard' | 'p2wsh-pubkeyhash' | 'p2wsh-multisig' | 'p2wsh-pubkey' | 'p2wsh-nonstandard' | 'p2sh-p2wsh-pubkeyhash' | 'p2sh-p2wsh-multisig' | 'p2sh-p2wsh-pubkey' | 'p2sh-p2wsh-nonstandard';
export {};
