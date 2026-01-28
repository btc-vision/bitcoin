/**
 * Stateful binary writer with a single DataView instance.
 *
 * Zero allocations during write operations. The DataView is created once
 * in the constructor and reused for all writes.
 *
 * @packageDocumentation
 */

import { toHex } from './hex.js';

/**
 * High-performance binary writer for serializing binary data.
 *
 * Creates exactly ONE DataView instance that is reused for all write operations.
 * This eliminates garbage collection pressure from repeated DataView allocations.
 *
 * Methods return `this` for chaining.
 *
 * @example
 * ```typescript
 * import { BinaryWriter } from '@btc-vision/bitcoin';
 *
 * // Serialize a simple structure
 * const writer = new BinaryWriter(16);
 * writer
 *     .writeInt32LE(1)        // version
 *     .writeUInt32LE(0)       // input count
 *     .writeUInt32LE(0)       // output count
 *     .writeUInt32LE(0);      // locktime
 *
 * const bytes = writer.finish();
 * ```
 */
export class BinaryWriter {
    /**
     * The underlying byte array.
     */
    readonly #data: Uint8Array;

    /**
     * Single DataView instance reused for all writes.
     */
    readonly #view: DataView;

    /**
     * Current write position.
     */
    #offset: number;

    /**
     * Creates a new BinaryWriter with a pre-allocated buffer.
     *
     * @param size - Size of the buffer in bytes
     *
     * @example
     * ```typescript
     * import { BinaryWriter } from '@btc-vision/bitcoin';
     *
     * const writer = new BinaryWriter(1024);
     * writer.writeUInt32LE(42);
     * ```
     */
    public constructor(size: number);

    /**
     * Creates a new BinaryWriter wrapping an existing buffer.
     *
     * @param buffer - Existing buffer to write into
     * @param offset - Initial write position (default 0)
     *
     * @example
     * ```typescript
     * import { BinaryWriter } from '@btc-vision/bitcoin';
     *
     * const buffer = new Uint8Array(1024);
     * const writer = new BinaryWriter(buffer, 10); // Start at offset 10
     * writer.writeUInt32LE(42);
     * ```
     */
    public constructor(buffer: Uint8Array, offset?: number);

    public constructor(arg: number | Uint8Array, offset: number = 0) {
        if (typeof arg === 'number') {
            this.#data = new Uint8Array(arg);
            this.#offset = 0;
        } else {
            this.#data = arg;
            this.#offset = offset;
        }
        this.#view = new DataView(this.#data.buffer, this.#data.byteOffset, this.#data.byteLength);
    }

    /**
     * Current write position in the buffer.
     */
    public get offset(): number {
        return this.#offset;
    }

    /**
     * Sets the write position.
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
     * Total capacity of the underlying buffer.
     */
    public get capacity(): number {
        return this.#data.length;
    }

    /**
     * Number of bytes remaining in the buffer.
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
     * Creates a BinaryWriter with automatic capacity management.
     *
     * Initial capacity is 256 bytes, grows as needed.
     *
     * @returns A new GrowableBinaryWriter instance
     *
     * @example
     * ```typescript
     * import { BinaryWriter } from '@btc-vision/bitcoin';
     *
     * const writer = BinaryWriter.growable();
     * writer.writeUInt32LE(1);
     * writer.writeBytes(new Uint8Array(1000)); // Automatically grows
     * ```
     */
    public static growable(initialCapacity: number = 256): GrowableBinaryWriter {
        return new GrowableBinaryWriter(initialCapacity);
    }

    /**
     * Writes an 8-bit unsigned integer.
     *
     * @param value - Value to write (0-255)
     * @returns This writer for chaining
     * @throws RangeError if writing past end of buffer
     *
     * @example
     * ```typescript
     * writer.writeUInt8(255);
     * ```
     */
    public writeUInt8(value: number): this {
        if (this.#offset >= this.#data.length) {
            throw new RangeError('Write past end of buffer');
        }
        this.#data[this.#offset++] = value & 0xff;
        return this;
    }

    /**
     * Writes an 8-bit signed integer.
     *
     * @param value - Value to write (-128 to 127)
     * @returns This writer for chaining
     * @throws RangeError if writing past end of buffer
     */
    public writeInt8(value: number): this {
        return this.writeUInt8(value < 0 ? value + 256 : value);
    }

