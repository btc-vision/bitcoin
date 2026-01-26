/**
 * ECC (Elliptic Curve Cryptography) library management.
 * Provides initialization and access to the ECC library used for Taproot operations.
 *
 * @packageDocumentation
 */
import { EccLib } from './ecc/types.js';
import { fromHex, equals } from './uint8array-utils.js';

let eccLibCache: EccLib | undefined;

/**
 * Initializes the ECC library with the provided instance.
 * The library is verified before being set as active.
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
 * // Now Taproot operations will work
 * ```
 */
export function initEccLib(eccLib: EccLib | undefined): void {
    if (!eccLib) {
        eccLibCache = undefined;
        return;
    }

    if (eccLib !== eccLibCache) {
        verifyEcc(eccLib);
        eccLibCache = eccLib;
    }
}

/**
 * Retrieves the initialized ECC library instance.
 * You must call `initEccLib()` before calling this function.
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
    if (!eccLibCache) {
        throw new Error(
            'No ECC Library provided. You must call initEccLib() with a valid TinySecp256k1Interface instance',
        );
    }
    return eccLibCache;
}

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
