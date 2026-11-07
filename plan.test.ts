import { describe, expect, test } from 'bun:test';
import {
  discordMessageLimit,
  type Entry,
  linksToProbe,
  type Mod,
  type OldStateRecord,
  type PlanConfig,
  type PlanInput,
  type ProbeAnswer,
  planUpdate
} from './plan.ts';

// Real records from the state history.

const skyve = mod('75804', 'Skyve', 'TDW', 371_049, 'https://crowdin.com/project/load-order-mod-2');
const skyveBeta = mod(
  '108773',
  'Skyve [BETA]',
  'TDW',
  28_375,
  'https://crowdin.com/project/load-order-mod-2'
);

const tleVariants = [
  mod(
    '128911',
    'Traffic Lights Enhancement',
    'Bruceyboy24804',
    114_542,
    'https://crowdin.com/project/cities2-trafficlightsenhancement'
  ),
  mod(
    '78960',
    'Traffic Lights Enhancement Alpha',
    'C2VMTLE',
    170_439,
    'https://crowdin.com/project/cities2-trafficlightsenhancement'
  ),
  mod(
    '79732',
    '[UNSTABLE] TLE Canary',
    'C2VMTLE',
    173,
    'https://crowdin.com/project/cities2-trafficlightsenhancement'
  ),
  mod(
    '89804',
    '[UNSTABLE] TLE 0.3 Preview',
    'C2VMTLE',
    851,
    'https://crowdin.com/project/cities2-trafficlightsenhancement'
  )
];

const luminaPacks = [
  mod('94394', 'Lumina', 'Nyyoko', 86_022, 'https://crowdin.com/project/lumina'),
  mod('113470', 'Lumina [Experimental]', 'Nyyoko', 683, 'https://crowdin.com/project/lumina'),
  mod('88524', 'ON1 Portrait LUT Pack', 'Nyyoko', 3852, 'https://crowdin.com/project/lumina'),
  mod(
    '88863',
    'PolyHaven Cubemap Pack Pure Sky',
    'Nyyoko',
    2996,
    'https://crowdin.com/project/lumina'
  ),
  mod('89556', 'Minecraft HDRI Sky', 'Nyyoko', 188, 'https://crowdin.com/project/lumina')
];

const starqMods = [
  mod('98560', 'Asset UI Manager', 'StarQ', 28_760, 'https://crowdin.com/project/cities2-mods'),
  mod('113708', 'Prefab Asset Fixes', 'StarQ', 4499, 'https://crowdin.com/project/cities2-mods'),
  mod('86124', 'Trading Cost Tweaker', 'StarQ', 2171, 'https://crowdin.com/project/cities2-mods'),
  mod('92671', "StarQ's Workflow Kit", 'StarQ', 1285, 'https://crowdin.com/project/cities2-mods')
];

const moveIt = mod(
  '74324',
  'Move It',
  'yenyang',
  740_786,
  'https://crowdin.com/project/csl2-mod-move-it'
);
const anarchy = mod(
  '74604',
  'Anarchy',
  'yenyang',
  798_053,
  'https://crowdin.com/project/csl2-mod-anarchy'
);
const topoToggle = mod(
  '129789',
  'Topo Toggle [Deprecated]',
  'yenyang',
  34_042,
  'https://crowdin.com/project/csl2-mod-topo-toggle'
);

const config: PlanConfig = {
  blacklist: { modIds: [], links: [] },
  deadNameMarkers: [
    'deprecated',
    'obsolete',
    'abandoned',
    'discontinued',
    'outdated',
    'unmaintained',
    'broken',
    'dead'
  ],
  maxRemovals: 5
};

const alive: ProbeAnswer = { status: 200, location: null };
const loginRedirect: ProbeAnswer = { status: 302, location: '/login' };

const now = new Date('2026-11-07T03:04:05Z');

function mod(
  modId: string,
  displayName: string,
  author: string,
  installedCount: number,
  translationLink?: string
): Mod {
  return { modId, displayName, author, os: 'Windows', installedCount, translationLink };
}

/** Plans with every Crowdin link alive unless `probes` says otherwise. */
function plan(overrides: Partial<PlanInput> & Pick<PlanInput, 'mods'>) {
  const probes = Object.fromEntries(linksToProbe(overrides.mods).map(link => [link, alive]));

  return planUpdate({
    previousState: [],
    config,
    template: '{{date}}\n\n{{list}}\n',
    allowMassRemoval: false,
    now,
    repository: 'toverux/pdxmods-intl-scrapper',
    ...overrides,
    probes: { ...probes, ...overrides.probes }
  });
}

