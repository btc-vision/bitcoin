/**
 * PSBT validation utilities
 * @packageDocumentation
 */

import type { PsbtInput } from 'bip174';
import { equals, reverse, toHex } from '../io/index.js';
import type { P2SHPayment, Payment, PaymentOpts } from '../payments/index.js';
import * as payments from '../payments/index.js';
import { checkTaprootInputForSigs, isTaprootInput } from './bip371.js';
import { checkInputForSig, pubkeyInScript } from './psbtutils.js';
import * as bscript from '../script.js';
import type { Transaction } from '../transaction.js';
import type { PsbtCacheInterface as PsbtCache } from './types.js';
import type { PublicKey, Script } from '../types.js';

/**
 * Validates that a number is a valid 32-bit unsigned integer.
 * @param num - The number to validate
 * @throws {Error} If the number is not a valid 32-bit integer
 */
export function check32Bit(num: number): void {
    if (typeof num !== 'number' || num !== Math.floor(num) || num > 0xffffffff || num < 0) {
        throw new Error('Invalid 32 bit integer');
    }
}

/**
 * Checks if the cache is in a valid state for export.
 * @param cache - The PSBT cache to check
 * @throws {Error} If the cache is not BIP174 compliant
 */
export function checkCache(cache: PsbtCache): void {
    if (cache.unsafeSignNonSegwit) {
        throw new Error('Not BIP174 compliant, can not export');
    }
}

/**
 * Checks if a PSBT input has been finalized.
 * @param input - The PSBT input to check
 * @returns True if the input has finalScriptSig or finalScriptWitness
 */
export function isFinalized(input: PsbtInput): boolean {
    return !!input.finalScriptSig || !!input.finalScriptWitness;
}

/**
 * Validates that a transaction has empty scriptSigs and witnesses.
 * @param tx - The transaction to check
 * @throws {Error} If any input has non-empty scripts
 */
export function checkTxEmpty(tx: Transaction): void {
    const isEmpty = tx.ins.every(
        (input) =>
            input.script &&
            input.script.length === 0 &&
            input.witness &&
            input.witness.length === 0,
    );
    if (!isEmpty) {
        throw new Error('Format Error: Transaction ScriptSigs are not empty');
    }
}

/**
 * Checks and caches a transaction input to detect duplicates.
 * @param cache - The PSBT cache
 * @param input - The input to check
 * @throws {Error} If a duplicate input is detected
 */
export function checkTxInputCache(
    cache: PsbtCache,
    input: { hash: Uint8Array; index: number },
): void {
    const reversed = reverse(new Uint8Array(input.hash));
    const key = `${toHex(reversed)}:${input.index}`;
    if (cache.txInCache[key]) throw new Error('Duplicate input detected.');
    (cache.txInCache as Record<string, number>)[key] = 1;
}

/**
 * Checks all transaction inputs for duplicates.
 * @param tx - The transaction to check
 * @param cache - The PSBT cache
 * @throws {Error} If duplicate inputs are detected
 */
export function checkTxForDupeIns(tx: Transaction, cache: PsbtCache): void {
    tx.ins.forEach((input) => {
        checkTxInputCache(cache, input);
    });
}

/**
 * Checks if any inputs have partial signatures that would prevent modification.
 * @param inputs - The PSBT inputs to check
 * @param action - The action being attempted (for error message)
 * @param hasSignaturesCache - Optional cached flag (true = definitely has sigs, false = check needed)
 * @throws {Error} If signatures exist and prevent modification
 */
export function checkInputsForPartialSig(
    inputs: PsbtInput[],
    action: string,
    hasSignaturesCache?: boolean,
): void {
    // Fast path: if cache says no signatures, skip entirely (O(1))
    if (hasSignaturesCache === false) {
        return;
    }

    // Only do full validation if signatures might exist
    inputs.forEach((input) => {
        const throws = isTaprootInput(input)
            ? checkTaprootInputForSigs(input, action)
            : checkInputForSig(input, action);
        if (throws) throw new Error('Can not modify transaction, signatures exist.');
    });
}

/**
 * Validates that partial signature sighash types match the input's sighash type.
 * @param input - The PSBT input to check
 * @throws {Error} If sighash types don't match
 */
export function checkPartialSigSighashes(input: PsbtInput): void {
    if (!input.sighashType || !input.partialSig) return;
    const { partialSig, sighashType } = input;
    partialSig.forEach((pSig) => {
        const { hashType } = bscript.signature.decode(pSig.signature);
        if (sighashType !== hashType) {
            throw new Error('Signature sighash does not match input sighash type');
        }
    });
}

/**
 * Validates that a pubkey exists in a script.
 * @param pubkey - The pubkey to find
 * @param script - The script to search
 * @param action - The action being attempted (for error message)
 * @throws {Error} If the pubkey is not found in the script
 */
export function checkScriptForPubkey(pubkey: PublicKey, script: Script, action: string): void {
    if (!pubkeyInScript(pubkey, script)) {
        throw new Error(`Can not ${action} for this input with the key ${toHex(pubkey)}`);
    }
}

/**
 * Creates a script checker function for validating redeem/witness scripts.
 * @param payment - The payment function to use (p2sh or p2wsh)
 * @param paymentScriptName - Name for error messages
 * @returns A function that validates scripts match
 */
export function scriptCheckerFactory(
    payment: (a: Omit<Payment, 'name'>, opts?: PaymentOpts) => Payment,
    paymentScriptName: string,
): (idx: number, scriptPubKey: Script, redeemScript: Script, ioType: 'input' | 'output') => void {
    return (
        inputIndex: number,
        scriptPubKey: Script,
        redeemScript: Script,
        ioType: 'input' | 'output',
    ): void => {
        const redeemScriptOutput = payment({
            redeem: { output: redeemScript },
        } as P2SHPayment).output as Uint8Array;

        if (!equals(scriptPubKey, redeemScriptOutput)) {
            throw new Error(
                `${paymentScriptName} for ${ioType} #${inputIndex} doesn't match the scriptPubKey in the prevout`,
            );
        }
    };
}

/**
 * Validates that a redeem script matches the scriptPubKey.
 */
export const checkRedeemScript = scriptCheckerFactory(payments.p2sh, 'Redeem script');

/**
 * Validates that a witness script matches the scriptPubKey.
 */
export const checkWitnessScript = scriptCheckerFactory(payments.p2wsh, 'Witness script');
