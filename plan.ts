// Pure planning of a list update: every rule of the pipeline lives here, the network and the
// file system stay in lib.ts and cli.ts.

export interface ListingMod {
  readonly modId: string;
  readonly displayName: string;
  readonly author: string;
  readonly os: string;
  readonly installedCount: number;
}

export interface Mod extends ListingMod {
  readonly translationLink: string | undefined;
}

/** A published list entry: one translation project, shown under its most installed mod. */
export interface Entry extends ListingMod {
  readonly translationLink: string;
  readonly normalizedLink: string;
  /** How many other mods link the same project. */
  readonly otherModsCount: number;
}

/** A record of the state file before the redesign: one per mod. */
export interface OldStateRecord extends ListingMod {
  readonly translationLink: string;
}

/** The raw answer to a probe request made without following redirects. */
export type ProbeAnswer =
  | { readonly status: number; readonly location: string | null }
  | { readonly error: string };

export interface PlanConfig {
  readonly blacklist: {
    readonly modIds: readonly string[];
    readonly links: readonly string[];
  };
  readonly deadNameMarkers: readonly string[];
  /** A run removing more entries than this fails unless mass removal is allowed. */
  readonly maxRemovals: number;
}

export interface PlanInput {
  readonly mods: readonly Mod[];
  /** Probe answers keyed by normalized link, see {@link linksToProbe}. */
  readonly probes: Readonly<Record<string, ProbeAnswer>>;
  readonly previousState: readonly (Entry | OldStateRecord)[];
  readonly config: PlanConfig;
  readonly template: string;
  readonly allowMassRemoval: boolean;
  readonly now: Date;
  /** The GitHub repository, as `owner/name`. */
  readonly repository: string;
}

export interface Changes {
  readonly added: readonly Entry[];
  readonly removed: readonly Entry[];
}

export interface Announcement {
  readonly tag: string;
  readonly releaseTitle: string;
  readonly releaseBody: string;
  readonly releaseUrl: string;
  /** The webhook request body, sent as-is. */
  readonly discord: DiscordWebhookBody;
}

export interface DiscordWebhookBody {
  readonly content: string;
  readonly flags: number;
  // biome-ignore lint/style/useNamingConvention: Discord API field
  readonly allowed_mentions: { readonly parse: readonly string[] };
}

export type Plan =
  | { readonly ok: false; readonly failure: string }
  | {
      readonly ok: true;
      readonly state: readonly Entry[];
      readonly listMarkdown: string;
      readonly changes: Changes;
      /** Absent when nothing was added or removed. */
      readonly announcement: Announcement | undefined;
    };

export const discordMessageLimit = 2000;

const discordSuppressEmbedsFlag = 4;

const trailingSlashesRe = /\/+$/;
const regexSpecialCharsRe = /[.*+?^${}()|[\]\\]/g;

export function normalizeLink(link: string): string {
  return link.toLowerCase().replace(trailingSlashesRe, '');
}

/** The distinct Crowdin links among the crawled mods, normalized, which `update` must probe. */
export function linksToProbe(mods: readonly Mod[]): readonly string[] {
  const links = new Set<string>();

  for (const mod of mods) {
    if (mod.translationLink) {
      const link = normalizeLink(mod.translationLink);

      if (isCrowdinLink(link)) {
        links.add(link);
      }
    }
  }

  return [...links].sort();
}

