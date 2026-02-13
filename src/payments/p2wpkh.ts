/**
 * Pay-to-Witness-Public-Key-Hash (P2WPKH) payment class.
 *
 * P2WPKH is the native SegWit version of P2PKH. The witness program is
 * a 20-byte pubkey hash, and spending requires the signature and public key
 * in the witness stack (not the scriptSig).
 *
 * @packageDocumentation
 */

import { bech32 } from 'bech32';
import * as bcrypto from '../crypto.js';
import { bitcoin as BITCOIN_NETWORK, type Network } from '../networks.js';
import * as bscript from '../script.js';
import type { Bytes20, PublicKey, Script, Signature } from '../types.js';
import { isPoint } from '../types.js';
import { equals } from '../io/index.js';
import { type P2WPKHPayment, type PaymentOpts, PaymentType } from './types.js';

const OPS = bscript.opcodes;
const EMPTY_BUFFER = new Uint8Array(0);

/**
 * Pay-to-Witness-Public-Key-Hash (P2WPKH) payment class.
 *
 * Creates locking scripts of the form: `OP_0 {hash160(pubkey)}`
 * Spending witness: `[{signature}, {pubkey}]`
 *
 * @example
 * ```typescript
 * import { P2WPKH } from '@btc-vision/bitcoin';
 *
 * // Create from public key
 * const payment = P2WPKH.fromPubkey(pubkey);
 * console.log(payment.address); // bc1q... bech32 address
 * console.log(payment.output); // scriptPubKey
 *
 * // Create from bech32 address
 * const fromAddr = P2WPKH.fromAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
 * console.log(fromAddr.hash); // 20-byte witness program
 * ```
 */
export class P2WPKH {
    // Static public fields
    static readonly NAME = PaymentType.P2WPKH;

    // Private instance fields
    readonly #network: Network;
    readonly #opts: Required<PaymentOpts>;

    // Input data (provided by user)
    #inputAddress?: string | undefined;
    #inputHash?: Uint8Array | undefined;
    #inputPubkey?: Uint8Array | undefined;
    #inputSignature?: Uint8Array | undefined;
    #inputOutput?: Uint8Array | undefined;
    #inputWitness?: Uint8Array[] | undefined;

    // Cached computed values
    #address?: string | undefined;
    #hash?: Uint8Array | undefined;
    #pubkey?: Uint8Array | undefined;
    #signature?: Uint8Array | undefined;
    #output?: Uint8Array | undefined;
    #input?: Uint8Array | undefined;
    #witness?: Uint8Array[] | undefined;

    // Cache flags
    #addressComputed = false;
    #hashComputed = false;
    #pubkeyComputed = false;
    #signatureComputed = false;
    #outputComputed = false;
    #inputComputed = false;
    #witnessComputed = false;

    // Decoded address cache
    #decodedAddress?: { version: number; prefix: string; data: Uint8Array } | undefined;
    #decodedAddressComputed = false;

    /**
     * Creates a new P2WPKH payment instance.
     *
     * @param params - Payment parameters
     * @param params.address - Bech32 encoded address
     * @param params.hash - 20-byte witness program (pubkey hash)
     * @param params.pubkey - The public key (must be 33 bytes compressed)
     * @param params.signature - DER-encoded signature
     * @param params.output - The scriptPubKey
     * @param params.witness - The witness stack [signature, pubkey]
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
            pubkey?: Uint8Array | undefined;
            signature?: Uint8Array | undefined;
            output?: Uint8Array | undefined;
            witness?: Uint8Array[] | undefined;
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
        this.#inputAddress = params.address;
        this.#inputHash = params.hash;
        this.#inputPubkey = params.pubkey;
        this.#inputSignature = params.signature;
        this.#inputOutput = params.output;
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
    get name(): typeof PaymentType.P2WPKH {
        return PaymentType.P2WPKH;
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
     * 20-byte witness program (RIPEMD160(SHA256(pubkey))).
     */
    get hash(): Bytes20 | undefined {
        if (!this.#hashComputed) {
            this.#hash = this.#computeHash();
            this.#hashComputed = true;
        }
        return this.#hash as Bytes20 | undefined;
    }

    /**
     * The public key (33 bytes compressed).
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
     */
    get signature(): Signature | undefined {
        if (!this.#signatureComputed) {
            this.#signature = this.#computeSignature();
            this.#signatureComputed = true;
        }
        return this.#signature as Signature | undefined;
    }

    /**
     * The scriptPubKey: `OP_0 {20-byte hash}`
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
     * Witness stack: `[signature, pubkey]`
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
     * Creates a P2WPKH payment from a compressed public key.
     *
     * @param pubkey - The public key (must be 33 bytes compressed)
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2WPKH payment instance
     *
     * @example
     * ```typescript
     * const payment = P2WPKH.fromPubkey(pubkey);
     * const address = payment.address; // bc1q...
     * ```
     */
    static fromPubkey(pubkey: PublicKey, network?: Network): P2WPKH {
        return new P2WPKH({ pubkey, network });
    }

    /**
     * Creates a P2WPKH payment from a bech32 address.
     *
     * @param address - Bech32 encoded address
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2WPKH payment instance
     *
     * @example
     * ```typescript
     * const payment = P2WPKH.fromAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
     * const hash = payment.hash;
     * ```
     */
    static fromAddress(address: string, network?: Network): P2WPKH {
        return new P2WPKH({ address, network });
    }

    /**
     * Creates a P2WPKH payment from a 20-byte witness program.
     *
     * @param hash - 20-byte witness program (pubkey hash)
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2WPKH payment instance
     */
    static fromHash(hash: Bytes20, network?: Network): P2WPKH {
        return new P2WPKH({ hash, network });
    }

