/**
 * Uint8Array utility functions to replace Buffer operations.
 * These provide Buffer-equivalent functionality without requiring polyfills.
 * Uses DataView for efficient binary data operations.
 *
 * @packageDocumentation
 */

/**
 * Concatenates multiple Uint8Arrays into a single Uint8Array.
 *
 * @param arrays - Arrays to concatenate
 * @returns A new Uint8Array containing all input arrays
 *
 * @example
 * ```typescript
 * import { concat, fromHex } from '@btc-vision/bitcoin';
 *
 * const a = fromHex('deadbeef');
 * const b = fromHex('cafebabe');
 * const result = concat([a, b]);
 * // result is Uint8Array containing deadbeefcafebabe
 * ```
 */
export function concat(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

/**
 * Checks if two Uint8Arrays are equal.
 *
 * @param a - First array
 * @param b - Second array
 * @returns True if arrays have the same length and contents
 *
 * @example
 * ```typescript
 * import { equals, fromHex } from '@btc-vision/bitcoin';
 *
 * const a = fromHex('deadbeef');
 * const b = fromHex('deadbeef');
 * const c = fromHex('cafebabe');
 *
 * equals(a, b); // true
 * equals(a, c); // false
 * ```
 */
export function equals(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * Compares two Uint8Arrays lexicographically.
 *
 * @param a - First array
 * @param b - Second array
 * @returns Negative if a < b, positive if a > b, 0 if equal
 *
 * @example
 * ```typescript
 * import { compare, fromHex } from '@btc-vision/bitcoin';
 *
 * const a = fromHex('0001');
 * const b = fromHex('0002');
 *
 * compare(a, b); // -1 (a < b)
 * compare(b, a); // 1 (b > a)
 * compare(a, a); // 0 (equal)
 * ```
 */
export function compare(a: Uint8Array, b: Uint8Array): number {
    const minLength = Math.min(a.length, b.length);
    for (let i = 0; i < minLength; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return a.length - b.length;
}

/**
 * Converts a hex string to Uint8Array.
 *
 * @param hex - Hex string (with or without 0x prefix)
 * @returns Uint8Array representation
 * @throws Error if hex string is invalid
 *
 * @example
 * ```typescript
 * import { fromHex } from '@btc-vision/bitcoin';
 *
 * const bytes = fromHex('deadbeef');
 * // bytes is Uint8Array [222, 173, 190, 239]
 *
 * const withPrefix = fromHex('0xdeadbeef');
 * // Also works with 0x prefix
 * ```
 */
export function fromHex(hex: string): Uint8Array {
    if (hex.startsWith('0x') || hex.startsWith('0X')) {
        hex = hex.slice(2);
    }
    if (hex.length % 2 !== 0) {
        throw new Error('Invalid hex string: odd length');
    }
    const length = hex.length / 2;
    const result = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        if (Number.isNaN(byte)) {
            throw new Error(`Invalid hex character at position ${i * 2}`);
        }
        result[i] = byte;
    }
    return result;
}

const HEX_CHARS = '0123456789abcdef';

/**
 * Converts a Uint8Array to hex string.
 *
 * @param bytes - Uint8Array to convert
 * @returns Lowercase hex string representation
 *
 * @example
 * ```typescript
 * import { toHex } from '@btc-vision/bitcoin';
 *
 * const bytes = new Uint8Array([222, 173, 190, 239]);
 * const hex = toHex(bytes);
 * // hex is 'deadbeef'
 * ```
 */
export function toHex(bytes: Uint8Array): string {
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
        result += HEX_CHARS[bytes[i] >> 4] + HEX_CHARS[bytes[i] & 0x0f];
    }
    return result;
}

/**
 * Allocates a new Uint8Array of the specified size.
 *
 * @param size - Number of bytes to allocate
 * @param fill - Optional fill value (default 0)
 * @returns A new Uint8Array filled with the specified value
 *
 * @example
 * ```typescript
 * import { alloc } from '@btc-vision/bitcoin';
 *
 * const zeros = alloc(32); // 32 zero bytes
 * const ones = alloc(32, 0xff); // 32 bytes of 0xff
 * ```
 */
export function alloc(size: number, fill: number = 0): Uint8Array {
    const result = new Uint8Array(size);
    if (fill !== 0) {
        result.fill(fill);
    }
    return result;
}

// ============================================================================
// DataView-based read/write operations
// ============================================================================

/**
 * Creates a DataView for a Uint8Array at a given offset.
 * Handles alignment by creating a view at the correct buffer position.
 */
function getDataView(bytes: Uint8Array, offset: number, length: number): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset + offset, length);
}

