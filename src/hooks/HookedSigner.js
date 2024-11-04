'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.hookSigner = void 0;
const SignatureManager_js_1 = require('./SignatureManager.js');
const AdvancedSignatureManager_js_1 = require('./AdvancedSignatureManager.js');
const advancedSignatureManager =
    AdvancedSignatureManager_js_1.AdvancedSignatureManager.getInstance();
function getPublicKey(keyPair) {
    if (keyPair.publicKey && Buffer.isBuffer(keyPair.publicKey)) {
        return keyPair.publicKey.toString('hex');
    }
}
function hookKeyPair(keyPair) {
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
function hookSigner(keyPair) {
    const newKeypair = keyPair;
    if (!newKeypair.hasHook) {
        newKeypair.hasHook = true;
        newKeypair.signatureManager =
            new SignatureManager_js_1.SignatureManager();
        hookKeyPair(newKeypair);
    }
}
exports.hookSigner = hookSigner;
