/**
 * Stateful binary reader with a single DataView instance.
 *
 * Zero allocations during read operations. The DataView is created once
 * in the constructor and reused for all reads.
 *
 * @packageDocumentation
 */

import { fromHex } from './hex.js';

/**
 * High-performance binary reader for parsing binary data.
 *
 * Creates exactly ONE DataView instance that is reused for all read operations.
 * This eliminates garbage collection pressure from repeated DataView allocations.
 *
 * @example
 * ```typescript
 * import { BinaryReader, fromHex } from '@btc-vision/bitcoin';
 *
 * // Parse a Bitcoin transaction
 * const data = fromHex('01000000...');
 * const reader = new BinaryReader(data);
 *
 * const version = reader.readInt32LE();
 * const inputCount = reader.readVarInt();
 *
 * for (let i = 0; i < inputCount; i++) {
 *     const txid = reader.readBytes(32);
 *     const vout = reader.readUInt32LE();
 *     const script = reader.readVarBytes();
 *     const sequence = reader.readUInt32LE();
 * }
 * ```
 */
export class BinaryReader {
    /**
     * The underlying byte array.
     */
    readonly #data: Uint8Array;

    /**
     * Single DataView instance reused for all reads.
     */
    readonly #view: DataView;

    /**
     * Current read position.
     */
    #offset: number;

    /**
     * Creates a new BinaryReader.
     *
     * @param data - The byte array to read from
     * @param offset - Initial read position (default 0)
     *
     * @example
     * ```typescript
     * import { BinaryReader, fromHex } from '@btc-vision/bitcoin';
     *
     * const data = fromHex('01020304');
     * const reader = new BinaryReader(data);
     * ```
     */
    public constructor(data: Uint8Array, offset: number = 0) {
        this.#data = data;
        this.#view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        this.#offset = offset;
    }

    /**
     * Current read position in the buffer.
     */
    public get offset(): number {
        return this.#offset;
    }

    /**
     * Sets the read position.
     *
     * @param value - New offset value
     * @throws RangeError if offset is negative or beyond buffer length
     */
    public set offset(value: number) {
        if (value < 0 || value > this.#data.length) {
            throw new RangeError(`Offset ${value} is out of bounds [0, ${this.#data.length}]`);
        }
        this.#offset = value;
    }

    /**
     * Total length of the underlying buffer.
     */
    public get length(): number {
        return this.#data.length;
    }

    /**
     * Number of bytes remaining to be read.
     */
    public get remaining(): number {
        return this.#data.length - this.#offset;
    }

    /**
     * The underlying data buffer.
     */
    public get data(): Uint8Array {
        return this.#data;
    }

    /**
     * Creates a BinaryReader from a hex string.
     *
     * @param hex - Hex string (with or without 0x prefix)
     * @returns A new BinaryReader instance
     *
     * @example
     * ```typescript
     * import { BinaryReader } from '@btc-vision/bitcoin';
     *
     * const reader = BinaryReader.fromHex('01000000');
     * const version = reader.readInt32LE(); // 1
     * ```
     */
    public static fromHex(hex: string): BinaryReader {
        return new BinaryReader(fromHex(hex));
    }

    /**
     * Reads an 8-bit unsigned integer.
     *
     * @returns The value (0-255)
     * @throws RangeError if reading past end of buffer
     *
     * @example
     * ```typescript
     * const reader = BinaryReader.fromHex('ff');
     * reader.readUInt8(); // 255
     * ```
     */
    public readUInt8(): number {
        if (this.#offset >= this.#data.length) {
            throw new RangeError('Read past end of buffer');
        }
        return this.#data[this.#offset++] as number; // Safe: bounds checked above
    }

    /**
     * Reads an 8-bit signed integer.
     *
     * @returns The value (-128 to 127)
     * @throws RangeError if reading past end of buffer
     */
    public readInt8(): number {
        const value = this.readUInt8();
        return value > 127 ? value - 256 : value;
    }

