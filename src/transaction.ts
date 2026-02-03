import { alloc, BinaryReader, BinaryWriter, fromHex, reverse, toHex, varuint } from './io/index.js';
import * as bcrypto from './crypto.js';
import * as bscript from './script.js';
import { opcodes } from './script.js';
import type { Bytes32, MessageHash, Satoshi, Script } from './types.js';
import { toMessageHash } from './types.js';

function varSliceSize(someScript: Uint8Array): number {
    const length = someScript.length;

    return varuint.encodingLength(length) + length;
}

function vectorSize(someVector: Uint8Array[]): number {
    const length = someVector.length;

    return (
        varuint.encodingLength(length) +
        someVector.reduce((sum, witness) => {
            return sum + varSliceSize(witness);
        }, 0)
    );
}

const EMPTY_BYTES = new Uint8Array(0) as Script;
const EMPTY_WITNESS: Uint8Array[] = [];
const ZERO = fromHex('0000000000000000000000000000000000000000000000000000000000000000') as Bytes32;
const ONE: MessageHash = toMessageHash(fromHex('0000000000000000000000000000000000000000000000000000000000000001'));

/** Maximum value for SIGHASH_SINGLE blank outputs (0xFFFFFFFFFFFFFFFF) */
const BLANK_OUTPUT_VALUE = 0xffffffffffffffffn as Satoshi;

/**
 * Cache for Taproot sighash intermediate values.
 * These are identical for all inputs with SIGHASH_ALL, so compute once and reuse.
 */
export interface TaprootHashCache {
    readonly hashPrevouts: Bytes32;
    readonly hashAmounts: Bytes32;
    readonly hashScriptPubKeys: Bytes32;
    readonly hashSequences: Bytes32;
    readonly hashOutputs: Bytes32;
}

export interface Output {
    readonly script: Script;
    readonly value: Satoshi;
}

export interface Input {
    readonly hash: Bytes32;
    readonly index: number;
    script: Script;
    sequence: number;
    witness: Uint8Array[];
}

/**
 * Represents a Bitcoin transaction.
 *
 * @example
 * ```typescript
 * import { Transaction, fromHex } from '@btc-vision/bitcoin';
 *
 * // Parse a transaction from hex
 * const tx = Transaction.fromHex('0100000001...');
 *
 * // Create a new transaction
 * const newTx = new Transaction();
 * newTx.version = 2;
 * newTx.addInput(prevTxHash, 0);
 * newTx.addOutput(scriptPubKey, 50000n);
 * ```
 */
export class Transaction {
    static readonly DEFAULT_SEQUENCE = 0xffffffff;
    static readonly SIGHASH_DEFAULT = 0x00;
    static readonly SIGHASH_ALL = 0x01;
    static readonly SIGHASH_NONE = 0x02;
    static readonly SIGHASH_SINGLE = 0x03;
    static readonly SIGHASH_ANYONECANPAY = 0x80;
    static readonly SIGHASH_OUTPUT_MASK = 0x03;
    static readonly SIGHASH_INPUT_MASK = 0x80;
    static readonly ADVANCED_TRANSACTION_MARKER = 0x00;
    static readonly ADVANCED_TRANSACTION_FLAG = 0x01;

    static readonly TRUC_VERSION = 3;
    static readonly TRUC_MAX_VSIZE = 10000;
    static readonly TRUC_CHILD_MAX_VSIZE = 1000;

    version: number = 1;
    locktime: number = 0;
    ins: Input[] = [];
    outs: Output[] = [];