function okPlan(overrides: Partial<PlanInput> & Pick<PlanInput, 'mods'>) {
  const result = plan(overrides);

  if (!result.ok) {
    throw new Error(result.failure);
  }

  return result;
}

/** The state a previous run published for these mods, all alive. */
function publishedState(mods: readonly Mod[]): readonly Entry[] {
  return okPlan({ mods }).state;
}

function asOldState(mods: readonly Mod[]): readonly OldStateRecord[] {
  return mods.map(m => ({ ...m, translationLink: m.translationLink ?? '' }));
}

function summary(entries: readonly Entry[]) {
  return entries.map(entry => [entry.displayName, entry.otherModsCount]);
}

describe('grouping', () => {
  test('Skyve and Skyve [BETA] make one entry under the most installed release', () => {
    expect(summary(okPlan({ mods: [skyveBeta, skyve] }).state)).toEqual([['Skyve', 1]]);
  });

  test('the four TLE variants make one entry with +3', () => {
    expect(summary(okPlan({ mods: tleVariants }).state)).toEqual([
      ['Traffic Lights Enhancement Alpha', 3]
    ]);
  });

  test('the Lumina packs fold into the Lumina entry', () => {
    expect(summary(okPlan({ mods: luminaPacks }).state)).toEqual([['Lumina', 4]]);
  });

  test('links group case-insensitively and without trailing slashes, showing the original link', () => {
    const upper = mod('1', 'Upper', 'a', 10, 'https://crowdin.com/project/Load-Order-Mod-2/');
    const { state } = okPlan({ mods: [upper, skyve] });

    expect(summary(state)).toEqual([['Skyve', 1]]);
    expect(state[0]?.translationLink).toBe(skyve.translationLink);
    expect(state[0]?.normalizedLink).toBe('https://crowdin.com/project/load-order-mod-2');
  });

  test('equal installs break by the lowest mod ID, for the winner and the order', () => {
    const a = mod('900', 'A', 'a', 10, 'https://crowdin.com/project/shared');
    const b = mod('85', 'B', 'b', 10, 'https://crowdin.com/project/shared');
    const c = mod('70', 'C', 'c', 10, 'https://crowdin.com/project/c');

    expect(summary(okPlan({ mods: [a, b, c] }).changes.added)).toEqual([
      ['C', 0],
      ['B', 1]
    ]);
  });

  test('mods without a link are left out', () => {
    expect(okPlan({ mods: [mod('1', 'No link', 'a', 5), moveIt] }).state).toHaveLength(1);
  });
});

describe('list markdown', () => {
  test('orders by installs, dates in UTC, and notes other mods on the project', () => {
    const { listMarkdown } = okPlan({ mods: [moveIt, skyve, skyveBeta, anarchy] });

    expect(listMarkdown).toBe(
      [
        '2026-11-07 03:04 UTC',
        '',
        '1. [Anarchy](https://crowdin.com/project/csl2-mod-anarchy) ([mod page](https://mods.paradoxplaza.com/mods/74604/Windows)) by *[yenyang](https://mods.paradoxplaza.com/authors/yenyang)* — ⬇️ 798,053 installs',
        '2. [Move It](https://crowdin.com/project/csl2-mod-move-it) ([mod page](https://mods.paradoxplaza.com/mods/74324/Windows)) by *[yenyang](https://mods.paradoxplaza.com/authors/yenyang)* — ⬇️ 740,786 installs',
        '3. [Skyve](https://crowdin.com/project/load-order-mod-2) ([mod page](https://mods.paradoxplaza.com/mods/75804/Windows)) by *[TDW](https://mods.paradoxplaza.com/authors/TDW)* — ⬇️ 371,049 installs — +1 mod on this project',
        ''
      ].join('\n')
    );
  });

  test('copies $-patterns in mod names as-is', () => {
    const cash = mod('1', "$$ Cash $& $'", 'TDW', 10, 'https://crowdin.com/project/cash');

    expect(okPlan({ mods: [cash] }).listMarkdown).toContain("[$$ Cash $& $'](");
  });
});