    /**
     * Reads a 16-bit unsigned integer in little-endian format.
     *
     * @returns The value (0-65535)
     * @throws RangeError if reading past end of buffer
     *
     * @example
     * ```typescript
     * const reader = BinaryReader.fromHex('0100'); // 1 in LE
     * reader.readUInt16LE(); // 1
     * ```
     */
    public readUInt16LE(): number {
        if (this.#offset + 2 > this.#data.length) {
            throw new RangeError('Read past end of buffer');
        }
        const value = this.#view.getUint16(this.#offset, true);
        this.#offset += 2;
        return value;
    }

    /**
     * Reads a 16-bit signed integer in little-endian format.
     *
     * @returns The value (-32768 to 32767)
     * @throws RangeError if reading past end of buffer
     */
    public readInt16LE(): number {
        if (this.#offset + 2 > this.#data.length) {
            throw new RangeError('Read past end of buffer');
        }
        const value = this.#view.getInt16(this.#offset, true);
        this.#offset += 2;
        return value;
    }

    /**
     * Reads a 32-bit unsigned integer in little-endian format.
     *
     * @returns The value (0 to 4294967295)
     * @throws RangeError if reading past end of buffer
     *
     * @example
     * ```typescript
     * const reader = BinaryReader.fromHex('01000000'); // 1 in LE
     * reader.readUInt32LE(); // 1
     * ```
     */
    public readUInt32LE(): number {
        if (this.#offset + 4 > this.#data.length) {
            throw new RangeError('Read past end of buffer');
        }
        const value = this.#view.getUint32(this.#offset, true);
        this.#offset += 4;
        return value;
    }

    /**
     * Reads a 32-bit signed integer in little-endian format.
     *
     * @returns The value (-2147483648 to 2147483647)
     * @throws RangeError if reading past end of buffer
     *
     * @example
     * ```typescript
     * const reader = BinaryReader.fromHex('ffffffff'); // -1 in LE signed
     * reader.readInt32LE(); // -1
     * ```
     */
    public readInt32LE(): number {
        if (this.#offset + 4 > this.#data.length) {
            throw new RangeError('Read past end of buffer');
        }
        const value = this.#view.getInt32(this.#offset, true);
        this.#offset += 4;
        return value;
    }

    /**
     * Reads a 64-bit unsigned integer in little-endian format as bigint.
     *
     * @returns The value as bigint
     * @throws RangeError if reading past end of buffer
     *
     * @example
     * ```typescript
     * const reader = BinaryReader.fromHex('0100000000000000'); // 1 in LE 64-bit
     * reader.readUInt64LE(); // 1n
     * ```
     */
    public readUInt64LE(): bigint {
        if (this.#offset + 8 > this.#data.length) {
            throw new RangeError('Read past end of buffer');
        }
        const value = this.#view.getBigUint64(this.#offset, true);
        this.#offset += 8;
        return value;
    }

    /**
     * Reads a 64-bit signed integer in little-endian format as bigint.
     *
     * @returns The value as bigint
     * @throws RangeError if reading past end of buffer
     */
    public readInt64LE(): bigint {
        if (this.#offset + 8 > this.#data.length) {
            throw new RangeError('Read past end of buffer');
        }
        const value = this.#view.getBigInt64(this.#offset, true);
        this.#offset += 8;
        return value;
    }

    /**
     * Reads a specified number of bytes.
     *
     * Returns a subarray view (no copy) for performance.
     * Use readBytesCopy() if you need an independent copy.
     *
     * @param length - Number of bytes to read
     * @returns Uint8Array view into the buffer
     * @throws RangeError if reading past end of buffer
     *
     * @example
     * ```typescript
     * const reader = BinaryReader.fromHex('deadbeefcafebabe');
     * const first4 = reader.readBytes(4); // deadbeef
     * const next4 = reader.readBytes(4); // cafebabe
     * ```
     */
    public readBytes(length: number): Uint8Array {
        if (this.#offset + length > this.#data.length) {
            throw new RangeError('Read past end of buffer');
        }
        const value = this.#data.subarray(this.#offset, this.#offset + length);
        this.#offset += length;
        return value;
    }

