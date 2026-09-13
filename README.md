# paper-search-bot

A small bot + static site that watches the [IACR Cryptology ePrint
Archive](https://eprint.iacr.org/) RSS feed, sorts new papers into topics you
care about using keyword rules, and publishes the result as a static page via
GitHub Pages.

There's no server and no LLM in the loop: a scheduled GitHub Action fetches
the feed, classifies each paper, and commits the updated data file; the page
itself is plain HTML/CSS/JS reading that data file client-side.

## How it works

1. `.github/workflows/update.yml` runs `scripts/fetch_papers.py` once a day
   (and on-demand via the "Run workflow" button in the Actions tab).
2. `scripts/fetch_papers.py` fetches `https://eprint.iacr.org/rss/rss.xml`,
   pulls title/abstract/authors/date/link for each entry, classifies it
   against `scripts/topics.json`, and upserts it into
   `docs/data/papers.json` (keyed by eprint id, e.g. `2026/223`, so a revised
   paper updates in place rather than duplicating).
3. If `docs/data/papers.json` changed, the workflow commits and pushes it.
4. GitHub Pages serves `docs/index.html`, which fetches `data/papers.json`
   and renders topic tabs, a search box, and a card grid, one card per paper.

Note: this only picks up papers that appear in the live RSS feed from the
point the workflow starts running — it does not backfill IACR's full archive.

## Site features

- **Card grid** with topic tabs and a search box across title/abstract.
- **🎲 Random Paper** — pops up a random paper's full abstract; "Another one"
  re-rolls without closing. Never picks a marked (hidden) paper, and avoids
  immediately repeating the last one shown.
- **Mark** — every card has a "Mark" button that hides it from your view.
  This is **browser-local only** (stored in `localStorage`, nothing is
  written to the repo): it doesn't sync across devices/browsers, and
  clearing this browser's site data brings marked papers back. A
  "Marked (N) — show" link near the search box lists what you've marked, with
  an "Unmark" button to restore any of them.
- **⟳ Update Now** — triggers `.github/workflows/update.yml` directly from
  the page via the GitHub REST API, then polls until the run finishes and
  refreshes the data — no need to visit the Actions tab. This needs a GitHub
  **fine-grained personal access token**, scoped to just this repo
  (`Anirudh-C/eprint-scrawler`) with **Actions: Read and write** permission
  (create one at
  [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)).
  Paste it into the token modal (opened automatically the first time you
  click "Update Now", or any time via the ⚙ button) — it's stored only in
  that browser's `localStorage` and sent only to `api.github.com`, never
  committed to the repo or embedded in the page source.

  **Note on scope:** a fine-grained PAT's permissions apply to the whole
  repo, not just the Actions API — treat it like any other credential
  (don't paste it on a shared/public computer; revoke it from GitHub
  settings if you ever suspect it leaked).

## Editing topics

Open `scripts/topics.json` — it's a plain map of topic name → list of
keywords/phrases:

```json
{
  "My Topic": ["keyword one", "keyword-two"]
}
```

Matching is case-insensitive against each paper's title + abstract, with word
boundaries (so `"mpc"` won't match inside an unrelated longer word). A paper
can land in multiple topics; papers matching none go into "Uncategorized" so
nothing is silently dropped. Edit the file, commit, and the next scheduled (or
manually triggered) run reclassifies going forward — it won't retroactively
reclassify papers already stored unless they're refetched as a revision.

## Running locally

```bash
python3 scripts/fetch_papers.py   # updates docs/data/papers.json
python3 -m http.server --directory docs
# open http://localhost:8000
```

No dependencies beyond the Python 3 standard library.

## Deployment

GitHub Pages is configured to serve from the `docs/` folder on `main`. Once
that's set (Settings → Pages, or via `gh api repos/:owner/:repo/pages`), pushes
to `docs/data/papers.json` — including the ones the scheduled workflow makes —
show up on the Pages URL automatically.
