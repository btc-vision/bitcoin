// https://en.bitcoin.it/wiki/List_of_address_prefixes
// Dogecoin BIP32 is a proposed standard: https://bitcointalk.org/index.php?topic=409731

/**
 * Represents a Bitcoin network configuration，including messagePrefix, bech32, bip32, pubKeyHash, scriptHash, wif.
 * Support bitcoin、bitcoin testnet and bitcoin regtest.
 * @packageDocumentation
 */

export interface Bip32 {
    readonly public: number;
    readonly private: number;
}

export interface Network {
    readonly wif: number;
    readonly bip32: Bip32;
    readonly messagePrefix: string;
    readonly bech32: string;
    readonly bech32Opnet?: string;
    readonly pubKeyHash: number;
    readonly scriptHash: number;
}

/**
 * Represents the Bitcoin network configuration.
 */
export const bitcoin: Network = {
    /**
     * The message prefix used for signing Bitcoin messages.
     */
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    /**
     * The Bech32 prefix used for Bitcoin addresses.
     */
    bech32: 'bc',
    bech32Opnet: 'op',
    /**
     * The BIP32 key prefixes for Bitcoin.
     */
    bip32: {
        /**
         * The public key prefix for BIP32 extended public keys.
         */
        public: 0x0488b21e,
        /**
         * The private key prefix for BIP32 extended private keys.
         */
        private: 0x0488ade4,
    },
    /**
     * The prefix for Bitcoin public key hashes.
     */
    pubKeyHash: 0x00,
    /**
     * The prefix for Bitcoin script hashes.
     */
    scriptHash: 0x05,
    /**
     * The prefix for Bitcoin Wallet Import Format (WIF) private keys.
     */
    wif: 0x80,
};
/**
 * Represents the regtest network configuration.
 */
export const regtest: Network = {
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    bech32: 'bcrt',
    bech32Opnet: 'opr',
    bip32: {
        public: 0x043587cf,
        private: 0x04358394,
    },
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef,
};
/**
 * Represents the testnet network configuration.
 */
export const testnet: Network = {
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    bech32: 'tb',
    bech32Opnet: 'opt',
    bip32: {
        public: 0x043587cf,
        private: 0x04358394,
    },
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef,
};

export const opnetTestnet: Network = {
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    bech32: 'opt',
    bech32Opnet: 'opt',
    bip32: {
        public: 0x043587cf,
        private: 0x04358394,
    },
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef,
};

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
export const dogecoin: Network = {
    messagePrefix: '\x19Dogecoin Signed Message:\n',
    bech32: '', // Dogecoin does not currently use Bech32
    bech32Opnet: '',
    bip32: {
        public: 0x02facafd,
        private: 0x02fac398,
    },
    pubKeyHash: 0x1e,
    scriptHash: 0x16,
    wif: 0x9e,
};

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
export const dogecoinTestnet: Network = {
    messagePrefix: '\x19Dogecoin Signed Message:\n',
    bech32: '', // Dogecoin testnet does not currently use Bech32
    bech32Opnet: '',
    bip32: {
        public: 0x0432a9a8,
        private: 0x0432a243,
    },
    pubKeyHash: 0x71,
    scriptHash: 0xc4,
    wif: 0xf1,
};

/**
 * Litecoin mainnet configuration.
 */
export const litecoin: Network = {
    messagePrefix: '\x19Litecoin Signed Message:\n',
    bech32: 'ltc',
    bech32Opnet: 'opl',
    bip32: {
        public: 0x019da462,
        private: 0x019d9cfe,
    },
    pubKeyHash: 0x30,
    scriptHash: 0x32,
    wif: 0xb0,
};

/**
 * Litecoin testnet configuration.
 */
export const litecoinTestnet: Network = {
    messagePrefix: '\x19Litecoin Signed Message:\n',
    bech32: 'tltc',
    bech32Opnet: 'oplt',
    bip32: {
        public: 0x0436ef7d,
        private: 0x0436f6e1,
    },
    pubKeyHash: 0x6f,
    scriptHash: 0x3a,
    wif: 0xef,
};

/**
 * Bitcoin Cash mainnet configuration (legacy).
 * Note: Bitcoin Cash uses Cashaddr starting with 'q' or 'p',
 * but we retain the legacy prefixes for compatibility.
 */
export const bitcoinCash: Network = {
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    // Cashaddr prefix differs from bech32 for general usage, but we can set it similarly.
    // Actual cashaddr prefix is "bitcoincash", but this field is for bech32 which BCH doesn't fully use for segwit (it doesn't have segwit).
    bech32: 'bitcoincash',
    bech32Opnet: 'opbch',
    bip32: {
        public: 0x0488b21e,
        private: 0x0488ade4,
    },
    pubKeyHash: 0x00,
    scriptHash: 0x05,
    wif: 0x80,
};

/**
 * Bitcoin Cash testnet configuration (legacy).
 */
export const bitcoinCashTestnet: Network = {
    messagePrefix: '\x18Bitcoin Signed Message:\n',
    bech32: 'bchtest',
    bech32Opnet: 'opbcht',
    bip32: {
        public: 0x043587cf,
        private: 0x04358394,
    },
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef,
};

/**
 * Dash mainnet configuration.
 */
export const dash: Network = {
    // Historically Dash used DarkCoin message prefix, and most implementations use this:
    // As of Dash Core 0.17, this has not changed in code.
    messagePrefix: '\x19DarkCoin Signed Message:\n',
    bech32: '', // Dash does not use Bech32
    bech32Opnet: '',
    bip32: {
        public: 0x02fe52cc,
        private: 0x02fe52f8,
    },
    pubKeyHash: 0x4c,
    scriptHash: 0x10,
    wif: 0xcc,
};

/**
 * Dash testnet configuration.
 */
export const dashTestnet: Network = {
    messagePrefix: '\x19DarkCoin Signed Message:\n',
    bech32: '', // Dash testnet does not use Bech32
    bech32Opnet: '',
    bip32: {
        public: 0x3a8061a0,
        private: 0x3a805837,
    },
    pubKeyHash: 0x8c,
    scriptHash: 0x13,
    wif: 0xef,
};
