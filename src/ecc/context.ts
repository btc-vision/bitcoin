/**
 * ECC library context management with dependency injection.
 * Provides initialization, access, and lifecycle management for the ECC library.
 *
 * @packageDocumentation
 */
import { EccLib, XOnlyPointAddTweakResult } from './types.js';
import { fromHex, equals } from '../uint8array-utils.js';

/**
 * Context class for managing the ECC library instance.
 * Uses dependency injection pattern instead of global singleton.
 *
 * @example
 * ```typescript
 * import { EccContext } from '@btc-vision/bitcoin';
 * import * as secp256k1 from 'tiny-secp256k1';
 *
 * // Initialize once at app startup
 * EccContext.init(secp256k1);
 *
 * // Get instance anywhere in your code
 * const ecc = EccContext.get();
 *
 * // Clear when done (optional, for testing)
 * EccContext.clear();
 * ```
 */
export class EccContext {
    static #instance: EccContext | undefined;
    readonly #lib: EccLib;

    private constructor(lib: EccLib) {
        this.#lib = lib;
    }

    /**
     * Initializes the ECC context with the provided library.
     * The library is verified before being set as active.
     *
     * @param lib - The ECC library instance to initialize
     * @returns The initialized EccContext instance
     * @throws Error if the ECC library fails verification
     *
     * @example
     * ```typescript
     * import { EccContext } from '@btc-vision/bitcoin';
     * import * as secp256k1 from 'tiny-secp256k1';
     *
     * const context = EccContext.init(secp256k1);
     * ```
     */
    static init(lib: EccLib): EccContext {
        verifyEcc(lib);
        EccContext.#instance = new EccContext(lib);
        return EccContext.#instance;
    }

    /**
     * Gets the initialized ECC context.
     *
     * @returns The EccContext instance
     * @throws Error if the context has not been initialized
     *
     * @example
     * ```typescript
     * import { EccContext } from '@btc-vision/bitcoin';
     *
     * const context = EccContext.get();
     * const isValid = context.lib.isXOnlyPoint(someKey);
     * ```
     */
    static get(): EccContext {
        if (!EccContext.#instance) {
            throw new Error(
                'ECC library not initialized. Call EccContext.init() or initEccLib() first.',
            );
        }
        return EccContext.#instance;
    }

    /**
     * Clears the ECC context.
     * Useful for testing or when reinitializing with a different library.
     *
     * @example
     * ```typescript
     * import { EccContext } from '@btc-vision/bitcoin';
     *
     * EccContext.clear();
     * // Context is now uninitialized
     * ```
     */
    static clear(): void {
        EccContext.#instance = undefined;
    }

    /**
     * Checks if the ECC context has been initialized.
     *
     * @returns True if initialized
     *
     * @example
     * ```typescript
     * import { EccContext } from '@btc-vision/bitcoin';
     *
     * if (!EccContext.isInitialized()) {
     *     EccContext.init(secp256k1);
     * }
     * ```
     */
    static isInitialized(): boolean {
        return EccContext.#instance !== undefined;
    }

    /**
     * The underlying ECC library instance.
     */
    get lib(): EccLib {
        return this.#lib;
    }
}

/**
 * Initializes the ECC library with the provided instance.
 * This is a convenience function that wraps EccContext.init().
 * Pass `undefined` to clear the library.
 *
 * @param eccLib - The ECC library instance to initialize, or undefined to clear
 * @throws Error if the ECC library fails verification
 *
 * @example
 * ```typescript
 * import { initEccLib } from '@btc-vision/bitcoin';
 * import * as secp256k1 from 'tiny-secp256k1';
 *
 * // Initialize the ECC library
 * initEccLib(secp256k1);
 *
 * // Clear the library
 * initEccLib(undefined);
 * ```
 */
export function initEccLib(eccLib: EccLib | undefined): void {
    if (eccLib === undefined) {
        EccContext.clear();
        return;
    }
    EccContext.init(eccLib);
}

