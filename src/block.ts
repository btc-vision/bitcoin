import * as bcrypto from './crypto.js';
import {
    alloc,
    BinaryReader,
    BinaryWriter,
    compare,
    equals,
    fromHex,
    reverse,
    toHex,
    varuint,
} from './io/index.js';
import { fastMerkleRoot } from './merkle.js';
import { Transaction } from './transaction.js';
import type { Bytes32 } from './types.js';

const errorMerkleNoTxes = new TypeError('Cannot compute merkle root for zero transactions');
const errorWitnessNotSegwit = new TypeError('Cannot compute witness commit for non-segwit block');

const WITNESS_COMMIT_PREFIX = fromHex('6a24aa21a9ed');

/**
 * Represents a Bitcoin block with header fields and optional transactions.
 *
 * @example
 * ```typescript
 * import { Block, fromHex } from '@btc-vision/bitcoin';
 *
 * // Parse a block from hex
 * const block = Block.fromHex('0100000000000000...');
 *
 * // Access block properties
 * console.log(block.version);
 * console.log(block.getId());
 * console.log(block.timestamp);
 *
 * // Check proof of work
 * if (block.checkProofOfWork()) {
 *     console.log('Valid PoW');
 * }
 * ```
 */
export class Block {
    /** Block version number */
    version: number = 1;
    /** Hash of the previous block (32 bytes) */
    prevHash?: Bytes32 = undefined;
    /** Merkle root of the transactions (32 bytes) */
    merkleRoot?: Bytes32 = undefined;
    /** Block timestamp (Unix time) */
    timestamp: number = 0;
    /** Witness commitment for SegWit blocks (32 bytes) */
    witnessCommit?: Bytes32 = undefined;
    /** Compact representation of the target threshold */
    bits: number = 0;
    /** Nonce used for proof of work */
    nonce: number = 0;
    /** Array of transactions included in the block */
    transactions?: Transaction[] = undefined;

    /**
     * Parses a Block from a Uint8Array.
     * @param buffer - The raw block data (minimum 80 bytes for header only)
     * @returns Parsed Block instance
     * @throws Error if buffer is too small
     */
    static fromBuffer(buffer: Uint8Array): Block {
        if (buffer.length < 80) throw new Error('Buffer too small (< 80 bytes)');

        const reader = new BinaryReader(buffer);

        const block = new Block();
        block.version = reader.readInt32LE();
        block.prevHash = reader.readBytes(32) as Bytes32;
        block.merkleRoot = reader.readBytes(32) as Bytes32;
        block.timestamp = reader.readUInt32LE();
        block.bits = reader.readUInt32LE();
        block.nonce = reader.readUInt32LE();

        if (buffer.length === 80) return block;

        const readTransaction = (): Transaction => {
            const tx = Transaction.fromBuffer(reader.data.subarray(reader.offset), true);
            reader.offset += tx.byteLength();
            return tx;
        };

        const nTransactions = reader.readVarInt();
        block.transactions = [];

        for (let i = 0; i < nTransactions; ++i) {
            const tx = readTransaction();
            block.transactions.push(tx);
        }

        const witnessCommit = block.getWitnessCommit();
        // This Block contains a witness commit
        if (witnessCommit) block.witnessCommit = witnessCommit;

        return block;
    }

    /**
     * Parses a Block from a hex string.
     * @param hex - Hexadecimal representation of the block
     * @returns Parsed Block instance
     */
    static fromHex(hex: string): Block {
        return Block.fromBuffer(fromHex(hex));
    }

    /**
     * Calculates the target threshold from the compact bits representation.
     * @param bits - Compact bits value from block header
     * @returns 32-byte target threshold
     */
    static calculateTarget(bits: number): Bytes32 {
        const exponent = ((bits & 0xff000000) >> 24) - 3;
        const mantissa = bits & 0x007fffff;
        const target = alloc(32);
        // Write mantissa as big-endian at the computed offset
        const offset = 29 - exponent;
        target[offset] = (mantissa >> 16) & 0xff;
        target[offset + 1] = (mantissa >> 8) & 0xff;
        target[offset + 2] = mantissa & 0xff;
        return target as Bytes32;
    }