    /**
     * Writes a 16-bit unsigned integer in little-endian format.
     *
     * @param value - Value to write (0-65535)
     * @returns This writer for chaining
     * @throws RangeError if writing past end of buffer
     *
     * @example
     * ```typescript
     * writer.writeUInt16LE(1); // Writes 01 00
     * ```
     */
    public writeUInt16LE(value: number): this {
        if (this.#offset + 2 > this.#data.length) {
            throw new RangeError('Write past end of buffer');
        }
        this.#view.setUint16(this.#offset, value, true);
        this.#offset += 2;
        return this;
    }

    /**
     * Writes a 16-bit signed integer in little-endian format.
     *
     * @param value - Value to write (-32768 to 32767)
     * @returns This writer for chaining
     * @throws RangeError if writing past end of buffer
     */
    public writeInt16LE(value: number): this {
        if (this.#offset + 2 > this.#data.length) {
            throw new RangeError('Write past end of buffer');
        }
        this.#view.setInt16(this.#offset, value, true);
        this.#offset += 2;
        return this;
    }

    /**
     * Writes a 32-bit unsigned integer in little-endian format.
     *
     * @param value - Value to write (0 to 4294967295)
     * @returns This writer for chaining
     * @throws RangeError if writing past end of buffer
     *
     * @example
     * ```typescript
     * writer.writeUInt32LE(1); // Writes 01 00 00 00
     * ```
     */
    public writeUInt32LE(value: number): this {
        if (this.#offset + 4 > this.#data.length) {
            throw new RangeError('Write past end of buffer');
        }
        this.#view.setUint32(this.#offset, value, true);
        this.#offset += 4;
        return this;
    }

    /**
     * Writes a 32-bit signed integer in little-endian format.
     *
     * @param value - Value to write (-2147483648 to 2147483647)
     * @returns This writer for chaining
     * @throws RangeError if writing past end of buffer
     *
     * @example
     * ```typescript
     * writer.writeInt32LE(-1); // Writes ff ff ff ff
     * ```
     */
    public writeInt32LE(value: number): this {
        if (this.#offset + 4 > this.#data.length) {
            throw new RangeError('Write past end of buffer');
        }
        this.#view.setInt32(this.#offset, value, true);
        this.#offset += 4;
        return this;
    }

    /**
     * Writes a 64-bit unsigned integer in little-endian format.
     *
     * @param value - Value to write as bigint
     * @returns This writer for chaining
     * @throws RangeError if writing past end of buffer
     *
     * @example
     * ```typescript
     * writer.writeUInt64LE(50000n); // Writes 50 c3 00 00 00 00 00 00
     * ```
     */
    public writeUInt64LE(value: bigint): this {
        if (this.#offset + 8 > this.#data.length) {
            throw new RangeError('Write past end of buffer');
        }
        this.#view.setBigUint64(this.#offset, value, true);
        this.#offset += 8;
        return this;
    }

    /**
     * Writes a 64-bit signed integer in little-endian format.
     *
     * @param value - Value to write as bigint
     * @returns This writer for chaining
     * @throws RangeError if writing past end of buffer
     */
    public writeInt64LE(value: bigint): this {
        if (this.#offset + 8 > this.#data.length) {
            throw new RangeError('Write past end of buffer');
        }
        this.#view.setBigInt64(this.#offset, value, true);
        this.#offset += 8;
        return this;
    }

    /**
     * Writes raw bytes.
     *
     * @param bytes - Bytes to write
     * @returns This writer for chaining
     * @throws RangeError if writing past end of buffer
     *
     * @example
     * ```typescript
     * writer.writeBytes(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
     * ```
     */
    public writeBytes(bytes: Uint8Array): this {
        if (this.#offset + bytes.length > this.#data.length) {
            throw new RangeError('Write past end of buffer');
        }
        this.#data.set(bytes, this.#offset);
        this.#offset += bytes.length;
        return this;
    }

    /**
     * Writes a Bitcoin CompactSize variable-length integer.
     *
     * CompactSize encoding:
     * - 0x00-0xFC: 1 byte (value as-is)
     * - 0xFD-0xFFFF: 3 bytes (0xFD + 2-byte LE uint16)
     * - 0x10000-0xFFFFFFFF: 5 bytes (0xFE + 4-byte LE uint32)
     * - Larger: 9 bytes (0xFF + 8-byte LE uint64)
     *
     * @param value - Value to write
     * @returns This writer for chaining
     * @throws RangeError if writing past end of buffer
     *
     * @example
     * ```typescript
     * writer.writeVarInt(252);    // Writes fc
     * writer.writeVarInt(253);    // Writes fd fd 00
     * writer.writeVarInt(65535);  // Writes fd ff ff
     * writer.writeVarInt(65536);  // Writes fe 00 00 01 00
     * ```
     */
    public writeVarInt(value: number): this {
        if (value < 0xfd) {
            return this.writeUInt8(value);
        }

        if (value <= 0xffff) {
            this.writeUInt8(0xfd);
            return this.writeUInt16LE(value);
        }

        if (value <= 0xffffffff) {
            this.writeUInt8(0xfe);
            return this.writeUInt32LE(value);
        }

        this.writeUInt8(0xff);
        return this.writeUInt64LE(BigInt(value));
    }

