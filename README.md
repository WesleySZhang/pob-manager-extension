# PoB Manager

An unofficial browser extension for Chrome, Edge and Firefox. It keeps a list of every Path of Building share link
you open, and shows them in the toolbar popup with filters.

Free and unofficial. Game names and data belong to Grinding Gear Games; Path of Building, pobb.in, poe.ninja and
the other sites belong to their authors.

## What it records

A visit to a share page on any of the 8 sites Path of Building v2.67.2 exports to (`src/Modules/BuildSiteTools.lua`):

| Site | Page | Build code downloaded from |
| --- | --- | --- |
| pobb.in | `pobb.in/{id}` | `pobb.in/pob/{id}` |
| poe.ninja | `poe.ninja/poe1/pob/{id}` (not the ladder or character pages) | `poe.ninja/poe1/pob/raw/{id}` |
| Maxroll | `maxroll.gg/poe/pob/{id}` | `maxroll.gg/poe/api/pob/{id}` |
| pob.codes | `pob.codes/b/{id}` | `api.pob.codes/{id}/raw` |
| poedb | `poedb.tw/pob/{id}` | `poedb.tw/pob/{id}/raw` |
| Pastebin / PastebinP | `pastebin.com/{id}` | `pastebin.com/raw/{id}` |
| Rentry | `rentry.co/{id}` | `rentry.co/paste/{id}/raw` |

On the first visit it downloads the build code once, reads it and keeps only what it read: class, ascendancy, level,
main skill, every gem, keystones, unique items, patch, PoB's saved stats (DPS, Life, ES) and each loadout. The code
itself is not kept. A link with no build (a 404, or a Pastebin or Rentry page holding other text) is dropped and
remembered. On the PoB sites, a reply that can't be read is kept as an error with a **Retry** button instead.

Checked with real share links: pobb.in, poe.ninja (both `/pob/` and `/poe1/pob/`) and poedb. Maxroll and pob.codes
follow PoB's own download URLs but haven't been tried with a real link yet.

Everything stays in the browser (IndexedDB). Nothing is sent anywhere except the download of each build from the
site it came from.

## The popup

- Patch drop-down (with the league), class and ascendancy drop-downs, search by name, creator or gem, sort.
- More filters: creator, DPS and Life ranges (`1.5m`, `800k`), keystones and uniques.
- Per build: rename it, note who made it, switch between its PoB loadouts, open the link, open it in PoB
  (`pob://` link), copy the link, delete.
- DPS is "as exported": what PoB calculated with the uploader's settings. Only the loadout the build was saved on has stats.

## Install (unpacked)

```
npm install
npm run build        # writes dist/chrome and dist/firefox
```

- **Chrome / Edge:** `chrome://extensions` (or `edge://extensions`), turn on Developer mode, **Load unpacked**, pick `dist/chrome`.
- **Firefox:** `about:debugging#/runtime/this-firefox`, **Load Temporary Add-on**, pick `dist/firefox/manifest.json`. Then
  allow the extension's site access in `about:addons` → PoB Manager → Permissions (Firefox asks for host access separately).

## How the reading is checked

The build reader (`src/buildinfo.js`) follows Path of Building v2.67.2 rule by rule, and is checked against PoB itself
running headless (PoE-Sim's pinned checkout and LuaJIT build):

| Command | What it checks |
| --- | --- |
| `npm test` | Unit tests, plus every fixture build in `test/fixtures/golden` against the fields headless PoB showed for it (`expected.json`), loadouts included. |
| `npm run accuracy` | The reader vs headless PoB on real builds (default: PoE-Sim's poe.ninja sweep and golden builds): class, ascendancy, level, main skill, keystones, uniques, and every loadout. Exact match. |
| `npm run e2e:edge` | Real Edge with the extension: visits share links and pages that must be ignored, then uses the popup. |
| `npm run e2e:firefox` | Real Firefox with a test copy of the extension: records a share link, ignores the ladder, renames through the popup. |

## Data

| File | Made by | From |
| --- | --- | --- |
| `data/pobdata.js` | `npm run data:pob` | Headless PoB v2.67.2: tree versions, keystones, classes, gems and skills, timeless and cluster jewel tables |
| `data/leagues.js` | `npm run data:leagues` | The PoE wiki vault's league pages (poewiki Cargo `events`) |
| `test/fixtures/golden/` | `npm run fixtures` | Builds from PoE-Sim's golden set, loadout builds made from one, and headless PoB's fields for each |
