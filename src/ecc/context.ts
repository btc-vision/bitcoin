/**
 * ECC library context management with dependency injection.
 * Provides initialization, access, and lifecycle management for the ECC library.
 *
 * @packageDocumentation
 */
import type { CryptoBackend } from '@btc-vision/ecpair';
import { verifyCryptoBackend } from '@btc-vision/ecpair';

/**
 * Context class for managing the ECC library instance.
 * Uses dependency injection pattern instead of global singleton.
 *
 * @example
 * ```typescript
 * import { EccContext } from '@btc-vision/bitcoin';
 * import { createNobleBackend } from '@btc-vision/ecpair';
 *
 * // Initialize once at app startup
 * const backend = createNobleBackend();
 * EccContext.init(backend);
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
    readonly #lib: CryptoBackend;

    private constructor(lib: CryptoBackend) {
        this.#lib = lib;
    }

    /**
     * The underlying ECC library instance.
     */
    get lib(): CryptoBackend {
        return this.#lib;
    }

    /**
     * Initializes the ECC context with the provided library.
     * The library is verified before being set as active.
     *
     * @param lib - The CryptoBackend instance to initialize
     * @returns The initialized EccContext instance
     * @throws Error if the CryptoBackend fails verification
     *
     * @example
     * ```typescript
     * import { EccContext } from '@btc-vision/bitcoin';
     * import { createNobleBackend } from '@btc-vision/ecpair';
     *
     * const context = EccContext.init(createNobleBackend());
     * ```
     */
    static init(lib: CryptoBackend): EccContext {
        // Skip re-verification if same lib is already initialized
        if (EccContext.#instance && EccContext.#instance.#lib === lib) {
            return EccContext.#instance;
        }
        verifyCryptoBackend(lib);
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
     * const tweaked = context.lib.xOnlyPointAddTweak(key, tweak);
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
     *     EccContext.init(createNobleBackend());
     * }
     * ```
     */
    static isInitialized(): boolean {
        return EccContext.#instance !== undefined;
    }
}

/**
 * Initializes the ECC library with the provided instance.
 * This is a convenience function that wraps EccContext.init().
 * Pass `undefined` to clear the library.
 *
 * @param eccLib - The CryptoBackend instance to initialize, or undefined to clear
 * @throws Error if the CryptoBackend fails verification
 *
 * @example
 * ```typescript
 * import { initEccLib } from '@btc-vision/bitcoin';
 * import { createNobleBackend } from '@btc-vision/ecpair';
 *
 * // Initialize the ECC library
 * initEccLib(createNobleBackend());
 *
 * // Clear the library
 * initEccLib(undefined);
 * ```
 */
export function initEccLib(eccLib: CryptoBackend | undefined): void {
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
 * @returns The CryptoBackend instance
 * @throws Error if the ECC library has not been initialized
 *
 * @example
 * ```typescript
 * import { getEccLib, initEccLib } from '@btc-vision/bitcoin';
 * import { createNobleBackend } from '@btc-vision/ecpair';
 *
 * initEccLib(createNobleBackend());
 *
 * const ecc = getEccLib();
 * const tweaked = ecc.xOnlyPointAddTweak(pubkey, tweak);
 * ```
 */
export function getEccLib(): CryptoBackend {
    return EccContext.get().lib;
}
