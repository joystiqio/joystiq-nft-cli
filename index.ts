//process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import { program } from "commander"
import { command_init } from "./init"
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import chalk from "chalk";
import fs from "fs";
import { command_collection } from "./collection";
import axios from "axios";
import { command_utils } from "./utils";
import { command_metadata } from "./metadata";

import http from 'http';
import https from 'https';
import { command_allowlist } from "./allowlist";

const JOYSTIQ_CORE_TESTNET = "0xdee6a2701e148576c687d5b15f53e57dd7205128f7a7c54fd7f87383b40445f1"
const JOYSTIQ_CORE_TESTNET_ROOT = "0xa53664b81324f5663f36a713389730e1435f51419e353c3bca96b6658656f74f"
const WAL_TESTNET = "0x8190b041122eb492bf63cb464476bd68c6b7e570a4079645a8b28732b6197a82::wal::WAL"
const WAL_MAINNET = "0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL"

export const getChainConfig = (pkMust: boolean = false) => {

    const configFilePath = program.opts().config || "./chain-config.json";
    var config: any;
    try {
        config = JSON.parse(fs.readFileSync(configFilePath).toString())
    } catch (error) {
        console.log(chalk.red(configFilePath + " not found. Please run 'joystiq init chain-config' to initialize the chain config file."))
        process.exit(1)
    }

    let pk: string = config.private_key;
    if (!pk && pkMust) {
        console.log(chalk.red("Private key not found in " + configFilePath))
        process.exit(1)
    }

    const keypair = Ed25519Keypair.fromSecretKey(pk);

    let joystiq: { core: string, root: string };
    let client: SuiClient;
    let rpc: string;
    let wal: string;

    if (config.network === "testnet") {
        joystiq = {
            core: JOYSTIQ_CORE_TESTNET,
            root: JOYSTIQ_CORE_TESTNET_ROOT,
        };
        client = new SuiClient({
            url: config.rpc || getFullnodeUrl("testnet"),
            network: "testnet",
        });
        rpc = config.rpc || getFullnodeUrl("testnet");
        wal = WAL_TESTNET;
    } else {
        console.log(chalk.red("Invalid network. available networks: mainnet, testnet"))
        process.exit(1)
    }

    return {
        rpc,
        keypair,
        client,
        joystiq,
        network: config.network,
        wal
    }
}

export const verifyTransaction = async (rpc: string, digest: string) => {
    let found = false;

    let maxRetries = 10;
    let retries = 0;

    while (!found && retries < maxRetries) {
        try {
            const res = await axios.post(rpc, {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "sui_getTransactionBlock",
                "params": [
                    digest,
                ]
            });

            if (res.data.error) {
                retries++;
                await new Promise(resolve => setTimeout(resolve, 1000)); 
                continue;
            }

            found = true;
            return res.data.result;

        } catch (error) {
            retries++;
            await new Promise(resolve => setTimeout(resolve, 1000)); 
        }
    }
    throw new Error(`Transaction with digest ${digest} not found after ${maxRetries} retries.`);
}

export const getTransactionResult = async (rpc: string, digest: string) => {
    let found = false;
    let maxRetries = 10;
    let retries = 0;

    while (!found && retries < maxRetries) {
        try {
            const res = await axios.post(rpc, {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "sui_getTransactionBlock",
                "params": [
                    digest,
                    {
                        "showInput": true,
                        "showRawInput": false,
                        "showEffects": true,
                        "showEvents": true,
                        "showObjectChanges": false,
                        "showBalanceChanges": false,
                        "showRawEffects": false
                    }
                ]
            });

            if (res.data.error) {
                retries++;
                await new Promise(resolve => setTimeout(resolve, 1000)); 
                continue;
            }

            return res.data.result;

        } catch (error) {
            retries++;
            await new Promise(resolve => setTimeout(resolve, 1000)); 
            
        }
    }

    throw new Error(`Transaction with digest ${digest} not found after ${maxRetries} retries.`);
}

const main = () => {
    program
        .name("joystiq")
        .description(``);

    const init = program.command("init").description("Initialization commands")
    const collection = program.command("collection").description("Collection commands")
    const metadata = program.command("metadata").description("Metadata commands")
    const utils = program.command("utils").description("Utility commands")
    const allowlist = program.command("allowlist").description("Allowlist commands (merkle tree)")

    command_init(init)
    command_collection(collection)
    command_utils(utils)
    command_metadata(metadata)
    command_allowlist(allowlist)

    program.parse()
}

main()