describe('dead-name markers', () => {
  test('a marker inside brackets or parentheses drops the mod, case-insensitively', () => {
    const parens = mod(
      '2',
      'Old Tool (OUTDATED - use New Tool)',
      'a',
      5,
      'https://crowdin.com/project/old-tool'
    );

    expect(okPlan({ mods: [topoToggle, parens, moveIt] }).state.map(e => e.displayName)).toEqual([
      'Move It'
    ]);
  });

  test('"Broken Bridges Fix" stays listed', () => {
    const bridges = mod('3', 'Broken Bridges Fix', 'a', 5, 'https://crowdin.com/project/bridges');

    expect(okPlan({ mods: [bridges] }).state).toHaveLength(1);
  });

  test('a dead-named winner promotes the next mod', () => {
    const deprecatedSkyve = { ...skyve, displayName: 'Skyve [Deprecated]' };

    expect(summary(okPlan({ mods: [deprecatedSkyve, skyveBeta] }).state)).toEqual([
      ['Skyve [BETA]', 0]
    ]);
  });

  test('a dead-named entry that was published reads as removed', () => {
    const previousState = publishedState([{ ...topoToggle, displayName: 'Topo Toggle' }, moveIt]);

    expect(summary(okPlan({ mods: [topoToggle, moveIt], previousState }).changes.removed)).toEqual([
      ['Topo Toggle', 0]
    ]);
  });
});

describe('blacklist', () => {
  const withBlacklist = (modIds: string[], links: string[]): PlanConfig => ({
    ...config,
    blacklist: { modIds, links }
  });

  test('a blacklisted mod ID or link (in any case) drops it', () => {
    const { state } = okPlan({
      mods: [moveIt, anarchy, skyve],
      config: withBlacklist(['74324'], ['HTTPS://crowdin.com/project/CSL2-mod-anarchy/'])
    });

    expect(state.map(e => e.displayName)).toEqual(['Skyve']);
  });

  test('a blacklisted winner promotes the next mod, silently', () => {
    const previousState = publishedState([skyve, skyveBeta]);
    const result = okPlan({
      mods: [skyve, skyveBeta],
      previousState,
      config: withBlacklist(['75804'], [])
    });

    expect(summary(result.state)).toEqual([['Skyve [BETA]', 0]]);
    expect(result.changes).toEqual({ added: [], removed: [] });
  });

  test('blacklisting a whole entry by link or winner ID is not announced as a removal', () => {
    const previousState = publishedState([moveIt, anarchy]);

    const byLink = okPlan({
      mods: [moveIt, anarchy],
      previousState,
      config: withBlacklist([], [moveIt.translationLink ?? ''])
    });
    const byId = okPlan({
      mods: [moveIt, anarchy],
      previousState,
      config: withBlacklist(['74324'], [])
    });

    for (const result of [byLink, byId]) {
      expect(summary(result.state)).toEqual([['Anarchy', 0]]);
      expect(result.changes.removed).toEqual([]);
      expect(result.announcement).toBeUndefined();
    }
  });

  test('an entry whose mod vanished stays silent when its link is blacklisted', () => {
    const previousState = publishedState([moveIt, anarchy]);
    const result = okPlan({
      mods: [anarchy],
      previousState,
      config: withBlacklist([], [moveIt.translationLink ?? ''])
    });

    expect(result.changes.removed).toEqual([]);
  });
});

