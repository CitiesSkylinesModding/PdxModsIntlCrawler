# pdxmods-intl-scrapper

A simple CLI tool to find mods from [Paradox Mods](https://mods.paradoxplaza.com/) proposing community-supported
translation projects. This is helpful for translators to find mods that need their help.

It uses the Paradox HTTP API to iterate over mod descriptions and external links and find the ones that have a
translation project.

Supported platforms:
- [Crowdin](https://crowdin.com)
- [ParaTranz](https://paratranz.cn)
- Other platforms can be supported easily on request!

## Usage

- Install [Bun](https://bun.sh),
- Run `bun install`,
- Run `./cli.ts help`.

### CLI Commands

#### `discover`

Scans the API for mods with translation projects and lists them as they are found.

Takes the game to generate the list of mods for, the game slug ID can be found on Paradox's website, ex.
https://mods.paradoxplaza.com/games/cities_skylines_2.

Generates a git-ignored `output/state.json` file that serves to the other commands for further processing.

When there is already a `state.json` file, it will be moved to `output/old-state.json` and a new state file will be
generated, allowing diffing and changelog generation.

Example:
```sh
./cli.ts discover cities_skylines_2 --tags "Code Mod"
```

#### `md-list`

Generates a markdown list of all mods with a translation project from the `output/state.json`.

Example output:

> This list is generated automatically. See second post in thread for more info.
>
> 1. [ExtraLib](https://crowdin.com/project/extralib) by *Triton Supreme* — 198,080 installs
> 2. [529 Tiles](https://crowdin.com/project/592-tiles) by *algernon* — 183,618 installs
> 3. [Line Tool](https://crowdin.com/project/line-tool-cs2) by *algernon* — 178,726 installs
> 4. [ExtraLandscapingTools](https://crowdin.com/project/extralandscapingtools) by *Triton Supreme* — 161,494 installs
> 5. [Plop the Growables](https://crowdin.com/project/plop-the-growables) by *algernon* — 72,466 installs
> 6. [ExtraDetailingTools](https://crowdin.com/project/extradetailingtools) by *Triton Supreme* — 41,082 installs
> 7. [ExtraAssetsImporter](https://crowdin.com/project/extraassetsimporter) by *Triton Supreme* — 39,646 installs
> 8. [Skyve [BETA]](https://crowdin.com/project/load-order-mod-2) by *TDW* — 29,505 installs
> 9. [First Person Camera Continued](https://crowdin.com/project/cs2-dfirst-person-camera-continued) by *Cgameworld* — 22,086 installs
> 10. [AdvancedSimulationSpeed](https://crowdin.com/project/cs2-advancedsimulationspeed) by *zakuro9715* — 6,353 installs
> 11. [Lumina](https://crowdin.com/project/lumina) by *Nyyoko* — 5,699 installs
> 12. [SettingsManager](https://crowdin.com/project/cs2-settingsmanager) by *zakuro9715* — 647 installs

### `md-changelog`

Generates a markdown changelog of all mods with a translation project by comparing `state.json` and `old-state.json`.

Example output:

> **List update!**
>
> New translation projects discovered:
> 1. [ExtraDetailingTools](https://crowdin.com/project/extradetailingtools) by *Triton Supreme* — 41,082 installs
> 2. [Plop the Growables](https://crowdin.com/project/plop-the-growables) by *algernon* — 72,466 installs
>
> Mods that updated their translation project link:
> 1. [First Person Camera Continued](https://crowdin.com/project/cs2-dfirst-person-camera-continued) by *Cgameworld* — 22,086 installs
>
> Deleted mods or translation projects:
> 1. [ExtendedRadio](https://crowdin.com/project/extendedradio) by *Triton Supreme* — 35,671 installs
