/**
 * ECC (Elliptic Curve Cryptography) type definitions.
 *
 * Re-exports {@link CryptoBackend} from `@btc-vision/ecpair` as the canonical
 * interface for secp256k1 operations. The legacy `EccLib` name is kept as a
 * type alias for backward compatibility.
 *
 * @packageDocumentation
 */

export type { CryptoBackend, XOnlyPointAddTweakResult, Parity } from '@btc-vision/ecpair';

/**
 * @deprecated Use {@link CryptoBackend} from `@btc-vision/ecpair` instead.
 */
export type { CryptoBackend as EccLib } from '@btc-vision/ecpair';
