# discord

Daily posts for the server, sent through channel webhooks by a GitHub Actions cron at 09:00 IST.

| Job | Channel (webhook key) | Posts |
|---|---|---|
| `memes` | `memes` | Top image post from r/ProgrammerHumor's hot list |
| `resources` | `resources` | One fresh read each for frontend, backend and AI, from the blogs in `data/feeds.json` |
| `india-match` | `sports` | India's next cricket match, once each time the next fixture changes |
| `movies` | `sports` | Films in `data/movies.json`, 30 days before release, 7 days before, and on the day |

## Setup

1. In Discord, for each channel: Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL.
2. Store each URL as its own repo secret. Each command asks you to paste the URL:

   ```sh
   gh secret set DISCORD_WEBHOOK_MEMES --repo chaiovercode/discord
   gh secret set DISCORD_WEBHOOK_RESOURCES --repo chaiovercode/discord
   gh secret set DISCORD_WEBHOOK_SPORTS --repo chaiovercode/discord
   ```

   A job whose secret is missing is skipped.
3. Run it once by hand: Actions → Daily posts → Run workflow.

## Editing

- Big films: add the exact Wikipedia page title to `data/movies.json`. The release date is read from the page's infobox every day, so date changes need no edit. A title with no page yet is skipped until one exists.
- Blogs: add `{ "name", "url" }` (RSS or Atom) under `frontend`, `backend` or `ai` in `data/feeds.json`.
- `data/state.json` records what was already posted. The workflow commits it after each run.

## Local run

```sh
npm ci
node src/run.ts              # dry run: prints every payload, saves no state
node src/run.ts movies       # one job
npm run check                # typecheck
```
