/**
 * Represents a Bitcoin network configuration，including messagePrefix, bech32, bip32, pubKeyHash, scriptHash, wif.
 * Support bitcoin、bitcoin testnet and bitcoin regtest.
 * @packageDocumentation
 */
export interface Bip32 {
    public: number;
    private: number;
}
export interface Network {
    wif: number;
    bip32: Bip32;
    messagePrefix: string;
    bech32: string;
    pubKeyHash: number;
    scriptHash: number;
}
/**
 * Represents the Bitcoin network configuration.
 */
export declare const bitcoin: Network;
/**
 * Represents the regtest network configuration.
 */
export declare const regtest: Network;
/**
 * Represents the testnet network configuration.
 */
export declare const testnet: Network;
