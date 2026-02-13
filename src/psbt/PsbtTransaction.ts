import type { Transaction as ITransaction, TransactionFromBuffer } from 'bip174';
import { fromHex, reverse } from '../io/index.js';
import { Transaction } from '../transaction.js';
import type { Bytes32 } from '../types.js';
import { checkTxEmpty } from './validation.js';
import type { PsbtTxOutput, TransactionInput } from './types.js';

/**
 * Empty version-2 transaction with zero inputs and zero outputs.
 * Used as the default buffer when constructing a new PsbtTransaction.
 *
 * Layout: [version(4LE)] [inputCount(varint)] [outputCount(varint)] [locktime(4LE)]
 *         [02 00 00 00]  [00]                 [00]                  [00 00 00 00]
 */
const EMPTY_TX_V2 = new Uint8Array([2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

/**
 * This class implements the Transaction interface from bip174 library.
 * It contains a bitcoinjs-lib Transaction object.
 */
export class PsbtTransaction implements ITransaction {
    public tx: Transaction;

    public constructor(buffer: Uint8Array = EMPTY_TX_V2) {
        this.tx = Transaction.fromBuffer(buffer);
        checkTxEmpty(this.tx);
        Object.defineProperty(this, 'tx', {
            enumerable: false,
            writable: true,
        });
    }

    public getInputOutputCounts(): {
        inputCount: number;
        outputCount: number;
    } {
        return {
            inputCount: this.tx.ins.length,
            outputCount: this.tx.outs.length,
        };
    }

    public addInput(input: TransactionInput): void {
        if (
            input.hash === undefined ||
            input.index === undefined ||
            (!(input.hash instanceof Uint8Array) && typeof input.hash !== 'string') ||
            typeof input.index !== 'number'
        ) {
            throw new Error('Error adding input.');
        }
        const hash = (
            typeof input.hash === 'string' ? reverse(fromHex(input.hash)) : input.hash
        ) as Bytes32;

        this.tx.addInput(hash, input.index, input.sequence);
    }

    public addOutput(output: PsbtTxOutput): void {
        if (
            output.script === undefined ||
            output.value === undefined ||
            !(output.script instanceof Uint8Array) ||
            typeof output.value !== 'bigint'
        ) {
            throw new Error('Error adding output.');
        }
        this.tx.addOutput(output.script, output.value);
    }

    public toBuffer(): Uint8Array {
        return this.tx.toBuffer();
    }
}

/**
 * This function is needed to pass to the bip174 base class's fromBuffer.
 * It takes the "transaction buffer" portion of the psbt buffer and returns a
 * Transaction (From the bip174 library) interface.
 */
export const transactionFromBuffer: TransactionFromBuffer = (buffer: Uint8Array): ITransaction =>
    new PsbtTransaction(buffer);
