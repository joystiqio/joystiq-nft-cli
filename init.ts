import { Command } from "commander"
import inquirer from "inquirer"
import fs from "fs"
import slugify from "slugify"
import chalk from "chalk"

export const command_init = async (parent: Command) => {
    parent
        .command("chain-config")
        .description("Initialize access to the SUI blockchain.")
        .action(async () => {

            let answers = await inquirer.prompt([
                {
                    type: "input",
                    name: "private_key",
                    message: "What is the private key of your wallet?"
                },
                {
                    type: "input",
                    name: "rpc",
                    message: "What is the rpc address you wanna use?"
                },
                {
                    type: "input",
                    name: "network",
                    message: "What is the network you wanna use? (mainnet, testnet)",
                },
            ])

            if (fs.existsSync("./chain-config.json")) {
                //ask for overwrite
                let overwrite = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "overwrite",
                        message: "chain-config.json already exists. Do you want to overwrite it?"
                    }
                ])
                if (!overwrite.overwrite) return;
            }

            fs.writeFileSync("./chain-config.json", JSON.stringify({...answers, "arweave_wallet_path": ""}, null, 4))

            console.log("Chain config file created at " + chalk.green("./chain-config.json") + ".")
        })

    parent
        .command("project")
        .description("Initialize a new project.")
        .argument("<name>", "Name of the project")
        .action(async (name: string) => {
            let slug = slugify(name, { lower: true })

            let config = {
                collection_name: name,
                collection_description: "",
                collection_media_url: "",
                supply: "4444",
                fixed_metadata: false,
                royalty_percent: "5",
                royalty_wallet: "",
                is_immutable: false,
                start_order: "1",
                groups: [
                    {
                        name: "public",
                        merkle_root: null,
                        max_mints_per_wallet: "0",
                        reserved_supply: "0",
                        payments: [
                            {
                                coin: "0x2::sui::SUI",
                                routes: [
                                    {
                                        method: "transfer",
                                        amount: "1000000000",
                                        destination: ""
                                    }
                                ]
                            }
                        ],
                        start_time: new Date().toISOString().split(".")[0] + "Z",
                        end_time: null
                    }
                ],
            }

            //save config
            if (fs.existsSync(`./${slug}`)) {
                //ask for overwrite
                let overwrite = await inquirer.prompt([
                    {
                        type: "confirm",
                        name: "overwrite",
                        message: `a project folder for ${slug} already exists. Do you want to overwrite it?`
                    }
                ])
                if (!overwrite.overwrite) return;
            } else {
                fs.mkdirSync(`./${slug}`, { recursive: true })
            }
            fs.writeFileSync(`./${slug}/config.json`, JSON.stringify(config, null, 4))

            if (!fs.existsSync(`./${slug}/assets`)) {
                fs.mkdirSync(`./${slug}/assets`, { recursive: true })
            }

            console.log("Project folder" + chalk.green(` ${slug}`) + " created.")

            //create assets folder if it doesn't exist
            
        })

}