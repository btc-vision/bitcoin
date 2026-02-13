/**
 * Base58Check encoding/decoding using @scure/base and @noble/hashes.
 *
 * Base58Check is a binary-to-text encoding with a 4-byte checksum
 * derived from double SHA-256, used for Bitcoin addresses and WIF keys.
 *
 * @packageDocumentation
 */

import { createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Base58Check codec instance using SHA-256 for checksum.
 */
export const base58check = createBase58check(sha256);

/**
 * Encode a Uint8Array to a Base58Check string.
 * @param data - The data to encode
 * @returns The Base58Check encoded string
 */
export function encode(data: Uint8Array): string {
    return base58check.encode(data);
}

/**
 * Decode a Base58Check string to a Uint8Array.
 * @param str - The Base58Check encoded string
 * @returns The decoded data
 * @throws If the checksum is invalid or the string is malformed
 */
export function decode(str: string): Uint8Array {
    return base58check.decode(str);
}
