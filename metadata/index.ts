import { Command } from "commander"
import inquirer from "inquirer"
import fs from "fs"
import chalk from "chalk"
//import { command_metadata_walrus } from "./walrus"
import { command_metadata_arweave } from "./arweave"

export const command_metadata = async (parent: Command) => {
    const walrus = parent.command("walrus").description("Walrus commands (Coming Soon!)")
    const arweave = parent.command("arweave").description("Arweave commands")

    //command_metadata_walrus(walrus)
    command_metadata_arweave(arweave)

}