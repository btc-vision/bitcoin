import type { Bip32Derivation, PsbtInput } from 'bip174';
import { checkForInput } from 'bip174';
import { equals, toHex } from '../io/index.js';
import * as payments from '../payments/index.js';
import { tapleafHash } from '../payments/bip341.js';
import { toXOnly } from '../pubkey.js';
import { isP2WPKH, pubkeyInScript } from './psbtutils.js';
import { getMeaningfulScript, sighashTypeToString } from './utils.js';
import { checkScriptForPubkey } from './validation.js';
import type { Output } from '../transaction.js';
import { Transaction } from '../transaction.js';
import type { Bytes20, Bytes32, MessageHash, PublicKey, Satoshi, Script } from '../types.js';
import type { PsbtCache } from './PsbtCache.js';
import type { HDSigner, HDSignerAsync } from './types.js';

export interface HashForSig {
    readonly pubkey: PublicKey;
    readonly hash: MessageHash;
    readonly leafHash?: Bytes32;
}

/**
 * Class wrapping all signing-related logic for PSBT.
 */
export class PsbtSigner {
    readonly #cache: PsbtCache;
    readonly #txFromBuffer: (buf: Uint8Array) => Transaction;

    public constructor(cache: PsbtCache, txFromBuffer: (buf: Uint8Array) => Transaction) {
        this.#cache = cache;
        this.#txFromBuffer = txFromBuffer;
    }

    public getHashAndSighashType(
        inputs: PsbtInput[],
        inputIndex: number,
        pubkey: Uint8Array,
        sighashTypes: number[],
    ): { hash: MessageHash; sighashType: number } {
        const input = checkForInput(inputs, inputIndex);
        const { hash, sighashType, script } = this.getHashForSig(
            inputIndex,
            input,
            false,
            sighashTypes,
        );

        checkScriptForPubkey(pubkey as PublicKey, script, 'sign');
        return { hash, sighashType };
    }

    public getHashForSig(
        inputIndex: number,
        input: PsbtInput,
        forValidate: boolean,
        sighashTypes?: number[],
    ): { script: Script; hash: MessageHash; sighashType: number } {
        const unsignedTx = this.#cache.tx;
        const sighashType = input.sighashType || Transaction.SIGHASH_ALL;
        checkSighashTypeAllowed(sighashType, sighashTypes);

        let hash: MessageHash;
        let prevout: Output;

        if (input.nonWitnessUtxo) {
            const nonWitnessUtxoTx = this.#cache.getNonWitnessUtxoTx(
                input,
                inputIndex,
                this.#txFromBuffer,
            );

            const txIn = unsignedTx.ins[inputIndex] as Transaction['ins'][0];
            const prevoutHash = txIn.hash;
            const utxoHash = nonWitnessUtxoTx.getHash();

            if (!equals(prevoutHash, utxoHash)) {
                throw new Error(
                    `Non-witness UTXO hash for input #${inputIndex} doesn't match the hash specified in the prevout`,
                );
            }

            const prevoutIndex = txIn.index;
            prevout = nonWitnessUtxoTx.outs[prevoutIndex] as Transaction['outs'][0];
        } else if (input.witnessUtxo) {
            prevout = {
                script: input.witnessUtxo.script as Script,
                value: input.witnessUtxo.value as Satoshi,
            };
        } else {
            throw new Error('Need a Utxo input item for signing');
        }

        const { meaningfulScript, type } = getMeaningfulScript(
            prevout.script,
            inputIndex,
            'input',
            input.redeemScript,
            input.witnessScript,
        );

        const script = meaningfulScript as Script;

