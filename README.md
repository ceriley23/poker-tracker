# Poker Tracker

A free, private poker session tracker that lives on your phone. No account, no
subscription, no internet needed at the casino. Built for one-handed use at the
table on a Pixel 9 Pro.

## What it does

- **Sessions** — tap Start when you sit down, log rebuys as they happen, tap
  End when you rack up. Date, venue, stakes, buy-ins, cash-out, duration and
  $/hr are all recorded — this doubles as your contemporaneous record for taxes.
- **Hands** — two ways to capture a hand:
  - **🎤 Voice Hand**: tap, talk, tap. For breaks and walks (most card rooms
    don't allow recording at the table).
  - **⌨️ Quick Hand**: position, stack, action shorthand, result — looks like
    texting, fine at the table.
- **Review** — after a session, listen back to voice memos, type up what
  matters, and mark hands reviewed.
- **Stats** — lifetime and filtered: net, $/hr, hours, win rate, standard
  deviation, biggest win/loss, cumulative graph, results by stakes and venue.
- **Backup** — one tap exports everything (including audio) as a zip. Save it
  to Google Drive. The same zip restores onto any phone via "Restore from
  backup". CSVs are included for taxes/spreadsheets.

## Important: your data lives on your phone

Everything is stored locally in your browser. Nothing is uploaded anywhere.
That means **your phone is the only copy until you export a backup** — the
home screen shows when you last backed up. Make it a habit after every session
or two: Export full backup → save to Google Drive.

Also: don't clear Chrome's site data / browsing data for this app's site, or
the data goes with it. (The app asks Chrome for "persistent storage" so normal
cleanup won't touch it.)

## Putting it on your phone

The app is just a folder of files. It needs to be served over HTTPS once so
your phone can install it; the free way is GitHub Pages:

1. Create a free account at github.com.
2. Create a new **public** repository, e.g. `poker-tracker`.
3. Upload every file in this folder (keep the folder structure: `css/`, `js/`,
   `icons/` …) using "Add file → Upload files".
4. In the repo: Settings → Pages → Source: "Deploy from a branch" →
   Branch: `main`, folder `/ (root)` → Save.
5. After a minute your app is live at `https://YOURNAME.github.io/poker-tracker/`.
6. Open that link in Chrome on your phone → menu (⋮) → **Add to Home screen →
   Install**. It now launches full-screen like a normal app and works offline.

Your poker data is **not** in the repository and never will be — the repo only
holds the app's code.

**Updating the app later:** re-upload the changed files to the repo, and bump
the `VERSION` date near the top of `sw.js` (e.g. to today's date). Then reopen
the app on your phone — the new version is picked up automatically (you may need
to close and reopen it once). Your data is untouched by updates.

## Files

- `index.html`, `css/`, `js/` — the app itself
- `js/dexie.min.js` — database helper (stores data in your browser)
- `js/fflate.min.js` — zip helper (for backups)
- `sw.js`, `manifest.webmanifest`, `icons/` — offline support + installability
- `docs/SPEC.md` — the original build spec