export function planUpdate(input: PlanInput): Plan {
  const { config } = input;

  const blacklistedIds = new Set(config.blacklist.modIds);
  const blacklistedLinks = new Set(config.blacklist.links.map(normalizeLink));
  const deadNameRe = buildDeadNameRegex(config.deadNameMarkers);

  const candidates = input.mods
    .flatMap(mod =>
      mod.translationLink
        ? [
            {
              ...mod,
              translationLink: mod.translationLink,
              link: normalizeLink(mod.translationLink)
            }
          ]
        : []
    )
    .filter(mod => !deadNameRe?.test(mod.displayName))
    .filter(mod => !(blacklistedIds.has(mod.modId) || blacklistedLinks.has(mod.link)));

  const unreadable: string[] = [];
  const deadLinks = new Set<string>();

  for (const link of new Set(candidates.map(mod => mod.link))) {
    const liveness = classifyProbe(link, input.probes[link]);

    if (liveness == 'dead') {
      deadLinks.add(link);
    } else if (liveness != 'alive') {
      unreadable.push(`${link}: ${liveness.unreadable}`);
    }
  }

  if (unreadable.length > 0) {
    return {
      ok: false,
      failure: `Unreadable answers from translation platforms:\n${unreadable.map(line => `- ${line}`).join('\n')}`
    };
  }

  const state = groupIntoEntries(candidates.filter(mod => !deadLinks.has(mod.link)));
  const previous = readPreviousState(input.previousState);

  const nextLinks = new Set(state.map(entry => entry.normalizedLink));
  const previousLinks = new Set(previous.map(({ entry }) => entry.normalizedLink));

  const changes: Changes = {
    added: sortEntries(state.filter(entry => !previousLinks.has(entry.normalizedLink))),
    removed: sortEntries(
      previous
        .filter(
          ({ entry, modIds }) =>
            !(
              nextLinks.has(entry.normalizedLink) ||
              blacklistedLinks.has(entry.normalizedLink) ||
              modIds.some(id => blacklistedIds.has(id))
            )
        )
        .map(({ entry }) => entry)
    )
  };

  if (changes.removed.length > config.maxRemovals && !input.allowMassRemoval) {
    return {
      ok: false,
      failure: `This run would remove ${changes.removed.length} entries, more than the ${config.maxRemovals} allowed; rerun with mass removal allowed if this is a real cleanup:\n${changes.removed
        .map(entry => `- ${entry.translationLink} (${entry.displayName})`)
        .join('\n')}`
    };
  }

  const hasChanges = changes.added.length > 0 || changes.removed.length > 0;

  return {
    ok: true,
    state: [...state].sort((a, b) => a.normalizedLink.localeCompare(b.normalizedLink)),
    listMarkdown: formatList(state, input.template, input.now),
    changes,
    announcement: hasChanges ? planAnnouncement(changes, input.now, input.repository) : undefined
  };
}

function isCrowdinLink(link: string): boolean {
  return new URL(link).host == 'crowdin.com';
}

function buildDeadNameRegex(markers: readonly string[]): RegExp | undefined {
  if (markers.length == 0) {
    return undefined;
  }

  const alternatives = markers.map(marker => marker.replace(regexSpecialCharsRe, '\\$&')).join('|');

  // A marker counts only inside [] or (), so "Broken Bridges Fix" stays listed.
  return new RegExp(`[[(][^\\])]*\\b(?:${alternatives})\\b[^\\])]*[\\])]`, 'i');
}

function classifyProbe(
  link: string,
  answer: ProbeAnswer | undefined
): 'alive' | 'dead' | { readonly unreadable: string } {
  if (!isCrowdinLink(link)) {
    return 'alive';
  }

  if (!answer) {
    return { unreadable: 'not probed' };
  }

  if ('error' in answer) {
    return { unreadable: answer.error };
  }

  if (answer.status == 200) {
    return 'alive';
  }

  // Crowdin answers the same for deleted and private projects: a translator can't join either.
  if (answer.status == 404) {
    return 'dead';
  }

  if (
    answer.status == 302 &&
    answer.location &&
    new URL(answer.location, link).pathname == '/login'
  ) {
    return 'dead';
  }

  return { unreadable: `${answer.status}${answer.location ? ` to ${answer.location}` : ''}` };
}

function compareMods(a: ListingMod, b: ListingMod): number {
  return b.installedCount - a.installedCount || compareModIds(a.modId, b.modId);
}

function compareModIds(a: string, b: string): number {
  return Number(a) - Number(b) || a.localeCompare(b);
}

function sortEntries(entries: readonly Entry[]): readonly Entry[] {
  return [...entries].sort(compareMods);
}

function groupIntoEntries(
  mods: readonly (ListingMod & { readonly translationLink: string; readonly link: string })[]
): readonly Entry[] {
  const groups = Map.groupBy(mods, mod => mod.link);

  return sortEntries(
    [...groups].map(([link, group]) => {
      // biome-ignore lint/style/noNonNullAssertion: groups are never empty
      const winner = [...group].sort(compareMods)[0]!;

      return {
        modId: winner.modId,
        displayName: winner.displayName,
        author: winner.author,
        os: winner.os,
        installedCount: winner.installedCount,
        translationLink: winner.translationLink,
        normalizedLink: link,
        otherModsCount: group.length - 1
      };
    })
  );
}

