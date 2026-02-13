/**
 * Pay-to-Script-Hash (P2SH) payment class.
 *
 * P2SH allows spending to be based on a hash of a script, with the actual
 * script revealed only at spend time. This enables complex spending conditions
 * while keeping addresses short.
 *
 * @packageDocumentation
 */

import * as bcrypto from '../crypto.js';
import { bitcoin as BITCOIN_NETWORK, type Network } from '../networks.js';
import * as bscript from '../script.js';
import { type Bytes20, type Script, type Stack, stacksEqual } from '../types.js';
import { alloc, base58check, equals } from '../io/index.js';
import {
    type P2SHPayment,
    type Payment,
    type PaymentOpts,
    PaymentType,
    type ScriptRedeem,
} from './types.js';

const OPS = bscript.opcodes;

/**
 * Pay-to-Script-Hash (P2SH) payment class.
 *
 * Creates locking scripts of the form:
 * `OP_HASH160 {hash160(redeemScript)} OP_EQUAL`
 *
 * Spending requires: `{redeemScriptSig...} {redeemScript}`
 *
 * @example
 * ```typescript
 * import { P2SH, P2MS } from '@btc-vision/bitcoin';
 *
 * // Wrap a multisig in P2SH
 * const multisig = P2MS.fromPubkeys(2, [pubkey1, pubkey2, pubkey3]);
 * const p2sh = P2SH.fromRedeem({ output: multisig.output });
 * console.log(p2sh.address); // 3... address
 *
 * // Decode an existing output
 * const decoded = P2SH.fromOutput(scriptPubKey);
 * console.log(decoded.hash); // 20-byte script hash
 * ```
 */
export class P2SH {
    // Static public fields
    static readonly NAME = PaymentType.P2SH;

    // Private instance fields
    readonly #network: Network;
    readonly #opts: Required<PaymentOpts>;

    // Input data (provided by user)
    #inputAddress?: string | undefined;
    #inputHash?: Uint8Array | undefined;
    #inputOutput?: Uint8Array | undefined;
    #inputInput?: Uint8Array | undefined;
    #inputRedeem?: ScriptRedeem | undefined;
    #inputWitness?: Uint8Array[] | undefined;

    // Cached computed values
    #address?: string | undefined;
    #hash?: Uint8Array | undefined;
    #output?: Uint8Array | undefined;
    #input?: Uint8Array | undefined;
    #redeem?: ScriptRedeem | undefined;
    #witness?: Uint8Array[] | undefined;

    // Cache flags
    #addressComputed = false;
    #hashComputed = false;
    #outputComputed = false;
    #inputComputed = false;
    #redeemComputed = false;
    #witnessComputed = false;

    // Decoded address cache
    #decodedAddress?: { version: number; hash: Uint8Array } | undefined;
    #decodedAddressComputed = false;

    // Decoded input chunks cache
    #inputChunks?: Stack | undefined;
    #inputChunksComputed = false;

    // Derived redeem from input
    #derivedRedeem?: ScriptRedeem | undefined;
    #derivedRedeemComputed = false;

    /**
     * Creates a new P2SH payment instance.
     *
     * @param params - Payment parameters
     * @param params.address - Base58Check encoded address (3...)
     * @param params.hash - 20-byte script hash
     * @param params.output - The scriptPubKey
     * @param params.input - The scriptSig
     * @param params.redeem - The redeem script information
     * @param params.witness - The witness stack (for wrapped SegWit)
     * @param params.network - Network parameters (defaults to mainnet)
     * @param opts - Payment options
     * @param opts.validate - Whether to validate inputs (default: true)
     *
     * @throws {TypeError} If validation is enabled and data is invalid
     */
    constructor(
        params: {
            address?: string | undefined;
            hash?: Uint8Array | undefined;
            output?: Uint8Array | undefined;
            input?: Uint8Array | undefined;
            redeem?: ScriptRedeem | undefined;
            witness?: Uint8Array[] | undefined;
            network?: Network | undefined;
        },
        opts?: PaymentOpts,
    ) {
        // Derive network from redeem if not specified
        let network = params.network;
        if (!network) {
            network = (params.redeem && params.redeem.network) || BITCOIN_NETWORK;
        }
        this.#network = network;
        this.#opts = {
            validate: opts?.validate ?? true,
            allowIncomplete: opts?.allowIncomplete ?? false,
        };

