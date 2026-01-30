/**
 * Pay-to-Multisig (P2MS) payment class.
 *
 * P2MS is a bare multisig script where M-of-N signatures are required
 * to spend the output. The public keys are embedded directly in the script.
 *
 * @packageDocumentation
 */

import { bitcoin as BITCOIN_NETWORK, type Network } from '../networks.js';
import * as bscript from '../script.js';
import {
    isPoint,
    type PublicKey,
    type Script,
    type Signature,
    type Stack,
    stacksEqual,
} from '../types.js';
import { type P2MSPayment, type PaymentOpts, PaymentType } from './types.js';

const OPS = bscript.opcodes;
const OP_INT_BASE = OPS.OP_RESERVED; // OP_1 - 1

/**
 * Pay-to-Multisig (P2MS) payment class.
 *
 * Creates locking scripts of the form:
 * `m {pubKey1} {pubKey2} ... {pubKeyN} n OP_CHECKMULTISIG`
 *
 * Spending requires: `OP_0 {sig1} {sig2} ... {sigM}`
 *
 * @example
 * ```typescript
 * import { P2MS } from '@btc-vision/bitcoin';
 *
 * // Create a 2-of-3 multisig
 * const payment = P2MS.fromPubkeys(2, [pubkey1, pubkey2, pubkey3]);
 * console.log(payment.output); // scriptPubKey
 * console.log(payment.m); // 2
 * console.log(payment.n); // 3
 *
 * // Decode an existing output
 * const decoded = P2MS.fromOutput(scriptPubKey);
 * console.log(decoded.pubkeys); // array of public keys
 * ```
 */
export class P2MS {
    // Static public fields
    static readonly NAME = PaymentType.P2MS;

    // Private instance fields
    readonly #network: Network;
    readonly #opts: Required<PaymentOpts>;

    // Input data (provided by user)
    #inputM?: number | undefined;
    #inputN?: number | undefined;
    #inputPubkeys?: Uint8Array[] | undefined;
    #inputSignatures?: Uint8Array[] | undefined;
    #inputOutput?: Uint8Array | undefined;
    #inputInput?: Uint8Array | undefined;

    // Cached computed values
    #m?: number | undefined;
    #n?: number | undefined;
    #pubkeys?: Uint8Array[] | undefined;
    #signatures?: Uint8Array[] | undefined;
    #output?: Uint8Array | undefined;
    #input?: Uint8Array | undefined;
    #witness?: Uint8Array[] | undefined;

    // Cache flags
    #mComputed = false;
    #nComputed = false;
    #pubkeysComputed = false;
    #signaturesComputed = false;
    #outputComputed = false;
    #inputComputed = false;
    #witnessComputed = false;

    // Decoded chunks cache
    #decodedChunks?: Stack | undefined;
    #decoded = false;

