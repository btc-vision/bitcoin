/**
 * Base64 encoding and decoding utilities.
 *
 * @packageDocumentation
 */

/**
 * Decodes a base64 string to a Uint8Array.
 *
 * @param base64 - The base64-encoded string to decode
 * @returns Uint8Array containing the decoded bytes
 */
export function fromBase64(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    return bytes;
}

/**
 * Encode a Uint8Array into a Base64 string.
 * Uses the native btoa() available in both browser and service worker contexts.
 *
 * @param bytes - The bytes to encode
 * @returns Base64-encoded string
 */
export function toBase64(bytes: Uint8Array): string {
    let binaryString = '';
    for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i] as number);
    }
    return btoa(binaryString);
}
