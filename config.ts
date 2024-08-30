export interface Config {
    readonly gameId: string;
    readonly tags: string[];
}

const config: Config = {
    // You can find the game ID in the Paradox Mods URL, ex.
    // https://mods.paradoxplaza.com/games/cities_skylines_2
    gameId: 'cities_skylines_2',
    // Filter mods by tags.
    // No need to seek for translation projects for ex. maps.
    tags: ['Code Mod']
};

export default config;
