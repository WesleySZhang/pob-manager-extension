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
- More filters: creator, when added (last 24 hours, 7, 30 or 90 days, by the first visit), DPS, Life, energy shield and
  level ranges (`1.5m`, `800k`), keystones, uniques and skills (every skill listed must be an active skill of the build,
  in any socket group; supports don't count). Sorts include energy shield and newest added.
- **Search, filters and sorting look only at each build's default loadout** (the one set by hand, else the saved one).
  A build whose other loadouts would match is not shown.
- Each build is a three-line row (name; class, level, main skill and patch; the saved DPS, Life, ES and EHP) with **Open link** and **Open in PoB** (`pob://` link) buttons. **Click the row to
  expand** it (selecting text in it doesn't collapse it): Path of Building's left panel for the build as saved, in three
  columns, with PoB's numbers: DPS lines, max hits (phys, fire, cold, lightning, chaos), EHP, life, mana, ES and regen,
  armour, evasion, block, spell block, spell suppression, resistances with over-cap, attributes, movement speed and
  charges. A value too long for its column is shortened to k, M or B (the full number on hover). Then the keystones and,
  on the bottom line, the loadout on show (hover it to see every loadout, with the saved and default ones marked;
  nothing to pick, the default is set with ✎) and Delete.
- ✎ on a row: rename it, note who made it, set its main skill or default loadout. It opens without expanding the row.
- DPS is "as exported": what PoB calculated with the uploader's settings. A PoB code holds stats for the loadout it was
  saved on only (pobb.in and poe.ninja show the same ones), so those are the build's stats on the row, in the panel and
  in the DPS/Life filters and sorts, whichever loadout is the default. Nothing is calculated.
- **Main skill.** PoB's main skill is whichever skill group the author left selected, so a Static Strike build saved on
  Ambush shows as "Ambush" in PoB and on pobb.in. When PoB's main skill deals no damage (movement, aura, herald, guard,
  banner, or a buff or curse without damage, by PoB's own skill types), the popup shows the damage skill with the most
  supports instead; hover the skill to see PoB's. You can also set the main skill by hand, per loadout (✎).
- **Default loadout.** Pick the loadout a build shows first (✎); it also names the build.
- **Favorites.** Click ☆ on a build to star it; **★ Favorites** next to the search shows only starred builds.
- Builds read by an older version of the extension are read again when the browser starts or the extension reloads.

## On the share page

On a share page whose build is stored, a PoB Manager panel opens in the bottom-right corner on every page load (on all
8 sites; it floats over the page, so it doesn't depend on any site's layout). It has the build's name, creator,
summary (class, level, main skill, patch, then saved DPS/Life/ES/EHP) and the same editor as ✎: name, creator, main skill and
default loadout, plus ☆ favorite, **Open in PoB** and **Delete** (two clicks). Edits show in the popup at once, and edits
made in the popup show in an open page's panel. **−** collapses it to a small **PoB Manager** button until you leave the
page (unsaved typing is kept); click the button to open it again. Pages that aren't a stored build (the ladder, a paste that holds no
build) and private windows get no panel.

The panel is drawn in a shadow root (the site's styles don't reach it) by `src/page.js`, a content script that asks the
background script for its build: a content script can't open the extension's database.

## Install

From the [latest release](https://github.com/WesleySZhang/pob-manager-extension/releases/latest):

- **Firefox (140 or later):** download `pob-manager-extension-<version>-firefox.xpi` and drag it onto a Firefox window,
  then click **Add**. It's signed by Mozilla, stays installed and updates itself. If it records nothing, allow its site
  access in `about:addons` → PoB Manager → Permissions.
- **Chrome / Edge:** download `pob-manager-extension-<version>-chrome-edge.zip` and unzip it. Open `chrome://extensions`
  (or `edge://extensions`), turn on **Developer mode**, and drag the unzipped folder onto the page (or **Load unpacked**).
  To update, unzip the new version over the same folder and click the extension's reload button; the saved builds stay.
  Removing the extension deletes them.

Privacy: [PRIVACY.md](PRIVACY.md). Nothing leaves the browser except the download of each build from its own site.

## Build from source

```
npm install
npm run build          # dist/chrome, dist/firefox, and the packages below
npm run lint:firefox   # Mozilla's add-on linter on dist/firefox
```

`npm run build` also writes `dist/packages/pob-manager-chrome-<version>.zip` and
`dist/packages/pob-manager-firefox-<version>.xpi` (made with Mozilla's `web-ext`; `--no-package` skips them).

- **Chrome / Edge:** Load unpacked, pick `dist/chrome`.
- **Firefox:** `about:debugging#/runtime/this-firefox`, **Load Temporary Add-on**, pick the `.xpi` (or
  `dist/firefox/manifest.json`). It is removed when Firefox closes: a local build is **unsigned**, and release Firefox
  only keeps signed add-ons.

## Releasing

A push to `main` whose version has no GitHub release yet releases it (`.github/workflows/release.yml`): the CI checks,
Mozilla signing (unlisted, for self-distribution), a GitHub release `vX.Y.Z` tagging that commit with the signed `.xpi`
and the Chrome/Edge zip, and `updates.json` on GitHub Pages
(`https://wesleyszhang.github.io/pob-manager-extension/updates.json`), which installed Firefox copies check daily. A
push with an already-released version only runs CI.

```
npm run bump -- 0.2.0
git commit -am "Release 0.2.0"
git push origin main
```

Mozilla signs each version number only once, so every release needs a new version. If a release fails after signing,
bump again; if it fails before, rerun it from the Actions tab (Release → Run workflow). Chrome and Edge copies loaded with
Load unpacked don't update; users replace the folder.

### One-time setup

1. The repo must be public (GitHub Pages and downloadable releases).
2. Settings → Pages → Source: **GitHub Actions**.
3. Settings → Environments → `github-pages` → Deployment branches and tags: `main` must be allowed (it is by default;
   releases deploy from `main`).
4. Settings → Secrets and variables → Actions: `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`, from addons.mozilla.org →
   Developer Hub → Tools → Manage API Keys (`gh secret set AMO_JWT_ISSUER` asks for the value without echoing it). The
   pair belongs to the Mozilla account, so PoE-Ninja-Extension uses the same one: regenerating it means updating both.

The add-on ID (`pob-manager@pob-manager-extension`) and the update URL must never change: installed copies only update
to the same ID from the URL they were installed with.

## How fast

`npm run measure` (`tools/e2e/measure.js`) opens share links in Edge with and without the extension, a fresh profile
each run, and reads the timing the extension stores with every build (`timing`: download, decode, read, save).
Nov 8, 2026, 7 runs, median (min–max) in milliseconds:

| Link | Page load without | Page load with | Build in list after | Download | Decode | Read | Save | Code / XML |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pobb.in/2FlZU8rRPp3F | 412 (373–463) | 361 (319–519) | 312 (265–408) | 144 (122–255) | 2.3 | 5.1 | 0.5 | 27 / 177 KB |
| pobb.in/agb0V8xT8c-j | 169 (126–198) | 150 (131–178) | 147 (117–181) | 73 (60–123) | 0.8 | 1.3 | 0.6 | 14 / 55 KB |
| poe.ninja/poe1/pob/934b3 | 528 (455–900) | 498 (463–620) | 248 (237–365) | 126 (113–204) | 1.3 | 2.4 | 0.4 | 37 / 302 KB |
| poe.ninja/pob/igw | 200 (177–235) | 193 (168–252) | 162 (149–218) | 52 (47–75) | 0.9 | 1.6 | 0.4 | 31 / 166 KB |

- **No measurable effect on the page:** load times with and without the extension overlap; the work runs in the
  background after the page starts loading.
- **A build is in the list 0.15–0.3 s after you open its link**, usually before the page itself has finished loading.
- **The download is nearly all of it.** Decoding, reading and saving take 2–8 ms together.
- pobb.in rate-limits quick repeats (HTTP 429). The extension then waits as asked (`Retry-After`, 2 s by default, at
  most 10 s) and tries once more; `timing.downloads` counts the attempts.

## How the reading is checked

The build reader (`src/buildinfo.js`) follows Path of Building v2.67.2 rule by rule, and is checked against PoB itself
running headless (PoE-Sim's pinned checkout and LuaJIT build):

| Command | What it checks |
| --- | --- |
| `npm test` | Unit tests, plus every fixture build in `test/fixtures/golden` against the fields headless PoB showed for it (`expected.json`), loadouts included. |
| `npm run test:ci` | What CI runs (`.github/workflows/ci.yml`): `npm test` without the one check that needs the PoE wiki vault (`data/leagues.js` vs the vault's league pages), which only exists on the dev machine. CI fetches the PoB files `test/data.test.js` reads at the pin and sets `POB_SRC`. |
| `npm run accuracy` | The reader vs headless PoB on real builds (default: PoE-Sim's poe.ninja sweep and golden builds): class, ascendancy, level, main skill, keystones, uniques, every loadout, and the sidebar text of every saved stat (vs PoB's own `FormatStat`). Exact match. |
| `node tools/main_skill_review.js` | After `npm run accuracy`: every build where our main skill pick differs from PoB's, to review by hand. |
| `npm run e2e:edge` | Real Edge with the extension: visits share links and pages that must be ignored, then uses the popup. |
| `npm run e2e:firefox` | Real Firefox with a test copy of the extension: records a share link, ignores the ladder, renames through the popup. |

## Data

| File | Made by | From |
| --- | --- | --- |
| `data/pobdata.js` | `npm run data:pob` | Headless PoB v2.67.2: tree versions, keystones, classes, gems and skills, timeless and cluster jewel tables |
| `data/leagues.js` | `npm run data:leagues` | The PoE wiki vault's league pages (poewiki Cargo `events`) |
| `test/fixtures/golden/` | `npm run fixtures` | Builds from PoE-Sim's golden set, loadout builds made from one, and headless PoB's fields for each |
