import { Command } from "commander"
import inquirer from "inquirer"
import fs from "fs"
import chalk from "chalk"
import { getChainConfig } from ".."
import { WalrusClient } from "@mysten/walrus"
import { BigNumber } from "bignumber.js"
import { contentTypeOf } from "."
import ora from "ora"

export const command_metadata_walrus = async (parent: Command) => {
    parent
        .command("upload-single")
        .description("Upload a single file to walrus")
        .argument("<file>", "Path to the file.")
        .argument("<epoch>", "Storage epoch to use.")
        .option("-s --skip-confirm", "Skip confirmation for the upload.")
        .option("-t --tip <tip>", "Max relay tip in WAL", "1000")
        .option("-u --url <url>", "Base (Aggregator) URL for the image (default is walrus.space depending on the network)")
        .option("-ur --upload-relay <url>", "Upload relay URL (default is walrus.space depending on the network)")
        .action(async (filePath: string, epoch: string, options: { skipConfirm: boolean, tip: string, url?: string, uploadRelay?: string }) => {

            let { rpc, client, keypair, wal, network } = getChainConfig(true)

            const baseUrl = options.url ? options.url.replace(/\/$/, "")
                : (network === "mainnet" ? "https://aggregator.walrus-mainnet.walrus.space" : "https://aggregator.walrus-testnet.walrus.space")
            const uploadRelayUrl = options.uploadRelay || (network === "mainnet" ? "https://upload-relay.walrus.space" : "https://upload-relay.testnet.walrus.space")
            let tip = parseInt(options.tip)

            client = client.$extend(
                WalrusClient.experimental_asClientExtension({
                    uploadRelay: {
                        host: uploadRelayUrl,
                        sendTip: {
                            max: tip,
                        },
                    },
                }),
            );

            const fileStats = fs.statSync(filePath);
            const fileSize = fileStats.size;
            const file = fs.readFileSync(filePath);
            const epochNumber = parseInt(epoch);

            const cost = await (client as any).walrus.storageCost(fileSize, epochNumber)

            const balance = await client.getBalance({
                owner: keypair.getPublicKey().toSuiAddress(),
                coinType: wal,
            })

            let totalCost = new BigNumber(cost.totalCost);
            let balanceValue = new BigNumber(balance.totalBalance).times(1e9);

            if (!options.skipConfirm) {
                let confirm = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "confirm",
                        message: `This will cost ${totalCost.div(1e9)} WAL. Do you want to continue?`
                    }
                ])

                if (!confirm.confirm)
                    return;

                if (balanceValue.isLessThan(totalCost)) {
                    console.log(chalk.red("Not enough balance to upload the file. Required: " + totalCost.div(1e9) + ", Available: " + balance.totalBalance + " WAL"))
                    process.exit(1)
                }
            }

            const contentType = contentTypeOf(filePath);

            const { blobId, blobObject } = await (client as any).walrus.writeBlob({
                blob: file,
                deletable: false,
                epochs: epochNumber,
                signer: keypair,
                attributes: {
                    contentType: contentType,
                    contentLength: fileSize.toString(),
                },
            });

            console.log("Blob ID:", blobId);
            console.log("Blob Object:", blobObject);
            console.log("URL:", `${baseUrl}/v1/blobs/by-object-id/${blobObject.id.id}`)
        })

    parent
        .command("upload")
        .description("Upload project images to walrus")
        .argument("<project>", "Path to the project folder.")
        .argument("<epoch>", "Storage epoch to use.")
        .option("-s --skip-confirm", "Skip confirmation for the transaction cost", false)
        .option("-m --max-retries <maxRetries>", "Maximum number of retries for uploading images", "3")
        .option("-t --tip <tip>", "Max relay tip in WAL", "1000")
        .option("-u --url <url>", "Base (Aggregator) URL for the images (default is walrus.space depending on the network)")
        .option("-ur --upload-relay <url>", "Upload relay URL (default is walrus.space depending on the network)")
        .action(async (projectPath: string, epoch: string, options) => {
            let { rpc, client, keypair, network, wal } = getChainConfig(true)

            const maxRetries = parseInt(options.maxRetries)
            const tip = parseInt(options.tip)
            const epochNumber = parseInt(epoch);
            const baseUrl = options.url ? options.url.replace(/\/$/, "")
                : (network === "mainnet" ? "https://aggregator.walrus-mainnet.walrus.space" : "https://aggregator.walrus-testnet.walrus.space");
            const uploadRelayUrl = options.uploadRelay || (network === "mainnet" ? "https://upload-relay.walrus.space" : "https://upload-relay.testnet.walrus.space");

            if (fs.existsSync(`${projectPath}/metadata.json`)) {
                let overwrite = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "overwrite",
                        message: `${projectPath}/metadata.json already exists. Do you want to overwrite it?`
                    }
                ])
                if (!overwrite.overwrite) {
                    console.log(chalk.red("Operation cancelled."))
                    return
                }
            }

            let spinner = ora("Validating files").start()

            let files = fs.readdirSync(`${projectPath}/assets`).filter((file) => file.endsWith(".json"))

            if (files.length === 0) {
                spinner.fail("No files found in assets folder")
                return
            }

            let filesParsed: any[] = []

            for (let file of files) {
                try {
                    let metadata = JSON.parse(fs.readFileSync(`${projectPath}/assets/${file}`, "utf-8"))

                    if (!metadata.image) {
                        spinner.fail("Image field not found in metadata file " + file)
                        return
                    } else {
                        if (!fs.existsSync(`${projectPath}/assets/${metadata.image}`)) {
                            spinner.fail("Image not found for metadata file " + file)
                            return
                        }
                    }

                    if (typeof metadata.token_id === "undefined") {
                        let tokenId = file.split(".")[0]
                        if (isNaN(Number(tokenId))) {
                            spinner.fail("Token ID either must be defined in metadata file or file name must be a number: " + file)
                            return
                        } else {
                            metadata.token_id = parseInt(tokenId)
                        }
                    } else {
                        if (isNaN(Number(metadata.token_id))) {
                            spinner.fail("Token ID must be a number in metadata file " + file)
                            return
                        }

                        metadata.token_id = parseInt(metadata.token_id)
                    }

                    if (!metadata.name && metadata.token_id !== -1) {
                        spinner.fail("Name field must exist in metadata file " + file);
                        return;
                    }

                    if (metadata.attributes) {
                        if (!metadata.attributes) {
                            spinner.fail("Attributes field must exist in metadata file " + file);
                            return;
                        }

                        const isArrayFormat = Array.isArray(metadata.attributes) && metadata.attributes.every((attr: any) =>
                            typeof attr === 'object' &&
                            typeof attr.trait_type === 'string' &&
                            'value' in attr
                        );

                        const isObjectFormat = typeof metadata.attributes === 'object' &&
                            !Array.isArray(metadata.attributes) &&
                            Object.values(metadata.attributes).every(value => typeof value === 'string');

                        if (!isArrayFormat && !isObjectFormat) {
                            spinner.fail("Attributes field must be either an array of {trait_type, value} or a flat object in metadata file " + file);
                            return;
                        }
                    }

                    filesParsed.push(metadata)
                } catch (e) {
                    spinner.fail("Invalid metadata file " + file)
                    console.log(e)
                    return
                }
            }

            let tokenIds = filesParsed.map(file => parseInt(file.token_id));
            tokenIds.sort((a, b) => a - b);
            tokenIds = tokenIds.filter(id => id !== -1);

            for (let i = 0; i < tokenIds.length; i++) {
                if (tokenIds[i] !== i + 1) {
                    spinner.fail("Token IDs must be sequential starting from 1 or 0. Found gap at index " + i + ": " + tokenIds[i]);
                    return;
                }
                if (tokenIds[i] < 0) {
                    spinner.fail("Token IDs must be positive integers. Only -1 is allowed for collection image. token id:" + tokenIds[i]);
                    return;
                }
            }

            filesParsed.sort((a, b) => parseInt(a.token_id) - parseInt(b.token_id));

            spinner.succeed("Files valid")

            const tokenIdMinusOne = filesParsed.findIndex((file) => parseInt(file.token_id) === -1);

            client = client.$extend(
                WalrusClient.experimental_asClientExtension({
                    uploadRelay: {
                        host: uploadRelayUrl,
                        sendTip: {
                            max: tip,
                        },
                    },
                }),
            );

            let logs: any = []

            let cache: any = {
                images: [],
            }

            if (!fs.existsSync(`${projectPath}/.walrus`)) {
                fs.mkdirSync(`${projectPath}/.walrus`, { recursive: true })
            }

            if (fs.existsSync(`${projectPath}/.walrus/cache.json`)) {
                let cachefile = JSON.parse(fs.readFileSync(`${projectPath}/.walrus/cache.json`, "utf-8"))

                let useCache = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "useCache",
                        message: `Would you like to use the cache file for previous content? located at ${chalk.green(`${projectPath}/.walrus/cache.json`)}`,
                        default: true
                    }
                ])

                if (useCache.useCache) {
                    cache = cachefile
                    if (!Array.isArray(cache.images)) {
                        spinner.fail("Invalid cache file")
                        return
                    }
                }
            }

            let totalSize = 0

            for (let file of filesParsed) {
                if (cache.images.filter((image: any) => image.name === file.image).length > 0) {
                    continue
                }
                let imageFileSize = fs.statSync(`${projectPath}/assets/${file.image}`).size
                totalSize += imageFileSize
            }

            const cost = await (client as any).walrus.storageCost(totalSize, epochNumber)

            const balance = await client.getBalance({
                owner: keypair.getPublicKey().toSuiAddress(),
                coinType: wal,
            })

            let totalCost = new BigNumber(cost.totalCost);
            let balanceValue = new BigNumber(balance.totalBalance).times(1e9);

            if (!options.skipConfirm && totalSize > 0) {
                let confirm = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "confirm",
                        message: "This will cost ~" + totalCost.div(1e9) + " WAL. Continue? (this is an estimate and may vary depending on the network and file size)",
                        default: true
                    }
                ])

                if (!confirm.confirm)
                    return

                if (balanceValue.isLessThan(totalCost)) {
                    console.log(chalk.red("Not enough balance to upload the file. Required: " + totalCost.div(1e9) + ", Available: " + balance.totalBalance + " WAL"))
                    process.exit(1)
                }
            }

            let failedImages: string[] = []

            spinner = ora("Uploading images").start()
            let counter = 0

            for (let i = 0; i < filesParsed.length; i++) {
                let retryCount = 0;
                let metadata = filesParsed[i]

                if (cache.images.filter((image: any) => image.name === metadata.image).length > 0) {
                    counter++
                    spinner.text = "Uploading images (" + counter + "/" + filesParsed.length + ") - (failed: " + failedImages.length + ")"
                    continue
                }

                let image = fs.readFileSync(`${projectPath}/assets/${metadata.image}`)
                let imageStats = fs.statSync(`${projectPath}/assets/${metadata.image}`);
                let imageSize = imageStats.size;

                while (retryCount < maxRetries) {
                    try {
                        const contentType = contentTypeOf(`${projectPath}/assets/${metadata.image}`);
                        const { blobId, blobObject } = await (client as any).walrus.writeBlob({
                            blob: image,
                            deletable: false,
                            epochs: epochNumber,
                            signer: keypair,
                            attributes: {
                                contentType: contentType,
                                contentLength: imageSize.toString()
                            },
                        });

                        cache.images.push({
                            name: metadata.image,
                            token_id: metadata.token_id,
                            blobId: blobId,
                            blobObject: blobObject.id.id,
                        })

                        fs.writeFileSync(`${projectPath}/.walrus/cache.json`, JSON.stringify(cache, null, 4))

                        counter++
                        spinner.text = "Uploading images (" + counter + "/" + filesParsed.length + ") - (failed: " + failedImages.length + ")"
                        break;
                    } catch (e: any) {
                        try {
                           if (e.message && (e.message.includes("429") || e.message.includes("502") || e.message.includes("503") || e.message.includes("504"))) {
                                let waitTime = (2 ** retryCount) * 60000; // Exponential backoff
                                spinner.text = `Rate/temporary limit reached, waiting ${waitTime / 60000} minutes`;
                                await new Promise(resolve => setTimeout(resolve, waitTime));
                                retryCount++;
                            } else {
                                failedImages.push(metadata.image);
                                counter++;
                                spinner.text = "Uploading images (" + counter + "/" + filesParsed.length + ") - (failed: " + failedImages.length + ")";

                                logs.push({
                                    type: "error",
                                    message: "Failed to upload image " + metadata.image,
                                    error: e
                                });
                                break;
                            }
                        } catch (e) {
                            failedImages.push(metadata.image);
                            counter++;
                            spinner.text = "Uploading images (" + counter + "/" + filesParsed.length + ") - (failed: " + failedImages.length + ")";

                            logs.push({
                                type: "error",
                                message: "Failed to upload image " + metadata.image,
                                error: e
                            });
                            break;
                        }
                    }

                    if (retryCount === maxRetries) {
                        logs.push({
                            type: "fatal",
                            message: `Failed to upload image ${metadata.image} after ${maxRetries} retries.`,
                            error: `Max retries reached: ${maxRetries}`
                        });

                        fs.writeFileSync(`${projectPath}/.walrus/logs.json`, JSON.stringify(logs, null, 4))
                        fs.writeFileSync(`${projectPath}/.walrus/cache.json`, JSON.stringify(cache, null, 4))

                        throw new Error(`Failed to upload image ${metadata.image} after ${maxRetries} retries. (429)`);
                    }
                }
            }

            spinner.succeed("Uploading Images completed")

            fs.writeFileSync(`${projectPath}/.walrus/cache.json`, JSON.stringify(cache, null, 4))
            fs.writeFileSync(`${projectPath}/.walrus/logs.json`, JSON.stringify(logs, null, 4))

            if (failedImages.length > 0) {
                console.log(chalk.red("Failed to upload " + failedImages.length + " images"))
                console.log("re run upload command to upload failed images")
                return
            }

            spinner = ora("Creating metadata file").start()

            let metadataFile: any[] = []

            const lookup = new Map(cache.images.map((i: any) => [parseInt(i.token_id), i]))

            for (let file of filesParsed) {
                if (file.token_id === -1) {
                    continue;
                }

                let attributes: any = {}

                if (Array.isArray(file.attributes)) {
                    file.attributes.forEach((attr: any) => {
                        attributes[attr.trait_type] = attr.value;
                    });
                } else if (file.attributes && typeof file.attributes === "object") {
                    attributes = file.attributes
                }

                const cached:any = lookup.get(parseInt(file.token_id))
                if (!cached) {
                    continue
                }

                let metadata = {
                    token_id: file.token_id,
                    name: file.name,
                    image_url: `${baseUrl}/v1/blobs/by-object-id/${cached.blobObject}`,
                    description: file.description || "",
                    attributes: attributes,
                }

                metadataFile.push(metadata)
            }

            let metadataFileContent = JSON.stringify(metadataFile, null, 4)
            fs.writeFileSync(`${projectPath}/metadata.json`, metadataFileContent)

            spinner.succeed("Metadata file created at " + chalk.green(`${projectPath}/metadata.json`))

            if (tokenIdMinusOne !== -1) {
                const minusOne = cache.images.find((i: any) => parseInt(i.token_id) === -1)
                if (minusOne) {
                    console.log("Collection image (token id -1): " + chalk.green(`${baseUrl}/v1/blobs/by-object-id/${minusOne.blobObject}`))
                }
            }
        })

}