    /**
     * Creates a P2WPKH payment from a scriptPubKey.
     *
     * @param output - The scriptPubKey
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2WPKH payment instance
     */
    static fromOutput(output: Uint8Array, network?: Network): P2WPKH {
        return new P2WPKH({ output, network });
    }

    // Private helper methods

    /**
     * Converts to a plain P2WPKHPayment object for backwards compatibility.
     *
     * @returns A P2WPKHPayment object
     */
    toPayment(): P2WPKHPayment {
        return {
            name: this.name,
            network: this.network,
            address: this.address,
            hash: this.hash,
            pubkey: this.pubkey,
            signature: this.signature,
            output: this.output,
            input: this.input,
            witness: this.witness,
        };
    }

    // Private computation methods

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
            return this.#inputOutput.subarray(2, 22) as Bytes20;
        }
        if (this.#inputAddress) {
            return this.#getDecodedAddress()?.data as Bytes20 | undefined;
        }
        const pk = this.#inputPubkey ?? this.pubkey;
        if (pk) {
            return bcrypto.hash160(pk);
        }
        return undefined;
    }

    #computePubkey(): Uint8Array | undefined {
        if (this.#inputPubkey) {
            return this.#inputPubkey;
        }
        if (this.#inputWitness && this.#inputWitness.length >= 2) {
            return this.#inputWitness[1] as PublicKey;
        }
        return undefined;
    }

    #computeSignature(): Uint8Array | undefined {
        if (this.#inputSignature) {
            return this.#inputSignature;
        }
        if (this.#inputWitness && this.#inputWitness.length >= 1) {
            return this.#inputWitness[0] as Signature;
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

    // Validation

    #computeWitness(): Uint8Array[] | undefined {
        if (this.#inputWitness) {
            return this.#inputWitness;
        }
        if (!this.#inputPubkey || !this.#inputSignature) {
            return undefined;
        }
        return [this.#inputSignature, this.#inputPubkey];
    }

    #validate(): void {
        let hash: Uint8Array = new Uint8Array(0);

        if (this.#inputAddress) {
            const addr = this.#getDecodedAddress();
            if (!addr) {
                throw new TypeError('Invalid address');
            }
            if (this.#network && this.#network.bech32 !== addr.prefix) {
                throw new TypeError('Invalid prefix or Network mismatch');
            }
            if (addr.version !== 0x00) {
                throw new TypeError('Invalid address version');
            }
            if (addr.data.length !== 20) {
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
                this.#inputOutput.length !== 22 ||
                this.#inputOutput[0] !== OPS.OP_0 ||
                this.#inputOutput[1] !== 0x14
            ) {
                throw new TypeError('Output is invalid');
            }
            if (hash.length > 0 && !equals(hash, this.#inputOutput.subarray(2))) {
                throw new TypeError('Hash mismatch');
            } else {
                hash = this.#inputOutput.subarray(2);
            }
        }

        if (this.#inputPubkey) {
            const pkh = bcrypto.hash160(this.#inputPubkey);
            if (hash.length > 0 && !equals(hash, pkh)) {
                throw new TypeError('Hash mismatch');
            } else {
                hash = pkh;
            }
            if (!isPoint(this.#inputPubkey) || this.#inputPubkey.length !== 33) {
                throw new TypeError('Invalid pubkey for p2wpkh');
            }
        }

        if (this.#inputWitness) {
            if (this.#inputWitness.length !== 2) {
                throw new TypeError('Witness is invalid');
            }
            const witnessSig = this.#inputWitness[0] as Uint8Array;
            const witnessPubkey = this.#inputWitness[1] as Uint8Array;
            if (!bscript.isCanonicalScriptSignature(witnessSig)) {
                throw new TypeError('Witness has invalid signature');
            }
            if (!isPoint(witnessPubkey) || witnessPubkey.length !== 33) {
                throw new TypeError('Witness has invalid pubkey');
            }

            if (this.#inputSignature && !equals(this.#inputSignature, witnessSig)) {
                throw new TypeError('Signature mismatch');
            }
            if (this.#inputPubkey && !equals(this.#inputPubkey, witnessPubkey)) {
                throw new TypeError('Pubkey mismatch');
            }

            const pkh = bcrypto.hash160(witnessPubkey);
            if (hash.length > 0 && !equals(hash, pkh)) {
                throw new TypeError('Hash mismatch');
            }
        }
    }
}

/**
 * Creates a Pay-to-Witness-Public-Key-Hash (P2WPKH) payment object.
 *
 * This is the legacy factory function for backwards compatibility.
 * For new code, prefer using the P2WPKH class directly.
 *
 * @param a - The payment object containing the necessary data
 * @param opts - Optional payment options
 * @returns The P2WPKH payment object
 * @throws {TypeError} If the required data is not provided or if the data is invalid
 *
 * @example
 * ```typescript
 * import { p2wpkh } from '@btc-vision/bitcoin';
 *
 * // Create from public key
 * const payment = p2wpkh({ pubkey });
 *
 * // Create from address
 * const fromAddr = p2wpkh({ address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' });
 * ```
 */
export function p2wpkh(a: Omit<P2WPKHPayment, 'name'>, opts?: PaymentOpts): P2WPKHPayment {
    if (!a.address && !a.hash && !a.output && !a.pubkey && !a.witness) {
        throw new TypeError('Not enough data');
    }

    const instance = new P2WPKH(
        {
            address: a.address,
            hash: a.hash,
            pubkey: a.pubkey,
            signature: a.signature,
            output: a.output,
            witness: a.witness,
            network: a.network,
        },
        opts,
    );

    // Return a merged object for backwards compatibility
    return Object.assign(instance.toPayment(), a);
}
