/**
 * PSBT types and interfaces
 * @packageDocumentation
 */

import type { Psbt as PsbtBase, PsbtGlobal, PsbtInput, PsbtOutput } from 'bip174';
import type { Network } from '../networks.js';
import type { TaprootHashCache, Transaction } from '../transaction.js';
import type { Bytes32, MessageHash, PublicKey, Satoshi, Script } from '../types.js';

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
    msghash: MessageHash,
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

export type { Signer, SignerAsync, HDSigner, HDSignerAsync } from '@btc-vision/ecpair';

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
export interface PsbtCacheInterface {
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
 * Keys for cached numeric values in the transaction cache.
 */
export type TxCacheNumberKey = 'feeRate' | 'fee';

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
 * Result from getTaprootHashesForSig containing hash and optional leaf hash.
 */
export interface TaprootHashResult {
    readonly hash: Bytes32;
    readonly leafHash?: Bytes32 | undefined;
}

/**
 * Extended Taproot hash result with pubkey for validation.
 */
export interface TaprootSigningHash {
    readonly pubkey: PublicKey;
    readonly hash: Bytes32;
    readonly leafHash?: Bytes32 | undefined;
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
