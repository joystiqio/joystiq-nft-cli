import { Command } from "commander"
import fs from "fs"
import chalk from "chalk"
import { getChainConfig } from "."
import { Transaction } from "@mysten/sui/transactions"
import inquirer from "inquirer"
import ora from "ora"

export const command_collection_metadata = async (parent: Command) => {
    parent
        .command("set")
        .description("Set metadatas of project")
        .argument("<project>", "Path to the project folder.")
        .option("-m, --metadata <metadata>", "Path to the metadata file")
        .option("-s --start <start>", "Manually set start token id", parseInt, 0)
        .option("-e --end <end>", "Manually set end token id", parseInt, 0)
        .option("-b --batch <batch>", "Batch size for setting metadata", parseInt, 2)
        .action(async (projectPath, options) => {
            const { rpc, keypair, client, joystiq } = getChainConfig(true)

            const artifacts = JSON.parse(fs.readFileSync(`${projectPath}/artifacts.json`).toString())
            const config = JSON.parse(fs.readFileSync(`${projectPath}/config.json`).toString())

            if (config.fixed_metadata) {
                console.log(chalk.red("This project has fixed metadata. You cannot set metadata for this project."))
                return
            }

            const metadataFile = options.metadata || `${projectPath}/metadata.json`
            if (!fs.existsSync(metadataFile)) {
                console.log(chalk.red("Metadata file not found. Please generate it first."))
                return
            }

            const metadata = JSON.parse(fs.readFileSync(metadataFile).toString())
            if (!Array.isArray(metadata)) {
                console.log(chalk.red("Invalid metadata file format. Expected an array."))
                return
            }

            // Basic validation
            for (let i = 0; i < metadata.length; i++) {
                const item = metadata[i]
                if (typeof item.token_id !== "number") return console.log(chalk.red(`Invalid token_id at index ${i}`))
                if (typeof item.name !== "string") return console.log(chalk.red(`Invalid name at index ${i}`))
                if (typeof item.image_url !== "string") return console.log(chalk.red(`Invalid image_url at index ${i}`))
                if (item.description && typeof item.description !== "string") return console.log(chalk.red(`Invalid description at index ${i}`))
                if (item.attributes && typeof item.attributes !== "object") return console.log(chalk.red(`Invalid attributes at index ${i}`))
            }

            const project = await client.getObject({
                id: artifacts.collectionObjectID,
                options: { showContent: true }
            })

            const supply = (project.data?.content as any).fields.supply

            if (parseInt(supply) !== metadata.length) {
                console.log(chalk.yellowBright(`⚠️  Collection supply (${supply}) does not match metadata count (${metadata.length}).`))
                const prompt = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "continue",
                        message: "Do you want to continue?",
                        default: false
                    }
                ])
                if (!prompt.continue) {
                    console.log(chalk.red("Aborted."))
                    return
                }
            }

            if ((project.data?.content as any).fixed_metadata) {
                console.log(chalk.red("This collection has fixed metadata. Cannot proceed."))
                return
            }

            let start = options.start || 0
            let end = Math.max(options.end || 0, metadata.length - 1)

            if (start < 0 || end < 0 || start > end) {
                console.log(chalk.red("Invalid start or end range."))
                return
            }

            const logs: any[] = []

            const metadataDir = `${projectPath}/.metadata`
            const cachePath = `${metadataDir}/cache.json`
            const logPath = `${metadataDir}/logs.json`

            if (!fs.existsSync(metadataDir)) fs.mkdirSync(metadataDir, { recursive: true })

            let cache: any = {}
            if (fs.existsSync(cachePath)) {
                const cachefile = JSON.parse(fs.readFileSync(cachePath, "utf-8"))
                const useCache = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "useCache",
                        message: `Use existing metadata cache from ${chalk.green(cachePath)}?`,
                        default: true
                    }
                ])
                if (useCache.useCache) cache = cachefile
            }

            let metadataToUpload = metadata.slice(start, end + 1)
            if (Object.keys(cache).length > 0) {
                metadataToUpload = metadataToUpload.filter((m: any) => !cache[m.token_id])
            }

            const confirm = await inquirer.prompt([
                {
                    type: "confirm",
                    name: "confirm",
                    message: `Set metadata for ${metadataToUpload.length} tokens? Ensure you have enough gas.`,
                    default: false
                }
            ])
            if (!confirm.confirm) {
                console.log(chalk.red("Aborted."))
                return
            }

            const batchSize = options.batch || 2
            const batches = []
            for (let i = 0; i < metadataToUpload.length; i += batchSize) {
                batches.push(metadataToUpload.slice(i, i + batchSize))
            }

            let total = metadataToUpload.length
            let completed = 0
            const spinner = ora(`Setting metadata (0/${total})`).start()

            for (const batch of batches) {
                const tx = new Transaction()
                tx.setSender(keypair.getPublicKey().toSuiAddress())
                tx.setGasBudget(50000000)

                for (const item of batch) {
                    let attributeKeys: string[] = []
                    let attributeValues: string[] = []

                    if (item.attributes) {
                        for (const key in item.attributes) {
                            attributeKeys.push(key)
                            attributeValues.push(item.attributes[key])
                        }
                    }

                    tx.moveCall({
                        target: `${artifacts.packageID}::jq721::create`,
                        arguments: [
                            tx.pure.u64(item.token_id),
                            tx.pure.string(item.name),
                            tx.pure.string(item.image_url),
                            item.description ? tx.pure.string(item.description) : tx.pure.string(""),
                            tx.pure.vector("string", attributeKeys),
                            tx.pure.vector("string", attributeValues),
                            tx.object(artifacts.collectionObjectID),
                            tx.object(artifacts.publisherID),
                        ]
                    })
                }

                try {
                    const res = await client.signAndExecuteTransaction({
                        transaction: tx,
                        signer: keypair,
                        options: {
                            showEffects: true,
                            showEvents: true,
                        }
                    })

                    if (res.effects!.status.status !== "success") {
                        logs.push({
                            type: "error",
                            token_ids: batch.map((item: any) => item.token_id),
                            error: res.effects!.status.error,
                            digest: res.digest,
                        })
                        fs.writeFileSync(logPath, JSON.stringify(logs, null, 4))
                    } else {
                        for (const item of batch) {
                            cache[item.token_id] = res.digest
                        }
                        fs.writeFileSync(cachePath, JSON.stringify(cache, null, 4))
                    }

                    completed += batch.length
                    spinner.text = `Setting metadata (${completed}/${total})`
                } catch (e) {
                    logs.push({
                        type: "fatal",
                        token_ids: batch.map((item: any) => item.token_id),
                        error: e,
                    })
                    fs.writeFileSync(logPath, JSON.stringify(logs, null, 4))
                    spinner.fail(`Failed batch at token_ids: [${batch.map(b => b.token_id).join(", ")}]`)
                    return
                }
            }

            spinner.succeed("Metadata setting completed successfully.")
        })
}
