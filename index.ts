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

const JOYSTIQ_CORE_TESTNET = "0xf3470587bbf694ade7e2b30bc92d8cb988f871ec1034bfeaef35a0cf01d23d3f"
const JOYSTIQ_CORE_TESTNET_ROOT = "0x0328d63fe460477e59e7499274c974d0719382884fcc2128ad1fbb3a7259f7e3"
const JOYSTIQ_CORE_MAINNET = "0x7595ad0a79228628cf186c3ae70d0c94e78b8071a7dcaaab3e7104cd87b8af84"
const JOYSTIQ_CORE_MAINNET_ROOT = "0x617b5bfab19d13a414c73f7ddaf711fa4d0bf39d6d252e8a56b62f447311c3d3"
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
        .version("0.1.0")
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