    /**
     * Parse a transaction from a Uint8Array buffer.
     *
     * @param buffer - The raw transaction bytes
     * @param _NO_STRICT - If true, allow extra data after transaction
     * @returns Parsed Transaction instance
     */
    static fromBuffer(buffer: Uint8Array, _NO_STRICT?: boolean): Transaction {
        const bufferReader = new BinaryReader(buffer);
        const tx = new Transaction();
        tx.version = bufferReader.readInt32LE();

        const marker = bufferReader.readUInt8();
        const flag = bufferReader.readUInt8();

        let hasWitnesses = false;
        if (
            marker === Transaction.ADVANCED_TRANSACTION_MARKER &&
            flag === Transaction.ADVANCED_TRANSACTION_FLAG
        ) {
            hasWitnesses = true;
        } else {
            bufferReader.offset -= 2;
        }

        const vinLen = bufferReader.readVarInt();
        for (let i = 0; i < vinLen; ++i) {
            const hash = bufferReader.readBytes(32) as Bytes32;
            const index = bufferReader.readUInt32LE();
            const script = bufferReader.readVarBytes() as Script;
            const sequence = bufferReader.readUInt32LE();

            tx.ins.push({
                hash: hash,
                index: index,
                script: script,
                sequence: sequence,
                witness: EMPTY_WITNESS,
            });
        }

        const voutLen = bufferReader.readVarInt();
        for (let i = 0; i < voutLen; ++i) {
            tx.outs.push({
                value: bufferReader.readUInt64LE() as Satoshi,
                script: bufferReader.readVarBytes() as Script,
            });
        }

        if (hasWitnesses) {
            for (let i = 0; i < vinLen; ++i) {
                (tx.ins[i] as Transaction['ins'][0]).witness = bufferReader.readVector();
            }

            // was this pointless?
            if (!tx.hasWitnesses()) throw new Error('Transaction has superfluous witness data');
        }

        tx.locktime = bufferReader.readUInt32LE();

        if (_NO_STRICT) return tx;
        if (bufferReader.offset !== buffer.length)
            throw new Error('Transaction has unexpected data');

        return tx;
    }

    /**
     * Parse a transaction from a hex string.
     *
     * @param hex - The transaction as a hex string
     * @returns Parsed Transaction instance
     */
    static fromHex(hex: string): Transaction {
        return Transaction.fromBuffer(fromHex(hex), false);
    }

    /**
     * Check if a hash is a coinbase hash (all zeros).
     *
     * @param hash - 32-byte hash to check
     * @returns true if hash is all zeros (coinbase)
     */
    static isCoinbaseHash(hash: Bytes32): boolean {
        if (hash.length !== 32) {
            throw new TypeError('Expected 32-byte hash');
        }
        for (let i = 0; i < 32; ++i) {
            if (hash[i] !== 0) return false;
        }
        return true;
    }

    isCoinbase(): boolean {
        const firstIn = this.ins[0];
        return this.ins.length === 1 && firstIn !== undefined && Transaction.isCoinbaseHash(firstIn.hash);
    }

    /**
     * Add an input to this transaction.
     *
     * @param hash - 32-byte hash of the previous transaction
     * @param index - Output index in the previous transaction
     * @param sequence - Sequence number (defaults to 0xffffffff)
     * @param scriptSig - Input script (defaults to empty)
     * @returns The index of the newly added input
     */
    addInput(hash: Bytes32, index: number, sequence?: number, scriptSig?: Script): number {
        if (hash.length !== 32) {
            throw new TypeError('Expected 32-byte hash');
        }
        if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
            throw new TypeError('Expected unsigned 32-bit integer for index');
        }
        if (
            sequence !== undefined &&
            sequence !== null &&
            (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff)
        ) {
            throw new TypeError('Expected unsigned 32-bit integer for sequence');
        }

        if (sequence === undefined || sequence === null) {
            sequence = Transaction.DEFAULT_SEQUENCE;
        }

