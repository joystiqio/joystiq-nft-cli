import { keccak_256 } from "@noble/hashes/sha3";
import chalk from "chalk";
import { Command } from "commander";
import MerkleTree from "merkletreejs";
import fs from "fs";
import inquirer from "inquirer"

export const command_allowlist = async (root: Command) => {

    root
        .command("format-wallets")
        .description("Format wallet addresses, remove duplicates and save to a new file")
        .argument("<file>", "Path to .JSON or .txt file containing wallet addresses")
        .option('-o --overwrite', 'Overwrite the file', false)
        .option('-n --new-file <file>', 'Save the formatted wallets in a new file')
        .option('-g --generate-merkle-root', 'Generate Merkle root from the formatted wallets')
        .action(async (file, options) => {

            let wallets: string[] = []

            if (file.endsWith(".txt")) {
                wallets = fs.readFileSync(file, "utf-8").split("\n");
            } else {
                wallets = JSON.parse(fs.readFileSync(file, "utf-8"))
            }

            //remove duplicates and format wallets 
            wallets = [...new Set(
                wallets.map((line) => line.trim().toLowerCase())
                    .filter((line) => line.startsWith("0x"))
            )];

            if (wallets.length === 0) {
                console.log(chalk.red("No valid wallets found in the file"))
                return
            }

            console.log(chalk.green(`Formatted ${wallets.length} wallets`))

            if (options.newFile) {
                fs.writeFileSync(options.newFile+".json", JSON.stringify(wallets, null, 4))
                console.log(chalk.green(`Saved to ${options.newFile}.json`))
            }else if (options.overwrite) {
                fs.writeFileSync(file, JSON.stringify(wallets, null, 4))
                console.log(chalk.green(`Saved to ${file}`))
            }else{

                let ask = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "overwrite",
                        message: "Do you want to overwrite the file?"
                    }
                ])

                if (ask.overwrite) {
                    fs.writeFileSync(file, JSON.stringify(wallets, null, 4))
                    console.log(chalk.green(`Saved to ${file}`))
                }else{
                    let newFile = await inquirer.prompt([
                        {
                            type: "input",
                            name: "file",
                            message: "Name of the new file to save the formatted wallets",
                        }
                    ])
                    
                    fs.writeFileSync(newFile.file+".json", JSON.stringify(wallets, null, 4))
                    console.log(chalk.green(`Saved to ${newFile.file}.json`))
                }
            }

            if (options.generateMerkleRoot) {
                _genMerkleRoot(wallets)
            }
        });

    const _genMerkleRoot = async (wallets: string[]) => {
        // Hash wallet addresses
        let hashedWallets = wallets.map(keccak_256)

        // Generate Merkle tree
        const tree = new MerkleTree(hashedWallets, keccak_256, { sortPairs: true })
        const merkleRoot = tree.getRoot().toString('hex')

        console.log(`Merkle root: ${merkleRoot}`)
    }

    root
        .command("merkle-root")
        .description("Generate Merkle root from wallet addresses")
        .argument("<file>", "Path to .JSON file containing wallet addresses")
        .action((file) => {
            // Read wallet addresses
            let wallets = JSON.parse(fs.readFileSync(file, "utf-8"))

            _genMerkleRoot(wallets)
        });


    root
        .command("merkle-proof")
        .description("Generate Merkle proof from wallet address")
        .argument("<file>", "Path to .JSON file containing wallet addresses")
        .argument("<wallet>", "Wallet address to generate proof for")
        .action((file, wallet) => {
            // Read wallet addresses
            let wallets = JSON.parse(fs.readFileSync(file, "utf-8"))

            // check if wallet exists
            if (wallets.indexOf(wallet) === -1) {
                console.log(chalk.red("Wallet not found"))
                return
            }

            // Hash wallet addresses
            let hashedWallets = wallets.map(keccak_256)

            // Generate Merkle tree
            const tree = new MerkleTree(hashedWallets, keccak_256, { sortPairs: true })
            const merkleRoot = tree.getRoot().toString('hex')

            // Generate Merkle proof
            const proof = tree.getProof(Buffer.from(keccak_256(wallet))).map(element => element.data.toString('hex'))

            console.log("verification: " + tree.verify(proof, Buffer.from(keccak_256(wallet)), merkleRoot))

            console.log(`Merkle root: ${merkleRoot}`)
            console.log(`Merkle proof:`)
            console.log(proof)
        });

}