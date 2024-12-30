'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.getPsigsFromInputFinalScripts =
    exports.signatureBlocksAction =
    exports.checkInputForSig =
    exports.pubkeyInScript =
    exports.pubkeyPositionInScript =
    exports.pubkeysMatch =
    exports.bigIntTo32Bytes =
    exports.getHybridPubKeyAndAddress =
    exports.witnessStackToScriptWitness =
    exports.isP2TR =
    exports.isP2SHScript =
    exports.isP2WSHScript =
    exports.isP2WPKH =
    exports.isP2PKH =
    exports.isP2PK =
    exports.isP2MS =
        void 0;
const varuint = require('bip174/src/lib/converter/varint');
const bscript = require('../script');
const transaction_1 = require('../transaction');
const payments = require('../payments');
const index_js_1 = require('../index.js');
const bip371_js_1 = require('./bip371.js');
const secp256k1_1 = require('@noble/secp256k1');
function isPaymentFactory(payment) {
    return script => {
        try {
            payment({ output: script });
            return true;
        } catch (err) {
            return false;
        }
    };
}
exports.isP2MS = isPaymentFactory(payments.p2ms);
exports.isP2PK = isPaymentFactory(payments.p2pk);
exports.isP2PKH = isPaymentFactory(payments.p2pkh);
exports.isP2WPKH = isPaymentFactory(payments.p2wpkh);
exports.isP2WSHScript = isPaymentFactory(payments.p2wsh);
exports.isP2SHScript = isPaymentFactory(payments.p2sh);
exports.isP2TR = isPaymentFactory(payments.p2tr);
/**
 * Converts a witness stack to a script witness.
 * @param witness The witness stack to convert.
 * @returns The script witness as a Buffer.
 */
/**
 * Converts a witness stack to a script witness.
 * @param witness The witness stack to convert.
 * @returns The converted script witness.
 */
function witnessStackToScriptWitness(witness) {
    let buffer = Buffer.allocUnsafe(0);
    function writeSlice(slice) {
        buffer = Buffer.concat([buffer, Buffer.from(slice)]);
    }
    function writeVarInt(i) {
        const currentLen = buffer.length;
        const varintLen = varuint.encodingLength(i);
        buffer = Buffer.concat([buffer, Buffer.allocUnsafe(varintLen)]);
        varuint.encode(i, buffer, currentLen);
    }
    function writeVarSlice(slice) {
        writeVarInt(slice.length);
        writeSlice(slice);
    }
    function writeVector(vector) {
        writeVarInt(vector.length);
        vector.forEach(writeVarSlice);
    }
    writeVector(witness);
    return buffer;
}
exports.witnessStackToScriptWitness = witnessStackToScriptWitness;
/**
 * Converts an existing real Bitcoin public key (compressed or uncompressed)
 * to its "hybrid" form (prefix 0x06/0x07), then derives a P2PKH address from it.
 *
 * @param realPubKey - 33-byte compressed (0x02/0x03) or 65-byte uncompressed (0x04) pubkey
 * @returns Buffer
 */
function getHybridPubKeyAndAddress(realPubKey) {
    if (![33, 65].includes(realPubKey.length)) {
        throw new Error(
            `Unsupported key length=${realPubKey.length}. Must be 33 (compressed) or 65 (uncompressed).`,
        );
    }
    // 1) Parse the public key to get an actual Point on secp256k1
    //    If it fails, the pubkey is invalid/corrupted.
    let point;
    try {
        point = secp256k1_1.ProjectivePoint.fromHex(realPubKey);
    } catch (err) {
        throw new Error('Invalid secp256k1 public key bytes. Cannot parse.');
    }
    // 2) Extract X and Y as 32-byte big-endian buffers
    const xBuf = bigIntTo32Bytes(point.x);
    const yBuf = bigIntTo32Bytes(point.y);
    // 3) Determine if Y is even or odd. That decides the hybrid prefix:
    //    - 0x06 => "uncompressed + even Y"
    //    - 0x07 => "uncompressed + odd Y"
    const isEven = point.y % 2n === 0n;
    const prefix = isEven ? 0x06 : 0x07;
    // 4) Construct 65-byte hybrid pubkey
    //    [prefix(1) || X(32) || Y(32)]
    const hybridPubKey = Buffer.alloc(65);
    hybridPubKey[0] = prefix;
    xBuf.copy(hybridPubKey, 1);
    yBuf.copy(hybridPubKey, 33);
    const uncompressedPubKey = Buffer.concat([Buffer.from([0x04]), xBuf, yBuf]);
    return {
        hybrid: hybridPubKey,
        uncompressed: uncompressedPubKey,
    };
}
exports.getHybridPubKeyAndAddress = getHybridPubKeyAndAddress;
/****************************************
 * Convert bigint -> 32-byte Buffer
 ****************************************/
function bigIntTo32Bytes(num) {
    let hex = num.toString(16);
    // Pad to 64 hex chars => 32 bytes
    hex = hex.padStart(64, '0');
    // In case it's bigger than 64 chars, slice the rightmost 64 (mod 2^256)
    if (hex.length > 64) {
        hex = hex.slice(-64);
    }
    return Buffer.from(hex, 'hex');
}
exports.bigIntTo32Bytes = bigIntTo32Bytes;
/**
 * Compare two potential pubkey Buffers, treating hybrid keys (0x06/0x07)
 * as equivalent to uncompressed (0x04).
 */
