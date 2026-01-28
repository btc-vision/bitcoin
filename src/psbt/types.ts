/**
 * PSBT types and interfaces
 * @packageDocumentation
 */

import type { Psbt as PsbtBase, PsbtGlobal, PsbtInput, PsbtOutput } from 'bip174';
import type { Network } from '../networks.js';
import type { Transaction, TaprootHashCache } from '../transaction.js';
import type {
    Bytes32,
    PublicKey,
    Satoshi,
    Script,
    Signature,
    SchnorrSignature,
} from '../types.js';

/**
 * Transaction input interface for PSBT.
 */
export interface TransactionInput {
    readonly hash: string | Bytes32;
    readonly index: number;
    readonly sequence?: number | undefined;
}

/**
 * PSBT transaction input with Uint8Array hash.
 */
export interface PsbtTxInput extends TransactionInput {
    readonly hash: Bytes32;
}

/**
 * Transaction output interface for PSBT.
 */
export interface TransactionOutput {
    readonly script: Script;
    readonly value: Satoshi;
}

/**
 * PSBT transaction output with optional address.
 */
export interface PsbtTxOutput extends TransactionOutput {
    readonly address: string | undefined;
}

/**
 * Signature validation function type.
 * msghash is 32 byte hash of preimage, signature is 64 byte compact signature (r,s 32 bytes each)
 */
export type ValidateSigFunction = (
    pubkey: PublicKey,
    msghash: Bytes32,
    signature: Uint8Array,
) => boolean;

/**
 * Extended PsbtBase interface with typed inputs and globalMap.
 */
export interface PsbtBaseExtended extends Omit<PsbtBase, 'inputs'> {
    readonly inputs: PsbtInput[];
    readonly globalMap: PsbtGlobal;
}

/**
 * Optional PSBT options.
 */
export interface PsbtOptsOptional {
    readonly network?: Network | undefined;
    readonly maximumFeeRate?: number | undefined;
    readonly version?: 1 | 2 | 3 | undefined;
}

/**
 * Required PSBT options.
 */
export interface PsbtOpts {
    readonly network: Network;
    maximumFeeRate: number;
}

/**
 * Extended PSBT input with additional fields.
 */
export interface PsbtInputExtended extends PsbtInput, TransactionInput {
    readonly isPayToAnchor?: boolean | undefined;
}

/**
 * Extended PSBT output - either address-based or script-based.
 */
export type PsbtOutputExtended = PsbtOutputExtendedAddress | PsbtOutputExtendedScript;

/**
 * PSBT output with address.
 */
export interface PsbtOutputExtendedAddress extends PsbtOutput {
    readonly address: string;
    readonly value: Satoshi;
}

/**
 * PSBT output with script.
 */
export interface PsbtOutputExtendedScript extends PsbtOutput {
    readonly script: Script;
    readonly value: Satoshi;
}

/**
 * Base interface for HD signers.
 */
interface HDSignerBase {
    /**
     * DER format compressed publicKey Uint8Array
     */
    readonly publicKey: PublicKey;
    /**
     * The first 4 bytes of the sha256-ripemd160 of the publicKey
     */
    readonly fingerprint: Uint8Array;
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
    sign(hash: Bytes32): Uint8Array;
}

/**
 * HD signer interface for asynchronous signing.
 */
export interface HDSignerAsync extends HDSignerBase {
    derivePath(path: string): HDSignerAsync;

    sign(hash: Bytes32): Promise<Uint8Array>;
}

/**
 * Alternative signer interface with lowR support.
 */
export interface SignerAlternative {
    readonly publicKey: PublicKey;
    readonly lowR: boolean;

    sign(hash: Bytes32, lowR?: boolean): Signature;

    verify(hash: Bytes32, signature: Signature): boolean;

    signSchnorr(hash: Bytes32): SchnorrSignature;

    verifySchnorr(hash: Bytes32, signature: SchnorrSignature): boolean;
}

/**
 * Basic signer interface for synchronous signing.
 */
export interface Signer {
    readonly publicKey: PublicKey;
    readonly network?: Network | undefined;

    sign(hash: Bytes32, lowR?: boolean): Signature;

    signSchnorr?(hash: Bytes32): SchnorrSignature;

    getPublicKey?(): PublicKey;
}

/**
 * Basic signer interface for asynchronous signing.
 */
export interface SignerAsync {
    readonly publicKey: PublicKey;
    readonly network?: Network | undefined;

    sign(hash: Bytes32, lowR?: boolean): Promise<Signature>;

