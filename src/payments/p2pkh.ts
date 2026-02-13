/**
 * Pay-to-Public-Key-Hash (P2PKH) payment class.
 *
 * P2PKH is the most common legacy Bitcoin payment type. The output script
 * contains the hash of a public key, and spending requires the full public key
 * and a valid signature.
 *
 * @packageDocumentation
 */

import * as bcrypto from '../crypto.js';
import { bitcoin as BITCOIN_NETWORK, type Network } from '../networks.js';
import { decompressPublicKey } from '../pubkey.js';
import * as bscript from '../script.js';
import { type Bytes20, isPoint, type PublicKey, type Script, type Signature } from '../types.js';
import { alloc, base58check, equals } from '../io/index.js';
import { type P2PKHPayment, type PaymentOpts, PaymentType } from './types.js';

const OPS = bscript.opcodes;

/**
 * Pay-to-Public-Key-Hash (P2PKH) payment class.
 *
 * Creates locking scripts of the form:
 * `OP_DUP OP_HASH160 {hash160(pubkey)} OP_EQUALVERIFY OP_CHECKSIG`
 *
 * Spending requires providing: `{signature} {pubkey}`
 *
 * @example
 * ```typescript
 * import { P2PKH } from '@btc-vision/bitcoin';
 *
 * // Create from public key
 * const payment = P2PKH.fromPubkey(pubkey);
 * console.log(payment.address); // Bitcoin address
 * console.log(payment.output); // scriptPubKey
 *
 * // Create from address
 * const fromAddr = P2PKH.fromAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2');
 * console.log(fromAddr.hash); // 20-byte pubkey hash
 *
 * // Create from hash
 * const fromHash = P2PKH.fromHash(hash160);
 * console.log(fromHash.address);
 * ```
 */
export class P2PKH {
    // Static public fields
    static readonly NAME = PaymentType.P2PKH;

    // Private instance fields
    readonly #network: Network;
    readonly #opts: Required<PaymentOpts>;

    // Input data (provided by user)
    #inputAddress?: string | undefined;
    #inputHash?: Uint8Array | undefined;
    #inputPubkey?: Uint8Array | undefined;
    #inputSignature?: Uint8Array | undefined;
    #inputOutput?: Uint8Array | undefined;
    #inputInput?: Uint8Array | undefined;

    // Hybrid/uncompressed key flags
    #useHybrid = false;
    #useUncompressed = false;

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
    #decodedAddress?: { version: number; hash: Uint8Array } | undefined;
    #decodedAddressComputed = false;

    // Decoded input chunks cache
    #inputChunks?: (Uint8Array | number)[] | undefined;
    #inputChunksComputed = false;

    /**
     * Creates a new P2PKH payment instance.
     *
     * @param params - Payment parameters
     * @param params.address - Base58Check encoded address
     * @param params.hash - 20-byte pubkey hash (RIPEMD160(SHA256(pubkey)))
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
            address?: string | undefined;
            hash?: Uint8Array | undefined;
            pubkey?: Uint8Array | undefined;
            signature?: Uint8Array | undefined;
            output?: Uint8Array | undefined;
            input?: Uint8Array | undefined;
            network?: Network | undefined;
            useHybrid?: boolean | undefined;
            useUncompressed?: boolean | undefined;
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
        this.#inputInput = params.input;
        this.#useHybrid = params.useHybrid ?? false;
        this.#useUncompressed = params.useUncompressed ?? false;

        // Validate if requested
        if (this.#opts.validate) {
            this.#validate();
        }
    }

    // Public getters

    /**
     * Payment type discriminant.
     */
    get name(): typeof PaymentType.P2PKH {
        return PaymentType.P2PKH;
    }

    /**
     * Network parameters.
     */
    get network(): Network {
        return this.#network;
    }

    /**
     * Base58Check encoded Bitcoin address.
     */
    get address(): string | undefined {
        if (!this.#addressComputed) {
            this.#address = this.#computeAddress();
            this.#addressComputed = true;
        }
        return this.#address;
    }

    /**
     * 20-byte pubkey hash (RIPEMD160(SHA256(pubkey))).
     */
    get hash(): Bytes20 | undefined {
        if (!this.#hashComputed) {
            this.#hash = this.#computeHash();
            this.#hashComputed = true;
        }
        return this.#hash as Bytes20 | undefined;
    }

    /**
     * The public key (33 or 65 bytes).
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
     * The scriptPubKey:
     * `OP_DUP OP_HASH160 {hash} OP_EQUALVERIFY OP_CHECKSIG`
     */
    get output(): Script | undefined {
        if (!this.#outputComputed) {
            this.#output = this.#computeOutput();
            this.#outputComputed = true;
        }
        return this.#output as Script | undefined;
    }

