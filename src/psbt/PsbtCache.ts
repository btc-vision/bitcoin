import type { PsbtInput, PsbtOutput } from 'bip174';
import * as bscript from '../script.js';
import type { TaprootHashCache, Transaction } from '../transaction.js';
import type { PublicKey, Satoshi, Script, XOnlyPublicKey } from '../types.js';
import { isP2TR, isP2WPKH, pubkeyInScript } from './psbtutils.js';
import { getMeaningfulScript, isPubkeyLike, isSigLike, scriptWitnessToWitnessStack, } from './utils.js';
import type { GetScriptReturn, PrevOut, PsbtOpts } from './types.js';
import { isFinalized } from './validation.js';
import { isUnknownSegwitVersion } from '../address.js';

/**
 * Internal PSBT cache for computed values.
 * Wraps all cache management previously handled by a plain interface + scattered helper functions.
 */
export class PsbtCache {
    public readonly nonWitnessUtxoTxCache: Transaction[];
    public readonly nonWitnessUtxoBufCache: Uint8Array[];
    public readonly txInCache: Record<string, number>;
    public readonly tx: Transaction;
    public unsafeSignNonSegwit: boolean;
    public hasSignatures: boolean;
    public fee: number | undefined;
    public feeRate: number | undefined;
    public extractedTx: Transaction | undefined;
    public prevOuts: readonly PrevOut[] | undefined;
    public signingScripts: readonly Script[] | undefined;
    public values: readonly Satoshi[] | undefined;
    public taprootHashCache: TaprootHashCache | undefined;

    public constructor(tx: Transaction) {
        this.nonWitnessUtxoTxCache = [];
        this.nonWitnessUtxoBufCache = [];
        this.txInCache = {};
        this.tx = tx;
        this.unsafeSignNonSegwit = false;
        this.hasSignatures = false;
    }

    /**
     * Invalidates cached computed values.
     * @param scope - 'full' clears everything (for input changes), 'outputs' clears fee/extract/taproot caches
     */
    public invalidate(scope: 'full' | 'outputs'): void {
        this.fee = undefined;
        this.feeRate = undefined;
        this.extractedTx = undefined;
        this.taprootHashCache = undefined;
        if (scope === 'full') {
            this.prevOuts = undefined;
            this.signingScripts = undefined;
            this.values = undefined;
        }
    }

    public addNonWitnessTxCache(
        input: PsbtInput,
        inputIndex: number,
        txFromBuffer: (buf: Uint8Array) => Transaction,
    ): void {
        if (!input.nonWitnessUtxo) throw new Error('nonWitnessUtxo is required');
        if (input === null || input === Object.prototype) {
            throw new Error('Invalid input object');
        }
        const nonWitnessUtxoBuf = input.nonWitnessUtxo;
        this.nonWitnessUtxoBufCache[inputIndex] = nonWitnessUtxoBuf;
        this.nonWitnessUtxoTxCache[inputIndex] = txFromBuffer(nonWitnessUtxoBuf);
    }

    public getNonWitnessUtxoTx(
        input: PsbtInput,
        inputIndex: number,
        txFromBuffer: (buf: Uint8Array) => Transaction,
    ): Transaction {
        const cached = this.nonWitnessUtxoTxCache[inputIndex];
        if (!cached) {
            this.addNonWitnessTxCache(input, inputIndex, txFromBuffer);
        }
        return this.nonWitnessUtxoTxCache[inputIndex] as Transaction;
    }

    public getScriptFromUtxo(
        inputIndex: number,
        input: PsbtInput,
        txFromBuffer: (buf: Uint8Array) => Transaction,
    ): Script {
        const { script } = this.getScriptAndAmountFromUtxo(inputIndex, input, txFromBuffer);
        return script;
    }

    public getScriptAndAmountFromUtxo(
        inputIndex: number,
        input: PsbtInput,
        txFromBuffer: (buf: Uint8Array) => Transaction,
    ): { script: Script; value: Satoshi } {
        if (input.witnessUtxo !== undefined) {
            return {
                script: input.witnessUtxo.script as Script,
                value: input.witnessUtxo.value as Satoshi,
            };
        } else if (input.nonWitnessUtxo !== undefined) {
            const nonWitnessUtxoTx = this.getNonWitnessUtxoTx(input, inputIndex, txFromBuffer);
            const txIn = this.tx.ins[inputIndex] as Transaction['ins'][0];
            const o = nonWitnessUtxoTx.outs[txIn.index] as Transaction['outs'][0];
            return { script: o.script, value: o.value };
        } else {
            throw new Error("Can't find pubkey in input without Utxo data");
        }
    }

