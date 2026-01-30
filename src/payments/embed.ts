/**
 * OP_RETURN Embed payment class.
 *
 * Embed payments use OP_RETURN to store arbitrary data in the blockchain.
 * These outputs are provably unspendable.
 *
 * @packageDocumentation
 */

import { bitcoin as BITCOIN_NETWORK, type Network } from '../networks.js';
import * as bscript from '../script.js';
import type { Script } from '../types.js';
import { type Stack, stacksEqual } from '../types.js';
import { type EmbedPayment, type PaymentOpts, PaymentType } from './types.js';

const OPS = bscript.opcodes;

/**
 * OP_RETURN Embed payment class.
 *
 * Creates outputs of the form: `OP_RETURN {data1} {data2} ...`
 * These outputs are provably unspendable and used for data storage.
 *
 * @example
 * ```typescript
 * import { Embed } from '@btc-vision/bitcoin';
 *
 * // Create from data
 * const payment = Embed.fromData([Buffer.from('Hello, Bitcoin!')]);
 * console.log(payment.output); // scriptPubKey with OP_RETURN
 *
 * // Decode an existing output
 * const decoded = Embed.fromOutput(scriptPubKey);
 * console.log(decoded.data); // array of data chunks
 * ```
 */
export class Embed {
    // Static public fields
    static readonly NAME = PaymentType.Embed;

    // Private instance fields
    readonly #network: Network;
    readonly #opts: Required<PaymentOpts>;

    // Input data (provided by user)
    #inputData?: Uint8Array[] | undefined;
    #inputOutput?: Uint8Array | undefined;

    // Cached computed values
    #data?: Uint8Array[] | undefined;
    #output?: Uint8Array | undefined;

    // Cache flags
    #dataComputed = false;
    #outputComputed = false;

    /**
     * Creates a new Embed payment instance.
     *
     * @param params - Payment parameters
     * @param params.data - Array of data chunks to embed
     * @param params.output - The scriptPubKey
     * @param params.network - Network parameters (defaults to mainnet)
     * @param opts - Payment options
     * @param opts.validate - Whether to validate inputs (default: true)
     *
     * @throws {TypeError} If validation is enabled and data is invalid
     */
    constructor(
        params: {
            data?: Uint8Array[] | undefined;
            output?: Uint8Array | undefined;
            network?: Network | undefined;
        },
        opts?: PaymentOpts,
    ) {
        this.#network = params.network ?? BITCOIN_NETWORK;
        this.#opts = {
            validate: opts?.validate ?? true,
            allowIncomplete: opts?.allowIncomplete ?? false,
        };

        // Store input data
        this.#inputData = params.data;
        this.#inputOutput = params.output;

        // Validate if requested
        if (this.#opts.validate) {
            this.#validate();
        }
    }

    // Public getters

    /**
     * Payment type discriminant.
     */
    get name(): typeof PaymentType.Embed {
        return PaymentType.Embed;
    }

    /**
     * Network parameters.
     */
    get network(): Network {
        return this.#network;
    }

    /**
     * The embedded data chunks.
     */
    get data(): Uint8Array[] {
        if (!this.#dataComputed) {
            this.#data = this.#computeData();
            this.#dataComputed = true;
        }
        return this.#data ?? [];
    }

    /**
     * The scriptPubKey: `OP_RETURN {data...}`
     */
    get output(): Script | undefined {
        if (!this.#outputComputed) {
            this.#output = this.#computeOutput();
            this.#outputComputed = true;
        }
        return this.#output as Script | undefined;
    }

    // Static factory methods

    /**
     * Creates an Embed payment from data chunks.
     *
     * @param data - Array of data chunks to embed
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new Embed payment instance
     *
     * @example
     * ```typescript
     * const payment = Embed.fromData([
     *   new TextEncoder().encode('Hello'),
     *   new TextEncoder().encode('Bitcoin')
     * ]);
     * ```
     */
    static fromData(data: Uint8Array[], network?: Network): Embed {
        return new Embed({ data, network });
    }

    /**
     * Creates an Embed payment from a scriptPubKey.
     *
     * @param output - The scriptPubKey
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new Embed payment instance
     */
    static fromOutput(output: Uint8Array, network?: Network): Embed {
        return new Embed({ output, network });
    }

    // Private computation methods

    /**
     * Converts to a plain EmbedPayment object for backwards compatibility.
     *
     * @returns An EmbedPayment object
     */
    toPayment(): EmbedPayment {
        return {
            name: this.name,
            network: this.network,
            data: this.data,
            output: this.output,
        };
    }

    #computeData(): Uint8Array[] | undefined {
        if (this.#inputData) {
            return this.#inputData;
        }
        if (this.#inputOutput) {
            const script = bscript.decompile(this.#inputOutput);
            if (script === null || script === undefined) {
                return undefined;
            }
            return script.slice(1) as Uint8Array[];
        }
        return undefined;
    }

    // Validation

    #computeOutput(): Uint8Array | undefined {
        if (this.#inputOutput) {
            return this.#inputOutput;
        }
        if (!this.#inputData) {
            return undefined;
        }
        return bscript.compile(([OPS.OP_RETURN] as Stack).concat(this.#inputData));
    }

    #validate(): void {
        if (this.#inputOutput) {
            const chunks = bscript.decompile(this.#inputOutput);
            if (!chunks) {
                throw new TypeError('Output is invalid');
            }
            if (chunks[0] !== OPS.OP_RETURN) {
                throw new TypeError('Output is invalid');
            }
            if (!chunks.slice(1).every((c) => c instanceof Uint8Array)) {
                throw new TypeError('Output is invalid');
            }

            if (this.#inputData && !stacksEqual(this.#inputData, this.data)) {
                throw new TypeError('Data mismatch');
            }
        }
    }
}

/**
 * Creates an OP_RETURN Embed payment object.
 *
 * This is the legacy factory function for backwards compatibility.
 * For new code, prefer using the Embed class directly.
 *
 * @param a - The payment object containing the necessary data
 * @param opts - Optional payment options
 * @returns The Embed payment object
 * @throws {TypeError} If the required data is not provided or if the data is invalid
 *
 * @example
 * ```typescript
 * import { p2data } from '@btc-vision/bitcoin';
 *
 * // Create from data
 * const payment = p2data({ data: [Buffer.from('Hello')] });
 *
 * // Decode from output
 * const decoded = p2data({ output: scriptPubKey });
 * ```
 */
export function p2data(a: Omit<EmbedPayment, 'name'>, opts?: PaymentOpts): EmbedPayment {
    if (!a.data && !a.output) {
        throw new TypeError('Not enough data');
    }

    const instance = new Embed(
        {
            data: a.data,
            output: a.output,
            network: a.network,
        },
        opts,
    );

    // Return a merged object for backwards compatibility
    return Object.assign(instance.toPayment(), a);
}
