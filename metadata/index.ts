import { Command } from "commander"
import inquirer from "inquirer"
import fs from "fs"
import chalk from "chalk"
import { command_metadata_walrus } from "./walrus"
import { command_metadata_arweave } from "./arweave"

export const command_metadata = async (parent: Command) => {
    const walrus = parent.command("walrus").description("Walrus commands (Coming Soon!)")
    const arweave = parent.command("arweave").description("Arweave commands")

    command_metadata_walrus(walrus)
    command_metadata_arweave(arweave)

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