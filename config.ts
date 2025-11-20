export interface Config {
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
  // Path to the markdown file that will be used as a template by the
  // "./cli.ts list --write" command as a template.
  // Resolved from the project root.
  listMarkdownTemplateFilePath: 'list-template.md',
  // Path to the markdown file that "./cli.ts list --write" will
  // create/override with the list of mods with translation projects.
  // Resolved from the project root.
  listMarkdownFilePath: 'List of Mods Seeking Translators.md'
};
