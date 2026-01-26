/**
 * Core type definitions, branded types, and type guard functions.
 *
 * @packageDocumentation
 */
import { isZero, compare, fromHex, equals } from './io/index.js';

// ============================================================================
// Branded Types
// ============================================================================

declare const __brand: unique symbol;
type Brand<T, B> = T & { [__brand]: B };

export type Bytes32 = Brand<Uint8Array, 'Bytes32'>;
export type Bytes20 = Brand<Uint8Array, 'Bytes20'>;
export type PublicKey = Brand<Uint8Array, 'PublicKey'>;
export type XOnlyPublicKey = Brand<Uint8Array, 'XOnlyPublicKey'>;
export type Satoshi = Brand<bigint, 'Satoshi'>;

// ============================================================================
// Constants
// ============================================================================

const ZERO32 = new Uint8Array(32);
const EC_P = fromHex('fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f');

export const SATOSHI_MAX = 21n * 10n ** 14n;
export const TAPLEAF_VERSION_MASK = 0xfe;

// ============================================================================
// Type Guards
// ============================================================================

export function isUInt8(value: unknown): value is number {
    return typeof value === 'number' && globalThis.Number.isInteger(value) && value >= 0 && value <= 0xff;
}

export function isUInt16(value: unknown): value is number {
    return typeof value === 'number' && globalThis.Number.isInteger(value) && value >= 0 && value <= 0xffff;
}

export function isUInt32(value: unknown): value is number {
    return typeof value === 'number' && globalThis.Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

export function isUInt53(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        globalThis.Number.isInteger(value) &&
        value >= 0 &&
        value <= globalThis.Number.MAX_SAFE_INTEGER
    );
}

export function isNumber(value: unknown): value is number {
    return typeof value === 'number' && globalThis.Number.isFinite(value);
}

export function isBoolean(value: unknown): value is boolean {
    return typeof value === 'boolean';
}

export function isString(value: unknown): value is string {
    return typeof value === 'string';
}

export function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
    return typeof value === 'function';
}

export function isNull(value: unknown): value is null {
    return value === null;
}

export function isUndefined(value: unknown): value is undefined {
    return value === undefined;
}

export function isNullish(value: unknown): value is null | undefined {
    return value === null || value === undefined;
}

export function isUint8Array(value: unknown): value is Uint8Array {
    return value instanceof Uint8Array;
}

export function isUint8ArrayN(value: unknown, n: number): boolean {
    return value instanceof Uint8Array && value.length === n;
}

