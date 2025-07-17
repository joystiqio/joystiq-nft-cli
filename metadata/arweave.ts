import { Command, program } from "commander"
import { contentTypeOf, createArTx, createManifestTx, getArweaveNodeUrl, getArweaveWallet, manifestData, signArTx, submitArTx } from "./_arweave"
import Arweave from "arweave"
import fs from "fs"
import chalk from "chalk"
import inquirer from "inquirer"
import ora from "ora"
import { BigNumber } from "bignumber.js"

export const command_metadata_arweave = async (parent: Command) => {
    parent
        .command("upload-single")
        .description("Upload a single file to arweave")
        .argument("<file>", "Path to the file to upload")
        .option("-w --wallet <wallet>", "Path to Arweave keypair JSON file")
        .option("-u --url <url>", "Arweave node URL (default: https://arweave.net)")
        .option("-s --skip-confirm", "Skip confirmation for the transaction cost", false)
        .action(async (file: string, options) => {

            if (!fs.existsSync(file)) {
                return console.log(chalk.red("File not found: " + file))
            }

            let wallet = getArweaveWallet(options.wallet)
            let { host, port, protocol } = getArweaveNodeUrl(options.url)

            let arweave = Arweave.init({
                host,
                port,
                protocol,
            })

            let fileStats = fs.statSync(file)
            let size = fileStats.size

            let cost = await arweave.transactions.getPrice(size)
            let costInAr = arweave.ar.winstonToAr(cost)

            if (!options.skipConfirm) {
                let confirm = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "confirm",
                        message: "This will cost ~" + costInAr + " AR. Continue? (this is an estimate and may vary depending on the network and file size)",
                        default: true
                    }
                ])

                if (!confirm.confirm)
                    return
            }

            //check balance
            let address = await arweave.wallets.jwkToAddress(wallet)
            let balance = await arweave.wallets.getBalance(address)

            if (new BigNumber(balance).isLessThan(cost)) {
                return console.log(chalk.red("Insufficient AR balance."))
            }

            let spinner = ora("Uploading file").start()

            // Create and sign the transaction
            let fileBuffer = fs.readFileSync(file)
            let tx = await createArTx(arweave, fileBuffer, wallet, contentTypeOf(file))
            tx = await signArTx(arweave, tx, wallet)

            await submitArTx(arweave, tx)

            spinner.succeed("File uploaded successfully")
            console.log("Transaction ID: " + chalk.blue(tx.id))
            if (port === "443" || port === "80")
                console.log("Url: " + chalk.green(`${protocol}://${host}/${tx.id}`))
            else
                console.log("Url: " + chalk.green(`${protocol}://${host}:${port}/${tx.id}`))
        })

    parent
        .command("upload")
        .description("Upload project images to arweave")
        .argument("<project>", "Path to the project folder.")
        .option("-w --wallet <wallet>", "Path to Arweave keypair JSON file")
        .option("-u --url <url>", "Arweave node URL (default: https://arweave.net)")
        .option("-s --skip-confirm", "Skip confirmation for the transaction cost", false)
        .option("-m --max-retries <maxRetries>", "Maximum number of retries for uploading images", "3")
        .action(async (projectPath: string, options) => {
            let maxRetries = parseInt(options.maxRetries)

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

            let filesParsed = []

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
                        //check if file name is number
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

                    if (metadata.token_id === -1) {
                        filesParsed.push(metadata)
                        continue; // Skip collection image
                    }

                    //validate name
                    if (!metadata.name) {
                        spinner.fail("Name field must exist in metadata file " + file);
                        return;
                    }

                    //validate attributes
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

            //validate filesParsed token ids are sequential. 1,2,3,... no gaps
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

            //sort filesParsed by token_id
            filesParsed.sort((a, b) => parseInt(a.token_id) - parseInt(b.token_id));

            spinner.succeed("Files valid")

            //Collection check
            let tokenIdMinusOne = filesParsed.findIndex((file) => parseInt(file.token_id) === -1);

            let wallet = getArweaveWallet(options.wallet)
            let { host, port, protocol } = getArweaveNodeUrl(options.url)

            let arweave = Arweave.init({
                host,
                port,
                protocol,
            })

            //logs
            let logs: any = []

            //setup cache
            let cache: any = {
                images: [],
                imagesManifest: "",
            }

            if (!fs.existsSync(`${projectPath}/.arweave`)) {
                fs.mkdirSync(`${projectPath}/.arweave`, { recursive: true })
            }

            if (fs.existsSync(`${projectPath}/.arweave/cache.json`)) {
                let cachefile = JSON.parse(fs.readFileSync(`${projectPath}/.arweave/cache.json`, "utf-8"))

                //ask if use cache
                let useCache = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "useCache",
                        message: `Would you like to use the cache file for previous content? located at ${chalk.green(`${projectPath}/.arweave/cache.json`)}`,
                        default: true
                    }
                ])

                if (useCache.useCache) {
                    cache = cachefile
                    //check if cache is valid
                    if (!Array.isArray(cache.images) || typeof cache.imagesManifest !== "string") {
                        spinner.fail("Invalid cache file")
                        return
                    }
                }
            }

            //calculate cost
            let totalSize = 0

            for (let file of filesParsed) {
                if (cache.images.filter((image: any) => image.name === file.image).length > 0) {
                    continue //skip if image is already in cache
                }
                let imageFileSize = fs.statSync(`${projectPath}/assets/${file.image}`).size
                totalSize += imageFileSize
            }

            let cost = await arweave.transactions.getPrice(totalSize)
            let constInAr = arweave.ar.winstonToAr(cost)

            if (!options.skipConfirm && totalSize > 0) {
                let confirm = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "confirm",
                        message: "This will cost ~" + constInAr + " AR. Continue? (this is an estimate and may vary depending on the network and file size)",
                        default: true
                    }
                ])

                if (!confirm.confirm)
                    return
            }

            //check balance
            let address = await arweave.wallets.jwkToAddress(wallet)
            let balance = await arweave.wallets.getBalance(address)

            if (new BigNumber(balance).isLessThan(cost)) {
                spinner.fail("Insufficient AR balance.")
                return
            }

            let failedImages = []

            spinner = ora("Uploading images").start()
            let counter = 0
            
            //upload images
            for (let i = 0; i < filesParsed.length; i++) {
                let retryCount = 0;
                let metadata = filesParsed[i]

                //if metadata.image is not in cache.images, upload it
                if (cache.images.filter((image: any) => image.name === metadata.image).length > 0) {
                    counter++
                    continue
                }

                let image = fs.readFileSync(`${projectPath}/assets/${metadata.image}`)

                while (retryCount < maxRetries) {
                    try {
                        let tx = await createArTx(arweave, image, wallet, contentTypeOf(metadata.image))
                        tx = await signArTx(arweave, tx, wallet)

                        await submitArTx(arweave, tx)
                        cache.images.push({
                            name: metadata.image,
                            token_id: metadata.token_id,
                            txid: tx.id
                        })

                        fs.writeFileSync(`${projectPath}/.arweave/cache.json`, JSON.stringify(cache, null, 4))

                        counter++
                        spinner.text = "Uploading images (" + counter + "/" + files.length + ") - (failed: " + failedImages.length + ")"
                        break;
                    } catch (e: any) {
                        try {
                            if (e.message && e.message.indexOf("429") !== -1) {
                                let waitTime = (2 ** retryCount) * 60000; // Exponential backoff
                                spinner.text = `Rate limit reached, waiting ${waitTime / 60000} minutes`;
                                await new Promise(resolve => setTimeout(resolve, waitTime));
                                retryCount++;
                            } else {
                                failedImages.push(metadata.image);
                                counter++;
                                spinner.text = "Uploading images (" + counter + "/" + files.length + ") - (failed: " + failedImages.length + ")";

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
                            spinner.text = "Uploading images (" + counter + "/" + files.length + ") - (failed: " + failedImages.length + ")";

                            logs.push({
                                type: "error",
                                message: "Failed to upload image " + metadata.image,
                                error: e
                            });
                            break;
                        }
                    }

                    // If the retry count has reached the maximum, log the failure and stop the CLI
                    if (retryCount === maxRetries) {
                        logs.push({
                            type: "fatal",
                            message: `Failed to upload image ${metadata.image} after ${maxRetries} retries.`,
                            error: `Error 429: Too Many Requests`
                        });

                        // Save logs before exiting
                        fs.writeFileSync(`${projectPath}/.arweave/logs.json`, JSON.stringify(logs, null, 4))

                        //save cache  before exiting
                        fs.writeFileSync(`${projectPath}/.arweave/cache.json`, JSON.stringify(cache, null, 4))

                        throw new Error(`Failed to upload image ${metadata.image} after ${maxRetries} retries. (429)`);
                    }
                }
            }

            spinner.succeed("Uploading Images completed")

            // Save cache
            fs.writeFileSync(`${projectPath}/.arweave/cache.json`, JSON.stringify(cache, null, 4))

            // Save logs
            fs.writeFileSync(`${projectPath}/.arweave/logs.json`, JSON.stringify(logs, null, 4))

            if (failedImages.length > 0) {
                console.log(chalk.red("Failed to upload " + failedImages.length + " images"))

                console.log("re run upload command to upload failed images")
                return
            }

            spinner = ora("Creating images manifest").start()

            let manifest: manifestData[] = []
            for (let image of cache.images) {
                manifest.push({
                    txid: image.txid,
                    path: image.token_id
                })
            }

            try {
                //if token id -1 exists or not
                let index;
                if (tokenIdMinusOne !== -1) {
                    index = "-1"
                } else {
                    index = cache.images[0].token_id;
                }

                let manifestTx = await createManifestTx(arweave, manifest, wallet, index);
                manifestTx = await signArTx(arweave, manifestTx, wallet)
                await submitArTx(arweave, manifestTx)
                cache.imagesManifest = manifestTx.id
            } catch (e) {
                spinner.fail("Failed to upload images manifest")
                console.log("re run upload command to retry upload")

                logs.push({
                    type: "error",
                    message: "Failed to upload image manifest",
                    error: e
                })

                fs.writeFileSync(`${projectPath}/.arweave/logs.json`, JSON.stringify(logs, null, 4))
                return
            }

            spinner.succeed("Uploading images manifest completed")

            // Save cache
            fs.writeFileSync(`${projectPath}/.arweave/cache.json`, JSON.stringify(cache, null, 4))

            // Create metadata file
            spinner = ora("Creating metadata file").start()

            let metadataFile: any[] = []
            let url = "";
            if (port === "443" || port === "80") {
                url = `${protocol}://${host}/${cache.imagesManifest}/`;
            } else {
                url = `${protocol}://${host}:${port}/${cache.imagesManifest}/`;
            }

            for (let file of filesParsed) {
                if (file.token_id === -1) {
                    continue; // Skip collection image
                }

                let attributes: any = {}

                if (Array.isArray(file.attributes)) {
                    file.attributes.forEach((attr: any) => {
                        attributes[attr.trait_type] = attr.value;
                    });
                }

                let metadata = {
                    token_id: file.token_id,
                    name: file.name,
                    image_url: `${url}${file.token_id}`,
                    description: file.description || "",
                    attributes: attributes,
                }

                metadataFile.push(metadata)
            }

            let metadataFileContent = JSON.stringify(metadataFile, null, 4)
            fs.writeFileSync(`${projectPath}/metadata.json`, metadataFileContent)

            spinner.succeed("Metadata file created at " + chalk.green(`${projectPath}/metadata.json`))
            console.log("Arweave manifest URL: " + chalk.green(url))

            if (tokenIdMinusOne !== -1) {
                console.log("Used token id -1 as index for manifest. You can use it as collection image: " + chalk.green(`${url}-1`))
            }


        })
}
