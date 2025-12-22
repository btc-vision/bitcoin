/**
 * Type definitions for typeforce library
 */

/**
 * Typeforce type validator - validates that a value matches a given type.
 */
type TypeforceValidator = (value: unknown) => boolean;

/**
 * Interface representing the typeforce library's API.
 */
interface TypeforceLib {
    (type: unknown, value: unknown): void;
    Number: TypeforceValidator;
    Array: TypeforceValidator;
    Boolean: TypeforceValidator;
    String: TypeforceValidator;
    Buffer: TypeforceValidator;
    Hex: TypeforceValidator;
    Null: TypeforceValidator;
    Function: TypeforceValidator;
    UInt8: TypeforceValidator;
    UInt32: TypeforceValidator;
    UInt53: TypeforceValidator;
    BufferN: (n: number) => TypeforceValidator;
    maybe: (type: unknown) => TypeforceValidator;
    tuple: (...types: unknown[]) => TypeforceValidator;
    oneOf: (...types: unknown[]) => TypeforceValidator;
    arrayOf: (type: unknown) => TypeforceValidator;
    Object: TypeforceValidator;
    anyOf: (...types: unknown[]) => TypeforceValidator;
}

declare module 'typeforce' {
    const typeforce: TypeforceLib;
    export = typeforce;
}
