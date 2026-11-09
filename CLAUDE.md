# PoB Manager: project memory

An unofficial Chrome/Edge/Firefox extension, to be published like `../PoE-Ninja-Extension`. It records every Path of Building
share link you open (the 8 sites PoB v2.67.2 exports to), reads each build once, and lists them in the toolbar popup with filters.
Owner: Wesley. How it works and how to test it: `README.md`.

## Where things live

| What | Where |
| --- | --- |
| Code, tests, data tools | This repo |
| Plan, decisions, change log, open questions | Obsidian vault `C:\Users\Wesley\Documents\Obsidian\PoE-Sim-Notes\pob-manager\PoB Manager Plan.md` (follow that vault's `CLAUDE.md`) |
| PoE knowledge (leagues and the like) | The PoE wiki vault `C:\Users\Wesley\Documents\Obsidian\PoE` (read only from here) |
| PoB source at the pin, headless PoB, LuaJIT | `../PoE-Sim` (`sources/pob` at v2.67.2 `b32759a`, `.local/luajit`) |
| Reference extension | `../PoE-Ninja-Extension` |

- No design notes in this repo. Never write into the PoE wiki vault.

## Sources of truth

- **PoB v2.67.2 is the reference** for everything read from a build. Rules in `src/buildinfo.js` cite the PoB file and function
  they follow. When PoB looks odd (e.g. no loadouts on old-tree builds), tell Wesley; don't "fix" PoB's behaviour silently.
- Generated data is never hand-edited: `data/pobdata.js` (`npm run data:pob`, from headless PoB) and `data/leagues.js`
  (`npm run data:leagues`, from the PoE wiki vault).

## Testing: accuracy is the product

- Every feature and fix lands with tests; a bug fix gets a regression test that fails before the fix.
- Every accuracy test names its reference (PoB file/function, headless PoB, the wiki page) and its tolerance (exact here).
- Never loosen a check, edit an expected value or skip a test to make it pass. Investigate.
- `npm test`: unit tests plus `test/golden.test.js` (fixture builds vs headless PoB's fields in `expected.json`).
- CI (`.github/workflows/ci.yml`, and the release workflow) runs `npm run test:ci`: `npm test` minus the one check that needs the
  PoE wiki vault, with PoB's files fetched at the pin (`.github/actions/pob-source`). A new test that reads local-only sources
  must work the same way: fetch the source in CI, or stay local and say so in README's test table.
- `npm run accuracy`: the reader vs headless PoB on real builds (PoE-Sim's poe.ninja sweep and golden builds). Run it after
  any change to `src/buildinfo.js` or the data. `npm run fixtures` rewrites the golden expectations from PoB.
- `npm run e2e:edge` / `npm run e2e:firefox`: real browsers with the extension; make real GET requests to the share sites.
- Real builds hold account names: they stay in `.local/` (gitignored). Tracked fixtures use generated builds or made-up names.

## Git

- **Short commit messages:** one line, imperative, no body unless it's really needed ("Add Lua state round-trip tests").
- **Commit at bigger milestones:** a finished feature, a merged batch of work, a batch of decisions. Not every small fix.
  Notes-vault edits go in with the milestone.
- **Never push without asking Wesley first**, and push rarely: batch work into a few commits, then ask at a natural checkpoint.
  Plan approval is not push approval. Never force-push without explicit approval.
- **A push to main with a new version is a public release** (`.github/workflows/release.yml`: Mozilla signs it, a GitHub
  release goes out, installed Firefox copies update). Bump the version (`npm run bump -- X.Y.Z`) only when Wesley asks for a
  release, and say so when asking to push.
- **No real account or character names in tracked files.** Real builds go in `.local/` (gitignored); tests use made-up names.
