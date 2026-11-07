import * as path from 'node:path';
import * as process from 'node:process';
import chalk from 'chalk';
import type { ListingMod, Mod, ProbeAnswer } from './plan.ts';

export const TRANSLATION_LINK_RE =
  /(crowdin\.com\/(?:project|translate)\/[-a-z0-9]+|paratranz\.cn\/projects\/[0-9]+|weblate\.[^\s/]+\/projects\/[-a-z0-9_]+|transifex\.com\/[a-z0-9_-]+\/[a-z0-9_-]+|poeditor\.com\/(?:projects|join\/project)\/[A-Za-z0-9_-]+|lokalise\.com\/[a-z0-9_-]+|oneskyapp\.com\/(?:project|crowd)\/[0-9]+|gitlocalize\.com\/[a-z0-9_-]+\/[a-z0-9_-]+|pontoon\.mozilla\.org\/[A-Za-z0-9_-]+|translatewiki\.net\/wiki\/[A-Za-z0-9_:-]+|lingohub\.com\/[a-z0-9_-]+\/[a-z0-9_-]+)/i;

export const stateFilePath = path.join(import.meta.dir, 'state', 'state.json');

export async function listMods(
  gameName: string,
  tags: readonly string[]
): Promise<readonly ListingMod[]> {
  const allMods: ListingMod[] = [];

  let page = 0;
  do {
    // biome-ignore lint/performance/noAwaitInLoops: we don't want to make too many parallel requests anyway.
    const { totalCount, mods } = await fetchPage(page++);

    if (mods.length == 0 && allMods.length < totalCount) {
      throw new Error(
        `Page ${page - 1} came back empty after ${allMods.length} of ${totalCount} mods.`
      );
    }

    allMods.push(...mods);

    process.stdout.write(`Listed ${allMods.length} of ${totalCount} mods...\n`);

    if (allMods.length >= totalCount) {
      break;
    }
    // biome-ignore lint/correctness/noConstantCondition: break condition
  } while (true);

  return allMods;

  async function fetchPage(page: number) {
    const response = await fetch('https://api.paradox-interactive.com/mods', {
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
    });

    interface Body {
      readonly totalCount: number;
      readonly mods: readonly ListingMod[];
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

export async function getModsDetails(listingMods: readonly ListingMod[]): Promise<readonly Mod[]> {
  const mods: Mod[] = [];

  for (let i = 0; i < listingMods.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index is always valid
    const listingMod = listingMods[i]!;

    process.stdout.write(`${i + 1}/${listingMods.length}: ${listingMod.displayName}... `);

    // biome-ignore lint/performance/noAwaitInLoops: we don't want to make too many parallel requests anyway.
    const mod = await fetchMod(listingMod);
    mods.push(mod);

    process.stdout.write(
      mod.translationLink
        ? chalk.greenBright(`✅ Found ${chalk.bold(mod.translationLink)}\n`)
        : chalk.dim('❌ No translations\n')
    );
  }

  return mods;
}

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

  const translationLinkLike = textToSearch.match(TRANSLATION_LINK_RE)?.[0];

  return {
    ...listingMod,
    translationLink: translationLinkLike && `https://${translationLinkLike}`
  };
}

export async function parseApiResponse<Body>(response: Response): Promise<Body> {
  interface BodyResponse {
    readonly result: 'OK' | 'Failure';

    readonly errorMessage?: string;
  }

  let body: BodyResponse = { result: 'Failure', errorMessage: 'Unknown error' };

  try {
    body = (await response.json()) as BodyResponse;
  } catch {
    // Ignore body consumption error.
  }

  if (!response.ok || body.result != 'OK') {
    throw new Error(
      `Failed to fetch "${response.url}" (${response.status} ${response.statusText}): ${body.errorMessage}`
    );
  }

  return body as Body;
}

/** Requests each link once, sequentially and without following redirects. */
export async function probeLinks(
  links: readonly string[]
): Promise<Readonly<Record<string, ProbeAnswer>>> {
  const answers: Record<string, ProbeAnswer> = {};

  for (const link of links) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: one request at a time is gentler on Crowdin.
      const response = await fetch(link, {
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000)
      });

      await response.body?.cancel();

      answers[link] = { status: response.status, location: response.headers.get('location') };
    } catch (error) {
      answers[link] = { error: String(error) };
    }

    const answer = answers[link];

    process.stdout.write(
      `${link}: ${'error' in answer ? answer.error : `${answer.status}${answer.location ? ` to ${answer.location}` : ''}`}\n`
    );
  }

  return answers;
}