/**
 * Reads both state shapes as entries, each with the mod IDs a blacklist entry must match to keep
 * its removal silent: the winner's for the current shape, every mod of the link for the old one.
 */
function readPreviousState(
  records: readonly (Entry | OldStateRecord)[]
): readonly { readonly entry: Entry; readonly modIds: readonly string[] }[] {
  const entries = records.filter(record => 'normalizedLink' in record);

  const oldRecords = records
    .filter(record => !('normalizedLink' in record))
    .map(record => ({ ...record, link: normalizeLink(record.translationLink) }));

  const oldModIds = Map.groupBy(oldRecords, record => record.link);

  return [
    ...entries.map(entry => ({ entry, modIds: [entry.modId] })),
    ...groupIntoEntries(oldRecords).map(entry => ({
      entry,
      modIds: (oldModIds.get(entry.normalizedLink) ?? []).map(record => record.modId)
    }))
  ];
}

const numberFormat = new Intl.NumberFormat('en-US');

function formatEntryLine(entry: Entry, index: number): string {
  const host = new URL(entry.translationLink).host;
  const platform = isCrowdinLink(entry.translationLink) ? '' : ` (on ${host})`;

  const others =
    entry.otherModsCount > 0
      ? ` — +${entry.otherModsCount} ${entry.otherModsCount == 1 ? 'mod' : 'mods'} on this project`
      : '';

  return `${index + 1}. [${entry.displayName}](${entry.translationLink})${platform} ([mod page](https://mods.paradoxplaza.com/mods/${entry.modId}/${entry.os})) by *[${entry.author}](https://mods.paradoxplaza.com/authors/${encodeURIComponent(entry.author)})* — ⬇️ ${numberFormat.format(entry.installedCount)} installs${others}`;
}

function formatList(entries: readonly Entry[], template: string, now: Date): string {
  const date = `${formatUtcDate(now)} ${formatUtcTime(now, ':')} UTC`;

  return template
    .replace('{{date}}', () => date)
    .replace('{{list}}', () => sortEntries(entries).map(formatEntryLine).join('\n'));
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatUtcTime(date: Date, separator: string): string {
  return date.toISOString().slice(11, 16).replace(':', separator);
}

function planAnnouncement(changes: Changes, now: Date, repository: string): Announcement {
  const tag = `list-${formatUtcDate(now)}-${formatUtcTime(now, '')}`;
  const releaseUrl = `https://github.com/${repository}/releases/tag/${tag}`;

  const sections = [
    { heading: 'New translation projects', entries: changes.added },
    { heading: 'Removed translation projects', entries: changes.removed }
  ].filter(section => section.entries.length > 0);

  const releaseBody = sections
    .map(({ heading, entries }) => `## ${heading}\n\n${entries.map(formatEntryLine).join('\n')}\n`)
    .join('\n');

  return {
    tag,
    releaseTitle: `List update ${formatUtcDate(now)}`,
    releaseBody,
    releaseUrl,
    discord: {
      content: formatDiscordMessage(sections, releaseUrl),
      flags: discordSuppressEmbedsFlag,
      // biome-ignore lint/style/useNamingConvention: Discord API field
      allowed_mentions: { parse: [] }
    }
  };
}

/** Lists every change compactly, stopping before Discord's limit with a pointer to the release. */
function formatDiscordMessage(
  sections: readonly { readonly heading: string; readonly entries: readonly Entry[] }[],
  releaseUrl: string
): string {
  const items = sections.flatMap(({ heading, entries }) =>
    entries.map((entry, i) => ({
      heading: i == 0 ? `**${heading}**` : undefined,
      line: `- [${entry.displayName}](${entry.translationLink})`
    }))
  );

  const lines: string[] = [];
  const more = (count: number) => `+${count} more, [see the release](${releaseUrl})`;

  for (const [i, item] of items.entries()) {
    const added = [
      ...(item.heading ? [...(lines.length > 0 ? [''] : []), item.heading] : []),
      item.line
    ];
    const remaining = items.length - i - 1;
    const trailer = remaining > 0 ? [more(remaining)] : [];

    if ([...lines, ...added, ...trailer].join('\n').length > discordMessageLimit) {
      return [...lines, more(items.length - i)].join('\n');
    }

    lines.push(...added);
  }

  return lines.join('\n');
}
