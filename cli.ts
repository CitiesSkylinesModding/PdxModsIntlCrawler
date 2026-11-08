#!/usr/bin/env bun

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import process from 'node:process';
import { $ } from 'bun';
import chalk from 'chalk';
import yargs from 'yargs/yargs';
import { config } from './config.ts';
import { getModsDetails, listMods, probeLinks, stateFilePath } from './lib.ts';
import { type Announcement, linksToProbe, planUpdate } from './plan.ts';

const githubRemoteRe = /github\.com[:/](.+?)(?:\.git)?$/;

yargs(process.argv.slice(2))
  .scriptName(import.meta.file)
  .usage('$0 <cmd> [args]')
  .help()
  .version(false)
  .strict()
  .recommendCommands()
  .demandCommand()
  // Usage errors print the help once (a typo reports twice: "Did you mean" then "Unknown
  // argument"); errors thrown by a handler go to the catch below.
  .fail((message, error, instance) => {
    if (error) {
      throw error;
    }

    if (process.exitCode != 1) {
      instance.showHelp();
      process.stderr.write('\n');
    }

    process.stderr.write(chalk.red(`${message}\n`));
    process.exitCode = 1;
  })
  .command({
    command: 'update',
    describe:
      'Crawl Paradox Mods, probe translation projects, then write the state, the list and, when projects appeared or disappeared, the announcement payload. Never touches GitHub or Discord.',
    builder: args =>
      args
        .option('payload', {
          type: 'string',
          describe: 'Where to write the announcement payload; deleted when there are no changes.',
          demandOption: true
        })
        .option('allow-mass-removal', {
          type: 'boolean',
          describe: `Let a run remove more than ${config.maxRemovals} entries.`,
          default: false
        }),
    async handler(args) {
      process.stdout.write(chalk.bold('=> Listing mods\n\n'));
      const listingMods = await listMods(config.gameId, config.tags);

      process.stdout.write(chalk.bold('\n=> Fetching mod details\n\n'));
      const mods = await getModsDetails(listingMods);

      process.stdout.write(chalk.bold('\n=> Probing Crowdin projects\n\n'));
      const probes = await probeLinks(linksToProbe(mods));

      const plan = planUpdate({
        mods,
        probes,
        previousState: (await fs.exists(stateFilePath))
          ? JSON.parse(await fs.readFile(stateFilePath, 'utf8'))
          : [],
        config,
        template: await readTemplate(),
        allowMassRemoval: args.allowMassRemoval,
        now: new Date(),
        repository: await getRepository()
      });

      if (!plan.ok) {
        throw new Error(plan.failure);
      }

      await fs.writeFile(stateFilePath, `${JSON.stringify(plan.state, null, 2)}\n`);
      await fs.writeFile(
        path.resolve(import.meta.dir, config.listMarkdownFilePath),
        plan.listMarkdown
      );

      process.stdout.write(
        chalk.bold(
          `\n=> ${plan.state.length} projects listed, ${plan.changes.added.length} new, ${plan.changes.removed.length} removed\n\n`
        )
      );

      for (const entry of plan.changes.added) {
        process.stdout.write(
          chalk.greenBright(`+ ${entry.translationLink} (${entry.displayName})\n`)
        );
      }

      for (const entry of plan.changes.removed) {
        process.stdout.write(
          chalk.redBright(`- ${entry.translationLink} (${entry.displayName})\n`)
        );
      }

      if (plan.announcement) {
        await fs.writeFile(args.payload, `${JSON.stringify(plan.announcement, null, 2)}\n`);
        process.stdout.write(`\nAnnouncement payload written to ${args.payload}.\n`);
      } else {
        await fs.rm(args.payload, { force: true });
      }
    }
  })
  .command({
    command: 'announce',
    describe:
      'Send the payload written by "update": create the GitHub release on HEAD, then post to Discord.',
    builder: args =>
      args.option('payload', {
        type: 'string',
        describe: 'The announcement payload written by "update".',
        demandOption: true
      }),
    async handler(args) {
      const announcement: Announcement = JSON.parse(await fs.readFile(args.payload, 'utf8'));

      await createRelease(announcement);
      await postToDiscord(announcement);
    }
  })
  .parseAsync()
  .catch((error: unknown) => {
    process.stderr.write(
      chalk.red(`${error instanceof Error ? (error.stack ?? error.message) : error}\n`)
    );
    process.exitCode = 1;
  });

async function readTemplate(): Promise<string> {
  if (!config.listMarkdownTemplateFilePath) {
    return '{{list}}\n';
  }

  return await fs.readFile(
    path.resolve(import.meta.dir, config.listMarkdownTemplateFilePath),
    'utf8'
  );
}

/** The GitHub repository as `owner/name`, from Actions or from the origin remote. */
async function getRepository(): Promise<string> {
  const remote = process.env.GITHUB_REPOSITORY
    ? undefined
    : await $`git remote get-url origin`.text();
  const repository = process.env.GITHUB_REPOSITORY ?? remote?.trim().match(githubRemoteRe)?.[1];

  if (!repository) {
    throw new Error('Cannot tell the GitHub repository: set GITHUB_REPOSITORY.');
  }

  return repository;
}

async function createRelease(announcement: Announcement): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;

  if (!(repository && token)) {
    throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN must both be set.');
  }

  const headers = {
    // biome-ignore lint/style/useNamingConvention: HTTP header
    Authorization: `Bearer ${token}`,
    // biome-ignore lint/style/useNamingConvention: HTTP header
    Accept: 'application/vnd.github+json'
  };

  const api = `https://api.github.com/repos/${repository}`;

  const existing = await fetch(`${api}/git/ref/tags/${announcement.tag}`, { headers });

  if (existing.ok) {
    process.stdout.write(`Tag ${announcement.tag} already exists, skipping the release.\n`);
    return;
  }

  if (existing.status != 404) {
    throw new Error(
      `Failed to check tag ${announcement.tag}: ${existing.status} ${await existing.text()}`
    );
  }

  const sha = (await $`git rev-parse HEAD`.text()).trim();

  const response = await fetch(`${api}/releases`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      // biome-ignore lint/style/useNamingConvention: GitHub API field
      tag_name: announcement.tag,
      // biome-ignore lint/style/useNamingConvention: GitHub API field
      target_commitish: sha,
      name: announcement.releaseTitle,
      body: announcement.releaseBody
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to create the release: ${response.status} ${await response.text()}`);
  }

  process.stdout.write(chalk.green(`Created release ${announcement.releaseUrl} on ${sha}.\n`));
}

async function postToDiscord(announcement: Announcement): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    process.stdout.write('::warning::DISCORD_WEBHOOK_URL is not set, skipping the Discord post.\n');
    return;
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(announcement.discord)
  });

  if (!response.ok) {
    throw new Error(`Discord rejected the post: ${response.status} ${await response.text()}`);
  }

  process.stdout.write(chalk.green('Posted to Discord.\n'));
}
