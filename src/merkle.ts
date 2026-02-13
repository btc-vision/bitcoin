/**
 * Calculates the Merkle root of an array of Uint8Arrays using a specified digest function.
 *
 * @param values - The array of Uint8Arrays.
 * @param digestFn - The digest function used to calculate the hash of the concatenated arrays.
 * @returns The Merkle root as a Uint8Array.
 * @throws {TypeError} If the values parameter is not an array or the digestFn parameter is not a function.
 */
export function fastMerkleRoot(
    values: Uint8Array[],
    digestFn: (b: Uint8Array) => Uint8Array,
): Uint8Array {
    if (!Array.isArray(values)) throw TypeError('Expected values Array');
    if (typeof digestFn !== 'function') throw TypeError('Expected digest Function');

    let length = values.length;
    const results = values.concat();

    while (length > 1) {
        let j = 0;

        for (let i = 0; i < length; i += 2, ++j) {
            const left = results[i] as Uint8Array;
            const right = i + 1 === length ? left : (results[i + 1] as Uint8Array);
            const data = new Uint8Array(left.length + right.length);
            data.set(left);
            data.set(right, left.length);

            results[j] = digestFn(data);
        }

        length = j;
    }

    return results[0] as Uint8Array;
}
