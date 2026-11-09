# Privacy policy

PoB Manager is an unofficial browser extension. It has no servers of its own and collects nothing for its
developer: no analytics, no tracking, no accounts.

## What it does with data

- **It watches tab addresses on the Path of Building share sites only:** pobb.in, poe.ninja, maxroll.gg, pob.codes,
  poedb.tw, pastebin.com, pastebinp.com and rentry.co. The browser shows it no other addresses. Private windows are
  ignored.
- **When an address is a build share link**, it downloads that build's code once from the same site (the same
  download Path of Building makes when you import the link), reads it, and keeps what it read: the link, when you
  visited it, and the build's class, level, skills, keystones, items and saved stats. The code itself is not kept.
- **On those sites' pages it adds a small PoB Manager button** that shows and edits the stored build for the page. It
  reads only the page's address, never the page's content, and sends nothing to the site.
- **Everything is stored in your browser** (the extension's IndexedDB). It is never sent anywhere. Removing the
  extension deletes it.
- Nothing else is sent anywhere.

## Contact

Questions: open an issue at https://github.com/WesleySZhang/pob-manager-extension/issues.
