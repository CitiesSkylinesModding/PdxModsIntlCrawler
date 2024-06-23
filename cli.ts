#!/usr/bin/env bun

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import yargs from 'yargs/yargs';

const stateDir = path.join(import.meta.dir, 'state');
const oldStateFilePath = path.join(stateDir, 'previous-state.json');
const stateFilePath = path.join(stateDir, 'state.json');

yargs(process.argv.slice(2))
    .scriptName(import.meta.file)
    .usage('$0 <cmd> [args]')
    .help()
    .version(false)
    .strict()
    .recommendCommands()
    .demandCommand()
    .command({
        command: 'discover [game]',
        describe: `Browse Paradox Mods to search for translation platforms links and writes results to output/state.json for later markdown generation.`,
        builder: args =>
            args
                .option('game', {
                    type: 'string',
                    describe: `The game for which to search mods for.`,
                    demandOption: true
                })
                .option('tags', {
                    type: 'array',
                    describe: `Filter mods on tags. Quote tags with spaces, ex: "Code Mods".`,
                    default: []
                }),
        async handler(args) {
            process.stdout.write(chalk.bold(`=> Listing mods\n\n`));

            const listingMods = await listMods(
                args.game,
                args.tags.map(String)
            );

            process.stdout.write(chalk.bold(`\n=> Fetching mod details\n\n`));

            const mods = await getModsDetails(listingMods);

            process.stdout.write(chalk.bold(`\n=> Writing state file...\n\n`));

            const translatableMods = mods
                .filter(mod => mod.translationLink)
                .map(mod => {
                    const { os, ...serializedMod } = mod;
                    return serializedMod;
                });

            process.stdout.write(
                `Found ${chalk.bold.greenBright(translatableMods.length)} mods with translations.\n\n`
            );

            if (await fs.exists(stateFilePath)) {
                process.stdout.write(
                    `Moving ${stateFilePath} to ${oldStateFilePath}...\n`
                );

                await fs.rename(stateFilePath, oldStateFilePath);
            }

            process.stdout.write(`Writing ${stateFilePath}...\n`);

            await fs.writeFile(
                stateFilePath,
                `${JSON.stringify(translatableMods, null, 2)}\n`
            );

            process.stdout.write(
                `\nRun ${chalk.bold('md-list')} or ${chalk.bold('md-changelog')} subcommands for generating markdown summaries.\n`
            );
        }
    })
    .command({
        command: 'md-list',
        describe: `Generate markdown list of mods with translation links from output/state.json.`,
        async handler() {
            if (!(await fs.exists(stateFilePath))) {
                throw new Error(
                    `File not found: ${stateFilePath}. Run "discover" command first.`
                );
            }

            const mods: Mod[] = JSON.parse(
                await fs.readFile(stateFilePath, 'utf8')
            );

            const markdown = mods
                .sort((a, b) => b.installedCount - a.installedCount)
                .map(formatModMarkdownLine)
                .join('\n');

            process.stdout.write(
                `This list is generated automatically. See second post in thread for more info.\n\n${markdown}\n`
            );
        }
    })
    .command({
        command: 'md-changelog',
        describe: `Generate markdown changelog of mods with translation links from output/state.json.`,
        async handler() {
            let oldMods: Mod[] = [];
            if (await fs.exists(oldStateFilePath)) {
                oldMods = JSON.parse(
                    await fs.readFile(oldStateFilePath, 'utf8')
                );
            }

            if (!(await fs.exists(stateFilePath))) {
                throw new Error(
                    `File not found: ${stateFilePath}. Run "discover" command first.`
                );
            }

            const mods: Mod[] = JSON.parse(
                await fs.readFile(stateFilePath, 'utf8')
            );

            const newMods = mods.filter(
                mod => !oldMods.some(oldMod => oldMod.modId == mod.modId)
            );

            const deletedMods = oldMods.filter(
                oldMod => !mods.some(mod => mod.modId == oldMod.modId)
            );
            const updatedMods = mods.filter(mod =>
                oldMods.some(
                    oldMod =>
                        oldMod.modId == mod.modId &&
                        oldMod.translationLink != mod.translationLink
                )
            );

            // biome-ignore lint/complexity/useSimplifiedLogicExpression: nonsensical
            if (!newMods.length && !updatedMods.length && !deletedMods.length) {
                process.stdout.write(
                    `No changes detected between ${stateFilePath} and ${oldStateFilePath} (if it exists).\n`
                );
                return;
            }

            const markdown = [
                `**List update!**`,
                ...(newMods.length
                    ? [
                          `\nNew translation projects discovered:`,
                          ...newMods.map(formatModMarkdownLine)
                      ]
                    : []),
                ...(updatedMods.length
                    ? [
                          `\nMods that updated their translation project link:`,
                          ...updatedMods.map(formatModMarkdownLine)
                      ]
                    : []),
                ...(deletedMods.length
                    ? [
                          `\nDeleted mods or translation projects:`,
                          ...deletedMods.map(formatModMarkdownLine)
                      ]
                    : []),
                ''
            ].join('\n');

            process.stdout.write(markdown);
        }
    }).argv;

