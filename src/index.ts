import './env.js';
import type {
    PsbtInput as _PsbtInput,
    PsbtInputUpdate as _PsbtInputUpdate,
    PsbtOutput as _PsbtOutput,
    TapBip32Derivation as _TapBip32Derivation,
    TapInternalKey as _TapInternalKey,
    TapKeySig as _TapKeySig,
    TapLeaf as _TapLeaf,
    TapLeafScript as _TapLeafScript,
    TapMerkleRoot as _TapMerkleRoot,
    TapScriptSig as _TapScriptSig,
    TapTree as _TapTree,
} from 'bip174';
import * as networks from './networks.js';
import * as address from './address.js';
import * as payments from './payments/index.js';
import * as script from './script.js';
import * as crypto from './crypto.js';
import * as Transaction from './transaction.js';
// Custom error types
import {
    AddressError,
    BitcoinError,
    EccError,
    InvalidInputError,
    InvalidOutputError,
    PsbtError,
    ScriptError,
    SignatureError,
    ValidationError,
} from './errors.js';

export * as address from './address.js';
export * as crypto from './crypto.js';
export * as networks from './networks.js';
export * as payments from './payments/index.js';
export * as script from './script.js';

export { Block } from './block.js';
/** @hidden */
export * from './crypto.js';
export {
    Psbt,
    PsbtCache,
    PsbtSigner,
    PsbtFinalizer,
    PsbtTransaction,
    transactionFromBuffer,
    getFinalScripts,
    prepareFinalScripts,
} from './psbt.js';
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
} from './psbt.js';
/** @hidden */
export { opcodes } from './opcodes.js';
export { Transaction } from './transaction.js';
export type { TaprootHashCache } from './transaction.js';
/** @hidden */
export type { Network } from './networks.js';
/** @hidden */
export { initEccLib, getEccLib, EccContext } from './ecc/context.js';
export type { CryptoBackend, EccLib } from './ecc/types.js';
export { PaymentType } from './payments/index.js';
export type {
    Payment,
    PaymentCreator,
    PaymentOpts,
    P2WSHPayment,
    P2PKPayment,
    BasePayment,
    P2SHPayment,
    P2TRPayment,
    P2MRPayment,
    P2WPKHPayment,
    P2PKHPayment,
    P2MSPayment,
    EmbedPayment,
    P2OPPayment,
    P2OPPaymentParams,
} from './payments/index.js';
export type { Stack, StackElement, StackFunction } from './types.js';
export type { Input as TxInput, Output as TxOutput } from './transaction.js';

export interface PsbtInput extends _PsbtInput {}

export interface PsbtOutput extends _PsbtOutput {}

export interface TapInternalKey extends _TapInternalKey {}

export interface TapLeaf extends _TapLeaf {}

export interface TapScriptSig extends _TapScriptSig {}

export interface TapKeySig extends _TapKeySig {}

export interface TapTree extends _TapTree {}

export interface TapMerkleRoot extends _TapMerkleRoot {}

export interface TapLeafScript extends _TapLeafScript {}

export interface TapBip32Derivation extends _TapBip32Derivation {}

export interface PsbtInputUpdate extends _PsbtInputUpdate {}

export * from './psbt/bip371.js';
export * from './address.js';
export {
    toHex,
    fromHex,
    isHex,
    fromBase64,
    toBase64,
    concat,
    equals,
    compare,
    isZero,
    clone,
    reverse,
    reverseCopy,
    alloc,
    xor,
    fromUtf8,
    toUtf8,
    varuint,
} from './io/index.js';
export * from './payments/bip341.js';
export * from './psbt/psbtutils.js';
export {
    toXOnly,
    decompressPublicKey,
    pubkeysMatch,
    type UncompressedPublicKey,
} from './pubkey.js';

export { TAPLEAF_VERSION_MASK } from './types.js';
export type { Taptree, Tapleaf } from './types.js';
export type {
    Bytes32,
    Bytes20,
    PublicKey,
    XOnlyPublicKey,
    Satoshi,
    PrivateKey,
    Signature,
    SchnorrSignature,
    Script,
} from './types.js';
export {
    isPrivateKey,
    isSchnorrSignature,
    isSignature,
    isScript,
    isBytes32,
    isBytes20,
    isPoint,
    isXOnlyPublicKey,
    isSatoshi,
    assertXOnlyPublicKey,
    assertPrivateKey,
    toBytes32,
    toBytes20,
    toSatoshi,
} from './types.js';
export type { XOnlyPointAddTweakResult } from './ecc/types.js';

export {
    BitcoinError,
    ValidationError,
    InvalidInputError,
    InvalidOutputError,
    ScriptError,
    PsbtError,
    EccError,
    AddressError,
    SignatureError,
};

/** All error classes grouped as a namespace */
export const errors = {
    BitcoinError,
    ValidationError,
    InvalidInputError,
    InvalidOutputError,
    ScriptError,
    PsbtError,
    EccError,
    AddressError,
    SignatureError,
} as const;

// Worker-based parallel signing (browser-safe shared exports only)
// For createSigningPool / detectRuntime, use '@btc-vision/bitcoin/workers' subpath export
// which routes to the correct platform-specific implementation.
export {
    WorkerSigningPool,
    getSigningPool,
    SignatureType,
    signPsbtParallel,
    prepareSigningTasks,
    applySignaturesToPsbt,
} from './workers/index.shared.js';
export type {
    WorkerPoolConfig,
    SigningTask,
    SigningPoolLike,
    ParallelSignerKeyPair,
    ParallelSigningResult,
    ParallelSignOptions,
    PsbtParallelKeyPair,
} from './workers/index.shared.js';

const bitcoin = {
    networks,
    address,
    payments,
    script,
    crypto,
    Transaction,
};

export default bitcoin;