/**
 * Reads an 8-bit unsigned integer from a Uint8Array.
 *
 * @param bytes - Source array
 * @param offset - Byte offset to read from
 * @returns The 8-bit unsigned integer value
 *
 * @example
 * ```typescript
 * import { readUInt8, fromHex } from '@btc-vision/bitcoin';
 *
 * const bytes = fromHex('ff');
 * const value = readUInt8(bytes, 0);
 * // value is 255
 * ```
 */
export function readUInt8(bytes: Uint8Array, offset: number): number {
    return bytes[offset];
}

/**
 * Writes an 8-bit unsigned integer to a Uint8Array.
 *
 * @param bytes - Destination array
 * @param value - Value to write
 * @param offset - Byte offset to write to
 * @returns The offset after the written value (offset + 1)
 *
 * @example
 * ```typescript
 * import { writeUInt8, alloc, toHex } from '@btc-vision/bitcoin';
 *
 * const bytes = alloc(1);
 * writeUInt8(bytes, 255, 0);
 * toHex(bytes); // 'ff'
 * ```
 */
export function writeUInt8(bytes: Uint8Array, value: number, offset: number): number {
    bytes[offset] = value & 0xff;
    return offset + 1;
}

/**
 * Reads a 16-bit unsigned integer from a Uint8Array in little-endian format.
 *
 * @param bytes - Source array
 * @param offset - Byte offset to read from
 * @returns The 16-bit unsigned integer value
 *
 * @example
 * ```typescript
 * import { readUInt16LE, fromHex } from '@btc-vision/bitcoin';
 *
 * const bytes = fromHex('0100'); // 1 in little-endian
 * const value = readUInt16LE(bytes, 0);
 * // value is 1
 * ```
 */
export function readUInt16LE(bytes: Uint8Array, offset: number): number {
    return getDataView(bytes, offset, 2).getUint16(0, true);
}

/**
 * Writes a 16-bit unsigned integer to a Uint8Array in little-endian format.
 *
 * @param bytes - Destination array
 * @param value - Value to write
 * @param offset - Byte offset to write to
 * @returns The offset after the written value (offset + 2)
 *
 * @example
 * ```typescript
 * import { writeUInt16LE, alloc, toHex } from '@btc-vision/bitcoin';
 *
 * const bytes = alloc(2);
 * writeUInt16LE(bytes, 256, 0);
 * toHex(bytes); // '0001'
 * ```
 */
export function writeUInt16LE(bytes: Uint8Array, value: number, offset: number): number {
    getDataView(bytes, offset, 2).setUint16(0, value, true);
    return offset + 2;
}

/**
 * Reads a 32-bit unsigned integer from a Uint8Array in little-endian format.
 *
 * @param bytes - Source array
 * @param offset - Byte offset to read from
 * @returns The 32-bit unsigned integer value
 *
 * @example
 * ```typescript
 * import { readUInt32LE, fromHex } from '@btc-vision/bitcoin';
 *
 * const bytes = fromHex('01000000'); // 1 in little-endian
 * const value = readUInt32LE(bytes, 0);
 * // value is 1
 * ```
 */
export function readUInt32LE(bytes: Uint8Array, offset: number): number {
    return getDataView(bytes, offset, 4).getUint32(0, true);
}

/**
 * Writes a 32-bit unsigned integer to a Uint8Array in little-endian format.
 *
 * @param bytes - Destination array
 * @param value - Value to write
 * @param offset - Byte offset to write to
 * @returns The offset after the written value (offset + 4)
 *
 * @example
 * ```typescript
 * import { writeUInt32LE, alloc, toHex } from '@btc-vision/bitcoin';
 *
 * const bytes = alloc(4);
 * writeUInt32LE(bytes, 1, 0);
 * toHex(bytes); // '01000000'
 * ```
 */
export function writeUInt32LE(bytes: Uint8Array, value: number, offset: number): number {
    getDataView(bytes, offset, 4).setUint32(0, value, true);
    return offset + 4;
}

/**
 * Reads a 32-bit signed integer from a Uint8Array in little-endian format.
 *
 * @param bytes - Source array
 * @param offset - Byte offset to read from
 * @returns The 32-bit signed integer value
 *
 * @example
 * ```typescript
 * import { readInt32LE, fromHex } from '@btc-vision/bitcoin';
 *
 * const bytes = fromHex('ffffffff'); // -1 in little-endian signed
 * const value = readInt32LE(bytes, 0);
 * // value is -1
 * ```
 */
export function readInt32LE(bytes: Uint8Array, offset: number): number {
    return getDataView(bytes, offset, 4).getInt32(0, true);
}

/**
 * Writes a 32-bit signed integer to a Uint8Array in little-endian format.
 *
 * @param bytes - Destination array
 * @param value - Value to write
 * @param offset - Byte offset to write to
 * @returns The offset after the written value (offset + 4)
 *
 * @example
 * ```typescript
 * import { writeInt32LE, alloc, toHex } from '@btc-vision/bitcoin';
 *
 * const bytes = alloc(4);
 * writeInt32LE(bytes, -1, 0);
 * toHex(bytes); // 'ffffffff'
 * ```
 */
