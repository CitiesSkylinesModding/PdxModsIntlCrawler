export interface Config {
    readonly gameId: string;
    readonly tags: string[];
    readonly changelogFormat: 'markdown' | 'wiki';
    readonly listFormat: 'markdown' | 'wiki';
}

const config: Config = {
    // You can find the game ID in the Paradox Mods URL, ex.
    // https://mods.paradoxplaza.com/games/cities_skylines_2
    gameId: 'cities_skylines_2',
    // Filter mods by tags.
    // No need to seek for translation projects for ex. maps.
    tags: ['Code Mod'],
    // Default format for "list" command, overridable with --fmt.
    listFormat: 'wiki',
    // Default format for "changelog" command, overridable with --fmt.
    changelogFormat: 'markdown'
};

export default config;
