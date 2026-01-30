/**
 * Pay-to-Public-Key (P2PK) payment class.
 *
 * P2PK is one of the simplest Bitcoin payment types where the output script
 * contains a public key directly, and spending requires a signature from that key.
 *
 * @packageDocumentation
 */

import { bitcoin as BITCOIN_NETWORK, type Network } from '../networks.js';
import * as bscript from '../script.js';
import { isPoint, type PublicKey, type Script, type Signature } from '../types.js';
import { equals } from '../io/index.js';
import { type P2PKPayment, type PaymentOpts, PaymentType } from './types.js';

const OPS = bscript.opcodes;

/**
 * Pay-to-Public-Key (P2PK) payment class.
 *
 * Creates locking scripts of the form: `{pubKey} OP_CHECKSIG`
 * Spending requires providing: `{signature}`
 *
 * @example
 * ```typescript
 * import { P2PK } from '@btc-vision/bitcoin';
 *
 * // Create from public key
 * const payment = P2PK.fromPubkey(pubkey);
 * console.log(payment.output); // scriptPubKey
 *
 * // Create from output script
 * const decoded = P2PK.fromOutput(scriptPubKey);
 * console.log(decoded.pubkey); // extracted public key
 *
 * // Legacy factory function still works
 * const legacy = p2pk({ pubkey });
 * ```
 */
export class P2PK {
    // Static public fields
    static readonly NAME = PaymentType.P2PK;

    // Private instance fields
    readonly #network: Network;
    readonly #opts: Required<PaymentOpts>;

    // Input data (provided by user)
    #inputPubkey?: Uint8Array | undefined;
    #inputSignature?: Uint8Array | undefined;
    #inputOutput?: Uint8Array | undefined;
    #inputInput?: Uint8Array | undefined;

    // Cached computed values
    #pubkey?: Uint8Array | undefined;
    #signature?: Uint8Array | undefined;
    #output?: Uint8Array | undefined;
    #input?: Uint8Array | undefined;
    #witness?: Uint8Array[] | undefined;

    // Cache flags
    #pubkeyComputed = false;
    #signatureComputed = false;
    #outputComputed = false;
    #inputComputed = false;
    #witnessComputed = false;

    /**
     * Creates a new P2PK payment instance.
     *
     * @param params - Payment parameters
     * @param params.pubkey - The public key (33 or 65 bytes)
     * @param params.signature - DER-encoded signature
     * @param params.output - The scriptPubKey
     * @param params.input - The scriptSig
     * @param params.network - Network parameters (defaults to mainnet)
     * @param opts - Payment options
     * @param opts.validate - Whether to validate inputs (default: true)
     *
     * @throws {TypeError} If validation is enabled and data is invalid
     */
    constructor(
        params: {
            pubkey?: Uint8Array | undefined;
            signature?: Uint8Array | undefined;
            output?: Uint8Array | undefined;
            input?: Uint8Array | undefined;
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
        this.#inputPubkey = params.pubkey;
        this.#inputSignature = params.signature;
        this.#inputOutput = params.output;
        this.#inputInput = params.input;

        // Validate if requested
        if (this.#opts.validate) {
            this.#validate();
        }
    }

    // Public getters

    /**
     * Payment type discriminant.
     */
    get name(): typeof PaymentType.P2PK {
        return PaymentType.P2PK;
    }

    /**
     * Network parameters.
     */
    get network(): Network {
        return this.#network;
    }

    /**
     * The public key (33 or 65 bytes).
     * Computed lazily from output if not provided directly.
     */
    get pubkey(): PublicKey | undefined {
        if (!this.#pubkeyComputed) {
            this.#pubkey = this.#computePubkey();
            this.#pubkeyComputed = true;
        }
        return this.#pubkey as PublicKey | undefined;
    }

    /**
     * The DER-encoded signature.
     * Computed lazily from input if not provided directly.
     */
    get signature(): Signature | undefined {
        if (!this.#signatureComputed) {
            this.#signature = this.#computeSignature();
            this.#signatureComputed = true;
        }
        return this.#signature as Signature | undefined;
    }

    /**
     * The scriptPubKey: `{pubKey} OP_CHECKSIG`
     * Computed lazily from pubkey if not provided directly.
     */
    get output(): Script | undefined {
        if (!this.#outputComputed) {
            this.#output = this.#computeOutput();
            this.#outputComputed = true;
        }
        return this.#output as Script | undefined;
    }

    /**
     * The scriptSig: `{signature}`
     * Computed lazily from signature if not provided directly.
     */
    get input(): Script | undefined {
        if (!this.#inputComputed) {
            this.#input = this.#computeInput();
            this.#inputComputed = true;
        }
        return this.#input as Script | undefined;
    }

    /**
     * Witness stack (empty for P2PK as it's not a SegWit type).
     */
    get witness(): Uint8Array[] | undefined {
        if (!this.#witnessComputed) {
            this.#witness = this.#computeWitness();
            this.#witnessComputed = true;
        }
        return this.#witness;
    }

    // Static factory methods

    /**
     * Creates a P2PK payment from a public key.
     *
     * @param pubkey - The public key (33 or 65 bytes)
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2PK payment instance
     *
     * @example
     * ```typescript
     * const payment = P2PK.fromPubkey(pubkey);
     * const scriptPubKey = payment.output;
     * ```
     */
    static fromPubkey(pubkey: PublicKey, network?: Network): P2PK {
        return new P2PK({ pubkey, network });
    }

    /**
     * Creates a P2PK payment from a scriptPubKey.
     *
     * @param output - The scriptPubKey
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2PK payment instance
     *
     * @example
     * ```typescript
     * const payment = P2PK.fromOutput(scriptPubKey);
     * const pubkey = payment.pubkey;
     * ```
     */
    static fromOutput(output: Uint8Array, network?: Network): P2PK {
        return new P2PK({ output, network });
    }

    /**
     * Creates a P2PK payment from a signature (for spending).
     *
     * @param signature - The DER-encoded signature
     * @param pubkey - The public key (optional, for validation)
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2PK payment instance
     *
     * @example
     * ```typescript
     * const payment = P2PK.fromSignature(signature, pubkey);
     * const scriptSig = payment.input;
     * ```
     */
    static fromSignature(signature: Signature, pubkey?: PublicKey, network?: Network): P2PK {
        return new P2PK({ signature, pubkey, network });
    }

    // Private computation methods

    /**
     * Converts to a plain P2PKPayment object for backwards compatibility.
     *
     * @returns A P2PKPayment object
     */
    toPayment(): P2PKPayment {
        return {
            name: this.name,
            network: this.network,
            pubkey: this.pubkey,
            signature: this.signature,
            output: this.output,
            input: this.input,
            witness: this.witness,
        };
    }

    #computePubkey(): PublicKey | undefined {
        if (this.#inputPubkey) {
            return this.#inputPubkey as PublicKey;
        }
        if (this.#inputOutput) {
            // Extract pubkey from output: {pubkey} OP_CHECKSIG
            return this.#inputOutput.subarray(1, -1) as PublicKey;
        }
        return undefined;
    }

