import { Command } from "commander"
import fs from "fs"
import chalk from "chalk"
import { getChainConfig, GetGasBudget, verifyTransaction } from "."
import { Transaction } from "@mysten/sui/transactions"
import inquirer from "inquirer"
import ora from "ora"

export const command_collection_metadata = async (parent: Command) => {
    parent
        .command("set")
        .description("Set metadata of project")
        .argument("<project>", "Path to the project folder.")
        .option("-m, --metadata <metadata>", "Path to the metadata file")
        .option("-s --start <start>", "Start token ID", parseInt, 0)
        .option("-e --end <end>", "End token ID", parseInt, 0)
        .option("-b --batch <batch>", "Batch size", "2")
        .action(async (projectPath, options) => {
            const { rpc, keypair, client } = getChainConfig(true)

            const artifacts = JSON.parse(fs.readFileSync(`${projectPath}/artifacts.json`, "utf8"))
            const config = JSON.parse(fs.readFileSync(`${projectPath}/config.json`, "utf8"))

            if (config.fixed_metadata) {
                console.log(chalk.red("Fixed metadata collection — can't proceed."))
                return
            }

            const metadataFile = options.metadata || `${projectPath}/metadata.json`
            if (!fs.existsSync(metadataFile)) {
                console.log(chalk.red("Metadata file not found."))
                return
            }

            const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"))
            if (!Array.isArray(metadata)) {
                console.log(chalk.red("Expected metadata.json to be an array."))
                return
            }

            // Validate metadata entries
            for (const [i, item] of metadata.entries()) {
                if (typeof item.token_id !== "number") return console.log(chalk.red(`Invalid token_id at index ${i}`))
                if (typeof item.name !== "string") return console.log(chalk.red(`Invalid name at index ${i}`))
                if (typeof item.image_url !== "string") return console.log(chalk.red(`Invalid image_url at index ${i}`))
                if (item.description && typeof item.description !== "string") return console.log(chalk.red(`Invalid description at index ${i}`))
                if (item.attributes && typeof item.attributes !== "object") return console.log(chalk.red(`Invalid attributes at index ${i}`))
            }

            const project = await client.getObject({
                id: artifacts.collectionObjectID,
                options: { showContent: true },
            })

            const supply = parseInt((project.data?.content as any).fields.supply)
            if (supply !== metadata.length) {
                const prompt = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "continue",
                        message: `Collection supply (${supply}) ≠ metadata count (${metadata.length}). Continue?`,
                        default: false,
                    },
                ])
                if (!prompt.continue) return
            }

            const start = options.start || 0
            const end = Math.max(options.end || metadata.length - 1, start)
            const batchSize = parseInt(options.batch, 10) || 2

            const metadataDir = `${projectPath}/.metadata`
            const cachePath = `${metadataDir}/cache.json`
            const logPath = `${metadataDir}/logs.json`

            if (!fs.existsSync(metadataDir)) fs.mkdirSync(metadataDir, { recursive: true })

            let cache: Record<number, string> = {}
            if (fs.existsSync(cachePath)) {
                const useCache = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "useCache",
                        message: `Use cached metadata from ${chalk.green(cachePath)}?`,
                        default: true,
                    },
                ])
                if (useCache.useCache) cache = JSON.parse(fs.readFileSync(cachePath, "utf8"))
            }

            const allLogs: any[] = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, "utf8")) : []

            const toUpload = metadata
                .slice(start, end + 1)
                .filter((m) => !cache[m.token_id])

            const confirm = await inquirer.prompt([
                {
                    type: "confirm",
                    name: "confirm",
                    message: `Set metadata for ${toUpload.length} tokens?`,
                    default: false,
                },
            ])
            if (!confirm.confirm) return

            const spinner = ora(`Setting metadata (0/${toUpload.length})`).start()
            let completed = 0

            for (let i = 0; i < toUpload.length; i += batchSize) {
                const batch = toUpload.slice(i, i + batchSize)

                const tx = new Transaction()
                tx.setSender(keypair.getPublicKey().toSuiAddress())

                for (const item of batch) {
                    const keys = Object.keys(item.attributes || {})
                    const values = keys.map((key) => item.attributes[key])

                    tx.moveCall({
                        target: `${artifacts.packageID}::jq721::create`,
                        arguments: [
                            tx.pure.u64(item.token_id),
                            tx.pure.string(item.name),
                            tx.pure.string(item.image_url),
                            item.description ? tx.pure.string(item.description) : tx.pure.string(""),
                            tx.pure.vector("string", keys),
                            tx.pure.vector("string", values),
                            tx.object(artifacts.collectionObjectID),
                            tx.object(artifacts.publisherID),
                        ],
                    })
                }

                try {
                    tx.setGasBudget(await GetGasBudget(client, tx))
                    const res = await client.signAndExecuteTransaction({
                        transaction: tx,
                        signer: keypair,
                        options: {
                            showEffects: true,
                            showEvents: true,
                        },
                    })

                    const success = res.effects?.status.status === "success"

                    if (success) {
                        for (const item of batch) {
                            cache[item.token_id] = res.digest
                        }
                        fs.writeFileSync(cachePath, JSON.stringify(cache, null, 4))
                        await verifyTransaction(rpc, res.digest)
                        completed += batch.length
                        spinner.text = `Setting metadata (${completed}/${toUpload.length})`
                    } else {
                        throw new Error(res.effects?.status.error)
                    }
                } catch (err: any) {
                    allLogs.push({
                        type: "error",
                        token_ids: batch.map((b) => b.token_id),
                        error: err.message || err,
                    })
                    fs.writeFileSync(logPath, JSON.stringify(allLogs, null, 4))
                    spinner.warn(`Failed batch: ${batch.map((b) => b.token_id).join(", ")}`)
                    // continue to next batch
                }
            }

            spinner.succeed("All metadata set (or attempted). Check logs for failures.")
        })
}
