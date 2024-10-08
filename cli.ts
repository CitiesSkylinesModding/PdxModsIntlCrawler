#!/usr/bin/env bun

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';
import chalk from 'chalk';
import yargs from 'yargs/yargs';
import config from './config';

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
        command: 'discover',
        describe: `Browse Paradox Mods to search for translation platforms links and writes results to output/state.json for later markdown generation. Uses configuration from config.ts.`,
        builder: args =>
            args.option('write', {
                type: 'boolean',
                describe: `Whether to update state files even if no new/updated/deleted mods were detected.`,
                default: false
            }),
        async handler(args) {
            process.stdout.write(chalk.bold(`=> Listing mods\n\n`));

            const listingMods = await listMods(
                config.gameId,
                config.tags.map(String)
            );

            process.stdout.write(chalk.bold(`\n=> Fetching mod details\n\n`));

            const mods = await getModsDetails(listingMods);

            process.stdout.write(chalk.bold(`\n=> Writing state file...\n\n`));

            const translatableMods = mods
                .filter(mod => mod.translationLink)
                .sort(
                    (a, b) =>
                        Number.parseInt(a.modId, 10) -
                        Number.parseInt(b.modId, 10)
                );

            process.stdout.write(
                `Found ${chalk.bold.greenBright(translatableMods.length)} mods with translations.\n\n`
            );

            if (!args.write && (await fs.exists(oldStateFilePath))) {
                const oldMods: Mod[] = JSON.parse(
                    await fs.readFile(stateFilePath, 'utf8')
                );

                const newIds = new Set(translatableMods.map(mod => mod.modId));
                const oldIds = new Set(oldMods.map(mod => mod.modId));

                const hasChanges = newIds.symmetricDifference(oldIds).size > 0;

                if (!hasChanges) {
                    process.stdout.write(
                        `${chalk.bold(`No new/updated/deleted mods detected.`)} Re-run the command using --write to force state files update.\n`
                    );

                    return;
                }
            }

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
                `\nRun ${chalk.bold('list')} or ${chalk.bold('changelog')} subcommands for generating summaries.\n`
            );
        }
    })
    .command({
        command: 'list',
        describe: `Generate a markdown list of mods with translation links from output/state.json.`,
        builder: args =>
            args.option('write', {
                type: 'boolean',
                describe: `Whether to write the content generated to the file specified in the config.ts file.`,
                default: false
            }),
        async handler(args) {
            if (!(await fs.exists(stateFilePath))) {
                throw new Error(
                    `File not found: ${stateFilePath}. Run "discover" command first.`
                );
            }

            const mods: Mod[] = JSON.parse(
                await fs.readFile(stateFilePath, 'utf8')
            );

            const listString = mods
                .sort((a, b) => b.installedCount - a.installedCount)
                .map((mod, i) => formatModLine(mod, i, false))
                .join('\n');

            let template = '{{list}}\n';

            if (config.listMarkdownTemplateFilePath) {
                const listTemplateFilePath = path.resolve(
                    import.meta.dir,
                    config.listMarkdownTemplateFilePath
                );

                if (await fs.exists(listTemplateFilePath)) {
                    template = await fs.readFile(listTemplateFilePath, 'utf8');
                } else {
                    process.stderr.write(
                        chalk.bold.red(
                            `Template file not found: ${listTemplateFilePath}\n`
                        )
                    );
                }
            }

            const contents = template
                .replace('{{date}}', new Date().toLocaleString())
                .replace('{{list}}', listString);

            process.stdout.write(contents);

            if (args.write) {
                const filePath = path.resolve(
                    import.meta.dir,
                    config.listMarkdownFilePath
                );

                await fs.writeFile(filePath, contents);

                process.stdout.write(
                    chalk.bold(`\nWritten to "${filePath}".\n`)
                );
            }
        }
    })
    .command({
        command: 'changelog',
        describe: `Generate a markdown changelog of mods with translation links from output/state.json.`,
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

            const newMods = mods
                .filter(
                    mod => !oldMods.some(oldMod => oldMod.modId == mod.modId)
                )
                .sort((a, b) => b.installedCount - a.installedCount);

            const deletedMods = oldMods
                .filter(oldMod => !mods.some(mod => mod.modId == oldMod.modId))
                .sort((a, b) => b.installedCount - a.installedCount);

            const updatedMods = mods
                .filter(mod =>
                    oldMods.some(
                        oldMod =>
                            oldMod.modId == mod.modId &&
                            oldMod.translationLink != mod.translationLink
                    )
                )
                .sort((a, b) => b.installedCount - a.installedCount);

            // biome-ignore lint/complexity/useSimplifiedLogicExpression: nonsensical
            if (!newMods.length && !updatedMods.length && !deletedMods.length) {
                process.stdout.write(
                    `No changes detected between ${stateFilePath} and ${oldStateFilePath} (if it exists).\n`
                );

                return;
            }

            const listString = [
                '**List update!**',
                ...(newMods.length
                    ? [
                          `\nNew translation projects discovered:`,
                          ...newMods.map((mod, i) =>
                              formatModLine(mod, i, true)
                          )
                      ]
                    : []),
                ...(updatedMods.length
                    ? [
                          `\nMods that updated their translation project link:`,
                          ...updatedMods.map((mod, i) =>
                              formatModLine(mod, i, true)
                          )
                      ]
                    : []),
                ...(deletedMods.length
                    ? [
                          `\nDeleted mods or translation projects:`,
                          ...deletedMods.map((mod, i) =>
                              formatModLine(mod, i, true)
                          )
                      ]
                    : []),
                ''
            ].join('\n');

            process.stdout.write(`${listString}\n`);
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
            ${modDetail.externalLinks.map(link => `${link.url}\n`)}
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

function formatModLine(mod: Mod, index: number, changelog: boolean): string {
    // biome-ignore lint/style/noNonNullAssertion: can't be null here
    const host = new URL(mod.translationLink!).host;
    const platform = host == 'crowdin.com' ? '' : ` (on ${host})`;

    const installedCount = Intl.NumberFormat().format(mod.installedCount);

    return `${index + 1}. [${mod.displayName}](${mod.translationLink})${platform}${changelog ? '' : ` ([mod page](https://mods.paradoxplaza.com/mods/${mod.modId}/${mod.os}))`} by *${mod.author}* — ⬇️ ${installedCount} installs`;
}
