/**
 * ECC (Elliptic Curve Cryptography) module.
 *
 * Provides dependency injection for the secp256k1 elliptic curve library
 * required for Taproot (BIP340/BIP341) operations.
 *
 * @packageDocumentation
 */

// Core types (CryptoBackend is the canonical name; EccLib is a deprecated alias)
export type { CryptoBackend, EccLib, XOnlyPointAddTweakResult, Parity } from './types.js';

// Context management
export { EccContext, initEccLib, getEccLib } from './context.js';
