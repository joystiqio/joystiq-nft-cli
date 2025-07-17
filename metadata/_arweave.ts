import Arweave from "arweave"
import Transaction from "arweave/node/lib/transaction"
import chalk from "chalk"
import { program } from "commander"
import crypto from "crypto"
import fs from "fs"

export const createArTx = async (arweave: Arweave, data: Buffer, wallet: any, contentType: string) => {

    let tags = new Tags()
    tags.addTag('Content-Type', contentType)
    tags.addTag('User-Agent', "joystiq")
    tags.addTag('User-Agent-Version', "2.0.0")
    tags.addTag('Type', 'file')
    tags.addTag('File-Hash', hashFile(data))

    let tx = await arweave.createTransaction({ data }, wallet)
    tags.addTagsToTransaction(tx)

    return tx
}

export const signArTx = async (arweave: Arweave, tx: Transaction, wallet: any) => {
    await arweave.transactions.sign(tx, wallet)
    return tx
}

export const submitArTx = async (arweave: Arweave, tx: Transaction) => new Promise(async (resolve, reject) => {
    let uploader = await arweave.transactions.getUploader(tx)
    try {
        while (!uploader.isComplete) {
            await uploader.uploadChunk()
        }
    } catch (err) {
        if (uploader.lastResponseStatus > 0) {
            return reject({
                status: uploader.lastResponseStatus,
                statusText: uploader.lastResponseError,
            })
        }
    }

    resolve(tx.id)
})

export interface manifestData {
    txid: string,
    path: string,
}

export const createManifestTx = async (arweave: Arweave, txs: manifestData[], wallet: any, index:string) => {
    let paths: any = {}

    txs.forEach(({ txid, path }) => {
        paths[path] = { id: txid }
    })

    const data = {
        manifest: 'arweave/paths',
        version: '0.1.0',
        index: {
            path: "-1",
        },
        paths,
    }

    let tx = await arweave.createTransaction(
        {
            data: JSON.stringify(data),
        },
        wallet,
    )

    let tags = new Tags()
    tags.addTag('Type', 'manifest')
    tags.addTag('Content-Type', 'application/x.arweave-manifest+json')
    tags.addTagsToTransaction(tx)

    return tx
}

class Tags {
    _tags = new Map();

    constructor() {
        this._tags = new Map();
    }
    get tags() {
        return Array.from(this._tags.entries()).map(([name, value]) => ({ name, value }));
    }
    addTag(key: any, value: any) {
        this._tags.set(key, value);
    }
    addTags(tags: any) {
        tags.forEach(({ name, value }: any) => this.addTag(name, value));
    }
    addTagsToTransaction(tx: Transaction) {
        this.tags.forEach(({ name, value }) => tx.addTag(name, value));
    }
}

const hashFile = (data: Buffer) => {
    const hash = crypto.createHash('sha256')
    hash.update(data)
    return hash.digest('hex')
}

export const contentTypeOf = (name: string) => {
    if (name.endsWith(".png")) return "image/png"
    if (name.endsWith(".jpg")) return "image/jpeg"
    if (name.endsWith(".jpeg")) return "image/jpeg"
    if (name.endsWith(".gif")) return "image/gif"
    if (name.endsWith(".svg")) return "image/svg+xml"
    if (name.endsWith(".webp")) return "image/webp"
    if (name.endsWith(".bmp")) return "image/bmp"
    if (name.endsWith(".ico")) return "image/vnd.microsoft.icon"
    if (name.endsWith(".tiff")) return "image/tiff"
    if (name.endsWith(".tif")) return "image/tiff"
    if (name.endsWith(".avif")) return "image/avif"
    if (name.endsWith(".apng")) return "image/apng"
    if (name.endsWith(".jfif")) return "image/jpeg"
    if (name.endsWith(".pjpeg")) return "image/jpeg"
    if (name.endsWith(".pjp")) return "image/jpeg"
    if (name.endsWith('.html') || name.endsWith('.htm')) return 'text/html'
    if (name.endsWith(".mp4")) return "video/mp4"
    if (name.endsWith(".webm")) return "video/webm"
    if (name.endsWith(".avi")) return "video/x-msvideo"
    if (name.endsWith(".flv")) return "video/x-flv"
    if (name.endsWith(".mov")) return "video/quicktime"
    if (name.endsWith(".wmv")) return "video/x-ms-wmv"
    if (name.endsWith(".mp3")) return "audio/mpeg"
    if (name.endsWith(".wav")) return "audio/wav"

    return "application/octet-stream"
}

export const getArweaveWallet = (walletPath?: string) => {
    if (walletPath) {
        if (!fs.existsSync(walletPath)) {
            console.log(chalk.red("Arweave wallet file not found at " + walletPath))
            process.exit(1)
        }
        return JSON.parse(fs.readFileSync(walletPath, "utf-8"));
    } else {
        const configFilePath = program.opts().config || "./chain-config.json";
        var config: any;
        try {
            config = JSON.parse(fs.readFileSync(configFilePath).toString())
        } catch (error) {
            console.log(chalk.red(configFilePath + " not found. Please run 'joystiq init chain-config' to initialize the chain config file."))
            process.exit(1)
        }

        if (!config.arweave_wallet_path) {
            console.log(chalk.red("Arweave wallet path not found in " + configFilePath))
            process.exit(1)
        }

        return JSON.parse(fs.readFileSync(config.arweave_wallet_path, "utf-8"));
    }
}

export const getArweaveNodeUrl = (url?: string) => {
    let host = url ? url : ""
    let port = ""
    let protocol = ""
    let fullurl = url ? url : ""
    if (host) {
        if (host.startsWith("https://")) {
            port = "443"
            protocol = "https"
            host = host.split("https://")[1]
            if (host.indexOf(":") !== -1)
                host = host.split(":")[0]
        } else if (host.startsWith("http://")) {
            protocol = "http"

            if (host.indexOf(":") !== -1)
                port = host.split(":")[2]
            else
                port = "80"

            host = host.split("http://")[1]

            if (host.indexOf(":") !== -1)
                host = host.split(":")[0]

        } else{
            console.log(chalk.red("Invalid Arweave node URL. It should start with http:// or https://"))
            process.exit(1)
        }

        if (fullurl.endsWith("/"))
            fullurl = fullurl.substring(0, fullurl.length - 1)
    } else {
        host = "arweave.net"
        port = "443"
        protocol = "https"
        fullurl = "https://arweave.net"
    }

    return {
        host,
        port,
        protocol,
        fullurl,
    }
}