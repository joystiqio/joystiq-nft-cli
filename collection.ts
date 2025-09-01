import { Command } from "commander"
import fs from "fs"
import { getChainConfig, GetGasBudget, getTransactionResult, verifyTransaction } from "."
import jq721Contract from "./contract"
import { Transaction } from "@mysten/sui/transactions"
import chalk from "chalk"
import { command_collection_metadata } from "./collectionMetadata"
import inquirer from "inquirer"

export const command_collection = async (parent: Command) => {
    const metadata = parent.command("metadata").description("Collection metadata commands")

    command_collection_metadata(metadata)

    parent
        .command("deploy")
        .description("Deploy a collection.")
        .argument("<project>", "Path to the project folder.")
        .action(async (projectPath: string, options: {}) => {
            let { rpc, keypair, client, joystiq } = getChainConfig(true)

            let config = JSON.parse(fs.readFileSync(`${projectPath}/config.json`).toString())

            let { modules, dependencies } = jq721Contract

            dependencies[dependencies.length - 1] = joystiq.core; // replace the last dependency with the core contract

            // STEP 1: deploy the jq721 contract
            let tx = new Transaction()
            tx.setSender(keypair.getPublicKey().toSuiAddress())
            const upgradeCap = tx.publish({ modules, dependencies })
            tx.transferObjects([upgradeCap], keypair.getPublicKey().toSuiAddress())

            tx.setGasBudget(await GetGasBudget(client, tx))
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

            //query digest and get the package id
            let packageId = res.events![0].packageId;

            console.log("Deployed package. Digest:", chalk.blue(res.digest));

            //verify the transaction
            await verifyTransaction(rpc, res.digest);

            // STEP 2: call the `initialize_collection` function of the jq721 contract
            tx = new Transaction()

            //get necessary objects
            let objects = await client.multiGetObjects({
                ids: res.effects!.created!.map((obj: any) => obj.reference.objectId),
                options: {
                    showType: true,

                }
            })

            let policyID = objects.find((obj: any) => obj.data.type === `0x2::transfer_policy::TransferPolicy<${packageId}::jq721::NFT>`)?.data?.objectId!;
            let policyCapID = objects.find((obj: any) => obj.data.type === `0x2::transfer_policy::TransferPolicyCap<${packageId}::jq721::NFT>`)?.data?.objectId!;
            let collectionObjectID = objects.find((obj: any) => obj.data.type === `${packageId}::jq721::Collection`)?.data?.objectId!;
            let publisherID = objects.find((obj: any) => obj.data.type === `0x2::package::Publisher`)?.data?.objectId!;

            let fixedMetadataArgs: any[] = [];
            if (config.fixed_metadata !== false) {
                let attributeKeys = config.fixed_metadata.attributes.map((a: any) => a.key);
                let attributeValues = config.fixed_metadata.attributes.map((a: any) => a.value);


                fixedMetadataArgs = [
                    tx.pure.string(config.fixed_metadata.name),
                    tx.pure.string(config.fixed_metadata.image),
                    tx.pure.string(config.fixed_metadata.description),
                    tx.pure.vector("string", attributeKeys),
                    tx.pure.vector("string", attributeValues),
                    tx.pure.option("string", config.fixed_metadata.name_format || undefined),
                ]
            } else {
                fixedMetadataArgs = [
                    tx.pure.string(""), tx.pure.string(""), tx.pure.string(""), tx.pure.vector("string", []), tx.pure.vector("string", []), tx.pure.option("string", null)
                ]
            }


            tx.setSender(keypair.getPublicKey().toSuiAddress())
            tx.moveCall({
                target: `${packageId}::jq721::initialize_collection`,
                arguments: [
                    tx.pure.string(config.collection_name),
                    tx.pure.string(config.collection_description),
                    tx.pure.string(config.collection_media_url),
                    tx.pure.u64(config.supply),
                    tx.pure.bool(config.is_immutable),
                    tx.pure.u16(parseFloat(config.royalty_percent) * 100),
                    tx.pure.u64(parseInt(config.start_order)),
                    tx.pure.bool(config.fixed_metadata !== false),

                    ...fixedMetadataArgs,
                    tx.object(policyID),
                    tx.object(policyCapID),
                    tx.object(collectionObjectID),
                    tx.object(publisherID)
                ]
            })

            tx.setGasBudget(await GetGasBudget(client, tx))
            let res2 = await client.signAndExecuteTransaction({
                transaction: tx,
                signer: keypair,
                options: {
                    showEffects: true,
                    showEvents: true,
                }
            })

            if (res2.effects!.status.status !== "success") {
                throw new Error(`Transaction failed: ${res2.effects!.status.error} \n\nDigest: ${chalk.blue(res2.digest)} \n`);
            }


            console.log("Collection initialized. Digest:", chalk.blue(res2.digest));

            //verify the transaction
            await verifyTransaction(rpc, res2.digest);

            objects = await client.multiGetObjects({
                ids: res2.effects!.created!.map((obj: any) => obj.reference.objectId),
                options: {
                    showType: true,
                }
            })

            let displayID = objects.find((obj: any) => obj.data.type === `0x2::display::Display<${packageId}::jq721::NFT>`)?.data?.objectId!;

            //STEP 3: register the collection to the Joystiq Core contract
            tx = new Transaction()
            tx.setSender(keypair.getPublicKey().toSuiAddress())

            tx.moveCall({
                target: `${joystiq.core}::nft_core::register_collection`,
                arguments: [
                    //tx.object(joystiq.root),
                    tx.object(publisherID),
                    tx.pure.string((config.collection_name)),
                ]
            })

            tx.setGasBudget(await GetGasBudget(client, tx))
            let res3 = await client.signAndExecuteTransaction({
                transaction: tx,
                signer: keypair,
                options: {
                    showEffects: true,
                    showEvents: true,
                }
            })

            if (res3.effects!.status.status !== "success") {
                throw new Error(`Transaction failed: ${res3.effects!.status.error} \n\nDigest: ${chalk.blue(res3.digest)} \n`);
            }

            console.log("Collection registered to Joystiq Core contract. Digest:", chalk.blue(res3.digest));

            //verify the transaction
            await verifyTransaction(rpc, res3.digest);

            objects = await client.multiGetObjects({
                ids: res3.effects!.created!.map((obj: any) => obj.reference.objectId),
                options: {
                    showType: true,
                }
            })

            let collectionJqCoreConfigID = objects.find((obj: any) => obj.data.type === `${joystiq.core}::nft_core::Collection`)?.data?.objectId!;

            //STEP 4: call update collection of core to set mint groups
            tx = new Transaction()
            tx.setSender(keypair.getPublicKey().toSuiAddress())

            let mg_name = config.groups.map((g: any) => g.name)
            let mg_merkle_root = config.groups.map((g: any) => g.merkle_root ? Array.from(Buffer.from(g.merkle_root, 'hex')) : null);
            let mg_max_mints_per_wallet = config.groups.map((g: any) => parseInt(g.max_mints_per_wallet))
            let mg_reserved_supply = config.groups.map((g: any) => parseInt(g.reserved_supply))
            let mg_start_time = config.groups.map((g: any) => g.start_time ? new Date(g.start_time).getTime() : 0)
            let mg_end_time = config.groups.map((g: any) => g.end_time ? new Date(g.end_time).getTime() : 0)

            tx.moveCall({
                target: `${joystiq.core}::nft_core::update_collection`,
                arguments: [
                    //tx.object(joystiq.root),
                    tx.object(collectionJqCoreConfigID),
                    tx.object(publisherID),
                    tx.pure.string((config.collection_name)),
                    tx.pure.vector("string", mg_name),
                    tx.pure.vector('option<vector<u8>>', mg_merkle_root),
                    tx.pure.vector("u64", mg_max_mints_per_wallet),
                    tx.pure.vector("u64", mg_reserved_supply),
                    tx.pure.vector("u64", mg_start_time),
                    tx.pure.vector("u64", mg_end_time),
                ]
            })

             tx.setGasBudget(await GetGasBudget(client, tx))
            let res4 = await client.signAndExecuteTransaction({
                transaction: tx,
                signer: keypair,
                options: {
                    showEffects: true,
                    showEvents: true,
                }
            })

            if (res4.effects!.status.status !== "success") {
                throw new Error(`Transaction failed: ${res4.effects!.status.error} \n\nDigest: ${chalk.blue(res4.digest)} \n`);
            }

            console.log("Mint groups saved. Digest:", chalk.blue(res4.digest));

            //verify the transaction
            await verifyTransaction(rpc, res4.digest);

            //STEP 5: for each mint group, call set payments
            const setPayments = async (index: any) => {
                let group = config.groups[index];
                if (!group.payments || group.payments.length === 0) {
                    return;
                }
                tx = new Transaction()
                tx.setSender(keypair.getPublicKey().toSuiAddress())

                const payment0 = group.payments.length > 0 ? getPaymentAsArgs(tx, group.payments[0]) : getEmptyPaymentArgs(tx);
                const payment1 = group.payments.length > 1 ? getPaymentAsArgs(tx, group.payments[1]) : getEmptyPaymentArgs(tx);

                tx.moveCall({
                    target: `${joystiq.core}::nft_core::set_payments`,
                    typeArguments: [payment0.type, payment1.type, "0x2::sui::SUI", "0x2::sui::SUI"],
                    arguments: [
                        tx.object(collectionJqCoreConfigID),
                        tx.object(publisherID),
                        tx.pure.u64(index),
                        ...payment0.args,
                        ...payment1.args,
                    ]
                })

                tx.setGasBudget(await GetGasBudget(client, tx))
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

                console.log(`Payments set for group ${group.name}. Digest:`, chalk.blue(res.digest));
                await verifyTransaction(rpc, res.digest);
            }

            for (let i = 0; i < config.groups.length; i++) {
                await setPayments(i);
            }

            //STEP x: save artifacts
            const artifacts = {
                packageID: packageId,
                publisherID,
                collectionObjectID,
                collectionJqCoreConfigID,
                policyID,
                policyCapID,
                displayID,
            };

            console.log("\"artifacts\":", JSON.stringify(artifacts, null, 4));

            fs.writeFileSync(`${projectPath}/artifacts.json`, JSON.stringify(artifacts, null, 4));
            console.log("saved to", chalk.green(`${projectPath}/artifacts.json`));

        })

    parent
        .command("update")
        .description("Update a collection.")
        .argument("<project>", "Path to the project folder.")
        .action(async (projectPath: string, options: {}) => {
            let { rpc, keypair, client, joystiq } = getChainConfig(true)

            let artifacts = JSON.parse(fs.readFileSync(`${projectPath}/artifacts.json`).toString())
            let config = JSON.parse(fs.readFileSync(`${projectPath}/config.json`).toString())

            // STEP 1: update the jq721 contract
            let tx = new Transaction()

            if (config.is_immutable === false) {
                let fixedMetadataArgs: any[] = [];
                if (config.fixed_metadata !== false) {
                    let attributeKeys = config.fixed_metadata.attributes.map((a: any) => a.key);
                    let attributeValues = config.fixed_metadata.attributes.map((a: any) => a.value);


                    fixedMetadataArgs = [
                        tx.pure.string(config.fixed_metadata.name),
                        tx.pure.string(config.fixed_metadata.image),
                        tx.pure.string(config.fixed_metadata.description),
                        tx.pure.vector("string", attributeKeys),
                        tx.pure.vector("string", attributeValues),
                        tx.pure.option("string", config.fixed_metadata.name_format || undefined),
                    ]
                } else {
                    fixedMetadataArgs = [
                        tx.pure.string(""), tx.pure.string(""), tx.pure.string(""), tx.pure.vector("string", []), tx.pure.vector("string", []), tx.pure.option("string", null)
                    ]
                }

                tx.setSender(keypair.getPublicKey().toSuiAddress())
                tx.moveCall({
                    target: `${artifacts.packageID}::jq721::update_collection`,
                    arguments: [
                        tx.object(artifacts.collectionObjectID),
                        tx.pure.string(config.collection_name),
                        tx.pure.string(config.collection_description),
                        tx.pure.string(config.collection_media_url),
                        tx.pure.u64(config.supply),
                        tx.pure.bool(config.fixed_metadata !== false),
                        //tx.pure.u16(parseFloat(config.royalty_percent) * 100),
                        ...fixedMetadataArgs,
                        tx.object(artifacts.policyID),
                        tx.object(artifacts.policyCapID),
                        tx.object(artifacts.displayID),
                        tx.object(artifacts.publisherID)
                    ]
                })

                tx.setGasBudget(await GetGasBudget(client, tx))
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

                console.log("Collection contract updated. Digest:", chalk.blue(res.digest));

                //verify the transaction
                await verifyTransaction(rpc, res.digest);
            }

            //STEEP 2: call update collection of core to update/set mint groups
            tx = new Transaction()
            tx.setSender(keypair.getPublicKey().toSuiAddress())

            let mg_name = config.groups.map((g: any) => g.name)
            let mg_merkle_root = config.groups.map((g: any) => g.merkle_root ? Array.from(Buffer.from(g.merkle_root, 'hex')) : null);
            let mg_max_mints_per_wallet = config.groups.map((g: any) => parseInt(g.max_mints_per_wallet))
            let mg_reserved_supply = config.groups.map((g: any) => parseInt(g.reserved_supply))
            let mg_start_time = config.groups.map((g: any) => g.start_time ? new Date(g.start_time).getTime() : 0)
            let mg_end_time = config.groups.map((g: any) => g.end_time ? new Date(g.end_time).getTime() : 0)

            tx.moveCall({
                target: `${joystiq.core}::nft_core::update_collection`,
                arguments: [
                    //tx.object(joystiq.root),
                    tx.object(artifacts.collectionJqCoreConfigID),
                    tx.object(artifacts.publisherID),
                    tx.pure.string((config.collection_name)),
                    tx.pure.vector("string", mg_name),
                    tx.pure.vector('option<vector<u8>>', mg_merkle_root),
                    tx.pure.vector("u64", mg_max_mints_per_wallet),
                    tx.pure.vector("u64", mg_reserved_supply),
                    tx.pure.vector("u64", mg_start_time),
                    tx.pure.vector("u64", mg_end_time),
                ]
            })

            tx.setGasBudget(await GetGasBudget(client, tx))
            let res2 = await client.signAndExecuteTransaction({
                transaction: tx,
                signer: keypair,
                options: {
                    showEffects: true,
                    showEvents: true,
                }
            })

            if (res2.effects!.status.status !== "success") {
                throw new Error(`Transaction failed: ${res2.effects!.status.error} \n\nDigest: ${chalk.blue(res2.digest)} \n`);
            }

            console.log("Mint groups saved. Digest:", chalk.blue(res2.digest));

            await verifyTransaction(rpc, res2.digest);

            //STEP 3: for each mint group, call set payments
            const setPayments = async (index: any) => {
                let group = config.groups[index];
                tx = new Transaction()
                tx.setSender(keypair.getPublicKey().toSuiAddress())

                const payment0 = group.payments.length > 0 ? getPaymentAsArgs(tx, group.payments[0]) : getEmptyPaymentArgs(tx);
                const payment1 = group.payments.length > 1 ? getPaymentAsArgs(tx, group.payments[1]) : getEmptyPaymentArgs(tx);

                const key0 = `payment_0_of_group_${index}`;
                const key1 = `payment_1_of_group_${index}`;

                const resp0 = await client.getDynamicFieldObject({
                    parentId: artifacts.collectionJqCoreConfigID,
                    name: { type: '0x1::string::String', value: key0 },
                });
                const resp1 = await client.getDynamicFieldObject({
                    parentId: artifacts.collectionJqCoreConfigID,
                    name: { type: '0x1::string::String', value: key1 },
                });

                const oldType0 = readCoinType(resp0) ?? '0x2::sui::SUI';
                const oldType1 = readCoinType(resp1) ?? '0x2::sui::SUI';

                tx.moveCall({
                    target: `${joystiq.core}::nft_core::set_payments`,
                    typeArguments: [payment0.type, payment1.type, oldType0, oldType1],
                    arguments: [
                        tx.object(artifacts.collectionJqCoreConfigID),
                        tx.object(artifacts.publisherID),
                        tx.pure.u64(index),
                        ...payment0.args,
                        ...payment1.args,
                    ]
                })

                tx.setGasBudget(await GetGasBudget(client, tx))
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

                console.log(`Payments set for group ${group.name}. Digest:`, chalk.blue(res.digest));
                await verifyTransaction(rpc, res.digest);
            }

            for (let i = 0; i < config.groups.length; i++) {
                await setPayments(i);
            }

            console.log("Collection update completed.");

        })


    parent
        .command("eject")
        .description("Eject the collection from the Joystiq Core contract. (Makes the collection independent from Joystiq Core and future minting will not be possible.)")
        .argument("<project>", "Path to the project folder.")
        .action(async (projectPath: string, options: {}) => {

            //ask confirmation
            const confirm = await inquirer.prompt({
                type: 'confirm',
                name: 'confirm',
                message: 'Are you sure you want to eject the collection? This will make the collection independent from Joystiq Core and future minting will not be possible.',
                default: false
            });

            if (!confirm) {
                console.log("Collection eject cancelled.");
                return;
            }

            let { rpc, keypair, client, joystiq } = getChainConfig(true)

            let artifacts = JSON.parse(fs.readFileSync(`${projectPath}/artifacts.json`).toString())

            let tx = new Transaction()
            tx.setSender(keypair.getPublicKey().toSuiAddress())

            tx.moveCall({
                target: `${artifacts.packageID}::jq721::eject_collection`,
                typeArguments: [],
                arguments: [
                    tx.object(artifacts.collectionObjectID),
                    tx.object(artifacts.publisherID),
                ]
            })

            tx.setGasBudget(await GetGasBudget(client, tx))
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

            console.log("Collection ejected. Digest:", chalk.blue(res.digest));

        })

    parent
        .command("transfer-ownership")
        .description("Transfer ownership of the collection.")
        .argument("<project>", "Path to the project folder.")
        .argument("<new_owner>", "New owner address.")
        .action(async (projectPath: string, newOwner: string, options: {}) => {

            //ask confirmation
            const confirm = await inquirer.prompt({
                type: 'confirm',
                name: 'confirm',
                message: 'Are you sure you want to transfer ownership of the collection?',
                default: false
            });

            if (!confirm) {
                console.log("Collection ownership transfer cancelled.");
                return;
            }

            let { rpc, keypair, client, joystiq } = getChainConfig(true)

            let artifacts = JSON.parse(fs.readFileSync(`${projectPath}/artifacts.json`).toString())

            let tx = new Transaction()
            tx.setSender(keypair.getPublicKey().toSuiAddress())

            tx.moveCall({
                target: `${artifacts.packageID}::jq721::transfer_collection_ownership`,
                typeArguments: [],
                arguments: [
                    tx.object(artifacts.collectionObjectID),
                    tx.object(artifacts.publisherID),
                    tx.object(artifacts.policyCapID),
                    tx.pure.address(newOwner)
                ]
            })

            tx.setGasBudget(await GetGasBudget(client, tx))
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

            console.log("Collection ownership transferred. Digest:", chalk.blue(res.digest));

        })

}

const getPaymentAsArgs = (tx: Transaction, payment: any) => {
    let coin = tx.pure.option("string", payment.coin);
    let routesMethods = tx.pure.vector("string", payment.routes.map((route: any) => route.method).flat());
    let routesAmounts = tx.pure.vector("u64", payment.routes.map((route: any) => route.amount).flat());
    let routesDestinaions = tx.pure.vector("option<address>", payment.routes.map((route: any) => route.destination || null).flat());

    return {
        args: [
            coin,
            routesMethods,
            routesAmounts,
            routesDestinaions
        ],
        type: payment.coin
    }
}

const getEmptyPaymentArgs = (tx: Transaction) => {
    return {
        args: [
            tx.pure.option("string", null),
            tx.pure.vector("string", []),
            tx.pure.vector("u64", []),
            tx.pure.vector("option<address>", [])
        ],
        type: "0x2::sui::SUI"
    }
}

const readCoinType = (resp: any): string | null => {
    if (!resp || resp.error) return null;
    const content = resp.data?.content;

    const v =
        content?.fields?.value?.fields?.coin ??
        content?.fields?.coin ??
        null;
    return typeof v === 'string' && v.length > 0 ? v : null;
};