    /**
     * The scriptSig: `{signature} {pubkey}`
     */
    get input(): Script | undefined {
        if (!this.#inputComputed) {
            this.#input = this.#computeInput();
            this.#inputComputed = true;
        }
        return this.#input as Script | undefined;
    }

    /**
     * Witness stack (empty for P2PKH as it's not a SegWit type).
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
     * Creates a P2PKH payment from a public key.
     *
     * @param pubkey - The public key (33 or 65 bytes)
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2PKH payment instance
     *
     * @example
     * ```typescript
     * const payment = P2PKH.fromPubkey(pubkey);
     * const address = payment.address;
     * ```
     */
    static fromPubkey(pubkey: PublicKey, network?: Network): P2PKH {
        return new P2PKH({ pubkey, network });
    }

    /**
     * Creates a P2PKH payment from a Base58Check address.
     *
     * @param address - Base58Check encoded address
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2PKH payment instance
     *
     * @example
     * ```typescript
     * const payment = P2PKH.fromAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2');
     * const hash = payment.hash;
     * ```
     */
    static fromAddress(address: string, network?: Network): P2PKH {
        return new P2PKH({ address, network });
    }

    /**
     * Creates a P2PKH payment from a 20-byte pubkey hash.
     *
     * @param hash - 20-byte pubkey hash
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2PKH payment instance
     *
     * @example
     * ```typescript
     * const payment = P2PKH.fromHash(hash160);
     * const address = payment.address;
     * ```
     */
    static fromHash(hash: Bytes20, network?: Network): P2PKH {
        return new P2PKH({ hash, network });
    }

    /**
     * Creates a P2PKH payment from a scriptPubKey.
     *
     * @param output - The scriptPubKey
     * @param network - Network parameters (defaults to mainnet)
     * @returns A new P2PKH payment instance
     */
    static fromOutput(output: Uint8Array, network?: Network): P2PKH {
        return new P2PKH({ output, network });
    }

    // Private helper methods

    /**
     * Converts to a plain P2PKHPayment object for backwards compatibility.
     *
     * @returns A P2PKHPayment object
     */
    toPayment(): P2PKHPayment {
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

    // Private computation methods

    #getInputChunks(): (Uint8Array | number)[] | undefined {
        if (!this.#inputChunksComputed) {
            if (this.#inputInput) {
                this.#inputChunks = bscript.decompile(this.#inputInput) ?? undefined;
            }
            this.#inputChunksComputed = true;
        }
        return this.#inputChunks;
    }

    #computeAddress(): string | undefined {
        if (this.#inputAddress) {
            return this.#inputAddress;
        }
        const h = this.hash;
        if (!h) return undefined;

