/**
 * Represents a payment object, which is used to create a payment.
 *
 * Supports P2PKH、P2SH、P2WPKH、P2WSH、P2TR and so on
 *
 * @packageDocumentation
 */

export {
    PaymentType,
    type BasePayment,
    type ScriptRedeem,
    type P2PKPayment,
    type P2PKHPayment,
    type P2SHPayment,
    type P2MSPayment,
    type P2WPKHPayment,
    type P2WSHPayment,
    type P2TRPayment,
    type P2OPPayment,
    type P2OPPaymentParams,
    type EmbedPayment,
    type Payment,
    type PaymentCreator,
    type PaymentOpts,
} from './types.js';

export { p2data } from './embed.js';
export { prop, value } from './lazy.js';
export { p2ms } from './p2ms.js';
export { p2pk } from './p2pk.js';
export { p2pkh } from './p2pkh.js';
export { p2sh } from './p2sh.js';
export { p2tr } from './p2tr.js';
export { p2wpkh } from './p2wpkh.js';
export { p2wsh } from './p2wsh.js';
export { p2op } from './p2op.js';

export {
    findScriptPath,
    LEAF_VERSION_TAPSCRIPT,
    MAX_TAPTREE_DEPTH,
    rootHashFromPath,
    tapleafHash,
    toHashTree,
    tweakKey,
    type HashTree,
} from './bip341.js';