/**
 * Retrieves the initialized ECC library instance.
 * This is a convenience function that wraps EccContext.get().lib.
 *
 * @returns The ECC library instance
 * @throws Error if the ECC library has not been initialized
 *
 * @example
 * ```typescript
 * import { getEccLib, initEccLib } from '@btc-vision/bitcoin';
 * import * as secp256k1 from 'tiny-secp256k1';
 *
 * initEccLib(secp256k1);
 *
 * const ecc = getEccLib();
 * const isValid = ecc.isXOnlyPoint(somePublicKey);
 * ```
 */
export function getEccLib(): EccLib {
    return EccContext.get().lib;
}

// ============================================================================
// Verification
// ============================================================================

interface TweakAddVector {
    pubkey: string;
    tweak: string;
    parity: 0 | 1 | -1;
    result: string | null;
}

const TWEAK_ADD_VECTORS: TweakAddVector[] = [
    {
        pubkey: '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        tweak: 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140',
        parity: -1,
        result: null,
    },
    {
        pubkey: '1617d38ed8d8657da4d4761e8057bc396ea9e4b9d29776d4be096016dbd2509b',
        tweak: 'a8397a935f0dfceba6ba9618f6451ef4d80637abf4e6af2669fbc9de6a8fd2ac',
        parity: 1,
        result: 'e478f99dab91052ab39a33ea35fd5e6e4933f4d28023cd597c9a1f6760346adf',
    },
    {
        pubkey: '2c0b7cf95324a07d05398b240174dc0c2be444d96b159aa6c7f7b1e668680991',
        tweak: '823c3cd2142744b075a87eade7e1b8678ba308d566226a0056ca2b7a76f86b47',
        parity: 0,
        result: '9534f8dc8c6deda2dc007655981c78b49c5d96c778fbf363462a11ec9dfd948c',
    },
];

/**
 * Verifies that the ECC library implementation is correct.
 * Tests `isXOnlyPoint` and `xOnlyPointAddTweak` with known test vectors.
 *
 * @param ecc - The ECC library to verify
 * @throws Error if any verification test fails
 */
function verifyEcc(ecc: EccLib): void {
    if (typeof ecc.isXOnlyPoint !== 'function') {
        throw new Error('ECC library missing isXOnlyPoint function');
    }

    // Test isXOnlyPoint with valid points
    const validPoints = [
        '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        'fffffffffffffffffffffffffffffffffffffffffffffffffffffffeeffffc2e',
        'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
        '0000000000000000000000000000000000000000000000000000000000000001',
    ];

    for (const hex of validPoints) {
        if (!ecc.isXOnlyPoint(fromHex(hex))) {
            throw new Error(`ECC library isXOnlyPoint failed for valid point: ${hex}`);
        }
    }

    // Test isXOnlyPoint with invalid points
    const invalidPoints = [
        '0000000000000000000000000000000000000000000000000000000000000000',
        'fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f',
    ];

    for (const hex of invalidPoints) {
        if (ecc.isXOnlyPoint(fromHex(hex))) {
            throw new Error(`ECC library isXOnlyPoint should reject invalid point: ${hex}`);
        }
    }

    // Test xOnlyPointAddTweak
    if (typeof ecc.xOnlyPointAddTweak !== 'function') {
        throw new Error('ECC library missing xOnlyPointAddTweak function');
    }

    for (const vector of TWEAK_ADD_VECTORS) {
        const result = ecc.xOnlyPointAddTweak(fromHex(vector.pubkey), fromHex(vector.tweak));

        if (vector.result === null) {
            if (result !== null) {
                throw new Error(
                    `ECC library xOnlyPointAddTweak should return null for: ${vector.pubkey}`,
                );
            }
        } else {
            if (result === null) {
                throw new Error(
                    `ECC library xOnlyPointAddTweak returned null unexpectedly for: ${vector.pubkey}`,
                );
            }
            if (result.parity !== vector.parity) {
                throw new Error(
                    `ECC library xOnlyPointAddTweak parity mismatch for: ${vector.pubkey}`,
                );
            }
            if (!equals(result.xOnlyPubkey, fromHex(vector.result))) {
                throw new Error(
                    `ECC library xOnlyPointAddTweak result mismatch for: ${vector.pubkey}`,
                );
            }
        }
    }
}
