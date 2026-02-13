/**
 * PSBT utility functions
 * @packageDocumentation
 */

import { varuint } from '../io/index.js';
import * as bscript from '../script.js';
import { Transaction } from '../transaction.js';
import { isP2MS, isP2PK, isP2PKH, isP2SHScript, isP2WPKH, isP2WSHScript } from './psbtutils.js';
import type { ScriptType } from './types.js';
import type { Script } from '../types.js';
import { checkRedeemScript, checkWitnessScript } from './validation.js';

/**
 * Converts a witness script buffer to an array of witness stack items.
 * @param buffer - The witness script buffer
 * @returns Array of witness stack items
 */
export function scriptWitnessToWitnessStack(buffer: Uint8Array): Uint8Array[] {
    let offset = 0;

    function readSlice(n: number): Uint8Array {
        offset += n;
        return buffer.subarray(offset - n, offset);
    }

    function readVarInt(): number {
        const vi = varuint.decode(buffer, offset);
        offset += vi.bytes;
        return vi.numberValue || 0;
    }

    function readVarSlice(): Uint8Array {
        return readSlice(readVarInt());
    }

    function readVector(): Uint8Array[] {
        const count = readVarInt();
        const vector: Uint8Array[] = [];
        for (let i = 0; i < count; i++) vector.push(readVarSlice());
        return vector;
    }

    return readVector();
}

/**
 * Converts a sighash type to a human-readable string.
 * @param sighashType - The sighash type value
 * @returns Human-readable sighash type string
 */
export function sighashTypeToString(sighashType: number): string {
    let text = sighashType & Transaction.SIGHASH_ANYONECANPAY ? 'SIGHASH_ANYONECANPAY | ' : '';
    const sigMod = sighashType & 0x1f;
    switch (sigMod) {
        case Transaction.SIGHASH_ALL:
            text += 'SIGHASH_ALL';
            break;
        case Transaction.SIGHASH_SINGLE:
            text += 'SIGHASH_SINGLE';
            break;
        case Transaction.SIGHASH_NONE:
            text += 'SIGHASH_NONE';
            break;
    }
    return text;
}

/**
 * Compresses an uncompressed public key to compressed form.
 * @param pubkey - The public key (33 or 65 bytes)
 * @returns Compressed public key (33 bytes)
 */
export function compressPubkey(pubkey: Uint8Array): Uint8Array {
    if (pubkey.length === 65) {
        const parity = (pubkey[64] as number) & 1;
        const newKey = new Uint8Array(pubkey.subarray(0, 33));
        newKey[0] = 2 | parity;
        return newKey;
    }
    return new Uint8Array(pubkey);
}

/**
 * Checks if a buffer looks like a public key.
 * @param buf - The buffer to check
 * @returns True if the buffer is a valid compressed public key format
 */
export function isPubkeyLike(buf: Uint8Array): boolean {
    return buf.length === 33 && bscript.isCanonicalPubKey(buf);
}

/**
 * Checks if a buffer looks like a signature.
 * @param buf - The buffer to check
 * @returns True if the buffer is a valid canonical signature format
 */
export function isSigLike(buf: Uint8Array): boolean {
    return bscript.isCanonicalScriptSignature(buf);
}

/**
 * Classifies a script into a known script type.
 * @param script - The script to classify
 * @returns The script type
 */
export function classifyScript(script: Uint8Array): ScriptType {
    if (isP2WPKH(script)) return 'witnesspubkeyhash';
    if (isP2PKH(script)) return 'pubkeyhash';
    if (isP2MS(script)) return 'multisig';
    if (isP2PK(script)) return 'pubkey';
    return 'nonstandard';
}

/**
 * Creates an array of numbers from 0 to n-1.
 * @param n - The length of the array
 * @returns Array of numbers [0, 1, 2, ..., n-1]
 */
export function range(n: number): number[] {
    return [...Array(n).keys()];
}

/**
 * Validates that a script is not P2WPKH or P2SH (invalid for P2WSH).
 * @param script - The script to check
 * @throws {Error} If the script is P2WPKH or P2SH
 */
export function checkInvalidP2WSH(script: Uint8Array): void {
    if (isP2WPKH(script) || isP2SHScript(script)) {
        throw new Error('P2WPKH or P2SH can not be contained within P2WSH');
    }
}

/**
 * Extracts the meaningful script from a potentially wrapped script.
 * Handles P2SH, P2WSH, and P2SH-P2WSH wrapping.
 * @param script - The script to analyze
 * @param index - The input/output index (for error messages)
 * @param ioType - Whether this is an input or output
 * @param redeemScript - Optional redeem script for P2SH
 * @param witnessScript - Optional witness script for P2WSH
 * @returns The meaningful script and its type
 */
export function getMeaningfulScript(
    script: Uint8Array,
    index: number,
    ioType: 'input' | 'output',
    redeemScript?: Uint8Array,
    witnessScript?: Uint8Array,
): {
    meaningfulScript: Uint8Array;
    type: 'p2sh' | 'p2wsh' | 'p2sh-p2wsh' | 'raw';
} {
    const isP2SH = isP2SHScript(script);
    const isP2SHP2WSH = isP2SH && redeemScript && isP2WSHScript(redeemScript);
    const isP2WSH = isP2WSHScript(script);

    if (isP2SH && redeemScript === undefined)
        throw new Error('scriptPubkey is P2SH but redeemScript missing');
    let meaningfulScript: Uint8Array;

    if (isP2SHP2WSH) {
        if (!witnessScript)
            throw new Error('scriptPubkey or redeemScript is P2WSH but witnessScript missing');
        if (!redeemScript) throw new Error('P2SH-P2WSH requires redeemScript');
        meaningfulScript = witnessScript;
        checkRedeemScript(index, script as Script, redeemScript as Script, ioType);
        checkWitnessScript(index, redeemScript as Script, witnessScript as Script, ioType);
        checkInvalidP2WSH(meaningfulScript);
    } else if (isP2WSH) {
        if (!witnessScript)
            throw new Error('scriptPubkey or redeemScript is P2WSH but witnessScript missing');
        meaningfulScript = witnessScript;
        checkWitnessScript(index, script as Script, witnessScript as Script, ioType);
        checkInvalidP2WSH(meaningfulScript);
    } else if (isP2SH) {
        if (!redeemScript) throw new Error('P2SH requires redeemScript');
        meaningfulScript = redeemScript;
        checkRedeemScript(index, script as Script, redeemScript as Script, ioType);
    } else {
        meaningfulScript = script;
    }
    return {
        meaningfulScript,
        type: isP2SHP2WSH ? 'p2sh-p2wsh' : isP2SH ? 'p2sh' : isP2WSH ? 'p2wsh' : 'raw',
    };
}