    #computeSignature(): Signature | undefined {
        if (this.#inputSignature) {
            return this.#inputSignature as Signature;
        }
        if (this.#inputInput) {
            const chunks = bscript.decompile(this.#inputInput);
            if (chunks && chunks.length > 0) {
                return chunks[0] as Signature;
            }
        }
        return undefined;
    }

    #computeOutput(): Script | undefined {
        if (this.#inputOutput) {
            return this.#inputOutput as Script;
        }
        const pubkey = this.#inputPubkey;
        if (pubkey) {
            return bscript.compile([pubkey, OPS.OP_CHECKSIG]);
        }
        return undefined;
    }

    #computeInput(): Script | undefined {
        if (this.#inputInput) {
            return this.#inputInput as Script;
        }
        const signature = this.#inputSignature;
        if (signature) {
            return bscript.compile([signature]);
        }
        return undefined;
    }

    // Validation

    #computeWitness(): Uint8Array[] | undefined {
        if (this.input) {
            return [];
        }
        return undefined;
    }

    #validate(): void {
        if (this.#inputOutput) {
            if (this.#inputOutput[this.#inputOutput.length - 1] !== OPS.OP_CHECKSIG) {
                throw new TypeError('Output is invalid');
            }
            const extractedPubkey = this.pubkey;
            if (!isPoint(extractedPubkey)) {
                throw new TypeError('Output pubkey is invalid');
            }
            if (
                this.#inputPubkey &&
                extractedPubkey &&
                !equals(this.#inputPubkey, extractedPubkey)
            ) {
                throw new TypeError('Pubkey mismatch');
            }
        }

        if (this.#inputSignature) {
            const computedInput = this.input;
            if (this.#inputInput && computedInput && !equals(this.#inputInput, computedInput)) {
                throw new TypeError('Signature mismatch');
            }
        }

        if (this.#inputInput) {
            const chunks = bscript.decompile(this.#inputInput);
            if (!chunks || chunks.length !== 1) {
                throw new TypeError('Input is invalid');
            }
            const sig = this.signature;
            if (!sig || !bscript.isCanonicalScriptSignature(sig)) {
                throw new TypeError('Input has invalid signature');
            }
        }
    }
}

/**
 * Creates a Pay-to-Public-Key (P2PK) payment object.
 *
 * This is the legacy factory function for backwards compatibility.
 * For new code, prefer using the P2PK class directly.
 *
 * @param a - The payment object containing the necessary data
 * @param opts - Optional payment options
 * @returns The P2PK payment object
 * @throws {TypeError} If the required data is not provided or if the data is invalid
 *
 * @example
 * ```typescript
 * import { p2pk } from '@btc-vision/bitcoin';
 *
 * // Create from public key
 * const payment = p2pk({ pubkey });
 *
 * // Create from output
 * const decoded = p2pk({ output: scriptPubKey });
 * ```
 */
export function p2pk(a: Omit<P2PKPayment, 'name'>, opts?: PaymentOpts): P2PKPayment {
    if (!a.input && !a.output && !a.pubkey && !a.signature) {
        throw new TypeError('Not enough data');
    }

    const instance = new P2PK(
        {
            pubkey: a.pubkey,
            signature: a.signature,
            output: a.output,
            input: a.input,
            network: a.network,
        },
        opts,
    );

    // Return a merged object for backwards compatibility
    return Object.assign(instance.toPayment(), a);
}
