"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.regtestUtils = void 0;
const regtest_client_1 = require("regtest-client");
const APIPASS = process.env.APIPASS || 'satoshi';
const APIURL = process.env.APIURL || 'https://regtest.bitbank.cc/1';
exports.regtestUtils = new regtest_client_1.RegtestUtils({ APIPASS, APIURL });
