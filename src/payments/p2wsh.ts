/**
 * Pay-to-Witness-Script-Hash (P2WSH) payment class.
 *
 * P2WSH is the native SegWit version of P2SH. The witness program is
 * a 32-byte SHA256 hash of the script, and spending requires the witness
 * stack with the script and its inputs.
 *
 * @packageDocumentation
 */

import { bech32 } from 'bech32';
import * as bcrypto from '../crypto.js';
import { bitcoin as BITCOIN_NETWORK, type Network } from '../networks.js';
import * as bscript from '../script.js';
import type { Bytes32, Script } from '../types.js';
import { isPoint, type StackElement, stacksEqual } from '../types.js';
import { equals } from '../io/index.js';
import { type P2WSHPayment, type PaymentOpts, PaymentType, type ScriptRedeem } from './types.js';

const OPS = bscript.opcodes;
const EMPTY_BUFFER = new Uint8Array(0);

/**
 * Checks if a stack element is an uncompressed public key.
 */
function chunkHasUncompressedPubkey(chunk: StackElement): boolean {
    if (chunk instanceof Uint8Array && chunk.length === 65 && chunk[0] === 0x04 && isPoint(chunk)) {
        return true;
    }
    return false;
}

/**
 * Pay-to-Witness-Script-Hash (P2WSH) payment class.
 *
 * Creates locking scripts of the form: `OP_0 {sha256(redeemScript)}`
 * Spending witness: `[{redeemScriptSig...}, {redeemScript}]`
 *
 * @example
 * ```typescript
 * import { P2WSH, P2MS } from '@btc-vision/bitcoin';
 *
 * // Wrap a multisig in P2WSH
 * const multisig = P2MS.fromPubkeys(2, [pubkey1, pubkey2, pubkey3]);
 * const p2wsh = P2WSH.fromRedeem({ output: multisig.output });
 * console.log(p2wsh.address); // bc1q... bech32 address
 *
 * // Decode an existing output
 * const decoded = P2WSH.fromOutput(scriptPubKey);
 * console.log(decoded.hash); // 32-byte witness program
 * ```
 */
export class P2WSH {
    // Static public fields
    static readonly NAME = PaymentType.P2WSH;

    // Private instance fields
    readonly #network: Network;
    readonly #opts: Required<PaymentOpts>;

    // Input data (provided by user)
    #inputAddress?: string | undefined;
    #inputHash?: Uint8Array | undefined;
    #inputOutput?: Uint8Array | undefined;
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
    #decodedAddress?: { version: number; prefix: string; data: Uint8Array } | undefined;
    #decodedAddressComputed = false;

    // Decoded redeem chunks cache
    #redeemChunks?: (Uint8Array | number)[] | undefined;
    #redeemChunksComputed = false;

    /**
     * Creates a new P2WSH payment instance.
     *
     * @param params - Payment parameters
     * @param params.address - Bech32 encoded address
     * @param params.hash - 32-byte witness program (SHA256 of script)
     * @param params.output - The scriptPubKey
     * @param params.redeem - The redeem script information
     * @param params.witness - The witness stack
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
            return `p2wsh-${r.name}`;
        }
        return PaymentType.P2WSH;
    }

    /**
     * Network parameters.
     */
    get network(): Network {
        return this.#network;
    }

    /**
     * Bech32 encoded address (bc1q... for mainnet).
     */
    get address(): string | undefined {
        if (!this.#addressComputed) {
            this.#address = this.#computeAddress();
            this.#addressComputed = true;
        }
        return this.#address;
    }

    /**
     * 32-byte witness program (SHA256 of redeem script).
     */
    get hash(): Bytes32 | undefined {
        if (!this.#hashComputed) {
            this.#hash = this.#computeHash();
            this.#hashComputed = true;
        }
        return this.#hash as Bytes32 | undefined;
    }

    /**
     * The scriptPubKey: `OP_0 {32-byte hash}`
     */
    get output(): Script | undefined {
        if (!this.#outputComputed) {
            this.#output = this.#computeOutput();
            this.#outputComputed = true;
        }
        return this.#output as Script | undefined;
    }

    /**
     * The scriptSig (always empty for native SegWit).
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
     * Witness stack: `[{scriptSig...}, {redeemScript}]`
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
     * Creates a P2WSH payment from a redeem script.
     *
     * @param redeem - The redeem script information
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2WSH payment instance
     *
     * @example
     * ```typescript
     * const p2wsh = P2WSH.fromRedeem({ output: redeemScript });
     * ```
     */
    static fromRedeem(redeem: ScriptRedeem, network?: Network): P2WSH {
        return new P2WSH({ redeem, network });
    }

    /**
     * Creates a P2WSH payment from a bech32 address.
     *
     * @param address - Bech32 encoded address
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2WSH payment instance
     */
    static fromAddress(address: string, network?: Network): P2WSH {
        return new P2WSH({ address, network });
    }

