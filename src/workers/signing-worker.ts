/**
 * Inline signing worker code.
 *
 * This module generates the worker code as a string that can be
 * loaded via Blob URL. This prevents external file tampering and
 * ensures the signing logic is bundled with the library.
 *
 * SECURITY CRITICAL:
 * - Private keys are zeroed immediately after signing
 * - No key data is logged or stored
 * - Worker only holds key during active signing operation
 *
 * @packageDocumentation
 */

/**
 * Generates the inline worker code as a string.
 *
 * The worker expects an ECC library to be provided via init message
 * that implements sign() and signSchnorr() methods.
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
    }
}

/**
 * ECC library reference (set during init).
 * @type {Object|null}
 */
let eccLib = null;

/**
 * Handle incoming messages from main thread.
 */
self.onmessage = function(event) {
    const msg = event.data;

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
};

/**
 * Initialize the worker with ECC library.
 * @param {Object} msg - Init message
 */
function handleInit(msg) {
    // In a real implementation, we'd load the ECC library here
    // For now, we expect it to be available globally or passed
    // The library ID tells us which implementation to use

    // Signal ready
    self.postMessage({ type: 'ready' });
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
        // CRITICAL: This is where signing happens
        // The ECC library must be loaded via init message
        if (!eccLib) {
            throw new Error('ECC library not initialized. Call init first.');
        }

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
    // Clear any references
    eccLib = null;

    self.postMessage({ type: 'shutdown-ack' });

    // Close the worker
    self.close();
}

/**
 * Set the ECC library for this worker.
 * Called by the pool when initializing with the actual library.
 * @param {Object} lib - ECC library with sign/signSchnorr methods
 */
self.setEccLib = function(lib) {
    eccLib = lib;
};
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