describe('Crowdin liveness', () => {
  test('a 404 or a redirect to /login (relative or absolute) is dead, a 200 alive', () => {
    const { state } = okPlan({
      mods: [moveIt, anarchy, skyve, ...luminaPacks],
      probes: {
        'https://crowdin.com/project/csl2-mod-move-it': { status: 404, location: null },
        'https://crowdin.com/project/csl2-mod-anarchy': {
          status: 302,
          location: 'https://crowdin.com/login'
        },
        'https://crowdin.com/project/lumina': loginRedirect
      }
    });

    expect(state.map(e => e.displayName)).toEqual(['Skyve']);
  });

  test('links on other platforms are never probed and stay listed', () => {
    const paratranz = mod('5', 'Paratranz Mod', 'a', 5, 'https://paratranz.cn/projects/123');

    expect(linksToProbe([paratranz, moveIt])).toEqual([
      'https://crowdin.com/project/csl2-mod-move-it'
    ]);
    expect(okPlan({ mods: [paratranz] }).state).toHaveLength(1);
  });

  test.each<[string, ProbeAnswer]>([
    ['429', { status: 429, location: null }],
    ['5xx', { status: 503, location: null }],
    ['an unexpected redirect', { status: 302, location: '/project/elsewhere' }],
    ['a network error', { error: 'ECONNRESET' }]
  ])('%s fails the run', (_name, answer) => {
    const result = plan({
      mods: [moveIt, anarchy],
      probes: { 'https://crowdin.com/project/csl2-mod-move-it': answer }
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure).toContain('csl2-mod-move-it');
  });

  test('an unreadable answer does not fail the run on a blacklisted or dead-named link', () => {
    const outage: ProbeAnswer = { status: 503, location: null };

    const result = plan({
      mods: [moveIt, topoToggle],
      probes: {
        'https://crowdin.com/project/csl2-mod-move-it': outage,
        'https://crowdin.com/project/csl2-mod-topo-toggle': outage
      },
      config: {
        ...config,
        blacklist: { modIds: [], links: ['https://crowdin.com/project/csl2-mod-move-it'] }
      }
    });

    expect(result.ok).toBe(true);
  });
});

describe('comparison by link', () => {
  test('the shared cities2-mods project reads as one removal when it goes private', () => {
    const previousState = publishedState([...starqMods, moveIt]);
    const result = okPlan({
      mods: [...starqMods, moveIt],
      previousState,
      probes: { 'https://crowdin.com/project/cities2-mods': loginRedirect }
    });

    expect(summary(result.changes.removed)).toEqual([['Asset UI Manager', 3]]);
    expect(result.changes.added).toEqual([]);
  });

  test('a new beta of a listed mod is not a new project', () => {
    const previousState = publishedState([skyve]);

    expect(okPlan({ mods: [skyve, skyveBeta], previousState }).changes).toEqual({
      added: [],
      removed: []
    });
  });

  test('a winner change or a +N change is not a change', () => {
    const previousState = publishedState([skyve, skyveBeta]);
    const overtaken = { ...skyveBeta, installedCount: 500_000 };
    const result = okPlan({
      mods: [skyve, overtaken, mod('9', 'Skyve [ALPHA]', 'TDW', 1, skyve.translationLink)],
      previousState
    });

    expect(summary(result.state)).toEqual([['Skyve [BETA]', 2]]);
    expect(result.changes).toEqual({ added: [], removed: [] });
    expect(result.announcement).toBeUndefined();
  });

  test('install counts refresh in the state without a change', () => {
    const previousState = publishedState([moveIt]);
    const result = okPlan({ mods: [{ ...moveIt, installedCount: 1_073_213 }], previousState });

    expect(result.state[0]?.installedCount).toBe(1_073_213);
    expect(result.announcement).toBeUndefined();
  });

  test("Move It's removal and return read as one removal, then one addition", () => {
    const day1 = publishedState([moveIt, anarchy]);

    const day2 = okPlan({ mods: [anarchy], previousState: day1 });
    expect(summary(day2.changes.removed)).toEqual([['Move It', 0]]);

    const day3 = okPlan({ mods: [moveIt, anarchy], previousState: day2.state });
    expect(summary(day3.changes.added)).toEqual([['Move It', 0]]);
    expect(day3.changes.removed).toEqual([]);
  });

  test('a mod changing its link reads as one removal plus one addition', () => {
    const previousState = publishedState([moveIt]);
    const result = okPlan({
      mods: [{ ...moveIt, translationLink: 'https://crowdin.com/project/move-it-2' }],
      previousState
    });

    expect(result.changes.added.map(e => e.normalizedLink)).toEqual([
      'https://crowdin.com/project/move-it-2'
    ]);
    expect(result.changes.removed.map(e => e.normalizedLink)).toEqual([
      'https://crowdin.com/project/csl2-mod-move-it'
    ]);
  });

  test('a missing previous state reads every project as new', () => {
    expect(okPlan({ mods: [moveIt, anarchy] }).changes.added).toHaveLength(2);
  });
});

describe('old per-mod state shape', () => {
  test('folds into projects by link without reporting a change', () => {
    const mods = [skyve, skyveBeta, ...tleVariants, ...luminaPacks, ...starqMods, moveIt];

    expect(okPlan({ mods, previousState: asOldState(mods) }).changes).toEqual({
      added: [],
      removed: []
    });
  });

  test('reads removals by link, naming the old winner', () => {
    const previousState = asOldState([...luminaPacks, moveIt]);
    const result = okPlan({
      mods: [...luminaPacks, moveIt],
      previousState,
      probes: { 'https://crowdin.com/project/lumina': loginRedirect }
    });

    expect(summary(result.changes.removed)).toEqual([['Lumina', 4]]);
  });

  test('a link is blacklisted by ID when any of its old records is', () => {
    const previousState = asOldState([...luminaPacks, moveIt]);
    const result = okPlan({
      mods: [...luminaPacks, moveIt],
      previousState,
      probes: { 'https://crowdin.com/project/lumina': loginRedirect },
      config: { ...config, blacklist: { modIds: ['88524'], links: [] } }
    });

    expect(result.changes.removed).toEqual([]);
  });
});

describe('removal guard', () => {
  const projects = Array.from({ length: 6 }, (_, i) =>
    mod(`${i + 1}`, `Mod ${i + 1}`, 'a', 100 - i, `https://crowdin.com/project/p${i + 1}`)
  );

  test('5 removals pass', () => {
    const result = plan({ mods: [projects[5] as Mod], previousState: publishedState(projects) });

    expect(result.ok && result.changes.removed).toHaveLength(5);
  });

  test('6 removals fail the run', () => {
    const result = plan({ mods: [], previousState: publishedState(projects) });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure).toContain('remove 6 entries');
  });

  test('6 removals pass when mass removal is allowed', () => {
    const result = plan({
      mods: [],
      previousState: publishedState(projects),
      allowMassRemoval: true
    });

    expect(result.ok && result.changes.removed).toHaveLength(6);
  });
});

