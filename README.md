# discord

Daily posts for the server, sent through channel webhooks by a GitHub Actions cron at 09:00 IST.

| Job | Channel (webhook key) | Posts |
|---|---|---|
| `resources` | `resources` | Richard's Reading List: at most one article each for frontend, backend and AI, picked by an LLM editor from the blogs in `data/feeds.json`, Lobsters (20+ votes) and Hacker News (300+ points), with a one-line reason, reading time and HN thread |
| `india-match` | `sports` | India men's result after each match, and the next fixture when it changes, from the series pages on Wikipedia |
| `movies` | `sports` | Films in `data/movies.json`, 60 days before release, 7 days before, and on the day |

## Setup

1. In Discord, for each channel: Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL.
2. Store each URL as its own repo secret, plus the Groq key the reading list's editor uses. Each command asks you to paste the value:

   ```sh
   gh secret set DISCORD_WEBHOOK_RESOURCES --repo chaiovercode/discord
   gh secret set DISCORD_WEBHOOK_SPORTS --repo chaiovercode/discord
   gh secret set GROQ_API_KEY --repo chaiovercode/discord
   ```

   A job whose webhook secret is missing is skipped.
3. Run it once by hand: Actions → Daily posts → Run workflow.

## Editing

- Big films: add the exact Wikipedia page title to `data/movies.json`. The release date is read from the page's infobox every day, so date changes need no edit. A title with no page yet is skipped until one exists.
- Blogs: add `{ "name", "url" }` (RSS or Atom) under `frontend`, `backend` or `ai` in `data/feeds.json`.
- `data/state.json` records what was already posted. The workflow commits it after each run.

## Local run

```sh
npm ci
node src/run.ts              # dry run: prints every payload, saves no state (resources needs GROQ_API_KEY)
node src/run.ts movies       # one job
npm run check                # typecheck
```
