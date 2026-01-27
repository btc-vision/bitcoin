/**
 * Branded type definitions for type-safe primitives.
 *
 * @packageDocumentation
 */

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type Bytes32 = Brand<Uint8Array, 'Bytes32'>;
export type Bytes20 = Brand<Uint8Array, 'Bytes20'>;
export type PublicKey = Brand<Uint8Array, 'PublicKey'>;
export type XOnlyPublicKey = Brand<Uint8Array, 'XOnlyPublicKey'>;
export type Satoshi = Brand<bigint, 'Satoshi'>;
export type PrivateKey = Brand<Uint8Array, 'PrivateKey'>;
export type Signature = Brand<Uint8Array, 'Signature'>;
export type SchnorrSignature = Brand<Uint8Array, 'SchnorrSignature'>;
export type Script = Brand<Uint8Array, 'Script'>;
