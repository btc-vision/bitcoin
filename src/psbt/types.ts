/**
 * PSBT types and interfaces
 * @packageDocumentation
 */

import type { Psbt as PsbtBase, PsbtGlobal, PsbtInput, PsbtOutput } from 'bip174';
import type { Network } from '../networks.js';
import type { Transaction } from '../transaction.js';

/**
 * Transaction input interface for PSBT.
 */
export interface TransactionInput {
    hash: string | Uint8Array;
    index: number;
    sequence?: number;
}

/**
 * PSBT transaction input with Uint8Array hash.
 */
export interface PsbtTxInput extends TransactionInput {
    hash: Uint8Array;
}

/**
 * Transaction output interface for PSBT.
 */
export interface TransactionOutput {
    script: Uint8Array;
    value: bigint;
}

/**
 * PSBT transaction output with optional address.
 */
export interface PsbtTxOutput extends TransactionOutput {
    address: string | undefined;
}

/**
 * Signature validation function type.
 * msghash is 32 byte hash of preimage, signature is 64 byte compact signature (r,s 32 bytes each)
 */
export type ValidateSigFunction = (
    pubkey: Uint8Array,
    msghash: Uint8Array,
    signature: Uint8Array,
) => boolean;

/**
 * Extended PsbtBase interface with typed inputs and globalMap.
 */
export interface PsbtBaseExtended extends Omit<PsbtBase, 'inputs'> {
    inputs: PsbtInput[];
    globalMap: PsbtGlobal;
}

/**
 * Optional PSBT options.
 */
export interface PsbtOptsOptional {
    network?: Network;
    maximumFeeRate?: number;
    version?: 1 | 2 | 3;
}

/**
 * Required PSBT options.
 */
export interface PsbtOpts {
    network: Network;
    maximumFeeRate: number;
}

/**
 * Extended PSBT input with additional fields.
 */
export interface PsbtInputExtended extends PsbtInput, TransactionInput {
    isPayToAnchor?: boolean;
}

/**
 * Extended PSBT output - either address-based or script-based.
 */
export type PsbtOutputExtended = PsbtOutputExtendedAddress | PsbtOutputExtendedScript;

/**
 * PSBT output with address.
 */
export interface PsbtOutputExtendedAddress extends PsbtOutput {
    address: string;
    value: bigint;
}

/**
 * PSBT output with script.
 */
export interface PsbtOutputExtendedScript extends PsbtOutput {
    script: Uint8Array;
    value: bigint;
}

/**
 * Base interface for HD signers.
 */
interface HDSignerBase {
    /**
     * DER format compressed publicKey Uint8Array
     */
    publicKey: Uint8Array;
    /**
     * The first 4 bytes of the sha256-ripemd160 of the publicKey
     */
    fingerprint: Uint8Array;
}

/**
 * HD signer interface for synchronous signing.
 */
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
    sign(hash: Uint8Array): Uint8Array;
}

/**
 * HD signer interface for asynchronous signing.
 */
export interface HDSignerAsync extends HDSignerBase {
    derivePath(path: string): HDSignerAsync;

    sign(hash: Uint8Array): Promise<Uint8Array>;
}

/**
 * Alternative signer interface with lowR support.
 */
export interface SignerAlternative {
    publicKey: Uint8Array;
    lowR: boolean;

    sign(hash: Uint8Array, lowR?: boolean): Uint8Array;

    verify(hash: Uint8Array, signature: Uint8Array): boolean;

    signSchnorr(hash: Uint8Array): Uint8Array;

    verifySchnorr(hash: Uint8Array, signature: Uint8Array): boolean;
}

/**
 * Basic signer interface for synchronous signing.
 */
export interface Signer {
    publicKey: Uint8Array;
    network?: Network;

    sign(hash: Uint8Array, lowR?: boolean): Uint8Array;

    signSchnorr?(hash: Uint8Array): Uint8Array;

    getPublicKey?(): Uint8Array;
}

/**
 * Basic signer interface for asynchronous signing.
 */
export interface SignerAsync {
    publicKey: Uint8Array;
    network?: Network;

    sign(hash: Uint8Array, lowR?: boolean): Promise<Uint8Array>;

    signSchnorr?(hash: Uint8Array): Promise<Uint8Array>;

    getPublicKey?(): Uint8Array;
}

/**
 * Internal PSBT cache for computed values.
 */
export interface PsbtCache {
    __NON_WITNESS_UTXO_TX_CACHE: Transaction[];
    __NON_WITNESS_UTXO_BUF_CACHE: Uint8Array[];
    __TX_IN_CACHE: { [index: string]: number };
    __TX: Transaction;
    __FEE_RATE?: number;
    __FEE?: number;
    __EXTRACTED_TX?: Transaction;
    __UNSAFE_SIGN_NONSEGWIT: boolean;
}

/**
 * Keys for cached numeric values in the transaction cache.
 */
export type TxCacheNumberKey = '__FEE_RATE' | '__FEE';

/**
 * Script types for classification.
 */
export type ScriptType = 'witnesspubkeyhash' | 'pubkeyhash' | 'multisig' | 'pubkey' | 'nonstandard';

/**
 * All possible script types including witness types.
 * Note: P2WPKH can't be wrapped in P2WSH (already a witness program)
 */
export type AllScriptType =
    | 'witnesspubkeyhash'
    | 'pubkeyhash'
    | 'multisig'
    | 'pubkey'
    | 'nonstandard'
    | 'p2sh-witnesspubkeyhash'
    | 'p2sh-pubkeyhash'
    | 'p2sh-multisig'
    | 'p2sh-pubkey'
    | 'p2sh-nonstandard'
    | 'p2wsh-pubkeyhash'
    | 'p2wsh-multisig'
    | 'p2wsh-pubkey'
    | 'p2wsh-nonstandard'
    | 'p2sh-p2wsh-pubkeyhash'
    | 'p2sh-p2wsh-multisig'
    | 'p2sh-p2wsh-pubkey'
    | 'p2sh-p2wsh-nonstandard';

/**
 * Return type for getScriptFromInput function.
 */
export interface GetScriptReturn {
    script: Uint8Array | null;
    isSegwit: boolean;
    isP2SH: boolean;
    isP2WSH: boolean;
}

/**
 * Function type for final scripts computation.
 */
export type FinalScriptsFunc = (
    inputIndex: number,
    input: PsbtInput,
    script: Uint8Array,
    isSegwit: boolean,
    isP2SH: boolean,
    isP2WSH: boolean,
    canRunChecks: boolean,
) => {
    finalScriptSig: Uint8Array | undefined;
    finalScriptWitness: Uint8Array | undefined;
};

/**
 * Function type for final Taproot scripts computation.
 */
export type FinalTaprootScriptsFunc = (
    inputIndex: number,
    input: PsbtInput,
    tapLeafHashToFinalize?: Uint8Array,
) => {
    finalScriptWitness: Uint8Array | undefined;
};