        // Add the input and return the input's index
        return (
            this.ins.push({
                hash,
                index,
                script: scriptSig || EMPTY_BYTES,
                sequence: sequence,
                witness: EMPTY_WITNESS,
            }) - 1
        );
    }

    /**
     * Add an output to this transaction.
     *
     * @param scriptPubKey - Output script (locking script)
     * @param value - Output value in satoshis (bigint)
     * @returns The index of the newly added output
     */
    addOutput(scriptPubKey: Script, value: Satoshi): number {
        if (!(scriptPubKey instanceof Uint8Array)) {
            throw new TypeError('Expected Uint8Array for scriptPubKey');
        }
        if (typeof value !== 'bigint' || value < 0n || value > 0x7fffffffffffffffn) {
            throw new TypeError('Expected bigint satoshi value (0 to 2^63-1)');
        }

        // Add the output and return the output's index
        return (
            this.outs.push({
                script: scriptPubKey,
                value,
            }) - 1
        );
    }

    hasWitnesses(): boolean {
        return this.ins.some((x) => {
            return x.witness.length !== 0;
        });
    }

    weight(): number {
        const base = this.byteLength(false);
        const total = this.byteLength(true);
        return base * 3 + total;
    }

    virtualSize(): number {
        return Math.ceil(this.weight() / 4);
    }

    byteLength(_ALLOW_WITNESS: boolean = true): number {
        const hasWitnesses = _ALLOW_WITNESS && this.hasWitnesses();

        return (
            (hasWitnesses ? 10 : 8) +
            varuint.encodingLength(this.ins.length) +
            varuint.encodingLength(this.outs.length) +
            this.ins.reduce((sum, input) => {
                return sum + 40 + varSliceSize(input.script);
            }, 0) +
            this.outs.reduce((sum, output) => {
                return sum + 8 + varSliceSize(output.script);
            }, 0) +
            (hasWitnesses
                ? this.ins.reduce((sum, input) => {
                      return sum + vectorSize(input.witness);
                  }, 0)
                : 0)
        );
    }

    clone(): Transaction {
        const newTx = new Transaction();
        newTx.version = this.version;
        newTx.locktime = this.locktime;

        newTx.ins = this.ins.map((txIn) => {
            return {
                hash: txIn.hash,
                index: txIn.index,
                script: txIn.script,
                sequence: txIn.sequence,
                witness: txIn.witness,
            };
        });

        newTx.outs = this.outs.map((txOut) => {
            return {
                script: txOut.script,
                value: txOut.value,
            };
        });

        return newTx;
    }

    /**
     * Hash transaction for signing a specific input.
     *
     * Bitcoin uses a different hash for each signed transaction input.
     * This method copies the transaction, makes the necessary changes based on the
     * hashType, and then hashes the result.
     * This hash can then be used to sign the provided transaction input.
     *
     * @param inIndex - Index of the input being signed
     * @param prevOutScript - The script of the output being spent
     * @param hashType - Signature hash type
     * @returns 32-byte hash for signing
     */
    hashForSignature(inIndex: number, prevOutScript: Script, hashType: number): MessageHash {
        if (!Number.isInteger(inIndex) || inIndex < 0) {
            throw new TypeError('Expected non-negative integer for inIndex');
        }
        if (!(prevOutScript instanceof Uint8Array)) {
            throw new TypeError('Expected Uint8Array for prevOutScript');
        }
        if (!Number.isInteger(hashType)) {
            throw new TypeError('Expected integer for hashType');
        }

        // https://github.com/bitcoin/bitcoin/blob/master/src/test/sighash_tests.cpp#L29
        if (inIndex >= this.ins.length) return ONE;

        // ignore OP_CODESEPARATOR
        const decompiled = bscript.decompile(prevOutScript);
        if (!decompiled) throw new Error('Could not decompile prevOutScript');
        const ourScript = bscript.compile(
            decompiled.filter((x) => {
                return x !== opcodes.OP_CODESEPARATOR;
            }),
        );

        const txTmp = this.clone();

        // SIGHASH_NONE: ignore all outputs? (wildcard payee)
        if ((hashType & 0x1f) === Transaction.SIGHASH_NONE) {
            txTmp.outs = [];

            // ignore sequence numbers (except at inIndex)
            txTmp.ins.forEach((input, i) => {
                if (i === inIndex) return;

                input.sequence = 0;
            });

            // SIGHASH_SINGLE: ignore all outputs, except at the same index?
        } else if ((hashType & 0x1f) === Transaction.SIGHASH_SINGLE) {
            // https://github.com/bitcoin/bitcoin/blob/master/src/test/sighash_tests.cpp#L60
            if (inIndex >= this.outs.length) return ONE;

            // truncate outputs after
            txTmp.outs.length = inIndex + 1;

            // "blank" outputs before (value = 0xFFFFFFFFFFFFFFFF, empty script)
            for (let i = 0; i < inIndex; i++) {
                txTmp.outs[i] = {
                    script: EMPTY_BYTES,
                    value: BLANK_OUTPUT_VALUE,
                };
            }

            // ignore sequence numbers (except at inIndex)
            txTmp.ins.forEach((input, y) => {
                if (y === inIndex) return;

                input.sequence = 0;
            });
        }

        // SIGHASH_ANYONECANPAY: ignore inputs entirely?
        if (hashType & Transaction.SIGHASH_ANYONECANPAY) {
            txTmp.ins = [txTmp.ins[inIndex] as Transaction['ins'][0]];
            (txTmp.ins[0] as Transaction['ins'][0]).script = ourScript;

            // SIGHASH_ALL: only ignore input scripts
        } else {
            // "blank" others input scripts
            txTmp.ins.forEach((input) => {
                input.script = EMPTY_BYTES;
            });
            (txTmp.ins[inIndex] as Transaction['ins'][0]).script = ourScript;
        }

        // serialize and hash
        const buffer: Uint8Array = alloc(txTmp.byteLength(false) + 4);
        const writer = new BinaryWriter(buffer, txTmp.byteLength(false));
        writer.writeInt32LE(hashType);
        txTmp.#toBuffer(buffer, 0, false);

        return toMessageHash(bcrypto.hash256(buffer));
    }

    /**
     * Hash transaction for signing a Taproot (witness v1) input.
     *
     * @param inIndex - Index of the input being signed
     * @param prevOutScripts - Scripts of all inputs being spent
     * @param values - Values of all inputs being spent (bigint satoshis)
     * @param hashType - Signature hash type
     * @param leafHash - Optional leaf hash for script path spending
     * @param annex - Optional annex data
     * @returns 32-byte hash for signing
     */
    hashForWitnessV1(
        inIndex: number,
        prevOutScripts: readonly Script[],
        values: readonly Satoshi[],
        hashType: number,
        leafHash?: Bytes32,
        annex?: Uint8Array,
        taprootCache?: TaprootHashCache,
    ): MessageHash {
        // https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki#common-signature-message
        if (!Number.isInteger(inIndex) || inIndex < 0 || inIndex > 0xffffffff) {
            throw new TypeError('Expected unsigned 32-bit integer for inIndex');
        }
        if (
            !Array.isArray(prevOutScripts) ||
            !prevOutScripts.every((s) => s instanceof Uint8Array)
        ) {
            throw new TypeError('Expected array of Uint8Array for prevOutScripts');
        }
        if (!Array.isArray(values) || !values.every((v) => typeof v === 'bigint')) {
            throw new TypeError('Expected array of bigint for values');
        }
        if (!Number.isInteger(hashType) || hashType < 0 || hashType > 0xffffffff) {
            throw new TypeError('Expected unsigned 32-bit integer for hashType');
        }

        if (values.length !== this.ins.length || prevOutScripts.length !== this.ins.length) {
            throw new Error('Must supply prevout script and value for all inputs');
        }

        const outputType =
            hashType === Transaction.SIGHASH_DEFAULT
                ? Transaction.SIGHASH_ALL
                : hashType & Transaction.SIGHASH_OUTPUT_MASK;

        const inputType = hashType & Transaction.SIGHASH_INPUT_MASK;

        const isAnyoneCanPay = inputType === Transaction.SIGHASH_ANYONECANPAY;
        const isNone = outputType === Transaction.SIGHASH_NONE;
        const isSingle = outputType === Transaction.SIGHASH_SINGLE;

        let hashPrevouts: Uint8Array = EMPTY_BYTES;
        let hashAmounts: Uint8Array = EMPTY_BYTES;
        let hashScriptPubKeys: Uint8Array = EMPTY_BYTES;
        let hashSequences: Uint8Array = EMPTY_BYTES;
        let hashOutputs: Uint8Array = EMPTY_BYTES;

        // Use cache if provided (for SIGHASH_ALL, these are identical for all inputs)
        if (!isAnyoneCanPay) {
            if (taprootCache) {
                hashPrevouts = taprootCache.hashPrevouts;
                hashAmounts = taprootCache.hashAmounts;
                hashScriptPubKeys = taprootCache.hashScriptPubKeys;
                hashSequences = taprootCache.hashSequences;
            } else {
                let bufferWriter = new BinaryWriter(36 * this.ins.length);
                this.ins.forEach((txIn) => {
                    bufferWriter.writeBytes(txIn.hash);
                    bufferWriter.writeUInt32LE(txIn.index);
                });
                hashPrevouts = bcrypto.sha256(bufferWriter.finish());

                bufferWriter = new BinaryWriter(8 * this.ins.length);
                values.forEach((value) => bufferWriter.writeUInt64LE(value));
                hashAmounts = bcrypto.sha256(bufferWriter.finish());

                bufferWriter = new BinaryWriter(
                    prevOutScripts.map(varSliceSize).reduce((a, b) => a + b),
                );
                prevOutScripts.forEach((prevOutScript) =>
                    bufferWriter.writeVarBytes(prevOutScript),
                );
                hashScriptPubKeys = bcrypto.sha256(bufferWriter.finish());

                bufferWriter = new BinaryWriter(4 * this.ins.length);
                this.ins.forEach((txIn) => bufferWriter.writeUInt32LE(txIn.sequence));
                hashSequences = bcrypto.sha256(bufferWriter.finish());
            }
        }

        if (!(isNone || isSingle)) {
            if (taprootCache) {
                hashOutputs = taprootCache.hashOutputs;
            } else {
                if (!this.outs.length)
                    throw new Error('Add outputs to the transaction before signing.');
                const txOutsSize = this.outs
                    .map((output) => 8 + varSliceSize(output.script))
                    .reduce((a, b) => a + b);
                const bufferWriter = new BinaryWriter(txOutsSize);

                this.outs.forEach((out) => {
                    bufferWriter.writeUInt64LE(out.value);
                    bufferWriter.writeVarBytes(out.script);
                });

                hashOutputs = bcrypto.sha256(bufferWriter.finish());
            }
        } else if (isSingle && inIndex < this.outs.length) {
            const output = this.outs[inIndex] as Transaction['outs'][0];

            const bufferWriter = new BinaryWriter(8 + varSliceSize(output.script));
            bufferWriter.writeUInt64LE(output.value);
            bufferWriter.writeVarBytes(output.script);
            hashOutputs = bcrypto.sha256(bufferWriter.finish());
        }

        const spendType = (leafHash ? 2 : 0) + (annex ? 1 : 0);

        // Length calculation from:
        // https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki#cite_note-14
        // With extension from:
        // https://github.com/bitcoin/bips/blob/master/bip-0342.mediawiki#signature-validation
        const sigMsgSize =
            174 -
            (isAnyoneCanPay ? 49 : 0) -
            (isNone ? 32 : 0) +
            (annex ? 32 : 0) +
            (leafHash ? 37 : 0);
        const sigMsgWriter = new BinaryWriter(sigMsgSize);

        sigMsgWriter.writeUInt8(hashType);
        // Transaction
        sigMsgWriter.writeInt32LE(this.version);
        sigMsgWriter.writeUInt32LE(this.locktime);
        sigMsgWriter.writeBytes(hashPrevouts);
        sigMsgWriter.writeBytes(hashAmounts);
        sigMsgWriter.writeBytes(hashScriptPubKeys);
        sigMsgWriter.writeBytes(hashSequences);
        if (!(isNone || isSingle)) {
            sigMsgWriter.writeBytes(hashOutputs);
        }
        // Input
        sigMsgWriter.writeUInt8(spendType);
        if (isAnyoneCanPay) {
            const input = this.ins[inIndex] as Transaction['ins'][0];
            sigMsgWriter.writeBytes(input.hash);
            sigMsgWriter.writeUInt32LE(input.index);
            sigMsgWriter.writeUInt64LE(values[inIndex] as Satoshi);
            sigMsgWriter.writeVarBytes(prevOutScripts[inIndex] as Uint8Array);
            sigMsgWriter.writeUInt32LE(input.sequence);
        } else {
            sigMsgWriter.writeUInt32LE(inIndex);
        }
        if (annex) {
            const bufferWriter = new BinaryWriter(varSliceSize(annex));
            bufferWriter.writeVarBytes(annex);
            sigMsgWriter.writeBytes(bcrypto.sha256(bufferWriter.finish()));
        }
        // Output
        if (isSingle) {
            sigMsgWriter.writeBytes(hashOutputs);
        }
        // BIP342 extension
        if (leafHash) {
            sigMsgWriter.writeBytes(leafHash);
            sigMsgWriter.writeUInt8(0);
            sigMsgWriter.writeUInt32LE(0xffffffff);
        }

        // Extra zero byte because:
        // https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki#cite_note-19
        const prefix = new Uint8Array([0x00]);
        const sigMsg = sigMsgWriter.finish();
        const combined = new Uint8Array(1 + sigMsg.length);
        combined.set(prefix);
        combined.set(sigMsg, 1);
        return toMessageHash(bcrypto.taggedHash('TapSighash', combined));
    }

    /**
     * Pre-compute intermediate hashes for Taproot signing.
     * Call this once before signing multiple inputs to avoid O(n^2) performance.
     *
     * @param prevOutScripts - Array of previous output scripts for all inputs
     * @param values - Array of previous output values for all inputs
     * @returns Cache object to pass to hashForWitnessV1
     */
    getTaprootHashCache(
        prevOutScripts: readonly Script[],
        values: readonly Satoshi[],
    ): TaprootHashCache {
        // hashPrevouts
        let bufferWriter = new BinaryWriter(36 * this.ins.length);
        for (const txIn of this.ins) {
            bufferWriter.writeBytes(txIn.hash);
            bufferWriter.writeUInt32LE(txIn.index);
        }
        const hashPrevouts = bcrypto.sha256(bufferWriter.finish());

        // hashAmounts
        bufferWriter = new BinaryWriter(8 * values.length);
        for (const value of values) {
            bufferWriter.writeUInt64LE(value);
        }
        const hashAmounts = bcrypto.sha256(bufferWriter.finish());

        // hashScriptPubKeys - compute size without intermediate array
        let scriptPubKeysSize = 0;
        for (const script of prevOutScripts) {
            scriptPubKeysSize += varSliceSize(script);
        }
        bufferWriter = new BinaryWriter(scriptPubKeysSize);
        for (const script of prevOutScripts) {
            bufferWriter.writeVarBytes(script);
        }
        const hashScriptPubKeys = bcrypto.sha256(bufferWriter.finish());

        // hashSequences
        bufferWriter = new BinaryWriter(4 * this.ins.length);
        for (const txIn of this.ins) {
            bufferWriter.writeUInt32LE(txIn.sequence);
        }
        const hashSequences = bcrypto.sha256(bufferWriter.finish());

        // hashOutputs - compute size without intermediate array
        let txOutsSize = 0;
        for (const out of this.outs) {
            txOutsSize += 8 + varSliceSize(out.script);
        }
        bufferWriter = new BinaryWriter(txOutsSize);
        for (const out of this.outs) {
            bufferWriter.writeUInt64LE(out.value);
            bufferWriter.writeVarBytes(out.script);
        }
        const hashOutputs = this.outs.length ? bcrypto.sha256(bufferWriter.finish()) : ZERO;

        return { hashPrevouts, hashAmounts, hashScriptPubKeys, hashSequences, hashOutputs };
    }

    /**
     * Hash transaction for signing a SegWit v0 (P2WPKH/P2WSH) input.
     *
     * @param inIndex - Index of the input being signed
     * @param prevOutScript - The script of the output being spent
     * @param value - Value of the output being spent (bigint satoshis)
     * @param hashType - Signature hash type
     * @returns 32-byte hash for signing
     */
    hashForWitnessV0(
        inIndex: number,
        prevOutScript: Script,
        value: Satoshi,
        hashType: number,
    ): MessageHash {
        if (!Number.isInteger(inIndex) || inIndex < 0 || inIndex > 0xffffffff) {
            throw new TypeError('Expected unsigned 32-bit integer for inIndex');
        }
        if (!(prevOutScript instanceof Uint8Array)) {
            throw new TypeError('Expected Uint8Array for prevOutScript');
        }
        if (typeof value !== 'bigint') {
            throw new TypeError('Expected bigint for value');
        }
        if (!Number.isInteger(hashType) || hashType < 0 || hashType > 0xffffffff) {
            throw new TypeError('Expected unsigned 32-bit integer for hashType');
        }

        let tbuffer: Uint8Array;
        let bufferWriter: BinaryWriter;

        let hashOutputs = ZERO;
        let hashPrevouts = ZERO;
        let hashSequence = ZERO;

        if (!(hashType & Transaction.SIGHASH_ANYONECANPAY)) {
            tbuffer = alloc(36 * this.ins.length);
            bufferWriter = new BinaryWriter(tbuffer, 0);

            this.ins.forEach((txIn) => {
                bufferWriter.writeBytes(txIn.hash);
                bufferWriter.writeUInt32LE(txIn.index);
            });

            hashPrevouts = bcrypto.hash256(tbuffer);
        }

        if (
            !(hashType & Transaction.SIGHASH_ANYONECANPAY) &&
            (hashType & 0x1f) !== Transaction.SIGHASH_SINGLE &&
            (hashType & 0x1f) !== Transaction.SIGHASH_NONE
        ) {
            tbuffer = alloc(4 * this.ins.length);
            bufferWriter = new BinaryWriter(tbuffer, 0);

            this.ins.forEach((txIn) => {
                bufferWriter.writeUInt32LE(txIn.sequence);
            });

            hashSequence = bcrypto.hash256(tbuffer);
        }

        if (
            (hashType & 0x1f) !== Transaction.SIGHASH_SINGLE &&
            (hashType & 0x1f) !== Transaction.SIGHASH_NONE
        ) {
            const txOutsSize = this.outs.reduce((sum, output) => {
                return sum + 8 + varSliceSize(output.script);
            }, 0);

            tbuffer = alloc(txOutsSize);
            bufferWriter = new BinaryWriter(tbuffer, 0);

            this.outs.forEach((out) => {
                bufferWriter.writeUInt64LE(out.value);
                bufferWriter.writeVarBytes(out.script);
            });

            hashOutputs = bcrypto.hash256(tbuffer);
        } else if ((hashType & 0x1f) === Transaction.SIGHASH_SINGLE && inIndex < this.outs.length) {
            const output = this.outs[inIndex] as Transaction['outs'][0];

            tbuffer = alloc(8 + varSliceSize(output.script));
            bufferWriter = new BinaryWriter(tbuffer, 0);
            bufferWriter.writeUInt64LE(output.value);
            bufferWriter.writeVarBytes(output.script);

            hashOutputs = bcrypto.hash256(tbuffer);
        }

        tbuffer = alloc(156 + varSliceSize(prevOutScript));
        bufferWriter = new BinaryWriter(tbuffer, 0);

        const input = this.ins[inIndex] as Transaction['ins'][0];
        bufferWriter.writeInt32LE(this.version);
        bufferWriter.writeBytes(hashPrevouts);
        bufferWriter.writeBytes(hashSequence);
        bufferWriter.writeBytes(input.hash);
        bufferWriter.writeUInt32LE(input.index);
        bufferWriter.writeVarBytes(prevOutScript);
        bufferWriter.writeUInt64LE(value);
        bufferWriter.writeUInt32LE(input.sequence);
        bufferWriter.writeBytes(hashOutputs);
        bufferWriter.writeUInt32LE(this.locktime);
        bufferWriter.writeUInt32LE(hashType);
        return toMessageHash(bcrypto.hash256(tbuffer));
    }

    /**
     * Get the transaction hash.
     *
     * @param forWitness - If true, include witness data (wtxid)
     * @returns 32-byte transaction hash
     */
    getHash(forWitness?: boolean): Bytes32 {
        // wtxid for coinbase is always 32 bytes of 0x00
        if (forWitness && this.isCoinbase()) return new Uint8Array(32) as Bytes32;
        return bcrypto.hash256(this.#toBuffer(undefined, undefined, forWitness));
    }

    /**
     * Get the transaction ID (txid) as a hex string.
     *
     * @returns Transaction ID in reversed hex format
     */
    getId(): string {
        // transaction hash's are displayed in reverse order
        return toHex(reverse(this.getHash(false)));
    }

    /**
     * Serialize the transaction to a Uint8Array buffer.
     *
     * @param buffer - Optional pre-allocated buffer
     * @param initialOffset - Optional starting offset in buffer
     * @returns Serialized transaction bytes
     */
    toBuffer(buffer?: Uint8Array, initialOffset?: number): Uint8Array {
        return this.#toBuffer(buffer, initialOffset, true);
    }

    /**
     * Serialize the transaction to a hex string.
     *
     * @returns Transaction as hex string
     */
    toHex(): string {
        return toHex(this.toBuffer(undefined, undefined));
    }

    /**
     * Set the input script for a specific input.
     *
     * @param index - Input index
     * @param scriptSig - The script to set
     */
    setInputScript(index: number, scriptSig: Script): void {
        if (!Number.isInteger(index) || index < 0) {
            throw new TypeError('Expected non-negative integer for index');
        }
        if (!(scriptSig instanceof Uint8Array)) {
            throw new TypeError('Expected Uint8Array for scriptSig');
        }

        (this.ins[index] as Transaction['ins'][0]).script = scriptSig;
    }

    /**
     * Set the witness data for a specific input.
     *
     * @param index - Input index
     * @param witness - Array of witness elements
     */
    setWitness(index: number, witness: Uint8Array[]): void {
        if (!Number.isInteger(index) || index < 0) {
            throw new TypeError('Expected non-negative integer for index');
        }
        if (!Array.isArray(witness) || !witness.every((w) => w instanceof Uint8Array)) {
            throw new TypeError('Expected array of Uint8Array for witness');
        }

        (this.ins[index] as Transaction['ins'][0]).witness = witness;
    }

    /**
     * Internal method to serialize the transaction.
     *
     * @param buffer - Optional pre-allocated buffer
     * @param initialOffset - Optional starting offset
     * @param _ALLOW_WITNESS - Whether to include witness data
     * @returns Serialized transaction bytes
     */
    #toBuffer(
        buffer?: Uint8Array,
        initialOffset?: number,
        _ALLOW_WITNESS: boolean = false,
    ): Uint8Array {
        if (!buffer) buffer = alloc(this.byteLength(_ALLOW_WITNESS));

        const bufferWriter = new BinaryWriter(buffer, initialOffset || 0);

        bufferWriter.writeInt32LE(this.version);

        const hasWitnesses = _ALLOW_WITNESS && this.hasWitnesses();

        if (hasWitnesses) {
            bufferWriter.writeUInt8(Transaction.ADVANCED_TRANSACTION_MARKER);
            bufferWriter.writeUInt8(Transaction.ADVANCED_TRANSACTION_FLAG);
        }

        bufferWriter.writeVarInt(this.ins.length);

        this.ins.forEach((txIn) => {
            bufferWriter.writeBytes(txIn.hash);
            bufferWriter.writeUInt32LE(txIn.index);
            bufferWriter.writeVarBytes(txIn.script);
            bufferWriter.writeUInt32LE(txIn.sequence);
        });

        bufferWriter.writeVarInt(this.outs.length);
        this.outs.forEach((txOut) => {
            bufferWriter.writeUInt64LE(txOut.value);
            bufferWriter.writeVarBytes(txOut.script);
        });

        if (hasWitnesses) {
            this.ins.forEach((input) => {
                bufferWriter.writeVector(input.witness);
            });
        }

        bufferWriter.writeUInt32LE(this.locktime);

        // avoid slicing unless necessary
        if (initialOffset !== undefined) return buffer.subarray(initialOffset, bufferWriter.offset);
        return buffer;
    }
}
