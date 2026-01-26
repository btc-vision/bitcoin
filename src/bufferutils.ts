/**
 * Utilities for reading and writing Bitcoin data types.
 *
 * @packageDocumentation
 */
import * as varuint from 'varuint-bitcoin';
import * as u8 from './uint8array-utils.js';

export { varuint };

function verifuint(value: number, max: number): void {
    if (typeof value !== 'number') throw new Error('cannot write a non-number as a number');
    if (value < 0) throw new Error('specified a negative value for writing an unsigned value');
    if (value > max) throw new Error('RangeError: value out of range');
    if (Math.floor(value) !== value) throw new Error('value has a fractional component');
}

export function readUInt64LE(buffer: Uint8Array, offset: number): bigint {
    return u8.readUInt64LE(buffer, offset);
}

export function writeUInt64LE(buffer: Uint8Array, value: bigint, offset: number): number {
    return u8.writeUInt64LE(buffer, value, offset);
}

export function reverseBuffer(buffer: Uint8Array): Uint8Array {
    return u8.reverse(buffer);
}

export function cloneBuffer(buffer: Uint8Array): Uint8Array {
    return u8.clone(buffer);
}

export class ByteWriter {
    public buffer: Uint8Array;
    public offset: number;

    constructor(buffer: Uint8Array, offset: number = 0) {
        if (!(buffer instanceof Uint8Array)) {
            throw new TypeError('buffer must be a Uint8Array');
        }
        if (typeof offset !== 'number' || offset < 0 || !Number.isInteger(offset)) {
            throw new TypeError('offset must be a non-negative integer');
        }
        this.buffer = buffer;
        this.offset = offset;
    }

    static withCapacity(size: number): ByteWriter {
        return new ByteWriter(new Uint8Array(size));
    }

    writeUInt8(value: number): void {
        this.buffer[this.offset++] = value & 0xff;
    }

    writeInt32(value: number): void {
        this.offset = u8.writeInt32LE(this.buffer, value, this.offset);
    }

    writeUInt32(value: number): void {
        this.offset = u8.writeUInt32LE(this.buffer, value, this.offset);
    }

    writeUInt64(value: bigint): void {
        this.offset = u8.writeUInt64LE(this.buffer, value, this.offset);
    }

    writeVarInt(value: number): void {
        const encode = varuint.encode(value, this.buffer, this.offset);
        this.offset += encode.bytes;
    }

    writeSlice(slice: Uint8Array): void {
        if (this.buffer.length < this.offset + slice.length) {
            throw new Error('Cannot write slice out of bounds');
        }
        this.buffer.set(slice, this.offset);
        this.offset += slice.length;
    }

    writeVarSlice(slice: Uint8Array): void {
        this.writeVarInt(slice.length);
        this.writeSlice(slice);
    }

    writeVector(vector: Uint8Array[]): void {
        this.writeVarInt(vector.length);
        for (const buf of vector) {
            this.writeVarSlice(buf);
        }
    }

    end(): Uint8Array {
        if (this.buffer.length === this.offset) {
            return this.buffer;
        }
        throw new Error(`buffer size ${this.buffer.length}, offset ${this.offset}`);
    }
}

// Aliases for backward compatibility
export { ByteWriter as BufferWriter };

export class ByteReader {
    public buffer: Uint8Array;
    public offset: number;

    constructor(buffer: Uint8Array, offset: number = 0) {
        if (!(buffer instanceof Uint8Array)) {
            throw new TypeError('buffer must be a Uint8Array');
        }
        if (typeof offset !== 'number' || offset < 0 || !Number.isInteger(offset)) {
            throw new TypeError('offset must be a non-negative integer');
        }
        this.buffer = buffer;
        this.offset = offset;
    }

    readUInt8(): number {
        const result = this.buffer[this.offset];
        this.offset++;
        return result;
    }

    readInt32(): number {
        const result = u8.readInt32LE(this.buffer, this.offset);
        this.offset += 4;
        return result;
    }

    readUInt32(): number {
        const result = u8.readUInt32LE(this.buffer, this.offset);
        this.offset += 4;
        return result;
    }

    readUInt64(): bigint {
        const result = u8.readUInt64LE(this.buffer, this.offset);
        this.offset += 8;
        return result;
    }

    readVarInt(): number {
        const vi = varuint.decode(this.buffer, this.offset);
        this.offset += vi.bytes;
        return vi.numberValue || 0;
    }

    readSlice(n: number): Uint8Array {
        if (this.buffer.length < this.offset + n) {
            throw new Error('Cannot read slice out of bounds');
        }
        const result = this.buffer.slice(this.offset, this.offset + n);
        this.offset += n;
        return result;
    }

    readVarSlice(): Uint8Array {
        return this.readSlice(this.readVarInt());
    }

    readVector(): Uint8Array[] {
        const count = this.readVarInt();
        const vector: Uint8Array[] = [];
        for (let i = 0; i < count; i++) {
            vector.push(this.readVarSlice());
        }
        return vector;
    }
}

// Alias for backward compatibility
export { ByteReader as BufferReader };
