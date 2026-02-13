import type { PartialSig, PsbtInput } from 'bip174';
import { equals } from '../io/index.js';
import type { P2SHPayment, P2WSHPayment, Payment } from '../payments/index.js';
import * as payments from '../payments/index.js';
import { witnessStackToScriptWitness } from './psbtutils.js';
import { classifyScript, compressPubkey } from './utils.js';
import type { Transaction } from '../transaction.js';
import type { PublicKey, Script, Signature } from '../types.js';
import type { PsbtCache } from './PsbtCache.js';
import type { GetScriptReturn } from './types.js';

export interface FinalScriptsResult {
    readonly finalScriptSig: Script | undefined;
    readonly finalScriptWitness: Uint8Array | undefined;
}

/**
 * Class wrapping all finalization logic for PSBT.
 */
export class PsbtFinalizer {
    readonly #cache: PsbtCache;
    readonly #txFromBuffer: (buf: Uint8Array) => Transaction;

    public constructor(cache: PsbtCache, txFromBuffer: (buf: Uint8Array) => Transaction) {
        this.#cache = cache;
        this.#txFromBuffer = txFromBuffer;
    }

    public getFinalScripts(
        inputIndex: number,
        input: PsbtInput,
        script: Script,
        isSegwit: boolean,
        isP2SH: boolean,
        isP2WSH: boolean,
        canRunChecks: boolean = true,
        solution?: Uint8Array[],
    ): FinalScriptsResult {
        const scriptType = classifyScript(script);
        if (!canFinalize(input, script, scriptType) && canRunChecks) {
            throw new Error(`Can not finalize input #${inputIndex}`);
        }

        if (!input.partialSig) throw new Error('Input missing partial signatures');
        return prepareFinalScripts(
            script,
            scriptType,
            input.partialSig,
            isSegwit,
            isP2SH,
            isP2WSH,
            solution,
        );
    }

    public getScriptFromInput(inputIndex: number, input: PsbtInput): GetScriptReturn {
        return this.#cache.getScriptFromInput(inputIndex, input, this.#txFromBuffer);
    }
}

export function getFinalScripts(
    inputIndex: number,
    input: PsbtInput,
    script: Script,
    isSegwit: boolean,
    isP2SH: boolean,
    isP2WSH: boolean,
    canRunChecks: boolean = true,
    solution?: Uint8Array[],
): FinalScriptsResult {
    const scriptType = classifyScript(script);
    if (!canFinalize(input, script, scriptType) && canRunChecks) {
        throw new Error(`Can not finalize input #${inputIndex}`);
    }

    if (!input.partialSig) throw new Error('Input missing partial signatures');
    return prepareFinalScripts(
        script,
        scriptType,
        input.partialSig,
        isSegwit,
        isP2SH,
        isP2WSH,
        solution,
    );
}

export function prepareFinalScripts(
    script: Uint8Array,
    scriptType: string,
    partialSig: PartialSig[],
    isSegwit: boolean,
    isP2SH: boolean,
    isP2WSH: boolean,
    solution?: Uint8Array[],
): FinalScriptsResult {
    let finalScriptSig: Script | undefined;
    let finalScriptWitness: Uint8Array | undefined;

    const payment: Payment = getPayment(script, scriptType, partialSig);
    const p2wsh = !isP2WSH ? null : payments.p2wsh({ redeem: payment } as P2WSHPayment);
    const p2sh = !isP2SH ? null : payments.p2sh({ redeem: p2wsh || payment } as P2SHPayment);

    if (isSegwit) {
        if (p2wsh && p2wsh.witness) {
            finalScriptWitness = witnessStackToScriptWitness(p2wsh.witness);
        } else if (payment && payment.witness) {
            finalScriptWitness = witnessStackToScriptWitness(payment.witness);
        } else {
            finalScriptWitness = witnessStackToScriptWitness(solution ?? [new Uint8Array([0x00])]);
        }
        if (p2sh) {
            finalScriptSig = p2sh?.input;
        }
    } else {
        if (p2sh) {
            finalScriptSig = p2sh?.input;
        } else {
            if (!payment) {
                finalScriptSig = (
                    Array.isArray(solution) && solution[0] ? solution[0] : new Uint8Array([0x01])
                ) as Script;
            } else {
                finalScriptSig = payment.input;
            }
        }
    }
    return { finalScriptSig, finalScriptWitness };
}

function canFinalize(input: PsbtInput, script: Uint8Array, scriptType: string): boolean {
    switch (scriptType) {
        case 'pubkey':
        case 'pubkeyhash':
        case 'witnesspubkeyhash':
            return hasSigs(1, input.partialSig);
        case 'multisig': {
            const p2ms = payments.p2ms({
                output: script as Script,
            });
            if (p2ms.m === undefined) throw new Error('Cannot determine m for multisig');
            return hasSigs(p2ms.m, input.partialSig, p2ms.pubkeys);
        }
        case 'nonstandard':
            return true;
        default:
            return false;
    }
}

function hasSigs(neededSigs: number, partialSig?: PartialSig[], pubkeys?: Uint8Array[]): boolean {
    if (!partialSig) return false;
    let sigs: PartialSig[];
    if (pubkeys) {
        sigs = pubkeys
            .map((pkey) => {
                const pubkey = compressPubkey(pkey);
                return partialSig.find((pSig) => equals(pSig.pubkey, pubkey));
            })
            .filter((v): v is PartialSig => !!v);
    } else {
        sigs = partialSig;
    }
    if (sigs.length > neededSigs) throw new Error('Too many signatures');
    return sigs.length === neededSigs;
}

function getPayment(script: Uint8Array, scriptType: string, partialSig: PartialSig[]): Payment {
    const scriptBranded = script as Script;
    switch (scriptType) {
        case 'multisig': {
            const sigs = getSortedSigs(script, partialSig);
            return payments.p2ms({
                output: scriptBranded,
                signatures: sigs as Signature[],
            });
        }
        case 'pubkey': {
            const sig0 = partialSig[0] as PartialSig;
            return payments.p2pk({
                output: scriptBranded,
                signature: sig0.signature as Signature,
            });
        }
        case 'pubkeyhash': {
            const sig0 = partialSig[0] as PartialSig;
            return payments.p2pkh({
                output: scriptBranded,
                pubkey: sig0.pubkey as PublicKey,
                signature: sig0.signature as Signature,
            });
        }
        case 'witnesspubkeyhash': {
            const sig0 = partialSig[0] as PartialSig;
            return payments.p2wpkh({
                output: scriptBranded,
                pubkey: sig0.pubkey as PublicKey,
                signature: sig0.signature as Signature,
            });
        }
        default:
            throw new Error(`Unknown script type: ${scriptType}`);
    }
}

function getSortedSigs(script: Uint8Array, partialSig: PartialSig[]): Uint8Array[] {
    const p2ms = payments.p2ms({ output: script as Script });
    if (!p2ms.pubkeys) throw new Error('Cannot extract pubkeys from multisig script');
    const result: Uint8Array[] = [];
    for (const pk of p2ms.pubkeys) {
        const matched = partialSig.filter((ps) => {
            return equals(ps.pubkey, pk);
        })[0];
        if (matched) {
            result.push(new Uint8Array(matched.signature));
        }
    }
    return result;
}
