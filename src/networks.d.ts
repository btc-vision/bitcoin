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
/**
 * Represents the Dogecoin mainnet configuration.
 *
 * Prefixes from:
 * - P2PKH: 0x1e (30 decimal) - addresses start with 'D'
 * - P2SH: 0x16 (22 decimal) - addresses often start with '9' or 'A'
 * - WIF: 0x9e (158 decimal)
 * - BIP32:
 *   - public: 0x02facafd
 *   - private: 0x02fac398
 * Message prefix:
 *   - Dogecoin uses "\x19Dogecoin Signed Message:\n"
 */
export declare const dogecoin: Network;
/**
 * Represents the Dogecoin testnet configuration.
 *
 * Prefixes from Dogecoin testnet chainparams:
 * - P2PKH: 0x71 (113 decimal)
 * - P2SH: 0xc4 (196 decimal)
 * - WIF: 0xf1 (241 decimal)
 * - BIP32:
 *   - public: 0x0432a9a8
 *   - private: 0x0432a243
 * Message prefix:
 *   - Same as mainnet: "\x19Dogecoin Signed Message:\n"
 */
export declare const dogecoinTestnet: Network;
/**
 * Litecoin mainnet configuration.
 */
export declare const litecoin: Network;
/**
 * Litecoin testnet configuration.
 */
export declare const litecoinTestnet: Network;
/**
 * Bitcoin Cash mainnet configuration (legacy).
 * Note: Bitcoin Cash uses Cashaddr starting with 'q' or 'p',
 * but we retain the legacy prefixes for compatibility.
 */
export declare const bitcoinCash: Network;
/**
 * Bitcoin Cash testnet configuration (legacy).
 */
export declare const bitcoinCashTestnet: Network;
/**
 * Dash mainnet configuration.
 */
export declare const dash: Network;
/**
 * Dash testnet configuration.
 */
export declare const dashTestnet: Network;