    /**
     * Creates a P2WSH payment from a 32-byte witness program.
     *
     * @param hash - 32-byte witness program (SHA256 of script)
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2WSH payment instance
     */
    static fromHash(hash: Bytes32, network?: Network): P2WSH {
        return new P2WSH({ hash, network });
    }

    /**
     * Creates a P2WSH payment from a scriptPubKey.
     *
     * @param output - The scriptPubKey
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2WSH payment instance
     */
    static fromOutput(output: Uint8Array, network?: Network): P2WSH {
        return new P2WSH({ output, network });
    }

    // Private helper methods

    /**
     * Converts to a plain P2WSHPayment object for backwards compatibility.
     *
     * @returns A P2WSHPayment object
     */
    toPayment(): P2WSHPayment {
        // Access witness first as it may modify redeem (transform input to witness)
        const witness = this.witness;
        const redeem = this.redeem;
        return {
            name: this.name,
            network: this.network,
            address: this.address,
            hash: this.hash,
            output: this.output,
            input: this.input,
            redeem,
            witness,
        };
    }

    #getDecodedAddress(): { version: number; prefix: string; data: Uint8Array } | undefined {
        if (!this.#decodedAddressComputed) {
            if (this.#inputAddress) {
                const result = bech32.decode(this.#inputAddress);
                const version = result.words.shift();
                const data = bech32.fromWords(result.words);
                this.#decodedAddress = {
                    version: version ?? 0,
                    prefix: result.prefix,
                    data: new Uint8Array(data),
                };
            }
            this.#decodedAddressComputed = true;
        }
        return this.#decodedAddress;
    }

    // Private computation methods

    #getRedeemChunks(): (Uint8Array | number)[] | undefined {
        if (!this.#redeemChunksComputed) {
            if (this.#inputRedeem?.input) {
                this.#redeemChunks = bscript.decompile(this.#inputRedeem.input) ?? undefined;
            }
            this.#redeemChunksComputed = true;
        }
        return this.#redeemChunks;
    }

    #computeAddress(): string | undefined {
        if (this.#inputAddress) {
            return this.#inputAddress;
        }
        const h = this.hash;
        if (!h) return undefined;

        const words = bech32.toWords(h);
        words.unshift(0x00);
        return bech32.encode(this.#network.bech32, words);
    }

    #computeHash(): Uint8Array | undefined {
        if (this.#inputHash) {
            return this.#inputHash;
        }
        if (this.#inputOutput) {
            return this.#inputOutput.subarray(2) as Bytes32;
        }
        if (this.#inputAddress) {
            return this.#getDecodedAddress()?.data as Bytes32 | undefined;
        }
        const r = this.redeem;
        if (r && r.output) {
            return bcrypto.sha256(r.output);
        }
        return undefined;
    }

    #computeOutput(): Uint8Array | undefined {
        if (this.#inputOutput) {
            return this.#inputOutput;
        }
        const h = this.hash;
        if (!h) return undefined;

        return bscript.compile([OPS.OP_0, h]);
    }

    #computeInput(): Uint8Array | undefined {
        if (this.witness) {
            return EMPTY_BUFFER as Script;
        }
        return undefined;
    }

    #computeRedeem(): ScriptRedeem | undefined {
        if (this.#inputRedeem) {
            return this.#inputRedeem;
        }
        if (this.#inputWitness && this.#inputWitness.length > 0) {
            return {
                output: this.#inputWitness[this.#inputWitness.length - 1] as Script,
                input: EMPTY_BUFFER as Script,
                witness: this.#inputWitness.slice(0, -1),
            };
        }
        return undefined;
    }

    // Validation

    #computeWitness(): Uint8Array[] | undefined {
        if (this.#inputWitness) {
            return this.#inputWitness;
        }

        const r = this.#inputRedeem;
        if (r) {
            // Transform redeem input to witness stack
            if (r.input && r.input.length > 0 && r.output && r.output.length > 0) {
                const chunks = this.#getRedeemChunks();
                if (chunks) {
                    const stack = bscript.toStack(chunks);
                    // Assign, and blank the existing input
                    this.#redeem = Object.assign({ witness: stack }, r, { input: EMPTY_BUFFER });
                    this.#redeemComputed = true;
                    return ([] as Uint8Array[]).concat(stack, r.output);
                }
            }

            if (!r.output) return undefined;
            if (!r.witness) return undefined;
            return ([] as Uint8Array[]).concat(r.witness, r.output);
        }

        return undefined;
    }

    #validate(): void {
        let hash: Uint8Array = new Uint8Array(0);

        if (this.#inputAddress) {
            const addr = this.#getDecodedAddress();
            if (!addr) {
                throw new TypeError('Invalid address');
            }
            if (addr.prefix !== this.#network.bech32) {
                throw new TypeError('Invalid prefix or Network mismatch');
            }
            if (addr.version !== 0x00) {
                throw new TypeError('Invalid address version');
            }
            if (addr.data.length !== 32) {
                throw new TypeError('Invalid address data');
            }
            hash = addr.data;
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
                this.#inputOutput.length !== 34 ||
                this.#inputOutput[0] !== OPS.OP_0 ||
                this.#inputOutput[1] !== 0x20
            ) {
                throw new TypeError('Output is invalid');
            }
            const hash2 = this.#inputOutput.subarray(2);
            if (hash.length > 0 && !equals(hash, hash2)) {
                throw new TypeError('Hash mismatch');
            } else {
                hash = hash2;
            }
        }

        if (this.#inputRedeem) {
            if (this.#inputRedeem.network && this.#inputRedeem.network !== this.#network) {
                throw new TypeError('Network mismatch');
            }

            // Is there two redeem sources?
            if (
                this.#inputRedeem.input &&
                this.#inputRedeem.input.length > 0 &&
                this.#inputRedeem.witness &&
                this.#inputRedeem.witness.length > 0
            ) {
                throw new TypeError('Ambiguous witness source');
            }

            // Is the redeem output non-empty/valid?
            if (this.#inputRedeem.output) {
                const decompile = bscript.decompile(this.#inputRedeem.output);
                if (!decompile || decompile.length < 1) {
                    throw new TypeError('Redeem.output is invalid');
                }
                if (this.#inputRedeem.output.byteLength > 3600) {
                    throw new TypeError('Redeem.output unspendable if larger than 3600 bytes');
                }
                if (bscript.countNonPushOnlyOPs(decompile) > 201) {
                    throw new TypeError(
                        'Redeem.output unspendable with more than 201 non-push ops',
                    );
                }

                // Match hash against other sources
                const hash2 = bcrypto.sha256(this.#inputRedeem.output);
                if (hash.length > 0 && !equals(hash, hash2)) {
                    throw new TypeError('Hash mismatch');
                } else {
                    hash = hash2;
                }
            }

            const chunks = this.#getRedeemChunks();
            if (this.#inputRedeem.input && chunks && !bscript.isPushOnly(chunks)) {
                throw new TypeError('Non push-only scriptSig');
            }
            if (
                this.#inputWitness &&
                this.#inputRedeem.witness &&
                !stacksEqual(this.#inputWitness, this.#inputRedeem.witness)
            ) {
                throw new TypeError('Witness and redeem.witness mismatch');
            }
            if (
                (this.#inputRedeem.input && chunks?.some(chunkHasUncompressedPubkey)) ||
                (this.#inputRedeem.output &&
                    (bscript.decompile(this.#inputRedeem.output) || []).some(
                        chunkHasUncompressedPubkey,
                    ))
            ) {
                throw new TypeError('redeem.input or redeem.output contains uncompressed pubkey');
            }
        }

        if (this.#inputWitness && this.#inputWitness.length > 0) {
            const wScript = this.#inputWitness[this.#inputWitness.length - 1] as Uint8Array;
            if (
                this.#inputRedeem &&
                this.#inputRedeem.output &&
                !equals(this.#inputRedeem.output, wScript)
            ) {
                throw new TypeError('Witness and redeem.output mismatch');
            }
            if (
                this.#inputWitness.some(chunkHasUncompressedPubkey) ||
                (bscript.decompile(wScript) || []).some(chunkHasUncompressedPubkey)
            ) {
                throw new TypeError('Witness contains uncompressed pubkey');
            }
        }
    }
}

/**
 * Creates a Pay-to-Witness-Script-Hash (P2WSH) payment object.
 *
 * This is the legacy factory function for backwards compatibility.
 * For new code, prefer using the P2WSH class directly.
 *
 * @param a - The payment object containing the necessary data
 * @param opts - Optional payment options
 * @returns The P2WSH payment object
 * @throws {TypeError} If the required data is not provided or if the data is invalid
 *
 * @example
 * ```typescript
 * import { p2wsh, p2ms } from '@btc-vision/bitcoin';
 *
 * // Wrap a multisig in P2WSH
 * const multisig = p2ms({ m: 2, pubkeys: [pk1, pk2, pk3] });
 * const payment = p2wsh({ redeem: multisig });
 * ```
 */
export function p2wsh(a: Omit<P2WSHPayment, 'name'>, opts?: PaymentOpts): P2WSHPayment {
    if (!a.address && !a.hash && !a.output && !a.redeem && !a.witness) {
        throw new TypeError('Not enough data');
    }

    const instance = new P2WSH(
        {
            address: a.address,
            hash: a.hash,
            output: a.output,
            redeem: a.redeem,
            witness: a.witness,
            network: a.network,
        },
        opts,
    );

    // Return the computed payment
    // Note: We don't use Object.assign(toPayment(), a) because that would
    // overwrite computed properties (like modified redeem) with original values
    return instance.toPayment();
}