export function writeInt32LE(bytes: Uint8Array, value: number, offset: number): number {
    getDataView(bytes, offset, 4).setInt32(0, value, true);
    return offset + 4;
}

/**
 * Reads a 64-bit unsigned integer from a Uint8Array in little-endian format as bigint.
 *
 * @param bytes - Source array
 * @param offset - Byte offset to read from
 * @returns The 64-bit unsigned integer value as bigint
 *
 * @example
 * ```typescript
 * import { readUInt64LE, fromHex } from '@btc-vision/bitcoin';
 *
 * const bytes = fromHex('0100000000000000'); // 1 in little-endian 64-bit
 * const value = readUInt64LE(bytes, 0);
 * // value is 1n
 * ```
 */
export function readUInt64LE(bytes: Uint8Array, offset: number): bigint {
    return getDataView(bytes, offset, 8).getBigUint64(0, true);
}

/**
 * Writes a 64-bit unsigned integer to a Uint8Array in little-endian format from bigint.
 *
 * @param bytes - Destination array
 * @param value - Value to write as bigint
 * @param offset - Byte offset to write to
 * @returns The offset after the written value (offset + 8)
 *
 * @example
 * ```typescript
 * import { writeUInt64LE, alloc, toHex } from '@btc-vision/bitcoin';
 *
 * const bytes = alloc(8);
 * writeUInt64LE(bytes, 50000n, 0);
 * toHex(bytes); // '50c3000000000000'
 * ```
 */
export function writeUInt64LE(bytes: Uint8Array, value: bigint, offset: number): number {
    getDataView(bytes, offset, 8).setBigUint64(0, value, true);
    return offset + 8;
}

/**
 * Reads a 64-bit signed integer from a Uint8Array in little-endian format as bigint.
 *
 * @param bytes - Source array
 * @param offset - Byte offset to read from
 * @returns The 64-bit signed integer value as bigint
 *
 * @example
 * ```typescript
 * import { readInt64LE, fromHex } from '@btc-vision/bitcoin';
 *
 * const bytes = fromHex('ffffffffffffffff'); // -1 in little-endian 64-bit
 * const value = readInt64LE(bytes, 0);
 * // value is -1n
 * ```
 */
export function readInt64LE(bytes: Uint8Array, offset: number): bigint {
    return getDataView(bytes, offset, 8).getBigInt64(0, true);
}

/**
 * Writes a 64-bit signed integer to a Uint8Array in little-endian format from bigint.
 *
 * @param bytes - Destination array
 * @param value - Value to write as bigint
 * @param offset - Byte offset to write to
 * @returns The offset after the written value (offset + 8)
 *
 * @example
 * ```typescript
 * import { writeInt64LE, alloc, toHex } from '@btc-vision/bitcoin';
 *
 * const bytes = alloc(8);
 * writeInt64LE(bytes, -1n, 0);
 * toHex(bytes); // 'ffffffffffffffff'
 * ```
 */
export function writeInt64LE(bytes: Uint8Array, value: bigint, offset: number): number {
    getDataView(bytes, offset, 8).setBigInt64(0, value, true);
    return offset + 8;
}

// ============================================================================
// Array manipulation utilities
// ============================================================================

/**
 * Reverses a Uint8Array in place.
 *
 * @param bytes - Array to reverse
 * @returns The same array, reversed
 *
 * @example
 * ```typescript
 * import { reverse, fromHex, toHex } from '@btc-vision/bitcoin';
 *
 * const bytes = fromHex('01020304');
 * reverse(bytes);
 * toHex(bytes); // '04030201'
 * ```
 */
export function reverse(bytes: Uint8Array): Uint8Array {
    bytes.reverse();
    return bytes;
}

/**
 * Creates a reversed copy of a Uint8Array.
 *
 * @param bytes - Array to copy and reverse
 * @returns A new reversed Uint8Array
 *
 * @example
 * ```typescript
 * import { reverseCopy, fromHex, toHex } from '@btc-vision/bitcoin';
 *
 * const bytes = fromHex('01020304');
 * const reversed = reverseCopy(bytes);
 * toHex(reversed); // '04030201'
 * toHex(bytes); // '01020304' (original unchanged)
 * ```
 */
export function reverseCopy(bytes: Uint8Array): Uint8Array {
    return new Uint8Array(bytes).reverse();
}

/**
 * Creates a copy of a Uint8Array.
 *
 * @param bytes - Array to clone
 * @returns A new Uint8Array with the same contents
 *
 * @example
 * ```typescript
 * import { clone, fromHex } from '@btc-vision/bitcoin';
 *
 * const original = fromHex('deadbeef');
 * const copy = clone(original);
 * copy[0] = 0; // Modifying copy doesn't affect original
 * ```
 */
