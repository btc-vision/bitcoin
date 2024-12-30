import * as varuint from 'bip174/src/lib/converter/varint';
import { PartialSig, PsbtInput } from 'bip174/src/lib/interfaces';
import * as bscript from '../script';
import { Transaction } from '../transaction';
import * as payments from '../payments';
import { crypto as bitCrypto } from '../index.js';
import { toXOnly } from './bip371.js';
import { ProjectivePoint } from '@noble/secp256k1';

function isPaymentFactory(payment: any): (script: Buffer) => boolean {
    return (script: Buffer): boolean => {
        try {
            payment({ output: script });
            return true;
        } catch (err) {
            return false;
        }
    };
}

export const isP2MS = isPaymentFactory(payments.p2ms);
export const isP2PK = isPaymentFactory(payments.p2pk);
export const isP2PKH = isPaymentFactory(payments.p2pkh);
export const isP2WPKH = isPaymentFactory(payments.p2wpkh);
export const isP2WSHScript = isPaymentFactory(payments.p2wsh);
export const isP2SHScript = isPaymentFactory(payments.p2sh);
export const isP2TR = isPaymentFactory(payments.p2tr);

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
export function witnessStackToScriptWitness(witness: Buffer[]): Buffer {
    let buffer = Buffer.allocUnsafe(0);

    function writeSlice(slice: Buffer): void {
        buffer = Buffer.concat([buffer, Buffer.from(slice)]);
    }

    function writeVarInt(i: number): void {
        const currentLen = buffer.length;
        const varintLen = varuint.encodingLength(i);

        buffer = Buffer.concat([buffer, Buffer.allocUnsafe(varintLen)]);
        varuint.encode(i, buffer, currentLen);
    }

    function writeVarSlice(slice: Buffer): void {
        writeVarInt(slice.length);
        writeSlice(slice);
    }

    function writeVector(vector: Buffer[]): void {
        writeVarInt(vector.length);
        vector.forEach(writeVarSlice);
    }

    writeVector(witness);

    return buffer;
}

export interface UncompressedPublicKey {
    hybrid: Buffer;
    uncompressed: Buffer;
}

/**
 * Converts an existing real Bitcoin public key (compressed or uncompressed)
 * to its "hybrid" form (prefix 0x06/0x07), then derives a P2PKH address from it.
 *
 * @param realPubKey - 33-byte compressed (0x02/0x03) or 65-byte uncompressed (0x04) pubkey
 * @returns Buffer
 */
export function decompressPublicKey(
    realPubKey: Uint8Array | Buffer,
): UncompressedPublicKey {
    if (![33, 65].includes(realPubKey.length)) {
        throw new Error(
            `Unsupported key length=${realPubKey.length}. Must be 33 (compressed) or 65 (uncompressed).`,
        );
    }

    // 1) Parse the public key to get an actual Point on secp256k1
    //    If it fails, the pubkey is invalid/corrupted.
    let point: ProjectivePoint;
    try {
        point = ProjectivePoint.fromHex(realPubKey);
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

/****************************************
 * Convert bigint -> 32-byte Buffer
 ****************************************/
export function bigIntTo32Bytes(num: bigint): Buffer {
    let hex = num.toString(16);
    // Pad to 64 hex chars => 32 bytes
    hex = hex.padStart(64, '0');
    // In case it's bigger than 64 chars, slice the rightmost 64 (mod 2^256)
    if (hex.length > 64) {
        hex = hex.slice(-64);
    }
    return Buffer.from(hex, 'hex');
}

/**
 * Compare two potential pubkey Buffers, treating hybrid keys (0x06/0x07)
 * as equivalent to uncompressed (0x04).
 */
export function pubkeysMatch(a: Buffer, b: Buffer): boolean {
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

/**
 * Finds the position of a public key in a script.
 * @param pubkey The public key to search for.
 * @param script The script to search in.
 * @returns The index of the public key in the script, or -1 if not found.
 * @throws {Error} If there is an unknown script error.
 */
export function pubkeyPositionInScript(pubkey: Buffer, script: Buffer): number {
    // For P2PKH or P2PK
    const pubkeyHash = bitCrypto.hash160(pubkey);

    // For Taproot or some cases, we might also check the x-only
    const pubkeyXOnly = toXOnly(pubkey);
    const uncompressed = decompressPublicKey(pubkey);

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

/**
 * Checks if a public key is present in a script.
 * @param pubkey The public key to check.
 * @param script The script to search in.
 * @returns A boolean indicating whether the public key is present in the script.
 */
export function pubkeyInScript(pubkey: Buffer, script: Buffer): boolean {
    return pubkeyPositionInScript(pubkey, script) !== -1;
}

/**
 * Checks if an input contains a signature for a specific action.
 * @param input - The input to check.
 * @param action - The action to check for.
 * @returns A boolean indicating whether the input contains a signature for the specified action.
 */
export function checkInputForSig(input: PsbtInput, action: string): boolean {
    const pSigs = extractPartialSigs(input);
    return pSigs.some(pSig =>
        signatureBlocksAction(pSig, bscript.signature.decode, action),
    );
}

type SignatureDecodeFunc = (buffer: Buffer) => {
    signature: Buffer;
    hashType: number;
};

/**
 * Determines if a given action is allowed for a signature block.
 * @param signature - The signature block.
 * @param signatureDecodeFn - The function used to decode the signature.
 * @param action - The action to be checked.
 * @returns True if the action is allowed, false otherwise.
 */
export function signatureBlocksAction(
    signature: Buffer,
    signatureDecodeFn: SignatureDecodeFunc,
    action: string,
): boolean {
    const { hashType } = signatureDecodeFn(signature);
    const whitelist: string[] = [];
    const isAnyoneCanPay = hashType & Transaction.SIGHASH_ANYONECANPAY;
    if (isAnyoneCanPay) whitelist.push('addInput');
    const hashMod = hashType & 0x1f;
    switch (hashMod) {
        case Transaction.SIGHASH_ALL:
            break;
        case Transaction.SIGHASH_SINGLE:
        case Transaction.SIGHASH_NONE:
            whitelist.push('addOutput');
            whitelist.push('setInputSequence');
            break;
    }
    return whitelist.indexOf(action) === -1;
}

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
function extractPartialSigs(input: PsbtInput): Buffer[] {
    let pSigs: PartialSig[] = [];
    if ((input.partialSig || []).length === 0) {
        if (!input.finalScriptSig && !input.finalScriptWitness) return [];
        pSigs = getPsigsFromInputFinalScripts(input);
    } else {
        pSigs = input.partialSig!;
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
export function getPsigsFromInputFinalScripts(input: PsbtInput): PartialSig[] {
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
        .map(sig => ({ signature: sig })) as PartialSig[];
}