    signSchnorr?(hash: Bytes32): Promise<SchnorrSignature>;

    getPublicKey?(): PublicKey;
}

/**
 * Minimal key pair interface for checking Taproot hashes.
 * Only requires publicKey and optional signSchnorr presence check.
 * Used by checkTaprootHashesForSig to accept broader key pair types (e.g., worker key pairs).
 */
export interface TaprootHashCheckSigner {
    readonly publicKey: Uint8Array;
    signSchnorr?(hash: Uint8Array): Uint8Array | Promise<Uint8Array>;
}

/**
 * Internal PSBT cache for computed values.
 */
export interface PsbtCache {
    nonWitnessUtxoTxCache: Transaction[];
    nonWitnessUtxoBufCache: Uint8Array[];
    txInCache: TxInCacheMap;
    tx: Transaction;
    feeRate?: number | undefined;
    fee?: number | undefined;
    extractedTx?: Transaction | undefined;
    unsafeSignNonSegwit: boolean;
    /** Cached flag: true if any input has signatures (avoids O(n) check) */
    hasSignatures: boolean;
    /** Cached prevOuts for Taproot signing (computed once) */
    prevOuts?: readonly PrevOut[] | undefined;
    /** Cached signing scripts */
    signingScripts?: readonly Script[] | undefined;
    /** Cached values */
    values?: readonly Satoshi[] | undefined;
    /** Cached intermediate hashes for Taproot sighash (computed once per PSBT) */
    taprootHashCache?: TaprootHashCache | undefined;
}

/**
 * Script types for classification.
 */
export const ScriptType = {
    WitnessPubKeyHash: 'witnesspubkeyhash',
    PubKeyHash: 'pubkeyhash',
    Multisig: 'multisig',
    PubKey: 'pubkey',
    NonStandard: 'nonstandard',
} as const;

export type ScriptType = (typeof ScriptType)[keyof typeof ScriptType];

/**
 * All possible script types including witness types.
 * Note: P2WPKH can't be wrapped in P2WSH (already a witness program)
 */
export const AllScriptType = {
    WitnessPubKeyHash: 'witnesspubkeyhash',
    PubKeyHash: 'pubkeyhash',
    Multisig: 'multisig',
    PubKey: 'pubkey',
    NonStandard: 'nonstandard',
    P2SH_WitnessPubKeyHash: 'p2sh-witnesspubkeyhash',
    P2SH_PubKeyHash: 'p2sh-pubkeyhash',
    P2SH_Multisig: 'p2sh-multisig',
    P2SH_PubKey: 'p2sh-pubkey',
    P2SH_NonStandard: 'p2sh-nonstandard',
    P2WSH_PubKeyHash: 'p2wsh-pubkeyhash',
    P2WSH_Multisig: 'p2wsh-multisig',
    P2WSH_PubKey: 'p2wsh-pubkey',
    P2WSH_NonStandard: 'p2wsh-nonstandard',
    P2SH_P2WSH_PubKeyHash: 'p2sh-p2wsh-pubkeyhash',
    P2SH_P2WSH_Multisig: 'p2sh-p2wsh-multisig',
    P2SH_P2WSH_PubKey: 'p2sh-p2wsh-pubkey',
    P2SH_P2WSH_NonStandard: 'p2sh-p2wsh-nonstandard',
} as const;

export type AllScriptType = (typeof AllScriptType)[keyof typeof AllScriptType];

/**
 * Return type for getScriptFromInput function.
 */
export interface GetScriptReturn {
    script: Script | null;
    isSegwit: boolean;
    isP2SH: boolean;
    isP2WSH: boolean;
}

/**
 * Index map for transaction input cache.
 */
export interface TxInCacheMap {
    readonly [index: string]: number;
}

/**
 * Previous output data for signing.
 */
export interface PrevOut {
    readonly script: Script;
    readonly value: Satoshi;
}

/**
 * Function type for final scripts computation.
 */
export type FinalScriptsFunc = (
    inputIndex: number,
    input: PsbtInput,
    script: Script,
    isSegwit: boolean,
    isP2SH: boolean,
    isP2WSH: boolean,
    canRunChecks: boolean,
) => {
    finalScriptSig: Script | undefined;
    finalScriptWitness: Uint8Array | undefined;
};

/**
 * Function type for final Taproot scripts computation.
 */
export type FinalTaprootScriptsFunc = (
    inputIndex: number,
    input: PsbtInput,
    tapLeafHashToFinalize?: Bytes32,
) => {
    finalScriptWitness: Uint8Array | undefined;
};
