import type { PlanConfig } from './plan.ts';

export interface Config extends PlanConfig {
  readonly gameId: string;
  readonly tags: string[];
  readonly listMarkdownTemplateFilePath?: string;
  readonly listMarkdownFilePath: string;
}

export const config: Config = {
  // You can find the game ID in the Paradox Mods URL, ex.
  // https://mods.paradoxplaza.com/games/cities_skylines_2
  gameId: 'cities_skylines_2',
  // Filter mods by tags.
  // No need to seek for translation projects for ex. maps.
  tags: ['Code Mod'],
  // Path to the markdown file that "./cli.ts update" uses as a template.
  // Resolved from the project root.
  listMarkdownTemplateFilePath: 'list-template.md',
  // Path to the markdown file that "./cli.ts update" creates/overrides with the list of
  // translation projects.
  // Resolved from the project root.
  listMarkdownFilePath: 'list-of-mods-seeking-translators.md',
  // Mods left out of the list by hand, by Paradox Mods ID or by translation project link.
  // Blacklisting a listed project is never announced as a removal.
  blacklist: {
    modIds: [],
    links: []
  },
  // A mod whose name holds one of these words inside [] or () is left out, ex. "Foo [Deprecated]".
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
  // A run removing more entries than this fails, unless run with --allow-mass-removal.
  maxRemovals: 5
};