export function clone(bytes: Uint8Array): Uint8Array {
    return bytes.slice();
}

/**
 * Copies bytes from source to destination.
 *
 * @param source - Source array
 * @param target - Destination array
 * @param targetStart - Start position in target (default 0)
 * @param sourceStart - Start position in source (default 0)
 * @param sourceEnd - End position in source (default source.length)
 * @returns Number of bytes copied
 *
 * @example
 * ```typescript
 * import { copy, alloc, fromHex, toHex } from '@btc-vision/bitcoin';
 *
 * const source = fromHex('deadbeef');
 * const target = alloc(8);
 * copy(source, target, 2); // Copy to offset 2
 * toHex(target); // '0000deadbeef0000'
 * ```
 */
export function copy(
    source: Uint8Array,
    target: Uint8Array,
    targetStart: number = 0,
    sourceStart: number = 0,
    sourceEnd: number = source.length,
): number {
    const slice = source.subarray(sourceStart, sourceEnd);
    const length = Math.min(slice.length, target.length - targetStart);
    target.set(slice.subarray(0, length), targetStart);
    return length;
}

// ============================================================================
// String conversion utilities
// ============================================================================

/**
 * Creates a Uint8Array from a string using UTF-8 encoding.
 *
 * @param str - String to encode
 * @returns Uint8Array containing UTF-8 encoded bytes
 *
 * @example
 * ```typescript
 * import { fromUtf8, toHex } from '@btc-vision/bitcoin';
 *
 * const bytes = fromUtf8('hello');
 * toHex(bytes); // '68656c6c6f'
 * ```
 */
export function fromUtf8(str: string): Uint8Array {
    return new TextEncoder().encode(str);
}

/**
 * Decodes a Uint8Array to a string using UTF-8 encoding.
 *
 * @param bytes - Uint8Array to decode
 * @returns Decoded string
 *
 * @example
 * ```typescript
 * import { toUtf8, fromHex } from '@btc-vision/bitcoin';
 *
 * const bytes = fromHex('68656c6c6f');
 * const str = toUtf8(bytes);
 * // str is 'hello'
 * ```
 */
export function toUtf8(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes);
}

// ============================================================================
// Type checking utilities
// ============================================================================

/**
 * Checks if a value is a Uint8Array.
 *
 * @param value - Value to check
 * @returns True if value is a Uint8Array
 *
 * @example
 * ```typescript
 * import { isUint8Array } from '@btc-vision/bitcoin';
 *
 * isUint8Array(new Uint8Array(32)); // true
 * isUint8Array([]); // false
 * isUint8Array(Buffer.alloc(32)); // true (Buffer extends Uint8Array)
 * ```
 */
export function isUint8Array(value: unknown): value is Uint8Array {
    return value instanceof Uint8Array;
}

/**
 * Converts a value to Uint8Array if it isn't already.
 * Supports Buffer, ArrayBuffer, and array-like objects.
 *
 * @param value - Value to convert
 * @returns Uint8Array representation
 *
 * @example
 * ```typescript
 * import { toUint8Array } from '@btc-vision/bitcoin';
 *
 * const fromArray = toUint8Array([1, 2, 3, 4]);
 * const fromArrayBuffer = toUint8Array(new ArrayBuffer(4));
 * ```
 */
export function toUint8Array(value: Uint8Array | ArrayBuffer | ArrayLike<number>): Uint8Array {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    return new Uint8Array(value);
}

/**
 * Checks if a Uint8Array is all zeros.
 *
 * @param bytes - Array to check
 * @returns True if all bytes are zero
 *
 * @example
 * ```typescript
 * import { isZero, alloc, fromHex } from '@btc-vision/bitcoin';
 *
 * isZero(alloc(32)); // true
 * isZero(fromHex('00000001')); // false
 * ```
 */
export function isZero(bytes: Uint8Array): boolean {
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] !== 0) return false;
    }
    return true;
}

/**
 * XORs two Uint8Arrays together.
 *
 * @param a - First array
 * @param b - Second array
 * @returns A new Uint8Array with the XOR result
 * @throws Error if arrays have different lengths
 *
 * @example
 * ```typescript
 * import { xor, fromHex, toHex } from '@btc-vision/bitcoin';
 *
 * const a = fromHex('ff00ff00');
 * const b = fromHex('0f0f0f0f');
 * const result = xor(a, b);
 * toHex(result); // 'f00ff00f'
 * ```
 */
export function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
    if (a.length !== b.length) {
        throw new Error('Arrays must have the same length for XOR operation');
    }
    const result = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) {
        result[i] = a[i] ^ b[i];
    }
    return result;
}