    /**
     * Creates a new P2MS payment instance.
     *
     * @param params - Payment parameters
     * @param params.m - Required number of signatures
     * @param params.n - Total number of public keys (optional, derived from pubkeys)
     * @param params.pubkeys - Array of public keys
     * @param params.signatures - Array of signatures
     * @param params.output - The scriptPubKey
     * @param params.input - The scriptSig
     * @param params.network - Network parameters (defaults to mainnet)
     * @param opts - Payment options
     * @param opts.validate - Whether to validate inputs (default: true)
     * @param opts.allowIncomplete - Allow incomplete signatures (default: false)
     *
     * @throws {TypeError} If validation is enabled and data is invalid
     */
    constructor(
        params: {
            m?: number | undefined;
            n?: number | undefined;
            pubkeys?: Uint8Array[] | undefined;
            signatures?: Uint8Array[] | undefined;
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
        this.#inputM = params.m;
        this.#inputN = params.n;
        this.#inputPubkeys = params.pubkeys;
        this.#inputSignatures = params.signatures;
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
    get name(): string {
        const m = this.m;
        const n = this.n;
        if (m !== undefined && n !== undefined) {
            return `p2ms(${m} of ${n})`;
        }
        return PaymentType.P2MS;
    }

    /**
     * Network parameters.
     */
    get network(): Network {
        return this.#network;
    }

    /**
     * Required number of signatures (M in M-of-N).
     */
    get m(): number | undefined {
        if (!this.#mComputed) {
            this.#m = this.#computeM();
            this.#mComputed = true;
        }
        return this.#m;
    }

    /**
     * Total number of public keys (N in M-of-N).
     */
    get n(): number | undefined {
        if (!this.#nComputed) {
            this.#n = this.#computeN();
            this.#nComputed = true;
        }
        return this.#n;
    }

    /**
     * Array of public keys.
     */
    get pubkeys(): PublicKey[] | undefined {
        if (!this.#pubkeysComputed) {
            this.#pubkeys = this.#computePubkeys();
            this.#pubkeysComputed = true;
        }
        return this.#pubkeys as PublicKey[] | undefined;
    }

    /**
     * Array of signatures.
     */
    get signatures(): Signature[] | undefined {
        if (!this.#signaturesComputed) {
            this.#signatures = this.#computeSignatures();
            this.#signaturesComputed = true;
        }
        return this.#signatures as Signature[] | undefined;
    }

    /**
     * The scriptPubKey: `m {pubkeys} n OP_CHECKMULTISIG`
     */
    get output(): Script | undefined {
        if (!this.#outputComputed) {
            this.#output = this.#computeOutput();
            this.#outputComputed = true;
        }
        return this.#output as Script | undefined;
    }

    /**
     * The scriptSig: `OP_0 {signatures}`
     */
    get input(): Script | undefined {
        if (!this.#inputComputed) {
            this.#input = this.#computeInput();
            this.#inputComputed = true;
        }
        return this.#input as Script | undefined;
    }

    /**
     * Witness stack (empty for P2MS as it's not a SegWit type).
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
     * Creates a P2MS payment from public keys.
     *
     * @param m - Required number of signatures
     * @param pubkeys - Array of public keys
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2MS payment instance
     *
     * @example
     * ```typescript
     * // Create a 2-of-3 multisig
     * const payment = P2MS.fromPubkeys(2, [pubkey1, pubkey2, pubkey3]);
     * ```
     */
    static fromPubkeys(m: number, pubkeys: PublicKey[], network?: Network): P2MS {
        return new P2MS({ m, pubkeys, network });
    }

    /**
     * Creates a P2MS payment from a scriptPubKey.
     *
     * @param output - The scriptPubKey
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2MS payment instance
     */
    static fromOutput(output: Uint8Array, network?: Network): P2MS {
        return new P2MS({ output, network });
    }

    /**
     * Creates a P2MS payment from signatures (for spending).
     *
     * @param signatures - Array of signatures
     * @param m - Required number of signatures (optional)
     * @param pubkeys - Array of public keys (optional, for validation)
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2MS payment instance
     */
    static fromSignatures(
        signatures: Signature[],
        m?: number,
        pubkeys?: PublicKey[],
        network?: Network,
    ): P2MS {
        return new P2MS({ signatures, m, pubkeys, network });
    }

    // Private helper methods

    /**
     * Converts to a plain P2MSPayment object for backwards compatibility.
     *
     * @returns A P2MSPayment object
     */
    toPayment(): P2MSPayment {
        return {
            name: this.name,
            network: this.network,
            m: this.m,
            n: this.n,
            pubkeys: this.pubkeys,
            signatures: this.signatures,
            output: this.output,
            input: this.input,
            witness: this.witness,
        };
    }

    // Private computation methods

    #decode(output: Uint8Array | Stack): void {
        if (this.#decoded) return;
        this.#decoded = true;
        this.#decodedChunks = (bscript.decompile(output) ?? []) as Stack;
        this.#m = (this.#decodedChunks[0] as number) - OP_INT_BASE;
        this.#n = (this.#decodedChunks[this.#decodedChunks.length - 2] as number) - OP_INT_BASE;
        this.#pubkeys = this.#decodedChunks.slice(1, -2) as Uint8Array[];
        this.#mComputed = true;
        this.#nComputed = true;
        this.#pubkeysComputed = true;
    }

    #computeM(): number | undefined {
        if (this.#inputM !== undefined) {
            return this.#inputM;
        }
        const output = this.#inputOutput ?? this.output;
        if (output) {
            this.#decode(output);
            return this.#m;
        }
        return undefined;
    }

    #computeN(): number | undefined {
        if (this.#inputN !== undefined) {
            return this.#inputN;
        }
        if (this.#inputPubkeys) {
            return this.#inputPubkeys.length;
        }
        if (this.#inputOutput) {
            this.#decode(this.#inputOutput);
            return this.#n;
        }
        return undefined;
    }