export function isArray(value: unknown): value is unknown[] {
    return globalThis.Array.isArray(value);
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
    if (compare(value, EC_P) >= 0) return false;
    return true;
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

// ============================================================================
// Taproot Types
// ============================================================================

export interface Tapleaf {
    output: Uint8Array;
    version?: number;
}

export type Taptree = [Taptree | Tapleaf, Taptree | Tapleaf] | Tapleaf;

export function isTapleaf(value: unknown): value is Tapleaf {
    if (!value || typeof value !== 'object') return false;

    const obj = value as Record<string, unknown>;
    if (!('output' in obj)) return false;
    if (!(obj.output instanceof Uint8Array)) return false;

    if (obj.version !== undefined) {
        if (typeof obj.version !== 'number') return false;
        if ((obj.version & TAPLEAF_VERSION_MASK) !== obj.version) return false;
    }

    return true;
}

export function isTaptree(value: unknown): value is Taptree {
    if (!globalThis.Array.isArray(value)) return isTapleaf(value);
    if (value.length !== 2) return false;
    return value.every((node: unknown) => isTaptree(node));
}

// ============================================================================
// ECC Interface (re-exported from ecc/types.ts for backward compatibility)
// ============================================================================

export type {
    XOnlyPointAddTweakResult,
    EccLib,
    Parity,
} from './ecc/types.js';

// ============================================================================
// Stack Types
// ============================================================================

export type StackElement = Uint8Array | number;
export type Stack = StackElement[];
export type StackFunction = () => Stack;

// ============================================================================
// Utility Functions
// ============================================================================

export function stacksEqual(a: Uint8Array[], b: Uint8Array[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((x, i) => equals(x, b[i]));
}

export function toBytes32(value: Uint8Array): Bytes32 {
    if (!isBytes32(value)) {
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
    if (!isSatoshi(value)) {
        throw new TypeError(`Invalid satoshi value: ${value}`);
    }
    return value;
}

// ============================================================================
// Assertion Helpers
// ============================================================================

export function assertType(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new TypeError(message);
    }
}

export function assertDefined<T>(value: T | null | undefined, name: string): asserts value is T {
    if (value === null || value === undefined) {
        throw new TypeError(`${name} is required`);
    }
}

export function assertUint8Array(value: unknown, name: string): asserts value is Uint8Array {
    if (!(value instanceof Uint8Array)) {
        throw new TypeError(`${name} must be a Uint8Array`);
    }
}

export function assertUint8ArrayN(
    value: unknown,
    n: number,
    name: string,
): asserts value is Uint8Array {
    if (!(value instanceof Uint8Array) || value.length !== n) {
        throw new TypeError(`${name} must be a Uint8Array of ${n} bytes`);
    }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TypeValidatorFn = ((value: unknown) => boolean) | ((value: any) => boolean);
type TypeValidator = TypeValidatorFn | Record<string, unknown>;
type TypeChecker = (value: unknown) => void;

interface TypeforceInterface {
    (type: unknown, value: unknown): void;
    maybe: (type: TypeValidator) => TypeValidatorFn;
    arrayOf: (type: TypeValidator) => TypeValidatorFn;
    anyOf: (...types: TypeValidator[]) => TypeValidatorFn;
    Object: () => boolean;
    String: (v: unknown) => boolean;
    Number: (v: unknown) => boolean;
    Buffer: (v: unknown) => boolean;
    BufferN: (n: number) => (v: unknown) => boolean;
    Uint8Array: (v: unknown) => boolean;
    Uint8ArrayN: (n: number) => (v: unknown) => boolean;
    Hex: (v: unknown) => boolean;
    UInt8: (v: unknown) => boolean;
    UInt32: (v: unknown) => boolean;
}

function createTypeforce(): TypeforceInterface {
    const tf = function (type: unknown, value: unknown): void {
        if (typeof type === 'function') {
            if (!(type as TypeValidatorFn)(value)) {
                throw new TypeError('Expected type validation to pass');
            }
            return;
        }
        if (typeof type === 'object' && type !== null) {
            if (globalThis.Array.isArray(type)) {
                // Array type like [{ getHash: Function }]
                if (!globalThis.Array.isArray(value)) {
                    throw new TypeError('Expected an array');
                }
                return;
            }
            // Object schema
            for (const key of Object.keys(type)) {
                const validator = (type as Record<string, unknown>)[key];
                const val = (value as Record<string, unknown>)?.[key];
                if (val !== undefined) {
                    tf(validator, val);
                }
            }
        }
    } as TypeforceInterface;

    // Helper to validate a value against a type (function or object schema)
    const validateType = (type: TypeValidator, value: unknown): boolean => {
        if (typeof type === 'function') {
            return type(value);
        }
        if (typeof type === 'object' && type !== null) {
            if (typeof value !== 'object' || value === null) return false;
            for (const key of Object.keys(type)) {
                const validator = (type as Record<string, unknown>)[key];
                const val = (value as Record<string, unknown>)[key];
                if (val !== undefined && !validateType(validator as TypeValidator, val)) {
                    return false;
                }
            }
            return true;
        }
        return false;
    };

    // Add static methods
    tf.maybe = (type: TypeValidator) => {
        return (value: unknown) => value === undefined || value === null || validateType(type, value);
    };
    tf.arrayOf = (type: TypeValidator) => {
        return (value: unknown) => globalThis.Array.isArray(value) && (value as unknown[]).every((v) => validateType(type, v));
    };
    tf.anyOf = (...types: TypeValidator[]) => {
        return (value: unknown) => types.some((type) => validateType(type, value));
    };
    tf.Object = () => true;
    tf.String = (v: unknown) => typeof v === 'string';
    tf.Number = (v: unknown) => typeof v === 'number';
    tf.Buffer = (v: unknown) => v instanceof globalThis.Uint8Array;
    tf.BufferN = (n: number) => (v: unknown) =>
        v instanceof globalThis.Uint8Array && v.length === n;
    tf.Uint8Array = (v: unknown) => v instanceof globalThis.Uint8Array;
    tf.Uint8ArrayN = (n: number) => (v: unknown) =>
        v instanceof globalThis.Uint8Array && v.length === n;
    tf.Hex = isHex;
    tf.UInt8 = isUInt8;
    tf.UInt32 = isUInt32;

    return tf;
}

export const typeforce = createTypeforce();

// Legacy aliases for backward compatibility
export const Number = isNumber;
export const String = isString;
export const Buffer = (v: unknown) => v instanceof globalThis.Uint8Array;
export const BufferN = (n: number) => (v: unknown) => v instanceof globalThis.Uint8Array && v.length === n;
export const Array = isArray;
export const Hex = isHex;
export const UInt8 = isUInt8;
export const UInt32 = isUInt32;
export const Function = isFunction;
export const maybe = typeforce.maybe as (type: TypeValidator) => TypeValidatorFn;
export const arrayOf = typeforce.arrayOf as (type: TypeValidator) => TypeValidatorFn;
export const Hash160bit = BufferN(20);
export const tuple = (...types: TypeValidatorFn[]) => (value: unknown) => {
    if (!globalThis.Array.isArray(value) || value.length !== types.length) return false;
    return types.every((t, i) => t((value as unknown[])[i]));
};