    public computeFee(
        inputs: PsbtInput[],
        disableOutputChecks: boolean = false,
        txFromBuffer?: (buf: Uint8Array) => Transaction,
    ): number {
        if (!inputs.every(isFinalized)) throw new Error('PSBT must be finalized to calculate fee');
        if (this.fee !== undefined) return this.fee;
        let tx: Transaction;
        let mustFinalize = true;
        if (this.extractedTx) {
            tx = this.extractedTx;
            mustFinalize = false;
        } else {
            tx = this.tx.clone();
        }
        const { fee } = this.finalizeAndComputeAmounts(
            inputs,
            tx,
            mustFinalize,
            disableOutputChecks,
            txFromBuffer,
        );
        return fee;
    }

    public computeFeeRate(
        inputs: PsbtInput[],
        disableOutputChecks: boolean = false,
        txFromBuffer?: (buf: Uint8Array) => Transaction,
    ): number {
        if (!inputs.every(isFinalized))
            throw new Error('PSBT must be finalized to calculate fee rate');
        if (this.feeRate !== undefined) return this.feeRate;
        let tx: Transaction;
        let mustFinalize = true;
        if (this.extractedTx) {
            tx = this.extractedTx;
            mustFinalize = false;
        } else {
            tx = this.tx.clone();
        }
        const { feeRate } = this.finalizeAndComputeAmounts(
            inputs,
            tx,
            mustFinalize,
            disableOutputChecks,
            txFromBuffer,
        );
        return feeRate;
    }

    public checkFees(opts: PsbtOpts): void {
        const feeRate = this.feeRate;
        if (!this.extractedTx) throw new Error('Transaction not extracted');
        if (feeRate === undefined) throw new Error('Fee rate not computed');
        const vsize = this.extractedTx.virtualSize();
        const satoshis = feeRate * vsize;
        if (feeRate >= opts.maximumFeeRate) {
            throw new Error(
                `Warning: You are paying around ${(satoshis / 1e8).toFixed(8)} in ` +
                    `fees, which is ${feeRate} satoshi per byte for a transaction ` +
                    `with a VSize of ${vsize} bytes (segwit counted as 0.25 byte per ` +
                    `byte). Use setMaximumFeeRate method to raise your threshold, or ` +
                    `pass true to the first arg of extractTransaction.`,
            );
        }
    }

    public pubkeyInInput(
        pubkey: PublicKey,
        input: PsbtInput,
        inputIndex: number,
        txFromBuffer: (buf: Uint8Array) => Transaction,
    ): boolean {
        const script = this.getScriptFromUtxo(inputIndex, input, txFromBuffer);
        const { meaningfulScript } = getMeaningfulScript(
            script,
            inputIndex,
            'input',
            input.redeemScript,
            input.witnessScript,
        );
        return pubkeyInScript(pubkey, meaningfulScript);
    }

    public pubkeyInOutput(pubkey: PublicKey, output: PsbtOutput, outputIndex: number): boolean {
        const script = (this.tx.outs[outputIndex] as Transaction['outs'][0]).script;
        const { meaningfulScript } = getMeaningfulScript(
            script,
            outputIndex,
            'output',
            output.redeemScript,
            output.witnessScript,
        );
        return pubkeyInScript(pubkey, meaningfulScript);
    }

    public redeemFromFinalScriptSig(finalScript: Uint8Array | undefined): Uint8Array | undefined {
        if (!finalScript) return;
        const decomp = bscript.decompile(finalScript);
        if (!decomp) return;
        const lastItem = decomp[decomp.length - 1];
        if (!(lastItem instanceof Uint8Array) || isPubkeyLike(lastItem) || isSigLike(lastItem))
            return;
        const sDecomp = bscript.decompile(lastItem);
        if (!sDecomp) return;
        return lastItem;
    }

