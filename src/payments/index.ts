/**
 * Represents a payment object, which is used to create a payment.
 *
 * Supports P2PKH、P2SH、P2WPKH、P2WSH、P2TR and so on
 *
 * @packageDocumentation
 */

import { Network } from '../networks';
import { Taptree } from '../types';

export * from './bip341.js';
export * from './embed.js';
export * from './lazy.js';
export * from './p2ms.js';
export * from './p2pk.js';
export * from './p2pkh.js';
export * from './p2sh.js';
export * from './p2tr.js';
export * from './p2wpkh.js';
export * from './p2wsh.js';

export interface Payment {
    name?: string;
    network?: Network;
    output?: Buffer;
    data?: Buffer[];
    m?: number;
    n?: number;
    pubkeys?: Buffer[];
    input?: Buffer;
    signatures?: Buffer[];
    internalPubkey?: Buffer;
    pubkey?: Buffer;
    signature?: Buffer;
    address?: string;
    hash?: Buffer;
    redeem?: Payment;
    redeemVersion?: number;
    scriptTree?: Taptree;
    witness?: Buffer[];
}

export type PaymentCreator = (a: Payment, opts?: PaymentOpts) => Payment;

export type PaymentFunction = () => Payment;

export interface PaymentOpts {
    validate?: boolean;
    allowIncomplete?: boolean;
}

export type StackElement = Buffer | number;
export type Stack = StackElement[];
export type StackFunction = () => Stack;

// TODO
// witness commitment
