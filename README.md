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
   and renders topic tabs, a search box, and a card per paper.

Note: this only picks up papers that appear in the live RSS feed from the
point the workflow starts running — it does not backfill IACR's full archive.

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
