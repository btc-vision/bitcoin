/**
 * Core type definitions, branded types, and type guard functions.
 *
 * @packageDocumentation
 */
import { compare, equals, fromHex, isZero } from './io/index.js';
import type {
    Bytes20,
    Bytes32,
    MessageHash,
    PrivateKey,
    PublicKey,
    Satoshi,
    SchnorrSignature,
    Script,
    Signature,
    XOnlyPublicKey,
} from './branded.js';

export type {
    Bytes32,
    Bytes20,
    PublicKey,
    XOnlyPublicKey,
    Satoshi,
    PrivateKey,
    Signature,
    SchnorrSignature,
    MessageHash,
    Script,
} from './branded.js';

/** @internal Do not mutate */
const EC_P = fromHex('fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f');

/** @internal Do not mutate — secp256k1 curve order */
const EC_N = fromHex('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

export const SATOSHI_MAX = 21n * 10n ** 14n;
export const TAPLEAF_VERSION_MASK = 0xfe;

export function isUInt8(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xff;
}

export function isUInt32(value: unknown): value is number {
    return (
        typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff
    );
}

export function isNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function isUint8Array(value: unknown): value is Uint8Array {
    return value instanceof Uint8Array;
}

export function isUint8ArrayN<N extends number>(
    value: unknown,
    n: N,
): value is Uint8Array & { readonly length: N } {
    return value instanceof Uint8Array && value.length === n;
}

export function isArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

export function isHex(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    if (value.length % 2 !== 0) return false;
    return /^[0-9a-fA-F]*$/.test(value);
}

export function isBytes32(value: unknown): value is Bytes32 {
    return value instanceof Uint8Array && value.length === 32;
}

export function isBytes20(value: unknown): value is Bytes20 {
    return value instanceof Uint8Array && value.length === 20;
}

export function isXOnlyPublicKey(value: unknown): value is XOnlyPublicKey {
    if (!(value instanceof Uint8Array) || value.length !== 32) return false;
    if (isZero(value)) return false;
    return compare(value, EC_P) < 0;
}

export function isPoint(value: unknown): value is PublicKey {
    if (!(value instanceof Uint8Array)) return false;
    if (value.length < 33) return false;

    const prefix = value[0];
    const x = value.subarray(1, 33);

    if (isZero(x)) return false;
    if (compare(x, EC_P) >= 0) return false;

    if ((prefix === 0x02 || prefix === 0x03) && value.length === 33) {
        return true;
    }

    if (value.length !== 65) return false;

    const y = value.subarray(33);
    if (isZero(y)) return false;
    if (compare(y, EC_P) >= 0) return false;

    return prefix === 0x04 || prefix === 0x06 || prefix === 0x07;
}

export function isSatoshi(value: unknown): value is Satoshi {
    return typeof value === 'bigint' && value >= 0n && value <= SATOSHI_MAX;
}

export function isPrivateKey(value: unknown): value is PrivateKey {
    if (!(value instanceof Uint8Array) || value.length !== 32) return false;
    if (isZero(value)) return false;
    return compare(value, EC_N) < 0;
}

export function isSchnorrSignature(value: unknown): value is SchnorrSignature {
    return value instanceof Uint8Array && value.length === 64;
}

export function isSignature(value: unknown): value is Signature {
    return value instanceof Uint8Array && value.length >= 8 && value.length <= 73;
}

export function isScript(value: unknown): value is Script {
    return value instanceof Uint8Array;
}

// Taproot Types

export interface Tapleaf {
    readonly output: Uint8Array;
    readonly version?: number;
}

export type Taptree = [Taptree | Tapleaf, Taptree | Tapleaf] | Tapleaf;

export function isTapleaf(value: unknown): value is Tapleaf {
    if (!value || typeof value !== 'object') return false;

    const obj = value as Record<string, unknown>;
    if (!('output' in obj)) return false;
    if (!(obj['output'] instanceof Uint8Array)) return false;

    if (obj['version'] !== undefined) {
        if (typeof obj['version'] !== 'number') return false;
        if ((obj['version'] & TAPLEAF_VERSION_MASK) !== obj['version']) return false;
    }

    return true;
}

export function isTaptree(value: unknown): value is Taptree {
    if (!Array.isArray(value)) return isTapleaf(value);
    if (value.length !== 2) return false;
    return value.every((node: unknown) => isTaptree(node));
}

// ECC Interface

export type { CryptoBackend, XOnlyPointAddTweakResult, EccLib, Parity } from './ecc/types.js';

// Stack Types

export type StackElement = Uint8Array | number;
export type Stack = readonly StackElement[];
export type StackFunction = () => Stack;

// Utility Functions

export function stacksEqual(a: Uint8Array[], b: Uint8Array[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((x, i) => equals(x, b[i] as Uint8Array));
}

export function toBytes32(value: Uint8Array): Bytes32 {
    if (!isBytes32(value)) {
        throw new TypeError(`Expected 32-byte Uint8Array, got ${value.length} bytes`);
    }
    return value;
}

export function isMessageHash(value: unknown): value is MessageHash {
    return value instanceof Uint8Array && value.length === 32;
}

export function toMessageHash(value: Uint8Array): MessageHash {
    if (!isMessageHash(value)) {
        throw new TypeError(`Expected 32-byte Uint8Array, got ${value.length} bytes`);
    }
    return value;
}

export function toBytes20(value: Uint8Array): Bytes20 {
    if (!isBytes20(value)) {
        throw new TypeError(`Expected 20-byte Uint8Array, got ${value.length} bytes`);
    }
    return value;
}

export function toSatoshi(value: bigint): Satoshi {
    if (value < 0n) {
        throw new RangeError(`Satoshi cannot be negative, got ${value}`);
    }
    if (value > SATOSHI_MAX) {
        throw new RangeError(`Satoshi exceeds maximum supply (${SATOSHI_MAX}), got ${value}`);
    }
    return value as Satoshi;
}

// Assertion Helpers

export function assertXOnlyPublicKey(
    value: unknown,
    name: string,
): asserts value is XOnlyPublicKey {
    if (!(value instanceof Uint8Array)) {
        throw new TypeError(`${name} must be Uint8Array, got ${typeof value}`);
    }
    if (value.length !== 32) {
        throw new TypeError(`${name} must be 32 bytes, got ${value.length}`);
    }
    if (isZero(value)) {
        throw new RangeError(`${name} cannot be zero`);
    }
    if (compare(value, EC_P) >= 0) {
        throw new RangeError(`${name} exceeds curve order`);
    }
}

export function assertPrivateKey(value: unknown, name: string): asserts value is PrivateKey {
    if (!(value instanceof Uint8Array)) {
        throw new TypeError(`${name} must be Uint8Array, got ${typeof value}`);
    }
    if (value.length !== 32) {
        throw new TypeError(`${name} must be 32 bytes, got ${value.length}`);
    }
    if (isZero(value)) {
        throw new RangeError(`${name} cannot be zero`);
    }
    if (compare(value, EC_N) >= 0) {
        throw new RangeError(`${name} exceeds curve order`);
    }
}
