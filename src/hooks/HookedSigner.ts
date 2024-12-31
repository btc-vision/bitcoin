import { BIP32Interface } from 'bip32';
import { ECPairInterface } from 'ecpair';
import { Signer, SignerAlternative, SignerAsync } from '../psbt.js';

import { SignatureManager } from './SignatureManager.js';
import { AdvancedSignatureManager } from './AdvancedSignatureManager.js';

interface HookSigner {
    hasHook?: boolean;
    signatureManager: SignatureManager;
}

type HookedSigner = (
    | Signer
    | SignerAlternative
    | SignerAsync
    | BIP32Interface
    | ECPairInterface
) &
    HookSigner;

const advancedSignatureManager: AdvancedSignatureManager =
    AdvancedSignatureManager.getInstance();

function getPublicKey(keyPair: HookedSigner): string | undefined {
    if (keyPair.publicKey && Buffer.isBuffer(keyPair.publicKey)) {
        return keyPair.publicKey.toString('hex');
    }
}

function hookKeyPair(keyPair: HookedSigner) {
    const oldSign = keyPair.sign;

    if (oldSign) {
        keyPair.sign = new Proxy(oldSign, {
            apply: function (target, thisArg, argumentsList) {
                const publicKey = getPublicKey(keyPair);
                const hash = argumentsList[0];

                if (publicKey) {
                    let possibleSignature =
                        advancedSignatureManager.getSignature(publicKey, hash);

                    if (!possibleSignature) {
                        possibleSignature =
                            advancedSignatureManager.addSignature(
                                publicKey,
                                hash,
                                Reflect.apply(target, thisArg, argumentsList),
                            );
                    }

                    return possibleSignature;
                } else {
                    let possibleSignature =
                        keyPair.signatureManager.getSignature(hash);

                    if (!possibleSignature) {
                        possibleSignature =
                            keyPair.signatureManager.addSignature(
                                hash,
                                Reflect.apply(target, thisArg, argumentsList),
                            );
                    }

                    return possibleSignature;
                }
            },
        });
    }

    const oldSignSchnorr = keyPair.signSchnorr;
    if (oldSignSchnorr) {
        keyPair.signSchnorr = new Proxy(oldSignSchnorr, {
            apply: function (target, thisArg, argumentsList) {
                const publicKey = getPublicKey(keyPair);
                const hash = argumentsList[0];

                if (publicKey) {
                    let possibleSignature =
                        advancedSignatureManager.getSignature(publicKey, hash);

                    if (!possibleSignature) {
                        possibleSignature =
                            advancedSignatureManager.addSignature(
                                publicKey,
                                hash,
                                Reflect.apply(target, thisArg, argumentsList),
                            );
                    }

                    return possibleSignature;
                } else {
                    let possibleSignature =
                        keyPair.signatureManager.getSignature(hash);

                    if (!possibleSignature) {
                        possibleSignature =
                            keyPair.signatureManager.addSignature(
                                hash,
                                Reflect.apply(target, thisArg, argumentsList),
                            );
                    }

                    return possibleSignature;
                }
            },
        });
    }
}

export function hookSigner(
    keyPair:
        | Signer
        | SignerAlternative
        | SignerAsync
        | BIP32Interface
        | ECPairInterface,
) {
    const newKeypair: HookedSigner = keyPair as HookedSigner;

    if (!newKeypair.hasHook) {
        newKeypair.hasHook = true;
        newKeypair.signatureManager = new SignatureManager();

        hookKeyPair(newKeypair);
    }
}
