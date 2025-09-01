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

import { command_allowlist } from "./allowlist";
import { Transaction } from "@mysten/sui/transactions"

const JOYSTIQ_CORE_TESTNET = "0xb7821def705f461d76490d7fe87b71cb1feed4896df71a04e115e485a4e89bff"
const JOYSTIQ_CORE_TESTNET_ROOT = "0xab7c93f04a96463af1cb257fecc50b9bf41bb0e2bcbafef250a3b8cf9d2b55d4"
const JOYSTIQ_CORE_MAINNET = "0xeace579752cd466d91aa73a60829674829d3e329bde76625340528b3954b79ea"
const JOYSTIQ_CORE_MAINNET_ROOT = "0x9e12a19292d42b4161778d4086d44489f1deb2c1b60813d0fc3f85b1150d22cf"
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
    } else if (config.network === "mainnet") {
        joystiq = {
            core: JOYSTIQ_CORE_MAINNET,
            root: JOYSTIQ_CORE_MAINNET_ROOT,
        };
        client = new SuiClient({
            url: config.rpc || getFullnodeUrl("mainnet"),
            network: "mainnet",
        });
        rpc = config.rpc || getFullnodeUrl("mainnet");
        wal = WAL_MAINNET;
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

export const GetGasBudget = async (client: SuiClient, tx: Transaction) => {
    const dryRunBytes = await tx.build({ client });
    const dryRunResult = await client.dryRunTransactionBlock({ transactionBlock: dryRunBytes });
    const gasUsed = dryRunResult.effects.gasUsed!;
    const estimatedGas = (
        BigInt(gasUsed.computationCost) +
        BigInt(gasUsed.storageCost) -
        BigInt(gasUsed.storageRebate)
    );
    return Number(estimatedGas * BigInt(12) / BigInt(10));
}

const main = () => {
    program
        .name("joystiq")
        .version("0.1.3")
        .description(`SUI NFT CLI`);

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