        const payload = alloc(21);
        payload[0] = this.#network.pubKeyHash;
        payload.set(h, 1);
        return base58check.encode(payload);
    }

    #computeHash(): Bytes20 | undefined {
        if (this.#inputHash) {
            return this.#inputHash as Bytes20;
        }
        if (this.#inputOutput) {
            return this.#inputOutput.subarray(3, 23) as Bytes20;
        }
        if (this.#inputAddress) {
            return this.#getDecodedAddress()?.hash as Bytes20 | undefined;
        }
        // Use the pubkey getter to derive pubkey from input if available
        const pk = this.pubkey;
        if (pk) {
            return bcrypto.hash160(pk);
        }
        return undefined;
    }

    #computePubkey(): PublicKey | undefined {
        if (this.#inputPubkey) {
            return this.#inputPubkey as PublicKey;
        }
        if (this.#inputInput) {
            const chunks = this.#getInputChunks();
            if (chunks && chunks.length >= 2) {
                return chunks[1] as PublicKey;
            }
        }
        return undefined;
    }

    #computeSignature(): Signature | undefined {
        if (this.#inputSignature) {
            return this.#inputSignature as Signature;
        }
        if (this.#inputInput) {
            const chunks = this.#getInputChunks();
            if (chunks && chunks.length >= 1) {
                return chunks[0] as Signature;
            }
        }
        return undefined;
    }

    #computeOutput(): Script | undefined {
        if (this.#inputOutput) {
            return this.#inputOutput as Script;
        }
        const h = this.hash;
        if (!h) return undefined;

        return bscript.compile([
            OPS.OP_DUP,
            OPS.OP_HASH160,
            h,
            OPS.OP_EQUALVERIFY,
            OPS.OP_CHECKSIG,
        ]);
    }

    #computeInput(): Script | undefined {
        if (this.#inputInput) {
            return this.#inputInput as Script;
        }
        if (!this.#inputPubkey || !this.#inputSignature) {
            return undefined;
        }

        let pubKey: Uint8Array = this.#inputPubkey;
        if (this.#useHybrid || this.#useUncompressed) {
            const decompressed = decompressPublicKey(this.#inputPubkey as PublicKey);
            if (decompressed) {
                if (this.#useUncompressed) {
                    pubKey = decompressed.uncompressed;
                } else {
                    pubKey = decompressed.hybrid;
                }
            }
        }

        return bscript.compile([this.#inputSignature, pubKey]);
    }

    // Validation

    #computeWitness(): Uint8Array[] | undefined {
        if (this.input) {
            return [];
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
            if (addr.version !== this.#network.pubKeyHash) {
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
                this.#inputOutput.length !== 25 ||
                this.#inputOutput[0] !== OPS.OP_DUP ||
                this.#inputOutput[1] !== OPS.OP_HASH160 ||
                this.#inputOutput[2] !== 0x14 ||
                this.#inputOutput[23] !== OPS.OP_EQUALVERIFY ||
                this.#inputOutput[24] !== OPS.OP_CHECKSIG
            ) {
                throw new TypeError('Output is invalid');
            }

            const hash2 = this.#inputOutput.subarray(3, 23);
            if (hash.length > 0 && !equals(hash, hash2)) {
                throw new TypeError('Hash mismatch');
            } else {
                hash = hash2;
            }
        }

        if (this.#inputPubkey) {
            const pkh = bcrypto.hash160(this.#inputPubkey);

            let badHash = hash.length > 0 && !equals(hash, pkh);
            if (badHash) {
                if (
                    (this.#inputPubkey.length === 33 &&
                        (this.#inputPubkey[0] === 0x02 || this.#inputPubkey[0] === 0x03)) ||
                    (this.#inputPubkey.length === 65 && this.#inputPubkey[0] === 0x04)
                ) {
                    const uncompressed = decompressPublicKey(this.#inputPubkey as PublicKey);
                    if (uncompressed) {
                        const pkh2 = bcrypto.hash160(uncompressed.uncompressed);

                        if (!equals(hash, pkh2)) {
                            const pkh3 = bcrypto.hash160(uncompressed.hybrid);
                            badHash = !equals(hash, pkh3);

                            if (!badHash) {
                                this.#useHybrid = true;
                            }
                        } else {
                            badHash = false;
                            this.#useUncompressed = true;
                        }
                    }
                }
            }

            if (badHash) {
                throw new TypeError('Hash mismatch');
            } else {
                hash = pkh;
            }
        }

        if (this.#inputInput) {
            const chunks = this.#getInputChunks();
            if (!chunks || chunks.length !== 2) {
                throw new TypeError('Input is invalid');
            }
            if (!bscript.isCanonicalScriptSignature(chunks[0] as Uint8Array)) {
                throw new TypeError('Input has invalid signature');
            }
            if (!isPoint(chunks[1])) {
                throw new TypeError('Input has invalid pubkey');
            }

            if (this.#inputSignature && !equals(this.#inputSignature, chunks[0] as Uint8Array)) {
                throw new TypeError('Signature mismatch');
            }
            if (this.#inputPubkey && !equals(this.#inputPubkey, chunks[1] as Uint8Array)) {
                throw new TypeError('Pubkey mismatch');
            }

            const pkh = bcrypto.hash160(chunks[1] as Uint8Array);
            if (hash.length > 0 && !equals(hash, pkh)) {
                throw new TypeError('Hash mismatch (input)');
            }
        }
    }
}

/**
 * Creates a Pay-to-Public-Key-Hash (P2PKH) payment object.
 *
 * This is the legacy factory function for backwards compatibility.
 * For new code, prefer using the P2PKH class directly.
 *
 * @param a - The payment object containing the necessary data
 * @param opts - Optional payment options
 * @returns The P2PKH payment object
 * @throws {TypeError} If the required data is not provided or if the data is invalid
 *
 * @example
 * ```typescript
 * import { p2pkh } from '@btc-vision/bitcoin';
 *
 * // Create from public key
 * const payment = p2pkh({ pubkey });
 *
 * // Create from address
 * const fromAddr = p2pkh({ address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2' });
 * ```
 */
export function p2pkh(a: Omit<P2PKHPayment, 'name'>, opts?: PaymentOpts): P2PKHPayment {
    if (!a.address && !a.hash && !a.output && !a.pubkey && !a.input) {
        throw new TypeError('Not enough data');
    }

    const instance = new P2PKH(
        {
            address: a.address,
            hash: a.hash,
            pubkey: a.pubkey,
            signature: a.signature,
            output: a.output,
            input: a.input,
            network: a.network,
            useHybrid: a.useHybrid,
            useUncompressed: a.useUncompressed,
        },
        opts,
    );

    // Return a merged object for backwards compatibility
    return Object.assign(instance.toPayment(), a);
}
