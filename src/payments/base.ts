/**
 * Base class for all payment types.
 *
 * Provides common functionality and lazy property evaluation
 * through ES2022 private fields and getters.
 *
 * @packageDocumentation
 */

import type { Network } from '../networks.js';
import { bitcoin as BITCOIN_NETWORK } from '../networks.js';
import type { PaymentOpts, PaymentType, ScriptRedeem } from './types.js';

/**
 * Abstract base class for Bitcoin payment types.
 *
 * All payment classes extend this base to share:
 * - Network configuration
 * - Lazy property computation via getters
 * - Common validation patterns
 *
 * @example
 * ```typescript
 * class P2PKH extends BasePayment {
 *   get hash(): Uint8Array | undefined {
 *     // Lazy computation
 *   }
 * }
 * ```
 */
export abstract class BasePayment {
    /** Payment type discriminant */
    abstract readonly name: PaymentType;

    /** Network parameters */
    readonly network: Network;

    /** Validation options */
    protected readonly opts: Required<PaymentOpts>;

    // Cached computed values (lazy evaluation)
    #output?: Uint8Array;
    #input?: Uint8Array;
    #address?: string;
    #witness?: Uint8Array[];
    #redeem?: ScriptRedeem;

    // Flags for cache state
    #outputComputed = false;
    #inputComputed = false;
    #addressComputed = false;
    #witnessComputed = false;
    #redeemComputed = false;

    constructor(network?: Network, opts?: PaymentOpts) {
        this.network = network ?? BITCOIN_NETWORK;
        this.opts = {
            validate: opts?.validate ?? true,
            allowIncomplete: opts?.allowIncomplete ?? false,
        };
    }

    /**
     * The scriptPubKey (locking script).
     * Computed lazily on first access.
     */
    get output(): Uint8Array | undefined {
        if (!this.#outputComputed) {
            this.#output = this.computeOutput();
            this.#outputComputed = true;
        }
        return this.#output;
    }

    set output(value: Uint8Array | undefined) {
        this.#output = value;
        this.#outputComputed = true;
    }

    /**
     * The scriptSig (unlocking script for legacy).
     * Computed lazily on first access.
     */
    get input(): Uint8Array | undefined {
        if (!this.#inputComputed) {
            this.#input = this.computeInput();
            this.#inputComputed = true;
        }
        return this.#input;
    }

    set input(value: Uint8Array | undefined) {
        this.#input = value;
        this.#inputComputed = true;
    }

    /**
     * Human-readable address.
     * Computed lazily on first access.
     */
    get address(): string | undefined {
        if (!this.#addressComputed) {
            this.#address = this.computeAddress();
            this.#addressComputed = true;
        }
        return this.#address;
    }

    set address(value: string | undefined) {
        this.#address = value;
        this.#addressComputed = true;
    }

    /**
     * Witness stack (for SegWit).
     * Computed lazily on first access.
     */
    get witness(): Uint8Array[] | undefined {
        if (!this.#witnessComputed) {
            this.#witness = this.computeWitness();
            this.#witnessComputed = true;
        }
        return this.#witness;
    }

    set witness(value: Uint8Array[] | undefined) {
        this.#witness = value;
        this.#witnessComputed = true;
    }

    /**
     * Redeem script information.
     * Computed lazily on first access.
     */
    get redeem(): ScriptRedeem | undefined {
        if (!this.#redeemComputed) {
            this.#redeem = this.computeRedeem();
            this.#redeemComputed = true;
        }
        return this.#redeem;
    }

    set redeem(value: ScriptRedeem | undefined) {
        this.#redeem = value;
        this.#redeemComputed = true;
    }

    /**
     * Override in subclasses to compute the scriptPubKey.
     */
    protected computeOutput(): Uint8Array | undefined {
        return undefined;
    }

    /**
     * Override in subclasses to compute the scriptSig.
     */
    protected computeInput(): Uint8Array | undefined {
        return undefined;
    }

    /**
     * Override in subclasses to compute the address.
     */
    protected computeAddress(): string | undefined {
        return undefined;
    }

    /**
     * Override in subclasses to compute the witness stack.
     */
    protected computeWitness(): Uint8Array[] | undefined {
        return undefined;
    }

    /**
     * Override in subclasses to compute the redeem script.
     */
    protected computeRedeem(): ScriptRedeem | undefined {
        return undefined;
    }

    /**
     * Validate the payment data.
     * Called during construction if opts.validate is true.
     */
    protected abstract validate(): void;

    /**
     * Reset all cached values.
     * Useful when input data changes.
     */
    protected resetCache(): void {
        this.#outputComputed = false;
        this.#inputComputed = false;
        this.#addressComputed = false;
        this.#witnessComputed = false;
        this.#redeemComputed = false;
        this.#output = undefined;
        this.#input = undefined;
        this.#address = undefined;
        this.#witness = undefined;
        this.#redeem = undefined;
    }
}

/**
 * Helper to check if a value equals another Uint8Array.
 */
export function uint8ArrayEquals(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