    /**
     * Calculates the merkle root for a list of transactions.
     * @param transactions - Array of transactions
     * @param forWitness - If true, calculate witness merkle root (for SegWit)
     * @returns 32-byte merkle root hash
     * @throws TypeError if transactions is empty or not an array
     */
    static calculateMerkleRoot(transactions: Transaction[], forWitness?: boolean): Bytes32 {
        if (!Array.isArray(transactions)) {
            throw new TypeError('Expected an array of transactions');
        }
        if (transactions.length === 0) throw errorMerkleNoTxes;
        if (forWitness && !txesHaveWitnessCommit(transactions)) throw errorWitnessNotSegwit;

        const hashes = transactions.map((transaction) => transaction.getHash(forWitness));

        const rootHash = fastMerkleRoot(hashes, bcrypto.hash256);

        if (forWitness) {
            const coinbase = transactions[0];
            const firstInput = coinbase?.ins[0];
            const witness = firstInput?.witness[0];
            if (!witness) throw new TypeError('Missing witness in coinbase');
            const combined = new Uint8Array(rootHash.length + witness.length);
            combined.set(rootHash);
            combined.set(witness, rootHash.length);
            return bcrypto.hash256(combined);
        }
        return rootHash as Bytes32;
    }

    /**
     * Extracts the witness commitment from the coinbase transaction.
     * @returns 32-byte witness commitment or null if not found
     */
    getWitnessCommit(): Bytes32 | null {
        if (!this.transactions || !txesHaveWitnessCommit(this.transactions)) return null;

        // The merkle root for the witness data is in an OP_RETURN output.
        // There is no rule for the index of the output, so use filter to find it.
        // The root is prepended with 0xaa21a9ed so check for 0x6a24aa21a9ed
        // If multiple commits are found, the output with highest index is assumed.
        const coinbase = this.transactions[0];
        if (!coinbase) return null;
        const witnessCommits = coinbase.outs.filter((out) =>
            equals(out.script.subarray(0, 6), WITNESS_COMMIT_PREFIX),
        ).map((out) => out.script.subarray(6, 38));
        if (witnessCommits.length === 0) return null;
        // Use the commit with the highest output (should only be one though)
        const result = witnessCommits[witnessCommits.length - 1];

        if (!(result instanceof Uint8Array && result.length === 32)) return null;
        return result as Bytes32;
    }

    /**
     * Checks if this block has a witness commitment.
     * @returns True if the block has a witness commitment
     */
    hasWitnessCommit(): boolean {
        if (this.witnessCommit instanceof Uint8Array && this.witnessCommit.length === 32)
            return true;
        if (this.getWitnessCommit() !== null) return true;
        return false;
    }

    /**
     * Checks if any transaction in this block has witness data.
     * @returns True if any transaction has witness data
     */
    hasWitness(): boolean {
        return this.transactions ? anyTxHasWitness(this.transactions) : false;
    }

    /**
     * Calculates the weight of this block.
     * Weight = (base size * 3) + total size
     * @returns Block weight in weight units
     */
    weight(): number {
        const base = this.byteLength(false, false);
        const total = this.byteLength(false, true);
        return base * 3 + total;
    }

    /**
     * Calculates the serialized byte length of this block.
     * @param headersOnly - If true, return only header size (80 bytes)
     * @param allowWitness - If true, include witness data in calculation
     * @returns Byte length of the serialized block
     */
    byteLength(headersOnly?: boolean, allowWitness: boolean = true): number {
        if (headersOnly || !this.transactions) return 80;

        return (
            80 +
            varuint.encodingLength(this.transactions.length) +
            this.transactions.reduce((a, x) => a + x.byteLength(allowWitness), 0)
        );
    }

    /**
     * Computes the double-SHA256 hash of the block header.
     * @returns 32-byte block hash
     */
    getHash(): Bytes32 {
        return bcrypto.hash256(this.toBuffer(true));
    }

