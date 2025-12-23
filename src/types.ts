import { Buffer as NBuffer } from 'buffer';
import typeforce from 'typeforce';

export { typeforce };

/**
 * Typeforce type validator - validates that a value matches a given type.
 */
export type TypeforceValidator = (value: unknown) => boolean;

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
    const x = p.subarray(1, 33); // Next 32 bytes = X coordinate

    // Validate X coordinate
    if (x.compare(ZERO32) === 0) return false; // X cannot be zero
    if (x.compare(EC_P) >= 0) return false; // X must be < P

    // Check for compressed format (0x02 or 0x03), must be exactly 33 bytes total
    if ((t === 0x02 || t === 0x03) && p.length === 33) {
        return true;
    }

    // For uncompressed (0x04) or hybrid (0x06 or 0x07) formats, must be 65 bytes total
    if (p.length !== 65) return false;

    const y = p.subarray(33); // Last 32 bytes = Y coordinate

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

export function isTapleaf(o: unknown): o is Tapleaf {
    if (!o || typeof o !== 'object' || !('output' in o)) return false;
    const obj = o as Record<string, unknown>;
    if (!NBuffer.isBuffer(obj.output)) return false;
    if (obj.version !== undefined)
        return ((obj.version as number) & TAPLEAF_VERSION_MASK) === obj.version;
    return true;
}

/**
 * Binary tree repsenting script path spends for a Taproot input.
 * Each node is either a single Tapleaf, or a pair of Tapleaf | Taptree.
 * The tree has no balancing requirements.
 */
export type Taptree = [Taptree | Tapleaf, Taptree | Tapleaf] | Tapleaf;

export function isTaptree(scriptTree: unknown): scriptTree is Taptree {
    if (!globalThis.Array.isArray(scriptTree)) return isTapleaf(scriptTree);
    if (scriptTree.length !== 2) return false;
    return scriptTree.every((t: unknown) => isTaptree(t));
}

export interface TinySecp256k1Interface {
    isXOnlyPoint(p: Uint8Array): boolean;

    xOnlyPointAddTweak(p: Uint8Array, tweak: Uint8Array): XOnlyPointAddTweakResult | null;
}

export const Buffer256bit: TypeforceValidator = typeforce.BufferN(32);
export const Hash160bit: TypeforceValidator = typeforce.BufferN(20);
export const Hash256bit: TypeforceValidator = typeforce.BufferN(32);
export const Number: TypeforceValidator = typeforce.Number;
export const Array: TypeforceValidator = typeforce.Array;
export const Boolean: TypeforceValidator = typeforce.Boolean;
export const String: TypeforceValidator = typeforce.String;
export const Buffer: TypeforceValidator = typeforce.Buffer;
export const Hex: TypeforceValidator = typeforce.Hex;
export const maybe: (type: unknown) => TypeforceValidator = typeforce.maybe;
export const tuple: (...types: unknown[]) => TypeforceValidator = typeforce.tuple;
export const UInt8: TypeforceValidator = typeforce.UInt8;
export const UInt32: TypeforceValidator = typeforce.UInt32;
export const Function: TypeforceValidator = typeforce.Function;
export const BufferN: (n: number) => TypeforceValidator = typeforce.BufferN;
export const Null: TypeforceValidator = typeforce.Null;
export const oneOf: (...types: unknown[]) => TypeforceValidator = typeforce.oneOf;

// Stack types - used by script and payments
export type StackElement = globalThis.Buffer | number;
export type Stack = StackElement[];
export type StackFunction = () => Stack;
