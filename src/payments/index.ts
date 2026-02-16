/**
 * Represents a payment object, which is used to create a payment.
 *
 * Supports P2PKH、P2SH、P2WPKH、P2WSH、P2TR and so on
 *
 * @packageDocumentation
 */

// Type exports
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
    type P2MRPayment,
    type P2OPPayment,
    type P2OPPaymentParams,
    type EmbedPayment,
    type Payment,
    type PaymentCreator,
    type PaymentOpts,
} from './types.js';

// Class exports (new pattern)
export { P2PK, p2pk } from './p2pk.js';
export { P2PKH, p2pkh } from './p2pkh.js';
export { P2WPKH, p2wpkh } from './p2wpkh.js';
export { Embed, p2data } from './embed.js';
export { P2MS, p2ms } from './p2ms.js';
export { P2SH, p2sh } from './p2sh.js';
export { P2WSH, p2wsh } from './p2wsh.js';
export { P2TR, p2tr } from './p2tr.js';
export { P2MR, p2mr } from './p2mr.js';
export { P2OP, p2op } from './p2op.js';

// BIP341 Taproot utilities
export {
    findScriptPath,
    LEAF_VERSION_TAPSCRIPT,
    MAX_TAPTREE_DEPTH,
    rootHashFromPath,
    rootHashFromPathP2MR,
    tapBranchHash,
    tapleafHash,
    toHashTree,
    tweakKey,
    type HashTree,
} from './bip341.js';
