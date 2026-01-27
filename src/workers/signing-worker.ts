/**
 * Inline signing worker code.
 *
 * This module generates the worker code as a string that can be
 * loaded via Blob URL. The worker uses the bundled @noble/secp256k1
 * library embedded at compile time - no network requests required.
 *
 * SECURITY CRITICAL:
 * - Private keys are zeroed immediately after signing
 * - No key data is logged or stored
 * - Worker only holds key during active signing operation
 * - ECC library is bundled at compile time (no CDN dependency)
 *
 * @packageDocumentation
 */

import { ECC_BUNDLE } from './ecc-bundle.js';

/**
 * Generates the inline worker code as a string.
 *
 * The worker uses the bundled @noble/secp256k1 library directly,
 * eliminating any network dependencies.
 *
 * @returns Worker code as a string for Blob URL creation
 */
export function generateWorkerCode(): string {
    // This code runs inside the worker
    return `
'use strict';

/**
 * Zero out a Uint8Array to clear sensitive data.
 * @param {Uint8Array} arr - Array to zero
 */
function secureZero(arr) {
    if (arr && arr.fill) {
        arr.fill(0);
        // Double-write to prevent optimization
        for (let i = 0; i < arr.length; i++) {
            arr[i] = 0;
        }
    }
}

/**
 * Bundled @noble/secp256k1 library (embedded at compile time).
 */
const eccBundle = ${JSON.stringify(ECC_BUNDLE)};

/**
 * Initialize the ECC library from the bundle.
 */
const eccModule = (function() {
    // Execute the IIFE and return the nobleSecp256k1 object
    const fn = new Function(eccBundle + '; return nobleSecp256k1;');
    return fn();
})();

/**
 * ECC library wrapper with the interface we need.
 */
const eccLib = {
    sign: (hash, privateKey) => {
        // noble returns Signature object, we need raw bytes
        const sig = eccModule.sign(hash, privateKey, { lowS: true });
        return sig.toCompactRawBytes();
    },
    signSchnorr: (hash, privateKey) => {
        return eccModule.schnorr.sign(hash, privateKey);
    }
};

/**
 * Whether initialization is complete.
 */
let initialized = false;

/**
 * Pending messages received before init completes.
 */
const pendingMessages = [];

/**
 * Handle incoming messages from main thread.
 */
self.onmessage = async function(event) {
    const msg = event.data;

    // Queue messages until initialized (except init)
    if (!initialized && msg.type !== 'init') {
        pendingMessages.push(msg);
        return;
    }

    await handleMessage(msg);
};

/**
 * Process a message.
 */
async function handleMessage(msg) {
    switch (msg.type) {
        case 'init':
            handleInit(msg);
            break;
        case 'sign':
            handleSign(msg);
            break;
        case 'shutdown':
            handleShutdown();
            break;
        default:
            self.postMessage({
                type: 'error',
                taskId: msg.taskId || 'unknown',
                error: 'Unknown message type: ' + msg.type,
                inputIndex: msg.inputIndex || -1
            });
    }
}

/**
 * Initialize the worker.
 * ECC library is already bundled, so this just marks as ready.
 */
function handleInit(msg) {
    initialized = true;

    // Signal ready
    self.postMessage({ type: 'ready' });

    // Process pending messages
    while (pendingMessages.length > 0) {
        handleMessage(pendingMessages.shift());
    }
}

/**
 * Handle a signing request.
 *
 * SECURITY: Private key is zeroed immediately after use.
 *
 * @param {Object} msg - Signing task message
 */
function handleSign(msg) {
    const {
        taskId,
        hash,
        privateKey,
        publicKey,
        signatureType,
        lowR,
        inputIndex,
        sighashType,
        leafHash
    } = msg;

    // Validate inputs
    if (!hash || hash.length !== 32) {
        secureZero(privateKey);
        self.postMessage({
            type: 'error',
            taskId: taskId,
            error: 'Invalid hash: must be 32 bytes',
            inputIndex: inputIndex
        });
        return;
    }

    if (!privateKey || privateKey.length !== 32) {
        secureZero(privateKey);
        self.postMessage({
            type: 'error',
            taskId: taskId,
            error: 'Invalid private key: must be 32 bytes',
            inputIndex: inputIndex
        });
        return;
    }

    let signature;

    try {
        if (signatureType === 1) {
            // Schnorr signature (BIP340)
            if (typeof eccLib.signSchnorr !== 'function') {
                throw new Error('ECC library does not support Schnorr signatures');
            }
            signature = eccLib.signSchnorr(hash, privateKey);
        } else {
            // ECDSA signature
            if (typeof eccLib.sign !== 'function') {
                throw new Error('ECC library does not support ECDSA signatures');
            }
            signature = eccLib.sign(hash, privateKey, { lowR: lowR || false });
        }

        if (!signature) {
            throw new Error('Signing returned null or undefined');
        }

    } catch (error) {
        // ALWAYS zero the key, even on error
        secureZero(privateKey);

        self.postMessage({
            type: 'error',
            taskId: taskId,
            error: error.message || 'Signing failed',
            inputIndex: inputIndex
        });
        return;
    }

    // CRITICAL: Zero the private key immediately after signing
    secureZero(privateKey);

    // Send result back
    const result = {
        type: 'result',
        taskId: taskId,
        signature: signature,
        inputIndex: inputIndex,
        publicKey: publicKey,
        signatureType: signatureType
    };

    if (leafHash) {
        result.leafHash = leafHash;
    }

    self.postMessage(result);
}

/**
 * Handle shutdown request.
 */
function handleShutdown() {
    initialized = false;
    pendingMessages.length = 0;

    self.postMessage({ type: 'shutdown-ack' });

    // Close the worker
    self.close();
}
`;
}

/**
 * Creates a Blob URL for the worker code.
 *
 * @returns Blob URL that can be used with new Worker()
 */
export function createWorkerBlobUrl(): string {
    const code = generateWorkerCode();
    const blob = new Blob([code], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
}

/**
 * Revokes a previously created worker Blob URL.
 *
 * @param url - The Blob URL to revoke
 */
export function revokeWorkerBlobUrl(url: string): void {
    URL.revokeObjectURL(url);
}
