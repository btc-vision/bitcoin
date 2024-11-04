import * as address from './address';
import * as crypto from './crypto';
import * as networks from './networks';
import * as payments from './payments';
import * as script from './script';
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
} from 'bip174/src/lib/interfaces';

export { address, crypto, networks, payments, script };

export { Block } from './block';
/** @hidden */
export { TaggedHashPrefix } from './crypto';
export * from './psbt';
/** @hidden */
export { OPS as opcodes } from './ops';
export { Transaction } from './transaction';
/** @hidden */
export { Network } from './networks';
/** @hidden */
export {
    Payment,
    PaymentCreator,
    PaymentOpts,
    Stack,
    StackElement,
} from './payments';
export { Input as TxInput, Output as TxOutput } from './transaction';
export { initEccLib } from './ecc_lib';

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
