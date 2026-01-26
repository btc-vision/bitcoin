/**
 * Public key utilities for Bitcoin
 * @packageDocumentation
 */
import { Point } from '@noble/secp256k1';

/**
 * Converts a public key to x-only format (32 bytes).
 * @param pubKey - The public key buffer (33 or 65 bytes)
 * @returns The x-only public key (32 bytes)
 */
export const toXOnly = (pubKey: Buffer | Uint8Array): Buffer => {
    const buffer = pubKey.length === 32 ? pubKey : pubKey.subarray(1, 33);
    return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
};

export interface UncompressedPublicKey {
    hybrid: Buffer;
    uncompressed: Buffer;
}

/**
 * Converts bigint to 32-byte Buffer.
 */
export function bigIntTo32Bytes(num: bigint): Buffer {
    let hex = num.toString(16);
    hex = hex.padStart(64, '0');
    if (hex.length > 64) {
        hex = hex.slice(-64);
    }
    return Buffer.from(hex, 'hex');
}

/**
 * Converts an existing real Bitcoin public key (compressed or uncompressed)
 * to its "hybrid" form (prefix 0x06/0x07), then derives a P2PKH address from it.
 *
 * @param realPubKey - 33-byte compressed (0x02/0x03) or 65-byte uncompressed (0x04) pubkey
 * @returns Buffer | undefined
 */
export function decompressPublicKey(
    realPubKey: Uint8Array | Buffer,
): UncompressedPublicKey | undefined {
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
        point = Point.fromHex(Buffer.from(realPubKey).toString('hex'));
    } catch (err) {
        throw new Error('Invalid secp256k1 public key bytes. Cannot parse.');
    }

    const xBuf = bigIntTo32Bytes(point.x);
    const yBuf = bigIntTo32Bytes(point.y);

    const isEven = point.y % 2n === 0n;
    const prefix = isEven ? 0x06 : 0x07;

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

/**
 * Compare two potential pubkey Buffers, treating hybrid keys (0x06/0x07)
 * as equivalent to uncompressed (0x04).
 */
export function pubkeysMatch(a: Buffer, b: Buffer): boolean {
    if (a.equals(b)) return true;

    if (a.length === 65 && b.length === 65) {
        const aCopy = Buffer.from(a);
        const bCopy = Buffer.from(b);

        if (aCopy[0] === 0x06 || aCopy[0] === 0x07) aCopy[0] = 0x04;
        if (bCopy[0] === 0x06 || bCopy[0] === 0x07) bCopy[0] = 0x04;

        return aCopy.equals(bCopy);
    }

    return false;
}
