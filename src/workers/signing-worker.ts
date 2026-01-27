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
 * Bundled @noble/secp256k1 + hashes library (embedded at compile time).
 */
const eccBundle = ${JSON.stringify(ECC_BUNDLE)};

/**
 * Initialize the ECC library from the bundle.
 * The bundle exports nobleBundle with { secp, sha256, hmac }.
 */
const eccModule = (function() {
    // Execute the IIFE and return the nobleBundle object
    const fn = new Function(eccBundle + '; return nobleBundle;');
    return fn();
})();

/**
 * ECC library wrapper with the interface we need.
 * Uses eccModule.secp which has hashes pre-configured.
 */
const eccLib = {
    sign: (hash, privateKey) => {
        // noble's sign returns Signature object, we need compact 64-byte format
        const sig = eccModule.secp.sign(hash, privateKey, { lowS: true });
        return sig.toCompactRawBytes();
    },
    signSchnorr: (hash, privateKey) => {
        return eccModule.secp.schnorr.sign(hash, privateKey);
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
        case 'signBatch':
            handleSignBatch(msg);
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
 * Handle a batch signing request.
 * Signs multiple tasks and returns all results in a single message.
 *
 * SECURITY: Private key is zeroed immediately after all signatures.
 *
 * @param {Object} msg - Batch signing message with tasks array
 */
function handleSignBatch(msg) {
    const { batchId, tasks, privateKey } = msg;
    const results = [];
    const errors = [];

    // Validate private key once
    if (!privateKey || privateKey.length !== 32) {
        secureZero(privateKey);
        self.postMessage({
            type: 'batchResult',
            batchId: batchId,
            results: [],
            errors: [{ inputIndex: -1, error: 'Invalid private key: must be 32 bytes' }]
        });
        return;
    }

    // Process all tasks
    for (const task of tasks) {
        const { taskId, hash, publicKey, signatureType, lowR, inputIndex, sighashType, leafHash } = task;

        // Validate hash
        if (!hash || hash.length !== 32) {
            errors.push({ taskId, inputIndex, error: 'Invalid hash: must be 32 bytes' });
            continue;
        }

        try {
            let signature;
            if (signatureType === 1) {
                // Schnorr signature (BIP340)
                signature = eccLib.signSchnorr(hash, privateKey);
            } else {
                // ECDSA signature
                signature = eccLib.sign(hash, privateKey, { lowR: lowR || false });
            }

            if (!signature) {
                throw new Error('Signing returned null or undefined');
            }

            const result = {
                taskId: taskId,
                signature: signature,
                inputIndex: inputIndex,
                publicKey: publicKey,
                signatureType: signatureType
            };

            if (leafHash) {
                result.leafHash = leafHash;
            }

            results.push(result);
        } catch (error) {
            errors.push({ taskId, inputIndex, error: error.message || 'Signing failed' });
        }
    }

    // CRITICAL: Zero the private key after processing all tasks
    secureZero(privateKey);

    // Send batch result back
    self.postMessage({
        type: 'batchResult',
        batchId: batchId,
        results: results,
        errors: errors
    });
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
