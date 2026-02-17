/**
 * Public key utilities for Bitcoin
 * @packageDocumentation
 */
import { Point } from '@noble/secp256k1';
import { alloc, concat, equals, fromHex, toHex } from './io/index.js';
import type { PublicKey, XOnlyPublicKey } from './types.js';

/**
 * Converts a public key to x-only format (32 bytes).
 * @param pubKey - The public key buffer (33 or 65 bytes)
 * @returns The x-only public key (32 bytes)
 */
export const toXOnly = (pubKey: PublicKey | XOnlyPublicKey): XOnlyPublicKey => {
    return (pubKey.length === 32 ? pubKey : pubKey.subarray(1, 33)) as XOnlyPublicKey;
};

export interface UncompressedPublicKey {
    hybrid: Uint8Array;
    uncompressed: Uint8Array;
}

/**
 * Converts bigint to 32-byte Uint8Array.
 */
export function bigIntTo32Bytes(num: bigint): Uint8Array {
    let hex = num.toString(16);
    hex = hex.padStart(64, '0');
    if (hex.length > 64) {
        hex = hex.slice(-64);
    }
    return fromHex(hex);
}

/**
 * Converts an existing real Bitcoin public key (compressed or uncompressed)
 * to its "hybrid" form (prefix 0x06/0x07), then derives a P2PKH address from it.
 *
 * @param realPubKey - 33-byte compressed (0x02/0x03) or 65-byte uncompressed (0x04) pubkey
 * @returns UncompressedPublicKey | undefined
 */
export function decompressPublicKey(realPubKey: PublicKey): UncompressedPublicKey | undefined {
    if (realPubKey.length === 32) {
        return;
    }

    if (![33, 65].includes(realPubKey.length)) {
        console.warn(
            `Unsupported key length=${realPubKey.length}. Must be 33 (compressed) or 65 (uncompressed).`,
        );
        return;
    }

    let point: Point;
    try {
        point = Point.fromHex(toHex(realPubKey));
    } catch (err) {
        throw new Error('Invalid secp256k1 public key bytes. Cannot parse.', { cause: err });
    }

    const xBuf = bigIntTo32Bytes(point.x);
    const yBuf = bigIntTo32Bytes(point.y);

    const isEven = point.y % 2n === 0n;
    const prefix = isEven ? 0x06 : 0x07;

    const hybridPubKey = alloc(65);
    hybridPubKey[0] = prefix;
    hybridPubKey.set(xBuf, 1);
    hybridPubKey.set(yBuf, 33);

    const uncompressedPubKey = concat([new Uint8Array([0x04]), xBuf, yBuf]);

    return {
        hybrid: hybridPubKey,
        uncompressed: uncompressedPubKey,
    };
}

/**
 * Compare two potential pubkey Uint8Arrays, treating hybrid keys (0x06/0x07)
 * as equivalent to uncompressed (0x04).
 */
export function pubkeysMatch(a: Uint8Array, b: Uint8Array): boolean {
    if (equals(a, b)) return true;

    if (a.length === 65 && b.length === 65) {
        const aCopy = new Uint8Array(a);
        const bCopy = new Uint8Array(b);

        if (aCopy[0] === 0x06 || aCopy[0] === 0x07) aCopy[0] = 0x04;
        if (bCopy[0] === 0x06 || bCopy[0] === 0x07) bCopy[0] = 0x04;

        return equals(aCopy, bCopy);
    }

    return false;
}
