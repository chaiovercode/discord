import { post, webhooks } from './lib/discord.ts';
import { readData, writeData } from './lib/util.ts';
import { indiaMatch } from './jobs/india-match.ts';
import { movies } from './jobs/movies.ts';
import { resources } from './jobs/resources.ts';
import type { Job } from './jobs/types.ts';

// Usage: node src/run.ts [job ...]
// Without any DISCORD_WEBHOOK_* variable it prints each payload and saves no state.

const JOBS: Job<any>[] = [resources, indiaMatch, movies];

const only = process.argv.slice(2);
const unknown = only.filter((n) => !JOBS.some((j) => j.name === n));
if (unknown.length) throw new Error(`unknown job(s): ${unknown.join(', ')}. Known: ${JOBS.map((j) => j.name).join(', ')}`);

const hooks = webhooks();
if (!hooks && process.env.CI) throw new Error('no DISCORD_WEBHOOK_* secret is set');

const state = readData<Record<string, unknown>>('state.json');
const now = new Date();
let failed = 0;

for (const job of JOBS) {
  if (only.length && !only.includes(job.name)) continue;
  const url = hooks?.[job.webhook];
  if (hooks && !url) {
    console.log(`- ${job.name}: no "${job.webhook}" webhook, skipped`);
    continue;
  }
  try {
    const { messages, state: next } = await job.run({ now, state: state[job.name] });
    if (!url) {
      console.log(`- ${job.name} (dry run): ${messages.length} message(s)`);
      for (const m of messages) console.log(JSON.stringify(m, null, 2));
      continue;
    }
    for (const m of messages) await post(url, m);
    state[job.name] = next;
    console.log(`✓ ${job.name}: ${messages.length} message(s)`);
  } catch (err) {
    failed++;
    console.error(`✗ ${job.name}:`, err);
  }
}

if (hooks) writeData('state.json', state);
if (failed) process.exitCode = 1;