    /**
     * Writes a Bitcoin CompactSize variable-length integer from bigint.
     *
     * @param value - Value to write as bigint
     * @returns This writer for chaining
     * @throws RangeError if writing past end of buffer
     */
    public writeVarIntBig(value: bigint): this {
        if (value < 0xfdn) {
            return this.writeUInt8(Number(value));
        }

        if (value <= 0xffffn) {
            this.writeUInt8(0xfd);
            return this.writeUInt16LE(Number(value));
        }

        if (value <= 0xffffffffn) {
            this.writeUInt8(0xfe);
            return this.writeUInt32LE(Number(value));
        }

        this.writeUInt8(0xff);
        return this.writeUInt64LE(value);
    }

    /**
     * Writes a length-prefixed byte array (VarInt length + bytes).
     *
     * @param bytes - Bytes to write
     * @returns This writer for chaining
     * @throws RangeError if writing past end of buffer
     *
     * @example
     * ```typescript
     * writer.writeVarBytes(new Uint8Array([0xde, 0xad])); // Writes 02 de ad
     * ```
     */
    public writeVarBytes(bytes: Uint8Array): this {
        this.writeVarInt(bytes.length);
        return this.writeBytes(bytes);
    }

    /**
     * Writes an array of length-prefixed byte arrays.
     *
     * Format: VarInt count + (VarInt length + bytes) for each item.
     *
     * @param vector - Array of byte arrays to write
     * @returns This writer for chaining
     * @throws RangeError if writing past end of buffer
     */
    public writeVector(vector: readonly Uint8Array[]): this {
        this.writeVarInt(vector.length);
        for (const item of vector) {
            this.writeVarBytes(item);
        }
        return this;
    }

    /**
     * Fills a region with a specific byte value.
     *
     * @param value - Byte value to fill with
     * @param length - Number of bytes to fill
     * @returns This writer for chaining
     * @throws RangeError if writing past end of buffer
     */
    public fill(value: number, length: number): this {
        if (this.#offset + length > this.#data.length) {
            throw new RangeError('Write past end of buffer');
        }
        this.#data.fill(value, this.#offset, this.#offset + length);
        this.#offset += length;
        return this;
    }

    /**
     * Skips a specified number of bytes (leaves them unchanged).
     *
     * @param length - Number of bytes to skip
     * @returns This writer for chaining
     * @throws RangeError if skipping past end of buffer
     */
    public skip(length: number): this {
        if (this.#offset + length > this.#data.length) {
            throw new RangeError('Skip past end of buffer');
        }
        this.#offset += length;
        return this;
    }

    /**
     * Resets the write position to the beginning.
     *
     * @returns This writer for chaining
     */
    public reset(): this {
        this.#offset = 0;
        return this;
    }

    /**
     * Verifies the buffer was fully written and returns it.
     *
     * Unlike {@link finish}, this method throws if the writer has not
     * written exactly to the end of the buffer.
     *
     * @returns The underlying buffer
     * @throws Error if the buffer was not fully written
     *
     * @example
     * ```typescript
     * const writer = new BinaryWriter(8);
     * writer.writeUInt32LE(1);
     * writer.writeUInt32LE(2);
     * const bytes = writer.end(); // OK: wrote exactly 8 bytes
     *
     * const writer2 = new BinaryWriter(8);
     * writer2.writeUInt32LE(1);
     * writer2.end(); // throws: buffer size 8, offset 4
     * ```
     */
    public end(): Uint8Array {
        if (this.#offset === this.#data.length) {
            return this.#data;
        }
        throw new Error(`buffer size ${this.#data.length}, offset ${this.#offset}`);
    }

    /**
     * Returns the written portion of the buffer.
     *
     * If the entire buffer was written, returns the buffer directly (no copy).
     * Otherwise, returns a subarray view.
     *
     * @returns Uint8Array containing the written data
     *
     * @example
     * ```typescript
     * const writer = new BinaryWriter(100);
     * writer.writeUInt32LE(42);
     * const bytes = writer.finish(); // 4 bytes
     * ```
     */
    public finish(): Uint8Array {
        return this.#offset === this.#data.length
            ? this.#data
            : this.#data.subarray(0, this.#offset);
    }

