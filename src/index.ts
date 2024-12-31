import {
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
} from 'bip174/src/lib/interfaces.js';

export * as address from './address.js';
export * as crypto from './crypto.js';
export * as networks from './networks.js';
export * as payments from './payments/index.js';
export * as script from './script.js';

export * from './psbt/psbtutils.js';

export { Block } from './block.js';
/** @hidden */
export { TaggedHashPrefix } from './crypto.js';
export * from './psbt.js';
/** @hidden */
export { OPS as opcodes } from './ops.js';
export { Transaction } from './transaction.js';
/** @hidden */
export { Network } from './networks.js';
/** @hidden */
export { initEccLib } from './ecc_lib.js';
export { Payment, PaymentCreator, PaymentOpts, Stack, StackElement } from './payments/index.js';
export { Input as TxInput, Output as TxOutput } from './transaction.js';

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