function pubkeysMatch(a, b) {
    // If they’re literally the same bytes, no further check needed
    if (a.equals(b)) return true;
    // If both are 65 bytes, see if one is hybrid and the other is uncompressed
    if (a.length === 65 && b.length === 65) {
        const aCopy = Buffer.from(a);
        const bCopy = Buffer.from(b);
        // Convert 0x06/0x07 to 0x04
        if (aCopy[0] === 0x06 || aCopy[0] === 0x07) aCopy[0] = 0x04;
        if (bCopy[0] === 0x06 || bCopy[0] === 0x07) bCopy[0] = 0x04;
        return aCopy.equals(bCopy);
    }
    return false;
}
exports.pubkeysMatch = pubkeysMatch;
/**
 * Finds the position of a public key in a script.
 * @param pubkey The public key to search for.
 * @param script The script to search in.
 * @returns The index of the public key in the script, or -1 if not found.
 * @throws {Error} If there is an unknown script error.
 */
function pubkeyPositionInScript(pubkey, script) {
    // For P2PKH or P2PK
    const pubkeyHash = index_js_1.crypto.hash160(pubkey);
    // For Taproot or some cases, we might also check the x-only
    const pubkeyXOnly = (0, bip371_js_1.toXOnly)(pubkey);
    const uncompressed = getHybridPubKeyAndAddress(pubkey);
    const decompiled = bscript.decompile(script);
    if (decompiled === null) throw new Error('Unknown script error');
    return decompiled.findIndex(element => {
        // Skip opcodes
        if (typeof element === 'number') return false;
        // Compare as raw pubkey (including hybrid check)
        if (pubkeysMatch(element, pubkey)) return true;
        // Compare with x-only
        if (pubkeysMatch(element, pubkeyXOnly)) return true;
        // Compare with uncompressed
        if (pubkeysMatch(element, uncompressed.uncompressed)) return true;
        // Compare with hybrid
        if (pubkeysMatch(element, uncompressed.hybrid)) return true;
        // Compare with hash160
        return element.equals(pubkeyHash);
    }); // returns -1 if not found
}
exports.pubkeyPositionInScript = pubkeyPositionInScript;
/**
 * Checks if a public key is present in a script.
 * @param pubkey The public key to check.
 * @param script The script to search in.
 * @returns A boolean indicating whether the public key is present in the script.
 */
function pubkeyInScript(pubkey, script) {
    return pubkeyPositionInScript(pubkey, script) !== -1;
}
exports.pubkeyInScript = pubkeyInScript;
/**
 * Checks if an input contains a signature for a specific action.
 * @param input - The input to check.
 * @param action - The action to check for.
 * @returns A boolean indicating whether the input contains a signature for the specified action.
 */
function checkInputForSig(input, action) {
    const pSigs = extractPartialSigs(input);
    return pSigs.some(pSig =>
        signatureBlocksAction(pSig, bscript.signature.decode, action),
    );
}
exports.checkInputForSig = checkInputForSig;
/**
 * Determines if a given action is allowed for a signature block.
 * @param signature - The signature block.
 * @param signatureDecodeFn - The function used to decode the signature.
 * @param action - The action to be checked.
 * @returns True if the action is allowed, false otherwise.
 */
function signatureBlocksAction(signature, signatureDecodeFn, action) {
    const { hashType } = signatureDecodeFn(signature);
    const whitelist = [];
    const isAnyoneCanPay =
        hashType & transaction_1.Transaction.SIGHASH_ANYONECANPAY;
    if (isAnyoneCanPay) whitelist.push('addInput');
    const hashMod = hashType & 0x1f;
    switch (hashMod) {
        case transaction_1.Transaction.SIGHASH_ALL:
            break;
        case transaction_1.Transaction.SIGHASH_SINGLE:
        case transaction_1.Transaction.SIGHASH_NONE:
            whitelist.push('addOutput');
            whitelist.push('setInputSequence');
            break;
    }
    return whitelist.indexOf(action) === -1;
}
exports.signatureBlocksAction = signatureBlocksAction;
/**
 * Extracts the signatures from a PsbtInput object.
 * If the input has partial signatures, it returns an array of the signatures.
 * If the input does not have partial signatures, it checks if it has a finalScriptSig or finalScriptWitness.
 * If it does, it extracts the signatures from the final scripts and returns them.
 * If none of the above conditions are met, it returns an empty array.
 *
 * @param input - The PsbtInput object from which to extract the signatures.
 * @returns An array of signatures extracted from the PsbtInput object.
 */
function extractPartialSigs(input) {
    let pSigs = [];
    if ((input.partialSig || []).length === 0) {
        if (!input.finalScriptSig && !input.finalScriptWitness) return [];
        pSigs = getPsigsFromInputFinalScripts(input);
    } else {
        pSigs = input.partialSig;
    }
    return pSigs.map(p => p.signature);
}
/**
 * Retrieves the partial signatures (Psigs) from the input's final scripts.
 * Psigs are extracted from both the final scriptSig and final scriptWitness of the input.
 * Only canonical script signatures are considered.
 *
 * @param input - The PsbtInput object representing the input.
 * @returns An array of PartialSig objects containing the extracted Psigs.
 */
function getPsigsFromInputFinalScripts(input) {
    const scriptItems = !input.finalScriptSig
        ? []
        : bscript.decompile(input.finalScriptSig) || [];
    const witnessItems = !input.finalScriptWitness
        ? []
        : bscript.decompile(input.finalScriptWitness) || [];
    return scriptItems
        .concat(witnessItems)
        .filter(item => {
            return (
                Buffer.isBuffer(item) &&
                bscript.isCanonicalScriptSignature(item)
            );
        })
        .map(sig => ({ signature: sig }));
}
exports.getPsigsFromInputFinalScripts = getPsigsFromInputFinalScripts;