    /**
     * Returns the written portion as a hex string.
     *
     * @returns Hex string representation
     *
     * @example
     * ```typescript
     * const writer = new BinaryWriter(4);
     * writer.writeUInt32LE(1);
     * writer.toHex(); // '01000000'
     * ```
     */
    public toHex(): string {
        return toHex(this.finish());
    }
}

/**
 * A BinaryWriter that automatically grows its buffer as needed.
 *
 * Use when the final size is unknown.
 *
 * @example
 * ```typescript
 * const writer = BinaryWriter.growable();
 * writer.writeBytes(largeData); // Automatically grows
 * const bytes = writer.finish();
 * ```
 */
export class GrowableBinaryWriter {
    #data: Uint8Array;
    #view: DataView;
    #offset: number = 0;

    /**
     * Creates a new GrowableBinaryWriter.
     *
     * @param initialCapacity - Initial buffer size (default 256)
     */
    public constructor(initialCapacity: number = 256) {
        this.#data = new Uint8Array(initialCapacity);
        this.#view = new DataView(this.#data.buffer);
    }

    /**
     * Current write position.
     */
    public get offset(): number {
        return this.#offset;
    }

    /**
     * Sets the write position.
     *
     * @param value - New offset value
     * @throws RangeError if offset is negative
     */
    public set offset(value: number) {
        if (value < 0) {
            throw new RangeError(`Offset ${value} cannot be negative`);
        }
        // GrowableBinaryWriter can grow, so allow setting offset beyond current capacity
        this.#offset = value;
    }

    /**
     * Current buffer capacity.
     */
    public get capacity(): number {
        return this.#data.length;
    }

    public writeUInt8(value: number): this {
        this.#ensureCapacity(1);
        this.#data[this.#offset++] = value & 0xff;
        return this;
    }

    public writeUInt16LE(value: number): this {
        this.#ensureCapacity(2);
        this.#view.setUint16(this.#offset, value, true);
        this.#offset += 2;
        return this;
    }

    public writeUInt32LE(value: number): this {
        this.#ensureCapacity(4);
        this.#view.setUint32(this.#offset, value, true);
        this.#offset += 4;
        return this;
    }

    public writeInt32LE(value: number): this {
        this.#ensureCapacity(4);
        this.#view.setInt32(this.#offset, value, true);
        this.#offset += 4;
        return this;
    }

    public writeUInt64LE(value: bigint): this {
        this.#ensureCapacity(8);
        this.#view.setBigUint64(this.#offset, value, true);
        this.#offset += 8;
        return this;
    }

    public writeBytes(bytes: Uint8Array): this {
        this.#ensureCapacity(bytes.length);
        this.#data.set(bytes, this.#offset);
        this.#offset += bytes.length;
        return this;
    }

    public writeVarInt(value: number): this {
        if (value < 0xfd) {
            return this.writeUInt8(value);
        }
        if (value <= 0xffff) {
            this.writeUInt8(0xfd);
            return this.writeUInt16LE(value);
        }
        if (value <= 0xffffffff) {
            this.writeUInt8(0xfe);
            return this.writeUInt32LE(value);
        }
        this.writeUInt8(0xff);
        return this.writeUInt64LE(BigInt(value));
    }

    public writeVarBytes(bytes: Uint8Array): this {
        this.writeVarInt(bytes.length);
        return this.writeBytes(bytes);
    }

    public writeVector(vector: readonly Uint8Array[]): this {
        this.writeVarInt(vector.length);
        for (const item of vector) {
            this.writeVarBytes(item);
        }
        return this;
    }

    /**
     * Returns the written data as a new Uint8Array.
     *
     * @returns Copy of the written data
     */
    public finish(): Uint8Array {
        return this.#data.slice(0, this.#offset);
    }

    /**
     * Returns the written data as a hex string.
     *
     * @returns Hex string representation
     */
    public toHex(): string {
        return toHex(this.finish());
    }

    /**
     * Ensures the buffer has enough space for additional bytes.
     *
     * @param additionalBytes - Number of additional bytes needed
     */
    #ensureCapacity(additionalBytes: number): void {
        const required = this.#offset + additionalBytes;
        if (required <= this.#data.length) {
            return;
        }

        // Grow by at least 2x or to required size
        let newCapacity = this.#data.length * 2;
        while (newCapacity < required) {
            newCapacity *= 2;
        }

        const newData = new Uint8Array(newCapacity);
        newData.set(this.#data.subarray(0, this.#offset));
        this.#data = newData;
        this.#view = new DataView(this.#data.buffer);
    }
}
