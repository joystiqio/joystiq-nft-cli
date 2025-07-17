import { Command } from "commander"
import fs from "fs"
import chalk from "chalk"
import { getChainConfig } from "."
import { Transaction } from "@mysten/sui/transactions"

export const command_utils = async (parent: Command) => {
    parent
        .command("mint")
        .description("Mint new NFTs from an existing project. Only unpaid minting is supported.")
        .argument("<project>", "Path to the project folder.")
        .argument("<group_name>", "Mint from a specific group")
        .argument("<amount>", "Amount of NFTs to mint")
        .action(async (projectPath, groupName, amount) => {
            let { rpc, keypair, client, joystiq } = getChainConfig(true)


            let artifacts = JSON.parse(fs.readFileSync(`${projectPath}/artifacts.json`).toString())
            let config = JSON.parse(fs.readFileSync(`${projectPath}/config.json`).toString())

            if (groupName)
                console.log("Minting from group: " + groupName)
            else
                return console.log(chalk.red("You must specify a group to mint from"))

            //check if group exists
            let groupIndex = config.groups.findIndex((group: any) => group.name === groupName);
            if (groupIndex === -1) {
                return console.log(chalk.red("Group not found: " + groupName));
            }

            let tx = new Transaction()
            tx.setSender(keypair.getPublicKey().toSuiAddress())
            tx.setGasBudget(50000000)

            tx.moveCall({
                target: `${artifacts.packageID}::jq721::mint_unpaid`,
                arguments: [
                    tx.object(artifacts.collectionObjectID),
                    tx.object(artifacts.collectionJqCoreConfigID),
                    tx.object(artifacts.policyID),
                    tx.pure.u64(groupIndex),
                    tx.pure.u64(parseInt(amount)),
                    tx.pure.option("vector<vector<u8>>", null),
                    tx.object("0x6"),
                ]
            })

            let res = await client.signAndExecuteTransaction({
                transaction: tx,
                signer: keypair,
                options: {
                    showEffects: true,
                    showEvents: true,
                }
            })

            if (res.effects!.status.status !== "success") {
                throw new Error(`Transaction failed: ${res.effects!.status.error} \n\nDigest: ${chalk.blue(res.digest)} \n`);
            }

            console.log("Mint success. Digest:", chalk.blue(res.digest));


        })

   
}