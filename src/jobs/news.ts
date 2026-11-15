import { cut, type Embed, type Message } from '../lib/discord.ts';
import { readFeed } from '../lib/feed.ts';
import { askJson } from '../lib/llm.ts';
import { getText, istDate, readData, urlKey } from '../lib/util.ts';
import type { Job } from './types.ts';

// Gilfoyle's Briefing: the top 5 stories in AI and tech and the top 5 in the world, from the last day of
// headlines in data/news.json. An LLM editor merges duplicates across outlets, ranks by importance and
// rewrites each headline with a one-line dek.

type Desk = 'tech' | 'world';
type Candidate = { title: string; url: string; source: string; summary: string };
type Story = { id: number; headline: string; dek: string };
type State = { seen: string[]; headlines: string[] };

const DESKS: { key: Desk; heading: string; brief: string }[] = [
  {
    key: 'tech',
    heading: 'Top 5 in AI and tech',
    brief:
      'AI and tech. Weigh model and product releases that change what people can do, moves by major tech companies, regulation, security breaches and outages, and research results. Skip deals and coupons, product reviews, how-tos, gadget rumours and opinion columns.',
  },
  {
    key: 'world',
    heading: 'Top 5 in the world',
    brief:
      'World news, read by Indians: include major India stories alongside global ones. Weigh conflicts, diplomacy, elections, the economy, disasters and decisions that affect many people. Skip celebrity, sport, lifestyle and opinion columns.',
  },
];

const WINDOW_HOURS = 24;
const PER_FEED = 8; // newest items per feed, so a busy feed cannot crowd out the rest
const TOP = 5;

const system = (brief: string, covered: string[]) => `You are Gilfoyle, editing the morning news briefing for a Discord server of software engineers in India.

Section: ${brief}

From the candidate headlines of the last day, pick the ${TOP} most important stories, most important first.
- Several outlets often report the same story. Count it once and pick the clearest report.
- Prefer stories with new facts over analysis of old ones.
${covered.length ? `- Yesterday's briefing already covered these. Pick them again only if there is a major new development:\n${covered.map((h) => `  - ${h}`).join('\n')}\n` : ''}
For each story write:
- "headline": at most 60 characters, plain and factual, no clickbait, no question.
- "dek": one sentence, at most 90 characters, adding the key fact the headline leaves out.
Dry and precise. No hype words, no emojis, no jokes about deaths or disasters.

Return JSON: {"stories": [{"id": number, "headline": string, "dek": string}]}`;

async function candidates(desk: Desk, now: Date, seen: Set<string>): Promise<Candidate[]> {
  const sources = readData<Record<Desk, { name: string; url: string }[]>>('news.json')[desk];
  const feeds = await Promise.all(
    sources.map(async (s) =>
      (
        await readFeed(s.url).catch((err: Error) => {
          // One dead outlet should not block the briefing.
          console.warn(`  skipped ${s.url}: ${err.message}`);
          return [];
        })
      )
        .filter((i) => now.getTime() - i.date.getTime() <= WINDOW_HOURS * 3_600_000)
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, PER_FEED)
        .map((i) => ({ title: i.title, url: i.url, source: s.name, summary: i.summary })),
    ),
  );
  const byUrl = new Map<string, Candidate>();
  for (const c of feeds.flat()) if (!seen.has(urlKey(c.url)) && !byUrl.has(urlKey(c.url))) byUrl.set(urlKey(c.url), c);
  return [...byUrl.values()];
}

// The article's share image, if its page declares one.
async function ogImage(url: string): Promise<string | null> {
  const html = await getText(url).catch(() => '');
  const tag = /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/i.exec(html)?.[0];
  const src = tag && /content=["']([^"']+)["']/i.exec(tag)?.[1];
  return src?.startsWith('http') ? src.replaceAll('&amp;', '&') : null;
}

export const news: Job<State> = {
  name: 'news',
  webhook: 'news',
  async run({ now, state }) {
    const seen = state?.seen ?? [];
    const covered = state?.headlines ?? [];
    const seenKeys = new Set(seen.map(urlKey));
    const messages: Message[] = [];
    const posted: string[] = [];
    const headlines: string[] = [];

    for (const desk of DESKS) {
      const pool = await candidates(desk.key, now, seenKeys);
      if (pool.length === 0) continue;
      const list = pool.map((c, i) => [`${i}. ${c.title}`, c.source, c.summary && cut(c.summary, 80)].filter(Boolean).join(' | '));
      const { stories = [] } = await askJson<{ stories?: Story[] }>(system(desk.brief, covered), list.join('\n'));

      const picked = stories
        .filter((s, i, all) => Number.isInteger(s.id) && pool[s.id] && all.findIndex((t) => t.id === s.id) === i)
        .slice(0, TOP);
      if (picked.length === 0) continue;

      const embeds: Embed[] = await Promise.all(
        picked.map(async (s) => {
          const c = pool[s.id];
          const image = await ogImage(c.url);
          return {
            title: cut(s.headline || c.title, 256),
            url: c.url,
            description: cut(s.dek, 300),
            color: 0xf4ecd8, // newsprint
            footer: { text: c.source },
            ...(image ? { thumbnail: { url: image } } : {}),
          };
        }),
      );
      messages.push({ username: "Gilfoyle's Briefing", content: `**${desk.heading}, ${istDate(now)}**`, embeds });
      posted.push(...picked.map((s) => pool[s.id].url));
      headlines.push(...picked.map((s) => s.headline));
    }

    return {
      messages,
      state: { seen: [...seen, ...posted].slice(-300), headlines: headlines.length ? headlines : covered },
    };
  },
};
