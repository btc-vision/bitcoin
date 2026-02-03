import * as bip66 from './bip66.js';
import { alloc, concat } from './io/index.js';
import { isUInt8, isUint8ArrayN } from './types.js';

const ZERO = new Uint8Array([0]);

/**
 * Checks if a hash type is defined (valid for Bitcoin signatures).
 * @param hashType - The hash type to check.
 * @returns True if the hash type is valid, false otherwise.
 */
export function isDefinedHashType(hashType: number): boolean {
    const hashTypeMod = hashType & ~0x80;
    return hashTypeMod > 0x00 && hashTypeMod < 0x04;
}

/**
 * Converts a Uint8Array to a DER-encoded Uint8Array.
 * @param x - The Uint8Array to be converted.
 * @returns The DER-encoded Uint8Array.
 */
function toDER(x: Uint8Array): Uint8Array {
    let i = 0;
    while (x[i] === 0) ++i;
    if (i === x.length) return ZERO;
    x = x.subarray(i);
    if ((x[0] as number) & 0x80) return concat([ZERO, x]);
    return x;
}

/**
 * Converts a DER-encoded signature to a Uint8Array.
 * If the first byte of the input is 0x00, it is skipped.
 * The resulting Uint8Array is 32 bytes long, filled with zeros if necessary.
 * @param x - The DER-encoded signature.
 * @returns The converted Uint8Array.
 */
function fromDER(x: Uint8Array): Uint8Array {
    if (x[0] === 0x00) x = x.subarray(1);
    const buffer = alloc(32);
    const bstart = Math.max(0, 32 - x.length);
    buffer.set(x, bstart);
    return buffer;
}

export interface ScriptSignature {
    signature: Uint8Array;
    hashType: number;
}

// BIP62: 1 byte hashType flag (only 0x01, 0x02, 0x03, 0x81, 0x82 and 0x83 are allowed)
/**
 * Decodes a Uint8Array into a ScriptSignature object.
 * @param buffer - The Uint8Array to decode.
 * @returns The decoded ScriptSignature object.
 * @throws Error if the hashType is invalid.
 */
export function decode(buffer: Uint8Array): ScriptSignature {
    const hashType = buffer[buffer.length - 1] as number;
    if (!isDefinedHashType(hashType)) {
        throw new Error(`Invalid hashType ${hashType}`);
    }

    const decoded = bip66.decode(buffer.subarray(0, -1));
    const r = fromDER(decoded.r);
    const s = fromDER(decoded.s);
    const signature = concat([r, s]);

    return { signature, hashType };
}

/**
 * Encodes a signature and hash type into a Uint8Array.
 * @param signature - The signature to encode.
 * @param hashType - The hash type to encode.
 * @returns The encoded Uint8Array.
 * @throws Error if the hashType is invalid.
 */
export function encode(signature: Uint8Array, hashType: number): Uint8Array {
    if (!isUint8ArrayN(signature, 64)) {
        throw new TypeError('Expected signature to be a 64-byte Uint8Array');
    }
    if (!isUInt8(hashType)) {
        throw new TypeError('Expected hashType to be a UInt8');
    }

    if (!isDefinedHashType(hashType)) {
        throw new Error(`Invalid hashType ${hashType}`);
    }

    const hashTypeBuffer = new Uint8Array([hashType]);

    const r = toDER(signature.subarray(0, 32));
    const s = toDER(signature.subarray(32, 64));

    return concat([bip66.encode(r, s), hashTypeBuffer]);
}