    /**
     * Returns the block ID (hash in reversed hex format, as displayed in block explorers).
     * @returns Block ID as hex string
     */
    getId(): string {
        return toHex(reverse(this.getHash()));
    }

    /**
     * Converts the block timestamp to a Date object.
     * @returns UTC date of the block
     */
    getUTCDate(): Date {
        const date = new Date(0); // epoch
        date.setUTCSeconds(this.timestamp);

        return date;
    }

    /**
     * Serializes the block to a Uint8Array.
     * @param headersOnly - If true, only serialize the 80-byte header
     * @returns Serialized block data
     */
    toBuffer(headersOnly?: boolean): Uint8Array {
        if (!this.prevHash) throw new TypeError('Block prevHash is required');
        if (!this.merkleRoot) throw new TypeError('Block merkleRoot is required');

        const buffer = new Uint8Array(this.byteLength(headersOnly));

        const writer = new BinaryWriter(buffer);

        writer.writeInt32LE(this.version);
        writer.writeBytes(this.prevHash);
        writer.writeBytes(this.merkleRoot);
        writer.writeUInt32LE(this.timestamp);
        writer.writeUInt32LE(this.bits);
        writer.writeUInt32LE(this.nonce);

        if (headersOnly || !this.transactions) return buffer;

        writer.writeVarInt(this.transactions.length);

        this.transactions.forEach((tx) => {
            const txSize = tx.byteLength(); // TODO: extract from toBuffer?
            tx.toBuffer(buffer.subarray(writer.offset));
            writer.offset += txSize;
        });

        return buffer;
    }

    /**
     * Serializes the block to a hex string.
     * @param headersOnly - If true, only serialize the 80-byte header
     * @returns Hex string representation of the block
     */
    toHex(headersOnly?: boolean): string {
        return toHex(this.toBuffer(headersOnly));
    }

    /**
     * Validates the merkle root and witness commitment (if present).
     * @returns True if the transaction roots are valid
     */
    checkTxRoots(): boolean {
        // If the Block has segwit transactions but no witness commit,
        // there's no way it can be valid, so fail the check.
        const hasWitnessCommit = this.hasWitnessCommit();
        if (!hasWitnessCommit && this.hasWitness()) return false;
        return this.#checkMerkleRoot() && (hasWitnessCommit ? this.#checkWitnessCommit() : true);
    }

    /**
     * Validates that the block hash meets the target threshold (proof of work).
     * @returns True if the block's proof of work is valid
     */
    checkProofOfWork(): boolean {
        const hash = reverse(this.getHash());
        const target = Block.calculateTarget(this.bits);

        return compare(hash, target) <= 0;
    }

    #checkMerkleRoot(): boolean {
        if (!this.transactions) throw errorMerkleNoTxes;
        if (!this.merkleRoot) throw new TypeError('Block merkleRoot is required');

        const actualMerkleRoot = Block.calculateMerkleRoot(this.transactions);
        return compare(this.merkleRoot, actualMerkleRoot) === 0;
    }

    #checkWitnessCommit(): boolean {
        if (!this.transactions) throw errorMerkleNoTxes;
        if (!this.hasWitnessCommit()) throw errorWitnessNotSegwit;
        if (!this.witnessCommit) throw errorWitnessNotSegwit;

        const actualWitnessCommit = Block.calculateMerkleRoot(this.transactions, true);
        return compare(this.witnessCommit, actualWitnessCommit) === 0;
    }
}

/**
 * Checks if the coinbase transaction has witness data (required for witness commitment).
 * @param transactions - Array of transactions
 * @returns True if coinbase has witness data
 */
function txesHaveWitnessCommit(transactions: Transaction[]): boolean {
    const coinbase = transactions[0];
    if (!coinbase?.ins?.[0]?.witness) return false;
    return coinbase.ins[0].witness.length > 0;
}

/**
 * Checks if any transaction in the array has witness data.
 * @param transactions - Array of transactions
 * @returns True if any transaction has witness data
 */
function anyTxHasWitness(transactions: Transaction[]): boolean {
    return transactions.some((tx) =>
        tx.ins?.some((input) => input.witness && input.witness.length > 0),
    );
}