    /**
     * Reads a specified number of bytes as an independent copy.
     *
     * @param length - Number of bytes to read
     * @returns New Uint8Array with copied data
     * @throws RangeError if reading past end of buffer
     */
    public readBytesCopy(length: number): Uint8Array {
        if (this.#offset + length > this.#data.length) {
            throw new RangeError('Read past end of buffer');
        }
        const value = this.#data.slice(this.#offset, this.#offset + length);
        this.#offset += length;
        return value;
    }

    /**
     * Reads a Bitcoin CompactSize variable-length integer.
     *
     * CompactSize encoding:
     * - 0x00-0xFC: 1 byte (value as-is)
     * - 0xFD: 3 bytes (0xFD + 2-byte LE uint16)
     * - 0xFE: 5 bytes (0xFE + 4-byte LE uint32)
     * - 0xFF: 9 bytes (0xFF + 8-byte LE uint64)
     *
     * @returns The decoded integer value
     * @throws RangeError if reading past end of buffer
     * @throws RangeError if value exceeds MAX_SAFE_INTEGER
     *
     * @example
     * ```typescript
     * const reader = BinaryReader.fromHex('fd0302'); // 515 encoded
     * reader.readVarInt(); // 515
     * ```
     */
    public readVarInt(): number {
        const first = this.readUInt8();

        if (first < 0xfd) {
            return first;
        }

        if (first === 0xfd) {
            return this.readUInt16LE();
        }

        if (first === 0xfe) {
            return this.readUInt32LE();
        }

        // first === 0xff
        const value = this.readUInt64LE();
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new RangeError('VarInt value exceeds MAX_SAFE_INTEGER');
        }
        return Number(value);
    }

    /**
     * Reads a Bitcoin CompactSize variable-length integer as bigint.
     *
     * Use this when you need the full 64-bit range.
     *
     * @returns The decoded integer value as bigint
     * @throws RangeError if reading past end of buffer
     */
    public readVarIntBig(): bigint {
        const first = this.readUInt8();

        if (first < 0xfd) {
            return BigInt(first);
        }

        if (first === 0xfd) {
            return BigInt(this.readUInt16LE());
        }

        if (first === 0xfe) {
            return BigInt(this.readUInt32LE());
        }

        // first === 0xff
        return this.readUInt64LE();
    }

    /**
     * Reads a length-prefixed byte array (VarInt length + bytes).
     *
     * @returns Uint8Array view into the buffer
     * @throws RangeError if reading past end of buffer
     *
     * @example
     * ```typescript
     * const reader = BinaryReader.fromHex('04deadbeef');
     * reader.readVarBytes(); // Uint8Array [0xde, 0xad, 0xbe, 0xef]
     * ```
     */
    public readVarBytes(): Uint8Array {
        const length = this.readVarInt();
        return this.readBytes(length);
    }

    /**
     * Reads an array of length-prefixed byte arrays.
     *
     * Format: VarInt count + (VarInt length + bytes) for each item.
     *
     * @returns Array of Uint8Array views
     * @throws RangeError if reading past end of buffer
     */
    public readVector(): Uint8Array[] {
        const count = this.readVarInt();
        const result: Uint8Array[] = [];
        for (let i = 0; i < count; i++) {
            result.push(this.readVarBytes());
        }
        return result;
    }

    /**
     * Peeks at the next byte without advancing the position.
     *
     * @returns The next byte value, or undefined if at end
     */
    public peek(): number | undefined {
        if (this.#offset >= this.#data.length) {
            return undefined;
        }
        return this.#data[this.#offset];
    }

    /**
     * Skips a specified number of bytes.
     *
     * @param length - Number of bytes to skip
     * @throws RangeError if skipping past end of buffer
     */
    public skip(length: number): void {
        if (this.#offset + length > this.#data.length) {
            throw new RangeError('Skip past end of buffer');
        }
        this.#offset += length;
    }

    /**
     * Resets the read position to the beginning.
     */
    public reset(): void {
        this.#offset = 0;
    }

    /**
     * Checks if there are more bytes to read.
     *
     * @returns True if there are remaining bytes
     */
    public hasMore(): boolean {
        return this.#offset < this.#data.length;
    }
}
