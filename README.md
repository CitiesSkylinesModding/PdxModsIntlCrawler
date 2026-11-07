# PdxModsIntlCrawler

> Reference maintainer(s): @toverux

A simple CLI tool to find mods from [Paradox Mods](https://mods.paradoxplaza.com/) proposing community-supported translation
projects. This is helpful for translators to find mods that need their help.

It uses the Paradox HTTP API to iterate over mod descriptions and external links and find the ones
that have a translation project.

This repository was made for Cities: Skylines II, but you can fork it for another Paradox game (see
[Forking](#forking)).

Supported platforms include:

- [Crowdin](https://crowdin.com)
- [Paratranz](https://paratranz.cn)
- [Weblate](https://weblate.org)
- [Transifex](https://transifex.com)
- [POEditor](https://poeditor.com)
- [Lokalise](https://lokalise.com)
- [GitLocalize](https://gitlocalize.com)
- [LingoHub](https://lingohub.com)

## Usage

- Install [mise-en-place](https://mise.jdx.dev),
- Run `mise i` (to install the required version of bun),
- Run `./cli.ts help`.
- Edit `config.ts` to set the game ID, the blacklist and the dead-name markers.

The list holds one entry per translation project: mods linking the same project share one entry,
shown under the most installed of them, with a "+N mods on this project" note. These are left out:

- mods whose name holds a dead-name marker inside brackets or parentheses, ex. `Foo [Deprecated]`
  (the `deadNameMarkers` setting),
- mods or projects on the blacklist (`blacklist.modIds` and `blacklist.links`); blacklisting a
  listed project is never announced as a removal,
- Crowdin projects that were deleted or made private.

### CLI Commands

#### `update`

Crawls Paradox Mods, checks each Crowdin project still answers publicly, then writes
`state/state.json` and the list. It compares the new list with the previous one by project link and,
when projects appeared or disappeared, writes the announcement to the `--payload` path (and deletes
any file there otherwise). It never creates a release or posts to Discord, so it's safe to run
locally.

The run fails without writing anything when a Crowdin project gives an unexpected answer, when a
listing page comes back empty, or when it would remove more than 5 projects. Pass
`--allow-mass-removal` when such a removal is a real cleanup.

```
./cli.ts update --payload /tmp/announcement.json
```

#### `announce`

Sends a payload written by `update`: creates a GitHub release tagged `list-YYYY-MM-DD-HHMM` on the
current `HEAD` (skipped if the tag already exists), then posts the changes to Discord. Needs
`GITHUB_TOKEN` and `GITHUB_REPOSITORY`; without `DISCORD_WEBHOOK_URL` it only warns and skips the
post.

```
./cli.ts announce --payload /tmp/announcement.json
```

### GitHub workflow

The "Chore: Update list" workflow runs daily. Its first job runs `update`, then `bun run check`, then
commits and pushes the list. A second job runs `announce` only after a successful push with changes
to announce; if it fails, "Re-run failed jobs" sends the same announcement again without creating a
second release.

Manual runs take two inputs:

- `announce` (default on): turn it off to update the list silently, ex. to rebaseline it.
- `allow_mass_removal` (default off): let the run remove more than 5 projects.

The Discord post needs a webhook URL stored as the `DISCORD_WEBHOOK_URL` repository secret.

### Forking

Delete `state/state.json` and set the game in `config.ts`. Run the workflow manually once with
`announce` off: with no previous state, every project would otherwise be announced as new.
