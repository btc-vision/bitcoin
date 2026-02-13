/**
 * Hex encoding and decoding utilities.
 *
 * Direct implementations with zero dependencies and no wrappers.
 * Optimized for performance with lookup tables.
 *
 * @packageDocumentation
 */

/**
 * Lookup table for byte to hex conversion.
 * Pre-computed for O(1) lookup per byte.
 */
const BYTE_TO_HEX: readonly string[] = Array.from({ length: 256 }, (_, i) =>
    i.toString(16).padStart(2, '0'),
);

/**
 * Lookup table for hex character to nibble conversion.
 * Returns -1 for invalid characters.
 */
const HEX_TO_NIBBLE: readonly number[] = (() => {
    const table = new Array<number>(128).fill(-1);
    for (let i = 0; i < 10; i++) {
        table[0x30 + i] = i; // '0'-'9'
    }
    for (let i = 0; i < 6; i++) {
        table[0x41 + i] = 10 + i; // 'A'-'F'
        table[0x61 + i] = 10 + i; // 'a'-'f'
    }
    return table;
})();

/**
 * Converts a Uint8Array to a lowercase hex string.
 *
 * @param bytes - The byte array to convert
 * @returns Lowercase hex string representation
 *
 * @example
 * ```typescript
 * import { toHex } from '@btc-vision/bitcoin';
 *
 * const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
 * const hex = toHex(bytes);
 * console.log(hex); // 'deadbeef'
 * ```
 */
export function toHex(bytes: Uint8Array): string {
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
        const hex = BYTE_TO_HEX[bytes[i] as number];
        result += hex as string;
    }
    return result;
}

/**
 * Converts a hex string to a Uint8Array.
 *
 * Accepts hex strings with or without '0x' prefix.
 * Case-insensitive (accepts both 'DEADBEEF' and 'deadbeef').
 *
 * @param hex - The hex string to convert
 * @returns Uint8Array containing the decoded bytes
 * @throws TypeError if hex string has odd length
 * @throws TypeError if hex string contains invalid characters
 *
 * @example
 * ```typescript
 * import { fromHex, toHex } from '@btc-vision/bitcoin';
 *
 * const bytes = fromHex('deadbeef');
 * console.log(bytes); // Uint8Array [222, 173, 190, 239]
 *
 * // Also works with 0x prefix
 * const bytes2 = fromHex('0xCAFEBABE');
 * console.log(toHex(bytes2)); // 'cafebabe'
 * ```
 */
export function fromHex(hex: string): Uint8Array {
    // Strip 0x prefix if present
    if (hex.length >= 2 && hex[0] === '0' && (hex[1] === 'x' || hex[1] === 'X')) {
        hex = hex.slice(2);
    }

    const len = hex.length;
    if (len % 2 !== 0) {
        throw new TypeError('Invalid hex string: odd length');
    }

    const byteLength = len / 2;
    const result = new Uint8Array(byteLength);

    for (let i = 0; i < byteLength; i++) {
        const charIndex = i * 2;
        const highCode = hex.charCodeAt(charIndex);
        const lowCode = hex.charCodeAt(charIndex + 1);

        // Bounds check for lookup table
        if (highCode >= 128 || lowCode >= 128) {
            throw new TypeError(`Invalid hex character at position ${charIndex}`);
        }

        const high = HEX_TO_NIBBLE[highCode];
        const low = HEX_TO_NIBBLE[lowCode];

        if (high === -1) {
            throw new TypeError(`Invalid hex character at position ${charIndex}`);
        }
        if (low === -1) {
            throw new TypeError(`Invalid hex character at position ${charIndex + 1}`);
        }

        result[i] = ((high as number) << 4) | (low as number); // Safe: validated above
    }

    return result;
}

/**
 * Checks if a string is valid hexadecimal.
 *
 * @param value - The string to check
 * @returns True if the string is valid hex (even length, valid chars)
 *
 * @example
 * ```typescript
 * import { isHex } from '@btc-vision/bitcoin';
 *
 * isHex('deadbeef'); // true
 * isHex('0xdeadbeef'); // true
 * isHex('DEADBEEF'); // true
 * isHex('deadbee'); // false (odd length)
 * isHex('deadbeeg'); // false (invalid char)
 * ```
 */
export function isHex(value: string): boolean {
    let hex = value;
    if (hex.length >= 2 && hex[0] === '0' && (hex[1] === 'x' || hex[1] === 'X')) {
        hex = hex.slice(2);
    }

    if (hex.length % 2 !== 0) {
        return false;
    }

    for (let i = 0; i < hex.length; i++) {
        const code = hex.charCodeAt(i);
        if (code >= 128 || HEX_TO_NIBBLE[code] === -1) {
            return false;
        }
    }

    return true;
}