    #computePubkeys(): PublicKey[] | undefined {
        if (this.#inputPubkeys) {
            return this.#inputPubkeys as PublicKey[];
        }
        if (this.#inputOutput) {
            this.#decode(this.#inputOutput);
            return this.#pubkeys as PublicKey[] | undefined;
        }
        return undefined;
    }

    #computeSignatures(): Signature[] | undefined {
        if (this.#inputSignatures) {
            return this.#inputSignatures as Signature[];
        }
        if (this.#inputInput) {
            const decompiled = bscript.decompile(this.#inputInput);
            if (decompiled === null || decompiled === undefined) {
                return undefined;
            }
            return decompiled.slice(1) as Signature[];
        }
        return undefined;
    }

    #computeOutput(): Script | undefined {
        if (this.#inputOutput) {
            return this.#inputOutput as Script;
        }
        const m = this.#inputM;
        const n = this.n;
        const pubkeys = this.#inputPubkeys;
        if (m === undefined || n === undefined || !pubkeys) {
            return undefined;
        }
        return bscript.compile(
            ([] as Stack).concat(OP_INT_BASE + m, pubkeys, OP_INT_BASE + n, OPS.OP_CHECKMULTISIG),
        );
    }

    #computeInput(): Script | undefined {
        if (this.#inputInput) {
            return this.#inputInput as Script;
        }
        if (!this.#inputSignatures) {
            return undefined;
        }
        return bscript.compile(([OPS.OP_0] as Stack).concat(this.#inputSignatures));
    }

    // Validation

    #computeWitness(): Uint8Array[] | undefined {
        if (this.input) {
            return [];
        }
        return undefined;
    }

    #isAcceptableSignature(x: Uint8Array | number): boolean {
        return (
            bscript.isCanonicalScriptSignature(x as Uint8Array) ||
            (this.#opts.allowIncomplete && (x as number) === OPS.OP_0)
        );
    }

    #validate(): void {
        if (this.#inputOutput) {
            this.#decode(this.#inputOutput);
            const chunks = this.#decodedChunks;
            if (!chunks) {
                throw new TypeError('Output is invalid');
            }

            if (typeof chunks[0] !== 'number') {
                throw new TypeError('Output is invalid');
            }
            if (typeof chunks[chunks.length - 2] !== 'number') {
                throw new TypeError('Output is invalid');
            }
            if (chunks[chunks.length - 1] !== OPS.OP_CHECKMULTISIG) {
                throw new TypeError('Output is invalid');
            }

            const m = this.#m;
            const n = this.#n;
            const pubkeys = this.#pubkeys;
            if (m === undefined || n === undefined || !pubkeys) {
                throw new TypeError('Output is invalid');
            }

            if (m <= 0 || n > 16 || m > n || n !== chunks.length - 3) {
                throw new TypeError('Output is invalid');
            }
            if (!pubkeys.every((x) => isPoint(x))) {
                throw new TypeError('Output is invalid');
            }

            if (this.#inputM !== undefined && this.#inputM !== m) {
                throw new TypeError('m mismatch');
            }
            if (this.#inputN !== undefined && this.#inputN !== n) {
                throw new TypeError('n mismatch');
            }
            if (this.#inputPubkeys && !stacksEqual(this.#inputPubkeys, pubkeys)) {
                throw new TypeError('Pubkeys mismatch');
            }
        }

        if (this.#inputPubkeys) {
            if (this.#inputN !== undefined && this.#inputN !== this.#inputPubkeys.length) {
                throw new TypeError('Pubkey count mismatch');
            }
            this.#n = this.#inputPubkeys.length;
            this.#nComputed = true;

            if (this.#m !== undefined && this.#n < this.#m) {
                throw new TypeError('Pubkey count cannot be less than m');
            }
        }

        if (this.#inputSignatures) {
            if (this.#m !== undefined && this.#inputSignatures.length < this.#m) {
                throw new TypeError('Not enough signatures provided');
            }
            if (this.#m !== undefined && this.#inputSignatures.length > this.#m) {
                throw new TypeError('Too many signatures provided');
            }
        }

        if (this.#inputInput) {
            if (this.#inputInput[0] !== OPS.OP_0) {
                throw new TypeError('Input is invalid');
            }
            const sigs = this.signatures;
            if (!sigs || sigs.length === 0 || !sigs.every((s) => this.#isAcceptableSignature(s))) {
                throw new TypeError('Input has invalid signature(s)');
            }

            if (this.#inputSignatures && !stacksEqual(this.#inputSignatures, sigs)) {
                throw new TypeError('Signature mismatch');
            }
            if (
                this.#inputM !== undefined &&
                this.#inputSignatures &&
                this.#inputM !== this.#inputSignatures.length
            ) {
                throw new TypeError('Signature count mismatch');
            }
        }
    }
}

/**
 * Creates a Pay-to-Multisig (P2MS) payment object.
 *
 * This is the legacy factory function for backwards compatibility.
 * For new code, prefer using the P2MS class directly.
 *
 * @param a - The payment object containing the necessary data
 * @param opts - Optional payment options
 * @returns The P2MS payment object
 * @throws {TypeError} If the required data is not provided or if the data is invalid
 *
 * @example
 * ```typescript
 * import { p2ms } from '@btc-vision/bitcoin';
 *
 * // Create a 2-of-3 multisig
 * const payment = p2ms({ m: 2, pubkeys: [pubkey1, pubkey2, pubkey3] });
 * ```
 */
export function p2ms(a: Omit<P2MSPayment, 'name'>, opts?: PaymentOpts): P2MSPayment {
    if (!a.input && !a.output && !(a.pubkeys && a.m !== undefined) && !a.signatures) {
        throw new TypeError('Not enough data');
    }

    const instance = new P2MS(
        {
            m: a.m,
            n: a.n,
            pubkeys: a.pubkeys,
            signatures: a.signatures,
            output: a.output,
            input: a.input,
            network: a.network,
        },
        opts,
    );

    // Return a merged object for backwards compatibility
    return Object.assign(instance.toPayment(), a);
}
