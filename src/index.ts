export type {
    PsbtInput,
    PsbtInputUpdate,
    PsbtOutput,
    TapBip32Derivation,
    TapInternalKey,
    TapKeySig,
    TapLeaf,
    TapLeafScript,
    TapMerkleRoot,
    TapScriptSig,
    TapTree,
} from 'bip174/src/lib/interfaces.js';
import * as networks from './networks.js';
import * as address from './address.js';
import * as payments from './payments/index.js';
import * as script from './script.js';
import * as crypto from './crypto.js';
import * as Transaction from './transaction.js';

export * as address from './address.js';
export * as crypto from './crypto.js';
export * as networks from './networks.js';
export * as payments from './payments/index.js';
export * as script from './script.js';

export { Block } from './block.js';
/** @hidden */
export * from './crypto.js';
export * from './psbt.js';
/** @hidden */
export { opcodes } from './opcodes.js';
export { Transaction } from './transaction.js';
/** @hidden */
export type { Network } from './networks.js';
/** @hidden */
export { initEccLib } from './ecc_lib.js';
export { PaymentType } from './payments/index.js';
export type {
    Payment,
    PaymentCreator,
    PaymentOpts,
    Stack,
    StackElement,
    P2WSHPayment,
    P2PKPayment,
    BasePayment,
    P2SHPayment,
    P2TRPayment,
    P2WPKHPayment,
    P2PKHPayment,
    P2MSPayment,
    EmbedPayment,
    P2OPPayment,
    P2OPPaymentParams,
    StackFunction,
} from './payments/index.js';
export type { Input as TxInput, Output as TxOutput } from './transaction.js';

export * from './psbt/bip371.js';
export * from './address.js';
export * from './bufferutils.js';
export * from './payments/bip341.js';
export * from './psbt/psbtutils.js';

export { TAPLEAF_VERSION_MASK } from './types.js';
export type {
    Taptree,
    XOnlyPointAddTweakResult,
    Tapleaf,
    TinySecp256k1Interface,
} from './types.js';

const bitcoin = {
    networks,
    address,
    payments,
    script,
    crypto,
    Transaction,
};

export default bitcoin;
