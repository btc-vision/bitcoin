/**
 * Pure utility functions for Uint8Array operations.
 *
 * No DataView allocations. No wrappers.
 * Optimized for performance with minimal allocations.
 *
 * @packageDocumentation
 */

/**
 * Concatenates multiple Uint8Arrays into a single Uint8Array.
 *
 * Allocates exactly once for the result array.
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
 * // result contains deadbeefcafebabe
 * ```
 */
export function concat(arrays: readonly Uint8Array[]): Uint8Array {
    let totalLength = 0;
    for (const arr of arrays) {
        totalLength += arr.length;
    }

    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }

    return result;
}

/**
 * Checks if two Uint8Arrays have identical contents.
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
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
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
        const diff = (a[i] as number) - (b[i] as number);
        if (diff !== 0) {
            return diff;
        }
    }
    return a.length - b.length;
}

/**
 * Checks if a Uint8Array contains only zero bytes.
 *
 * @param bytes - Array to check
 * @returns True if all bytes are zero
 *
 * @example
 * ```typescript
 * import { isZero } from '@btc-vision/bitcoin';
 *
 * isZero(new Uint8Array(32)); // true
 * isZero(new Uint8Array([0, 0, 1])); // false
 * ```
 */
export function isZero(bytes: Uint8Array): boolean {
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] !== 0) {
            return false;
        }
    }
    return true;
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
    // Create a true copy - .slice() on Buffer returns a view, not a copy
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return copy;
}

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
    const result = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        result[i] = bytes[bytes.length - 1 - i] as number;
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
 * import { alloc, toHex } from '@btc-vision/bitcoin';
 *
 * const zeros = alloc(4); // 4 zero bytes
 * const ones = alloc(4, 0xff); // 4 bytes of 0xff
 * toHex(ones); // 'ffffffff'
 * ```
 */
export function alloc(size: number, fill: number = 0): Uint8Array {
    const result = new Uint8Array(size);
    if (fill !== 0) {
        result.fill(fill);
    }
    return result;
}

/**
 * XORs two Uint8Arrays together.
 *
 * @param a - First array
 * @param b - Second array
 * @returns A new Uint8Array with the XOR result
 * @throws TypeError if arrays have different lengths
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
        throw new TypeError('Arrays must have the same length for XOR operation');
    }
    const result = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) {
        result[i] = (a[i] as number) ^ (b[i] as number);
    }
    return result;
}

/**
 * Creates a Uint8Array from a UTF-8 string.
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
 * Decodes a Uint8Array to a UTF-8 string.
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
