import * as varuint from 'bip174/src/lib/converter/varint.js';
import { PartialSig, PsbtInput } from 'bip174/src/lib/interfaces.js';
import { hash160 } from '../crypto.js';
import { p2ms } from '../payments/p2ms.js';
import { p2pk } from '../payments/p2pk.js';
import { p2pkh } from '../payments/p2pkh.js';
import { p2sh } from '../payments/p2sh.js';
import { p2tr } from '../payments/p2tr.js';
import { p2wpkh } from '../payments/p2wpkh.js';
import { p2wsh } from '../payments/p2wsh.js';
import { p2op } from '../payments/p2op.js';
import { decompressPublicKey, pubkeysMatch, toXOnly } from '../pubkey.js';
import * as bscript from '../script.js';
import { Transaction } from '../transaction.js';

type PaymentFunction = (opts: { output: Buffer }) => unknown;

function isPaymentFactory(payment: PaymentFunction): (script: Buffer) => boolean {
    return (script: Buffer): boolean => {
        try {
            payment({ output: script });
            return true;
        } catch {
            return false;
        }
    };
}

export const isP2MS = isPaymentFactory(p2ms);
export const isP2PK = isPaymentFactory(p2pk);
export const isP2PKH = isPaymentFactory(p2pkh);
export const isP2WPKH = isPaymentFactory(p2wpkh);
export const isP2WSHScript = isPaymentFactory(p2wsh);
export const isP2SHScript = isPaymentFactory(p2sh);
export const isP2TR = isPaymentFactory(p2tr);
export const isP2OP = isPaymentFactory(p2op);
export const isP2A = (script: Buffer): boolean => {
    return (
        script.length === 4 &&
        script[0] === 0x51 && // OP_1
        script[1] === 0x02 && // push 2 bytes
        script[2] === 0x4e &&
        script[3] === 0x73
    );
};

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

/**
 * Finds the position of a public key in a script.
 * @param pubkey The public key to search for.
 * @param script The script to search in.
 * @returns The index of the public key in the script, or -1 if not found.
 * @throws {Error} If there is an unknown script error.
 */
export function pubkeyPositionInScript(pubkey: Buffer, script: Buffer): number {
    const decompiled = bscript.decompile(script);
    if (decompiled === null) throw new Error('Unknown script error');

    // For P2PKH or P2PK
    const pubkeyHash = hash160(pubkey);

    // For Taproot or some cases, we might also check the x-only
    const pubkeyXOnly = toXOnly(pubkey);
    const uncompressed = decompressPublicKey(pubkey);

    const pubkeyHybridHash = uncompressed?.hybrid ? hash160(uncompressed.hybrid) : undefined;
    const pubkeyUncompressedHash = uncompressed?.uncompressed
        ? hash160(uncompressed.uncompressed)
        : undefined;

    return decompiled.findIndex((element) => {
        if (typeof element === 'number') return false;

        if (pubkeysMatch(element, pubkey)) return true;

        if (pubkeysMatch(element, pubkeyXOnly)) return true;

        if (element.equals(pubkeyHash)) {
            return true;
        }

        if (uncompressed) {
            if (pubkeysMatch(element, uncompressed.uncompressed)) return true;

            if (pubkeysMatch(element, uncompressed.hybrid)) return true;

            if (
                (pubkeyHybridHash && element.equals(pubkeyHybridHash)) ||
                (pubkeyUncompressedHash && element.equals(pubkeyUncompressedHash))
            ) {
                return true;
            }
        }
    });
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
    return pSigs.some((pSig) => signatureBlocksAction(pSig, bscript.signature.decode, action));
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
    const { partialSig } = input;
    let pSigs: PartialSig[];
    if (!partialSig || partialSig.length === 0) {
        if (!input.finalScriptSig && !input.finalScriptWitness) return [];
        pSigs = getPsigsFromInputFinalScripts(input);
    } else {
        pSigs = partialSig;
    }
    return pSigs.map((p) => p.signature);
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
    const scriptItems = !input.finalScriptSig ? [] : bscript.decompile(input.finalScriptSig) || [];
    const witnessItems = !input.finalScriptWitness
        ? []
        : bscript.decompile(input.finalScriptWitness) || [];
    return scriptItems
        .concat(witnessItems)
        .filter((item) => {
            return Buffer.isBuffer(item) && bscript.isCanonicalScriptSignature(item);
        })
        .map((sig) => ({ signature: sig })) as PartialSig[];
}