        if (['p2sh-p2wsh', 'p2wsh'].includes(type)) {
            hash = unsignedTx.hashForWitnessV0(inputIndex, script, prevout.value, sighashType);
        } else if (isP2WPKH(meaningfulScript)) {
            const p2pkhPayment = payments.p2pkh({
                hash: meaningfulScript.subarray(2) as Bytes20,
            });
            if (!p2pkhPayment.output) throw new Error('Unable to create signing script');
            hash = unsignedTx.hashForWitnessV0(
                inputIndex,
                p2pkhPayment.output,
                prevout.value,
                sighashType,
            );
        } else {
            // non-segwit
            if (input.nonWitnessUtxo === undefined && !this.#cache.unsafeSignNonSegwit)
                throw new Error(
                    `Input #${inputIndex} has witnessUtxo but non-segwit script: ` +
                        toHex(meaningfulScript),
                );
            if (!forValidate && this.#cache.unsafeSignNonSegwit)
                console.warn(
                    'Warning: Signing non-segwit inputs without the full parent transaction ' +
                        'means there is a chance that a miner could feed you incorrect information ' +
                        "to trick you into paying large fees. This behavior is the same as Psbt's predecessor " +
                        '(TransactionBuilder - now removed) when signing non-segwit scripts. You are not ' +
                        'able to export this Psbt with toBuffer|toBase64|toHex since it is not ' +
                        'BIP174 compliant.\n*********************\nPROCEED WITH CAUTION!\n' +
                        '*********************',
                );
            hash = unsignedTx.hashForSignature(inputIndex, script, sighashType);
        }

        return { script, sighashType, hash };
    }

    public getTaprootHashesForSig(
        inputIndex: number,
        input: PsbtInput,
        inputs: PsbtInput[],
        pubkey: Uint8Array,
        tapLeafHashToSign?: Uint8Array,
        allowedSighashTypes?: number[],
    ): HashForSig[] {
        const unsignedTx = this.#cache.tx;
        const sighashType = input.sighashType || Transaction.SIGHASH_DEFAULT;
        checkSighashTypeAllowed(sighashType, allowedSighashTypes);

        if (!this.#cache.prevOuts) {
            const prevOuts = inputs.map((i, index) =>
                this.#cache.getScriptAndAmountFromUtxo(index, i, this.#txFromBuffer),
            );
            this.#cache.prevOuts = prevOuts;
            this.#cache.signingScripts = prevOuts.map((o) => o.script);
            this.#cache.values = prevOuts.map((o) => o.value);
        }
        const signingScripts = this.#cache.signingScripts as readonly Script[];
        const values = this.#cache.values as readonly Satoshi[];

        if (!this.#cache.taprootHashCache) {
            this.#cache.taprootHashCache = unsignedTx.getTaprootHashCache(signingScripts, values);
        }
        const taprootCache = this.#cache.taprootHashCache;

        const hashes: HashForSig[] = [];
        if (input.tapInternalKey && !tapLeafHashToSign) {
            const outputKey =
                this.#cache.getPrevoutTaprootKey(inputIndex, input, this.#txFromBuffer) ||
                new Uint8Array(0);
            if (equals(toXOnly(pubkey as PublicKey), outputKey)) {
                const tapKeyHash = unsignedTx.hashForWitnessV1(
                    inputIndex,
                    signingScripts,
                    values,
                    sighashType,
                    undefined,
                    undefined,
                    taprootCache,
                );
                hashes.push({ pubkey: pubkey as PublicKey, hash: tapKeyHash });
            }
        }

        const tapLeafHashes = (input.tapLeafScript || [])
            .filter((tapLeaf) => pubkeyInScript(pubkey, tapLeaf.script))
            .map((tapLeaf) => {
                const hash = tapleafHash({
                    output: tapLeaf.script,
                    version: tapLeaf.leafVersion,
                });
                return Object.assign({ hash }, tapLeaf);
            })
            .filter((tapLeaf) => !tapLeafHashToSign || equals(tapLeafHashToSign, tapLeaf.hash))
            .map((tapLeaf) => {
                const tapScriptHash = unsignedTx.hashForWitnessV1(
                    inputIndex,
                    signingScripts,
                    values,
                    sighashType,
                    tapLeaf.hash,
                    undefined,
                    taprootCache,
                );

                return {
                    pubkey: pubkey as PublicKey,
                    hash: tapScriptHash,
                    leafHash: tapLeaf.hash,
                };
            });

        return hashes.concat(tapLeafHashes);
    }

    public getAllTaprootHashesForSig(
        inputIndex: number,
        input: PsbtInput,
        inputs: PsbtInput[],
    ): HashForSig[] {
        const allPublicKeys: Uint8Array[] = [];
        if (input.tapInternalKey) {
            const key = this.#cache.getPrevoutTaprootKey(inputIndex, input, this.#txFromBuffer);
            if (key) {
                allPublicKeys.push(key);
            }
        }

        if (input.tapScriptSig) {
            const tapScriptPubkeys = input.tapScriptSig.map((tss) => tss.pubkey);
            allPublicKeys.push(...tapScriptPubkeys);
        }

        const allHashes = allPublicKeys.map((pubicKey) =>
            this.getTaprootHashesForSig(inputIndex, input, inputs, pubicKey),
        );

        return allHashes.flat();
    }

    public trimTaprootSig(signature: Uint8Array): Uint8Array {
        return signature.length === 64 ? signature : signature.subarray(0, 64);
    }

    public getSignersFromHD<T extends HDSigner | HDSignerAsync>(
        inputIndex: number,
        inputs: PsbtInput[],
        hdKeyPair: T,
    ): T[] {
        const input = checkForInput(inputs, inputIndex);
        if (!input.bip32Derivation || input.bip32Derivation.length === 0) {
            throw new Error('Need bip32Derivation to sign with HD');
        }
        const myDerivations = input.bip32Derivation
            .map((bipDv) => {
                if (equals(bipDv.masterFingerprint, hdKeyPair.fingerprint)) {
                    return bipDv;
                } else {
                    return;
                }
            })
            .filter((v) => !!v);
        if (myDerivations.length === 0) {
            throw new Error(
                'Need one bip32Derivation masterFingerprint to match the HDSigner fingerprint',
            );
        }

        return myDerivations.map((bipDv) => {
            const node = hdKeyPair.derivePath(bipDv.path) as T;
            if (!equals(bipDv.pubkey, node.publicKey)) {
                throw new Error('pubkey did not match bip32Derivation');
            }
            return node;
        });
    }

    public bip32DerivationIsMine(root: HDSigner): (d: Bip32Derivation) => boolean {
        return (d: Bip32Derivation): boolean => {
            const fingerprint =
                root.fingerprint instanceof Uint8Array
                    ? root.fingerprint
                    : new Uint8Array(root.fingerprint);
            if (!equals(d.masterFingerprint, fingerprint)) return false;
            const derivedPubkey = root.derivePath(d.path).publicKey;
            const pubkey =
                derivedPubkey instanceof Uint8Array ? derivedPubkey : new Uint8Array(derivedPubkey);
            if (!equals(pubkey, d.pubkey)) return false;
            return true;
        };
    }
}

function checkSighashTypeAllowed(sighashType: number, sighashTypes?: number[]): void {
    if (sighashTypes && !sighashTypes.includes(sighashType)) {
        const str = sighashTypeToString(sighashType);
        throw new Error(
            `Sighash type is not allowed. Retry the sign method passing the ` +
                `sighashTypes array of whitelisted types. Sighash type: ${str}`,
        );
    }
}
