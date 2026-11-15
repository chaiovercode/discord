import { cut, type Embed } from '../lib/discord.ts';
import { readFeed, type FeedItem } from '../lib/feed.ts';
import { dayNumber, istDate, istDay, readData } from '../lib/util.ts';
import type { Job } from './types.ts';

// One fresh read per team from hand-picked engineering blogs (data/feeds.json).

type Source = { name: string; url: string };
type State = { seen: string[] };

const TEAMS = [
  { key: 'frontend', label: 'Frontend', color: 0x00a8fc },
  { key: 'backend', label: 'Backend', color: 0x23a55a },
  { key: 'ai', label: 'AI', color: 0x9b59b6 },
] as const;

const FRESH_DAYS = 7;

async function pick(sources: Source[], today: number, now: Date, seen: string[]) {
  const feeds = await Promise.all(
    sources.map((s) =>
      readFeed(s.url).catch((err: Error) => {
        // One dead blog should not block the post.
        console.warn(`  feed skipped: ${s.name}: ${err.message}`);
        return [] as FeedItem[];
      }),
    ),
  );
  // Start at a different source each day so one prolific blog does not win every time.
  for (let k = 0; k < sources.length; k++) {
    const i = (today + k) % sources.length;
    const fresh = feeds[i]
      .filter((it) => now.getTime() - it.date.getTime() <= FRESH_DAYS * 86_400_000 && !seen.includes(it.url))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
    if (fresh[0]) return { source: sources[i], item: fresh[0] };
  }
  return null;
}

export const resources: Job<State> = {
  name: 'resources',
  webhook: 'resources',
  async run({ now, state }) {
    const seen = state?.seen ?? [];
    const feeds = readData<Record<string, Source[]>>('feeds.json');
    const today = dayNumber(istDate(now));

    const embeds: Embed[] = [];
    const posted: string[] = [];
    for (const team of TEAMS) {
      const found = await pick(feeds[team.key], today, now, seen);
      if (!found) continue;
      posted.push(found.item.url);
      embeds.push({
        author: { name: team.label.toUpperCase() },
        title: cut(found.item.title, 256),
        url: found.item.url,
        ...(found.item.summary ? { description: cut(found.item.summary, 200) } : {}),
        color: team.color,
        footer: { text: `${found.source.name} · ${istDay(found.item.date)}` },
      });
    }
    if (embeds.length === 0) return { messages: [], state: { seen } };

    return {
      messages: [{ username: 'Daily Reads', content: "**Today's reads**", embeds }],
      state: { seen: [...seen, ...posted].slice(-500) },
    };
  },
};