    public redeemFromFinalWitnessScript(
        finalScript: Uint8Array | undefined,
    ): Uint8Array | undefined {
        if (!finalScript) return;
        const decomp = scriptWitnessToWitnessStack(finalScript);
        const lastItem = decomp[decomp.length - 1];
        if (!lastItem) return;
        if (isPubkeyLike(lastItem)) return;
        const sDecomp = bscript.decompile(lastItem);
        if (!sDecomp) return;
        return lastItem;
    }

    /**
     * Finalize transaction inputs and compute fee amounts.
     * Returns computed values instead of mutating cache parameters directly.
     */
    public finalizeAndComputeAmounts(
        inputs: PsbtInput[],
        tx: Transaction,
        mustFinalize: boolean,
        disableOutputChecks?: boolean,
        txFromBuffer?: (buf: Uint8Array) => Transaction,
    ): { fee: number; feeRate: number } {
        let inputAmount = 0n;
        inputs.forEach((input, idx) => {
            const txIn = tx.ins[idx] as Transaction['ins'][0];
            if (mustFinalize && input.finalScriptSig)
                txIn.script = input.finalScriptSig as Script;
            if (mustFinalize && input.finalScriptWitness) {
                txIn.witness = scriptWitnessToWitnessStack(input.finalScriptWitness);
            }
            if (input.witnessUtxo) {
                inputAmount += input.witnessUtxo.value;
            } else if (input.nonWitnessUtxo) {
                if (!txFromBuffer)
                    throw new Error('txFromBuffer is required for nonWitnessUtxo inputs');
                const nwTx = this.getNonWitnessUtxoTx(input, idx, txFromBuffer);
                const vout = txIn.index;
                const out = nwTx.outs[vout] as Transaction['outs'][0];
                inputAmount += out.value;
            }
        });
        const outputAmount = tx.outs.reduce((total, o) => total + o.value, 0n);
        const feeValue = inputAmount - outputAmount;
        if (!disableOutputChecks) {
            if (feeValue < 0n) {
                throw new Error(
                    `Outputs are spending more than Inputs ${inputAmount} < ${outputAmount}`,
                );
            }
        }
        const bytes = tx.virtualSize();
        const fee = Number(feeValue);
        const feeRate = Math.floor(fee / bytes);

        this.fee = fee;
        this.extractedTx = tx;
        this.feeRate = feeRate;

        return { fee, feeRate };
    }

    public getScriptFromInput(
        inputIndex: number,
        input: PsbtInput,
        txFromBuffer: (buf: Uint8Array) => Transaction,
    ): GetScriptReturn {
        const res: GetScriptReturn = {
            script: null,
            isSegwit: false,
            isP2SH: false,
            isP2WSH: false,
        };
        res.isP2SH = !!input.redeemScript;
        res.isP2WSH = !!input.witnessScript;
        if (input.witnessScript) {
            res.script = input.witnessScript as Script;
        } else if (input.redeemScript) {
            res.script = input.redeemScript as Script;
        } else {
            if (input.nonWitnessUtxo) {
                const nonWitnessUtxoTx = this.getNonWitnessUtxoTx(input, inputIndex, txFromBuffer);
                const prevoutIndex = (this.tx.ins[inputIndex] as Transaction['ins'][0]).index;
                res.script = (nonWitnessUtxoTx.outs[prevoutIndex] as Transaction['outs'][0]).script;
            } else if (input.witnessUtxo) {
                res.script = input.witnessUtxo.script as Script;
            }
        }

        if (input.witnessScript || (res.script && isP2WPKH(res.script))) {
            res.isSegwit = true;
        } else {
            if (res.script && isUnknownSegwitVersion(res.script)) {
                res.isSegwit = true;
            }
        }

        return res;
    }

    public getPrevoutTaprootKey(
        inputIndex: number,
        input: PsbtInput,
        txFromBuffer: (buf: Uint8Array) => Transaction,
    ): XOnlyPublicKey | null {
        const { script } = this.getScriptAndAmountFromUtxo(inputIndex, input, txFromBuffer);
        return isP2TR(script) ? (script.subarray(2, 34) as XOnlyPublicKey) : null;
    }
}