interface ListingMod {
    readonly modId: string;
    readonly displayName: string;
    readonly author: string;
    readonly os: string;
    readonly installedCount: number;
}

interface Mod extends ListingMod {
    readonly translationLink: string | undefined;
}

async function listMods(
    gameName: string,
    tags: readonly string[]
): Promise<readonly ListingMod[]> {
    const allMods = [];

    let page = 0;
    do {
        const { totalCount, mods } = await fetchPage(page++);
        allMods.push(...mods);

        process.stdout.write(
            `Listed ${allMods.length} of ${totalCount} mods...\n`
        );

        if (allMods.length >= totalCount) {
            break;
        }
        // biome-ignore lint/correctness/noConstantCondition: break condition
    } while (true);

    return allMods;

    async function fetchPage(page: number) {
        const response = await fetch(
            'https://api.paradox-interactive.com/mods',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    gameName,
                    tags,
                    page,
                    pageSize: 100 // max allowed by PDX Mods
                })
            }
        );

        interface Body {
            readonly totalCount: number;
            readonly mods: ReadonlyArray<ListingMod>;
        }

        const { mods, totalCount } = await parseApiResponse<Body>(response);

        return {
            totalCount,
            mods: mods.map<ListingMod>(mod => ({
                modId: mod.modId,
                displayName: mod.displayName,
                author: mod.author,
                os: mod.os,
                installedCount: mod.installedCount
            }))
        };
    }
}

async function getModsDetails(
    listingMods: readonly ListingMod[]
): Promise<readonly Mod[]> {
    const mods: Mod[] = [];

    for (let i = 0; i < listingMods.length; i++) {
        // biome-ignore lint/style/noNonNullAssertion: index is always valid
        const listingMod = listingMods[i]!;

        process.stdout.write(
            `${i + 1}/${listingMods.length}: ${listingMod.displayName}... `
        );

        const mod = await fetchMod(listingMod);
        mods.push(mod);

        process.stdout.write(
            mod.translationLink
                ? chalk.greenBright(
                      `✅ Found ${chalk.bold(mod.translationLink)}\n`
                  )
                : chalk.dim('❌ No translations\n')
        );
    }

    return mods;

    async function fetchMod(listingMod: ListingMod): Promise<Mod> {
        const response = await fetch(
            `https://api.paradox-interactive.com/mods?modId=${listingMod.modId}&os=${listingMod.os}`,
            { method: 'GET' }
        );

        interface Body {
            readonly modDetail: {
                readonly longDescription: string;
                readonly externalLinks: ReadonlyArray<{ url: string }>;
            };
        }

        const { modDetail } = await parseApiResponse<Body>(response);

        const textToSearch = `
            ${modDetail.externalLinks.map(link => link.url)}
            ${modDetail.longDescription}`;

        const linkLike = textToSearch.match(
            /(crowdin\.com\/project\/[-a-z0-9]+|paratranz\.cn\/projects\/[0-9]+)/im
        )?.[0];

        return {
            ...listingMod,
            translationLink: linkLike && `https://${linkLike}`
        };
    }
}

async function parseApiResponse<TBody>(response: Response): Promise<TBody> {
    interface Body {
        readonly result: 'OK' | 'Failure';
        readonly errorMessage?: string;
    }

    let body: Body = { result: 'Failure', errorMessage: 'Unknown error' };

    try {
        body = await response.json();
    } catch {
        // Ignore body consumption error.
    }

    if (!response.ok || body.result != 'OK') {
        throw new Error(
            `Failed to fetch "${response.url}" (${response.status} ${response.statusText}): ${body.errorMessage}`
        );
    }

    return body as TBody;
}

function formatModMarkdownLine(mod: Mod, index: number): string {
    // biome-ignore lint/style/noNonNullAssertion: can't be null here
    const host = new URL(mod.translationLink!).host;
    const platform = host == 'crowdin.com' ? '' : ` (on ${host})`;

    const installedCount = Intl.NumberFormat().format(mod.installedCount);

    return `${index + 1}. [${mod.displayName}](${mod.translationLink})${platform} by *${mod.author}* — ${installedCount} installs`;
}
