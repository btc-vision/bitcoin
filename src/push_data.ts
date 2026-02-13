import { opcodes } from './opcodes.js';

/**
 * Calculates the encoding length of a number used for push data in Bitcoin transactions.
 * @param i The number to calculate the encoding length for.
 * @returns The encoding length of the number.
 */
export function encodingLength(i: number): number {
    return i < opcodes.OP_PUSHDATA1 ? 1 : i <= 0xff ? 2 : i <= 0xffff ? 3 : 5;
}

/**
 * Encodes a number into a buffer using a variable-length encoding scheme.
 * The encoded buffer is written starting at the specified offset.
 * Returns the size of the encoded buffer.
 *
 * @param buffer - The buffer to write the encoded data into.
 * @param num - The number to encode.
 * @param offset - The offset at which to start writing the encoded buffer.
 * @returns The size of the encoded buffer.
 */
export function encode(buffer: Uint8Array, num: number, offset: number): number {
    const size = encodingLength(num);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    // ~6 bit
    if (size === 1) {
        buffer[offset] = num;

        // 8 bit
    } else if (size === 2) {
        buffer[offset] = opcodes.OP_PUSHDATA1;
        buffer[offset + 1] = num;

        // 16 bit
    } else if (size === 3) {
        buffer[offset] = opcodes.OP_PUSHDATA2;
        view.setUint16(offset + 1, num, true);

        // 32 bit
    } else {
        buffer[offset] = opcodes.OP_PUSHDATA4;
        view.setUint32(offset + 1, num, true);
    }

    return size;
}

/**
 * Decodes a buffer and returns information about the opcode, number, and size.
 * @param buffer - The buffer to decode.
 * @param offset - The offset within the buffer to start decoding.
 * @returns An object containing the opcode, number, and size, or null if decoding fails.
 */
export function decode(
    buffer: Uint8Array,
    offset: number,
): {
    opcode: number;
    number: number;
    size: number;
} | null {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const opcode = buffer[offset] as number;
    let num: number;
    let size: number;

    // ~6 bit
    if (opcode < opcodes.OP_PUSHDATA1) {
        num = opcode;
        size = 1;

        // 8 bit
    } else if (opcode === opcodes.OP_PUSHDATA1) {
        if (offset + 2 > buffer.length) return null;
        num = buffer[offset + 1] as number;
        size = 2;

        // 16 bit
    } else if (opcode === opcodes.OP_PUSHDATA2) {
        if (offset + 3 > buffer.length) return null;
        num = view.getUint16(offset + 1, true);
        size = 3;

        // 32 bit
    } else {
        if (offset + 5 > buffer.length) return null;
        if (opcode !== opcodes.OP_PUSHDATA4) throw new Error('Unexpected opcode');

        num = view.getUint32(offset + 1, true);
        size = 5;
    }

    return {
        opcode,
        number: num,
        size,
    };
}
