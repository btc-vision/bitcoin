import { Buffer as NBuffer } from 'buffer';

// @ts-ignore
import * as _typeforce from 'typeforce';

export const typeforce = _typeforce.default;

const ZERO32 = NBuffer.alloc(32, 0);
const EC_P = NBuffer.from(
    'fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f',
    'hex',
);

/**
 * Checks if two arrays of Buffers are equal.
 * @param a - The first array of Buffers.
 * @param b - The second array of Buffers.
 * @returns True if the arrays are equal, false otherwise.
 */
export function stacksEqual(a: Buffer[], b: Buffer[]): boolean {
    if (a.length !== b.length) return false;

    return a.every((x, i) => {
        return x.equals(b[i]);
    });
}

/**
 * Checks if the given value is a valid elliptic curve point.
 * @param p - The value to check.
 * @returns True if the value is a valid elliptic curve point, false otherwise.
 */
export function isPoint(p: Buffer | number | undefined | null): boolean {
    if (!NBuffer.isBuffer(p)) return false;
    if (p.length < 33) return false;

    const t = p[0]; // First byte = point format indicator
    const x = p.slice(1, 33); // Next 32 bytes = X coordinate

    // Validate X coordinate
    if (x.compare(ZERO32) === 0) return false; // X cannot be zero
    if (x.compare(EC_P) >= 0) return false; // X must be < P

    // Check for compressed format (0x02 or 0x03), must be exactly 33 bytes total
    if ((t === 0x02 || t === 0x03) && p.length === 33) {
        return true;
    }

    // For uncompressed (0x04) or hybrid (0x06 or 0x07) formats, must be 65 bytes total
    if (p.length !== 65) return false;

    const y = p.slice(33); // Last 32 bytes = Y coordinate

    // Validate Y coordinate
    if (y.compare(ZERO32) === 0) return false; // Y cannot be zero
    if (y.compare(EC_P) >= 0) return false; // Y must be < P

    // 0x04 = uncompressed, 0x06/0x07 = hybrid (also 65 bytes, but with Y's parity bit set)
    return t === 0x04 || t === 0x06 || t === 0x07;
}

const SATOSHI_MAX: number = 21 * 1e14;

export function Satoshi(value: number): boolean {
    return typeforce.UInt53(value) && value <= SATOSHI_MAX;
}

export interface XOnlyPointAddTweakResult {
    parity: 1 | 0;
    xOnlyPubkey: Uint8Array;
}

export interface Tapleaf {
    output: Buffer;
    version?: number;
}

export const TAPLEAF_VERSION_MASK = 0xfe;

export function isTapleaf(o: any): o is Tapleaf {
    if (!o || !('output' in o)) return false;
    if (!NBuffer.isBuffer(o.output)) return false;
    if (o.version !== undefined) return (o.version & TAPLEAF_VERSION_MASK) === o.version;
    return true;
}

/**
 * Binary tree repsenting script path spends for a Taproot input.
 * Each node is either a single Tapleaf, or a pair of Tapleaf | Taptree.
 * The tree has no balancing requirements.
 */
export type Taptree = [Taptree | Tapleaf, Taptree | Tapleaf] | Tapleaf;

export function isTaptree(scriptTree: any): scriptTree is Taptree {
    if (!Array(scriptTree)) return isTapleaf(scriptTree);
    if (scriptTree.length !== 2) return false;
    return scriptTree.every((t: any) => isTaptree(t));
}

export interface TinySecp256k1Interface {
    isXOnlyPoint(p: Uint8Array): boolean;

    xOnlyPointAddTweak(p: Uint8Array, tweak: Uint8Array): XOnlyPointAddTweakResult | null;
}

export const Buffer256bit = typeforce.BufferN(32);
export const Hash160bit = typeforce.BufferN(20);
export const Hash256bit = typeforce.BufferN(32);
export const Number = typeforce.Number;
export const Array = typeforce.Array;
export const Boolean = typeforce.Boolean;
export const String = typeforce.String;
export const Buffer = typeforce.Buffer;
export const Hex = typeforce.Hex;
export const maybe = typeforce.maybe;
export const tuple = typeforce.tuple;
export const UInt8 = typeforce.UInt8;
export const UInt32 = typeforce.UInt32;
export const Function = typeforce.Function;
export const BufferN = typeforce.BufferN;
export const Null = typeforce.Null;
export const oneOf = typeforce.oneOf;