        // Store input data
        this.#inputAddress = params.address;
        this.#inputHash = params.hash;
        this.#inputOutput = params.output;
        this.#inputInput = params.input;
        this.#inputRedeem = params.redeem;
        this.#inputWitness = params.witness;

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
        const r = this.redeem;
        if (r !== undefined && r.name !== undefined) {
            return `p2sh-${r.name}`;
        }
        return PaymentType.P2SH;
    }

    /**
     * Network parameters.
     */
    get network(): Network {
        return this.#network;
    }

    /**
     * Base58Check encoded address (3... for mainnet).
     */
    get address(): string | undefined {
        if (!this.#addressComputed) {
            this.#address = this.#computeAddress();
            this.#addressComputed = true;
        }
        return this.#address;
    }

    /**
     * 20-byte script hash (HASH160 of redeem script).
     */
    get hash(): Bytes20 | undefined {
        if (!this.#hashComputed) {
            this.#hash = this.#computeHash();
            this.#hashComputed = true;
        }
        return this.#hash as Bytes20 | undefined;
    }

    /**
     * The scriptPubKey: `OP_HASH160 {hash} OP_EQUAL`
     */
    get output(): Script | undefined {
        if (!this.#outputComputed) {
            this.#output = this.#computeOutput();
            this.#outputComputed = true;
        }
        return this.#output as Script | undefined;
    }

    /**
     * The scriptSig: `{redeemScriptSig...} {redeemScript}`
     */
    get input(): Script | undefined {
        if (!this.#inputComputed) {
            this.#input = this.#computeInput();
            this.#inputComputed = true;
        }
        return this.#input as Script | undefined;
    }

    /**
     * The redeem script information.
     */
    get redeem(): ScriptRedeem | undefined {
        if (!this.#redeemComputed) {
            this.#redeem = this.#computeRedeem();
            this.#redeemComputed = true;
        }
        return this.#redeem;
    }

    /**
     * The witness stack (for wrapped SegWit).
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
     * Creates a P2SH payment from a redeem script.
     *
     * @param redeem - The redeem script information
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2SH payment instance
     *
     * @example
     * ```typescript
     * const p2sh = P2SH.fromRedeem({ output: redeemScript });
     * ```
     */
    static fromRedeem(redeem: ScriptRedeem, network?: Network): P2SH {
        return new P2SH({ redeem, network });
    }

    /**
     * Creates a P2SH payment from a Base58Check address.
     *
     * @param address - Base58Check encoded address
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2SH payment instance
     */
    static fromAddress(address: string, network?: Network): P2SH {
        return new P2SH({ address, network });
    }

    /**
     * Creates a P2SH payment from a 20-byte script hash.
     *
     * @param hash - 20-byte script hash
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2SH payment instance
     */
    static fromHash(hash: Bytes20, network?: Network): P2SH {
        return new P2SH({ hash, network });
    }

    /**
     * Creates a P2SH payment from a scriptPubKey.
     *
     * @param output - The scriptPubKey
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2SH payment instance
     */
    static fromOutput(output: Uint8Array, network?: Network): P2SH {
        return new P2SH({ output, network });
    }

    // Private helper methods

    /**
     * Converts to a plain P2SHPayment object for backwards compatibility.
     *
     * @returns A P2SHPayment object
     */
    toPayment(): P2SHPayment {
        return {
            name: this.name,
            network: this.network,
            address: this.address,
            hash: this.hash,
            output: this.output,
            input: this.input,
            redeem: this.redeem,
            witness: this.witness,
        };
    }

    #getDecodedAddress(): { version: number; hash: Uint8Array } | undefined {
        if (!this.#decodedAddressComputed) {
            if (this.#inputAddress) {
                const payload = new Uint8Array(base58check.decode(this.#inputAddress));
                this.#decodedAddress = {
                    version: payload[0] as number,
                    hash: payload.subarray(1),
                };
            }
            this.#decodedAddressComputed = true;
        }
        return this.#decodedAddress;
    }

    #getInputChunks(): Stack | undefined {
        if (!this.#inputChunksComputed) {
            if (this.#inputInput) {
                this.#inputChunks = (bscript.decompile(this.#inputInput) as Stack) ?? undefined;
            }
            this.#inputChunksComputed = true;
        }
        return this.#inputChunks;
    }

    // Private computation methods

    #getDerivedRedeem(): ScriptRedeem | undefined {
        if (!this.#derivedRedeemComputed) {
            const chunks = this.#getInputChunks();
            if (chunks) {
                const lastChunk = chunks[chunks.length - 1];
                this.#derivedRedeem = {
                    network: this.#network,
                    output: (lastChunk === OPS.OP_FALSE
                        ? new Uint8Array(0)
                        : (lastChunk as Uint8Array)) as Script,
                    input: bscript.compile(chunks.slice(0, -1)),
                    witness: this.#inputWitness || [],
                };
            }
            this.#derivedRedeemComputed = true;
        }
        return this.#derivedRedeem;
    }

    #computeAddress(): string | undefined {
        if (this.#inputAddress) {
            return this.#inputAddress;
        }
        const h = this.hash;
        if (!h) return undefined;

        const payload = alloc(21);
        payload[0] = this.#network.scriptHash;
        payload.set(h, 1);
        return base58check.encode(payload);
    }

    #computeHash(): Bytes20 | undefined {
        if (this.#inputHash) {
            return this.#inputHash as Bytes20;
        }
        if (this.#inputOutput) {
            return this.#inputOutput.subarray(2, 22) as Bytes20;
        }
        if (this.#inputAddress) {
            return this.#getDecodedAddress()?.hash as Bytes20 | undefined;
        }
        const r = this.redeem;
        if (r && r.output) {
            return bcrypto.hash160(r.output);
        }
        return undefined;
    }

    #computeOutput(): Script | undefined {
        if (this.#inputOutput) {
            return this.#inputOutput as Script;
        }
        const h = this.hash;
        if (!h) return undefined;

        return bscript.compile([OPS.OP_HASH160, h, OPS.OP_EQUAL]);
    }

    #computeInput(): Script | undefined {
        if (this.#inputInput) {
            return this.#inputInput as Script;
        }
        const r = this.#inputRedeem;
        if (!r || !r.input || !r.output) {
            return undefined;
        }
        return bscript.compile(
            ([] as Stack).concat(bscript.decompile(r.input) as Stack, r.output),
        );
    }

    #computeRedeem(): ScriptRedeem | undefined {
        if (this.#inputRedeem) {
            return this.#inputRedeem;
        }
        if (this.#inputInput) {
            return this.#getDerivedRedeem();
        }
        return undefined;
    }

    // Validation

    #computeWitness(): Uint8Array[] | undefined {
        if (this.#inputWitness) {
            return this.#inputWitness;
        }
        const r = this.redeem;
        if (r && r.witness) {
            return r.witness;
        }
        if (this.input) {
            return [];
        }
        return undefined;
    }

    #checkRedeem(redeem: Payment): void {
        // Is the redeem output empty/invalid?
        if (redeem.output) {
            const decompile = bscript.decompile(redeem.output);
            if (!decompile || decompile.length < 1) {
                throw new TypeError('Redeem.output too short');
            }
            if (redeem.output.byteLength > 520) {
                throw new TypeError('Redeem.output unspendable if larger than 520 bytes');
            }
            if (bscript.countNonPushOnlyOPs(decompile) > 201) {
                throw new TypeError('Redeem.output unspendable with more than 201 non-push ops');
            }
        }

        if (redeem.input) {
            const hasInput = redeem.input.length > 0;
            const hasWitness = redeem.witness && redeem.witness.length > 0;
            if (!hasInput && !hasWitness) {
                throw new TypeError('Empty input');
            }
            if (hasInput && hasWitness) {
                throw new TypeError('Input and witness provided');
            }
            if (hasInput) {
                const richunks = bscript.decompile(redeem.input) as Stack;
                if (!bscript.isPushOnly(richunks)) {
                    throw new TypeError('Non push-only scriptSig');
                }
            }
        }
    }

    #validate(): void {
        let hash: Uint8Array = new Uint8Array(0);

        if (this.#inputAddress) {
            const addr = this.#getDecodedAddress();
            if (!addr) {
                throw new TypeError('Invalid address');
            }
            if (addr.version !== this.#network.scriptHash) {
                throw new TypeError('Invalid version or Network mismatch');
            }
            if (addr.hash.length !== 20) {
                throw new TypeError('Invalid address');
            }
            hash = addr.hash;
        }

        if (this.#inputHash) {
            if (hash.length > 0 && !equals(hash, this.#inputHash)) {
                throw new TypeError('Hash mismatch');
            } else {
                hash = this.#inputHash;
            }
        }

        if (this.#inputOutput) {
            if (
                this.#inputOutput.length !== 23 ||
                this.#inputOutput[0] !== OPS.OP_HASH160 ||
                this.#inputOutput[1] !== 0x14 ||
                this.#inputOutput[22] !== OPS.OP_EQUAL
            ) {
                throw new TypeError('Output is invalid');
            }

            const hash2 = this.#inputOutput.subarray(2, 22);
            if (hash.length > 0 && !equals(hash, hash2)) {
                throw new TypeError('Hash mismatch');
            } else {
                hash = hash2;
            }
        }

        if (this.#inputInput) {
            const chunks = this.#getInputChunks();
            if (!chunks || chunks.length < 1) {
                throw new TypeError('Input too short');
            }
            const derived = this.#getDerivedRedeem();
            if (!derived || !(derived.output instanceof Uint8Array)) {
                throw new TypeError('Input is invalid');
            }

            this.#checkRedeem(derived);

            // Match hash against redeem output
            if (derived.output) {
                const hash2 = bcrypto.hash160(derived.output);
                if (hash.length > 0 && !equals(hash, hash2)) {
                    throw new TypeError('Hash mismatch');
                } else {
                    hash = hash2;
                }
            }
        }

        if (this.#inputRedeem) {
            if (this.#inputRedeem.network && this.#inputRedeem.network !== this.#network) {
                throw new TypeError('Network mismatch');
            }
            if (this.#inputInput) {
                const derived = this.#getDerivedRedeem();
                if (derived) {
                    if (
                        this.#inputRedeem.output &&
                        derived.output &&
                        !equals(this.#inputRedeem.output, derived.output)
                    ) {
                        throw new TypeError('Redeem.output mismatch');
                    }
                    if (
                        this.#inputRedeem.input &&
                        derived.input &&
                        !equals(this.#inputRedeem.input, derived.input)
                    ) {
                        throw new TypeError('Redeem.input mismatch');
                    }
                }
            }

            this.#checkRedeem(this.#inputRedeem);

            // Match hash against redeem output
            if (this.#inputRedeem.output) {
                const hash2 = bcrypto.hash160(this.#inputRedeem.output);
                if (hash.length > 0 && !equals(hash, hash2)) {
                    throw new TypeError('Hash mismatch');
                }
            }
        }

        if (this.#inputWitness) {
            if (
                this.#inputRedeem &&
                this.#inputRedeem.witness &&
                !stacksEqual(this.#inputRedeem.witness, this.#inputWitness)
            ) {
                throw new TypeError('Witness and redeem.witness mismatch');
            }
        }
    }
}

/**
 * Creates a Pay-to-Script-Hash (P2SH) payment object.
 *
 * This is the legacy factory function for backwards compatibility.
 * For new code, prefer using the P2SH class directly.
 *
 * @param a - The payment object containing the necessary data
 * @param opts - Optional payment options
 * @returns The P2SH payment object
 * @throws {TypeError} If the required data is not provided or if the data is invalid
 *
 * @example
 * ```typescript
 * import { p2sh, p2ms } from '@btc-vision/bitcoin';
 *
 * // Wrap a multisig in P2SH
 * const multisig = p2ms({ m: 2, pubkeys: [pk1, pk2, pk3] });
 * const payment = p2sh({ redeem: multisig });
 * ```
 */
export function p2sh(a: Omit<P2SHPayment, 'name'>, opts?: PaymentOpts): P2SHPayment {
    if (!a.address && !a.hash && !a.output && !a.redeem && !a.input) {
        throw new TypeError('Not enough data');
    }

    const instance = new P2SH(
        {
            address: a.address,
            hash: a.hash,
            output: a.output,
            input: a.input,
            redeem: a.redeem,
            witness: a.witness,
            network: a.network,
        },
        opts,
    );

    // Return a merged object for backwards compatibility
    return Object.assign(instance.toPayment(), a);
}
