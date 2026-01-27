/**
 * ECC (Elliptic Curve Cryptography) type definitions.
 * Defines interfaces for secp256k1 operations used in Taproot and signatures.
 *
 * @packageDocumentation
 */

import type {
    Bytes32,
    PrivateKey,
    PublicKey,
    Signature,
    SchnorrSignature,
    XOnlyPublicKey,
} from '../branded.js';

/**
 * Parity of the y-coordinate for an x-only public key.
 * - 0: even y-coordinate
 * - 1: odd y-coordinate
 */
export type Parity = 0 | 1;

/**
 * Result of x-only point addition with tweak.
 */
export interface XOnlyPointAddTweakResult {
    /** Parity of the resulting y-coordinate (0 = even, 1 = odd) */
    readonly parity: Parity;
    /** The resulting x-only public key */
    readonly xOnlyPubkey: XOnlyPublicKey;
}

/**
 * Interface for the ECC library used by this library.
 * This is compatible with tiny-secp256k1 and @noble/secp256k1.
 *
 * @example
 * ```typescript
 * import { EccLib, initEccLib } from '@btc-vision/bitcoin';
 * import * as secp256k1 from 'tiny-secp256k1';
 *
 * // tiny-secp256k1 implements EccLib
 * const ecc: EccLib = secp256k1;
 * initEccLib(ecc);
 * ```
 */
export interface EccLib {
    /**
     * Checks if a 32-byte value is a valid x-only public key.
     *
     * @param p - 32-byte x-coordinate
     * @returns True if the point is valid on the secp256k1 curve
     */
    isXOnlyPoint(p: Uint8Array): boolean;

    /**
     * Adds a tweak to an x-only public key.
     *
     * @param p - 32-byte x-only public key
     * @param tweak - 32-byte scalar to add
     * @returns The tweaked public key with parity, or null if result is invalid
     */
    xOnlyPointAddTweak(p: XOnlyPublicKey, tweak: Bytes32): XOnlyPointAddTweakResult | null;

    /**
     * Signs a 32-byte message hash with a private key (ECDSA).
     * Optional - only needed for signing operations.
     *
     * @param hash - 32-byte message hash
     * @param privateKey - 32-byte private key
     * @returns DER-encoded signature
     */
    sign?(hash: Bytes32, privateKey: PrivateKey): Signature;

    /**
     * Signs a 32-byte message hash with a private key (Schnorr/BIP340).
     * Optional - only needed for Taproot key-path signing.
     *
     * @param hash - 32-byte message hash
     * @param privateKey - 32-byte private key
     * @returns 64-byte Schnorr signature
     */
    signSchnorr?(hash: Bytes32, privateKey: PrivateKey): SchnorrSignature;

    /**
     * Verifies an ECDSA signature.
     * Optional - only needed for signature verification.
     *
     * @param hash - 32-byte message hash
     * @param publicKey - 33 or 65-byte public key
     * @param signature - DER-encoded signature
     * @returns True if signature is valid
     */
    verify?(hash: Bytes32, publicKey: PublicKey, signature: Signature): boolean;

    /**
     * Verifies a Schnorr/BIP340 signature.
     * Optional - only needed for Taproot signature verification.
     *
     * @param hash - 32-byte message hash
     * @param publicKey - 32-byte x-only public key
     * @param signature - 64-byte Schnorr signature
     * @returns True if signature is valid
     */
    verifySchnorr?(hash: Bytes32, publicKey: XOnlyPublicKey, signature: SchnorrSignature): boolean;

    /**
     * Derives a public key from a private key.
     * Optional - only needed for key derivation.
     *
     * @param privateKey - 32-byte private key
     * @param compressed - Whether to return compressed (33-byte) or uncompressed (65-byte)
     * @returns The public key, or null if private key is invalid
     */
    pointFromScalar?(privateKey: PrivateKey, compressed?: boolean): PublicKey | null;

    /**
     * Computes the x-only public key from a private key.
     * Optional - only needed for Taproot key derivation.
     *
     * @param privateKey - 32-byte private key
     * @returns 32-byte x-only public key, or null if private key is invalid
     */
    xOnlyPointFromScalar?(privateKey: PrivateKey): XOnlyPublicKey | null;

    /**
     * Converts a full public key to x-only format.
     * Optional - only needed when working with x-only keys.
     *
     * @param pubkey - 33 or 65-byte public key
     * @returns 32-byte x-only public key
     */
    xOnlyPointFromPoint?(pubkey: PublicKey): XOnlyPublicKey;

    /**
     * Adds a scalar to a private key.
     * Optional - only needed for key tweaking.
     *
     * @param privateKey - 32-byte private key
     * @param tweak - 32-byte scalar to add
     * @returns The tweaked private key, or null if result is invalid
     */
    privateAdd?(privateKey: PrivateKey, tweak: Bytes32): PrivateKey | null;

    /**
     * Negates a private key.
     * Optional - only needed for Taproot parity handling.
     *
     * @param privateKey - 32-byte private key
     * @returns The negated private key
     */
    privateNegate?(privateKey: PrivateKey): PrivateKey;
}