describe('announcement', () => {
  test('tag, title and release URL use the run time in UTC', () => {
    const { announcement } = okPlan({ mods: [moveIt] });

    expect(announcement?.tag).toBe('list-2026-11-07-0304');
    expect(announcement?.releaseTitle).toBe('List update 2026-11-07');
    expect(announcement?.releaseUrl).toBe(
      'https://github.com/toverux/pdxmods-intl-scrapper/releases/tag/list-2026-11-07-0304'
    );
  });

  test('the release body holds the full delta in detailed lines', () => {
    const { announcement } = okPlan({ mods: [anarchy], previousState: publishedState([moveIt]) });

    expect(announcement?.releaseBody).toBe(
      [
        '## New translation projects',
        '',
        '1. [Anarchy](https://crowdin.com/project/csl2-mod-anarchy) ([mod page](https://mods.paradoxplaza.com/mods/74604/Windows)) by *[yenyang](https://mods.paradoxplaza.com/authors/yenyang)* — ⬇️ 798,053 installs',
        '',
        '## Removed translation projects',
        '',
        '1. [Move It](https://crowdin.com/project/csl2-mod-move-it) ([mod page](https://mods.paradoxplaza.com/mods/74324/Windows)) by *[yenyang](https://mods.paradoxplaza.com/authors/yenyang)* — ⬇️ 740,786 installs',
        ''
      ].join('\n')
    );
  });

  test('the Discord post lists changes compactly, without embeds or pings', () => {
    const everyone = mod('6', 'Ping @everyone Mod', 'a', 5, 'https://crowdin.com/project/ping');
    const { announcement } = okPlan({ mods: [everyone], previousState: publishedState([moveIt]) });

    expect(announcement?.discord).toEqual({
      content: [
        '**New translation projects**',
        '- [Ping @everyone Mod](https://crowdin.com/project/ping)',
        '',
        '**Removed translation projects**',
        '- [Move It](https://crowdin.com/project/csl2-mod-move-it)'
      ].join('\n'),
      flags: 4,
      // biome-ignore lint/style/useNamingConvention: Discord API field
      allowed_mentions: { parse: [] }
    });
  });

  /** A 20-project day whose Discord message, without trailer, is `padding` characters past the limit. */
  function twentyProjectDay(padding: number) {
    const mods = Array.from({ length: 20 }, (_, i) =>
      mod(
        `${i + 1}`,
        `Project ${String(i + 1).padStart(2, '0')} ${'x'.repeat(40)}`,
        'a',
        100 - i,
        `https://crowdin.com/project/project-${i + 1}`
      )
    );

    const baseLength = okPlan({ mods }).announcement?.discord.content.length ?? 0;
    const last = mods[19] as Mod;
    mods[19] = {
      ...last,
      displayName: last.displayName + 'y'.repeat(discordMessageLimit - baseLength + padding)
    };

    return okPlan({ mods }).announcement;
  }

  test('a Discord message exactly at the limit is sent whole', () => {
    const content = twentyProjectDay(0)?.discord.content ?? '';

    expect(content).toHaveLength(discordMessageLimit);
    expect(content).not.toContain('more, [see the release]');
  });

  test('a Discord message over the limit stops before it and points to the release', () => {
    const announcement = twentyProjectDay(1);
    const content = announcement?.discord.content ?? '';

    expect(content.length).toBeLessThanOrEqual(discordMessageLimit);
    expect(content.split('\n').at(-1)).toBe(
      `+1 more, [see the release](${announcement?.releaseUrl})`
    );
    expect(content).toContain('Project 19');
    expect(content).not.toContain('Project 20');
  });
});
