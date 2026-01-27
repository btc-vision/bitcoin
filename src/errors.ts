/**
 * Custom error types for the Bitcoin library.
 * @packageDocumentation
 */

/**
 * Base error class for all Bitcoin-related errors.
 *
 * @example
 * ```typescript
 * import { BitcoinError } from '@btc-vision/bitcoin';
 *
 * if (error instanceof BitcoinError) {
 *     console.log('Bitcoin library error:', error.message);
 * }
 * ```
 */
export class BitcoinError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BitcoinError';
        // Maintains proper stack trace for where error was thrown (V8 engines)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, BitcoinError);
        }
    }
}

/**
 * Error thrown when input validation fails.
 *
 * @example
 * ```typescript
 * import { ValidationError } from '@btc-vision/bitcoin';
 *
 * throw new ValidationError('Invalid public key length');
 * ```
 */
export class ValidationError extends BitcoinError {
    constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
    }
}

/**
 * Error thrown when an invalid input is provided to a transaction.
 *
 * @example
 * ```typescript
 * import { InvalidInputError } from '@btc-vision/bitcoin';
 *
 * throw new InvalidInputError('Input index out of range');
 * ```
 */
export class InvalidInputError extends BitcoinError {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidInputError';
    }
}

/**
 * Error thrown when an invalid output is provided to a transaction.
 *
 * @example
 * ```typescript
 * import { InvalidOutputError } from '@btc-vision/bitcoin';
 *
 * throw new InvalidOutputError('Output value exceeds maximum');
 * ```
 */
export class InvalidOutputError extends BitcoinError {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidOutputError';
    }
}

/**
 * Error thrown when a script operation fails.
 *
 * @example
 * ```typescript
 * import { ScriptError } from '@btc-vision/bitcoin';
 *
 * throw new ScriptError('Failed to decompile script');
 * ```
 */
export class ScriptError extends BitcoinError {
    constructor(message: string) {
        super(message);
        this.name = 'ScriptError';
    }
}

/**
 * Error thrown when a PSBT operation fails.
 *
 * @example
 * ```typescript
 * import { PsbtError } from '@btc-vision/bitcoin';
 *
 * throw new PsbtError('Cannot finalize unsigned input');
 * ```
 */
export class PsbtError extends BitcoinError {
    constructor(message: string) {
        super(message);
        this.name = 'PsbtError';
    }
}

/**
 * Error thrown when ECC library is not initialized.
 *
 * @example
 * ```typescript
 * import { EccError } from '@btc-vision/bitcoin';
 *
 * throw new EccError('ECC library must be initialized before use');
 * ```
 */
export class EccError extends BitcoinError {
    constructor(message: string) {
        super(message);
        this.name = 'EccError';
    }
}

/**
 * Error thrown when address encoding/decoding fails.
 *
 * @example
 * ```typescript
 * import { AddressError } from '@btc-vision/bitcoin';
 *
 * throw new AddressError('Invalid address checksum');
 * ```
 */
export class AddressError extends BitcoinError {
    constructor(message: string) {
        super(message);
        this.name = 'AddressError';
    }
}

/**
 * Error thrown when signature operations fail.
 *
 * @example
 * ```typescript
 * import { SignatureError } from '@btc-vision/bitcoin';
 *
 * throw new SignatureError('Invalid signature format');
 * ```
 */
export class SignatureError extends BitcoinError {
    constructor(message: string) {
        super(message);
        this.name = 'SignatureError';
    }
}
