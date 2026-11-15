import { cut, type Embed } from '../lib/discord.ts';
import { plain, readFeed } from '../lib/feed.ts';
import { askJson } from '../lib/llm.ts';
import { getJson, getText, istDay, readData } from '../lib/util.ts';
import type { Job } from './types.ts';

// Richard's Reading List: at most one article a day each for frontend, backend and AI.
// Candidates come from hand-picked engineering blogs (data/feeds.json), well-voted Lobsters
// stories and big Hacker News stories. An LLM editor keeps only pieces worth reading in six
// months and says why. A team gets nothing on a day with no strong candidate.

type Team = 'frontend' | 'backend' | 'ai';
type Candidate = { team: Team | null; title: string; url: string; source: string; date: Date; summary: string; votes: string[] };
type Pick = { id: number; why: string } | null;
type State = { seen: string[] };

const TEAMS: { key: Team; label: string; color: number; lobsters: string }[] = [
  { key: 'frontend', label: 'Frontend', color: 0x00a8fc, lobsters: 'web,css,javascript,browsers,a11y' },
  { key: 'backend', label: 'Backend', color: 0x23a55a, lobsters: 'distributed,databases,performance,scaling,networking,devops,api' },
  { key: 'ai', label: 'AI', color: 0x9b59b6, lobsters: 'ai' },
];

const POOL_DAYS = 14; // many of the best blogs post monthly
const PER_FEED = 2; // newest posts per blog, so one prolific blog cannot flood the pool
const LOBSTERS_MIN_SCORE = 20;
const HN_MIN_POINTS = 300;
const HN_DAYS = 7;

const SYSTEM = `You are the editor of Richard's Reading List: one article a day each for a product team's frontend, backend and AI engineers.

The bar: a senior engineer would bookmark it and still be glad they read it six months from now. Good picks teach something concrete: a technique, a deep explanation of how something works, a postmortem, a careful benchmark, a hard-won lesson from production, a well-argued design essay.

Reject: news, announcements, product launches, release notes, funding, company drama, hiring, beginner tutorials, listicles, marketing, link roundups, podcasts, videos, and opinion pieces without technical substance.

Prefer original writing by practitioners. Votes are a signal, not the decision.
Hacker News candidates have no team. Give one to a team only if it clearly fits.
Pick at most one per team and never the same article twice. If nothing clears the bar for a team, use null: an empty slot is better than a weak pick.

For each pick write "why": one sentence, at most 25 words, plain words, saying what the reader will learn or be able to do. No hype words.

Return JSON: {"frontend": {"id": number, "why": string} | null, "backend": {"id": number, "why": string} | null, "ai": {"id": number, "why": string} | null}`;

// Same article despite tracking params, "www." or a trailing slash.
function urlKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch {
    return url;
  }
}

const host = (url: string) => new URL(url).host.replace(/^www\./, '');

async function gather(now: Date, seen: Set<string>): Promise<Candidate[]> {
  const ageOk = (d: Date, days: number) => now.getTime() - d.getTime() <= days * 86_400_000;
  // A dead source should not block the post.
  const warn = (what: string) => (err: Error) => {
    console.warn(`  skipped ${what}: ${err.message}`);
    return [];
  };

  const feeds = readData<Record<Team, { name: string; url: string }[]>>('feeds.json');
  const fromFeeds = await Promise.all(
    TEAMS.flatMap((t) =>
      feeds[t.key].map(async (s): Promise<Candidate[]> =>
        (await readFeed(s.url).catch(warn(s.name)))
          .filter((i) => ageOk(i.date, POOL_DAYS))
          .sort((a, b) => b.date.getTime() - a.date.getTime())
          .slice(0, PER_FEED)
          .map((i) => ({ team: t.key, title: i.title, url: i.url, source: s.name, date: i.date, summary: i.summary, votes: [] })),
      ),
    ),
  );

  type Lobster = { title: string; url: string; score: number; created_at: string };
  const fromLobsters = await Promise.all(
    TEAMS.map(async (t): Promise<Candidate[]> =>
      (await getJson<Lobster[]>(`https://lobste.rs/t/${t.lobsters}.json`).catch(warn(`Lobsters ${t.key}`)))
        .filter((s) => s.url && s.score >= LOBSTERS_MIN_SCORE && ageOk(new Date(s.created_at), POOL_DAYS))
        .map((s) => ({
          team: t.key,
          title: s.title,
          url: s.url,
          source: host(s.url),
          date: new Date(s.created_at),
          summary: '',
          votes: [`${s.score} votes on Lobsters`],
        })),
    ),
  );

  type Hit = { title: string; url: string | null; points: number; created_at: string };
  const since = Math.floor(now.getTime() / 1000) - HN_DAYS * 86_400;
  const hn = await getJson<{ hits: Hit[] }>(
    `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=100&numericFilters=${encodeURIComponent(`created_at_i>${since},points>=${HN_MIN_POINTS}`)}`,
  ).catch((err: Error) => ({ hits: warn('Hacker News')(err) as Hit[] }));
  const fromHn: Candidate[] = hn.hits
    .filter((h): h is Hit & { url: string } => !!h.url)
    .map((h) => ({ team: null, title: h.title, url: h.url, source: host(h.url), date: new Date(h.created_at), summary: '', votes: [`${h.points} points on HN`] }));

  // Blogs first, so a blog post that is also on Lobsters or HN keeps its team and gains the votes.
  const byUrl = new Map<string, Candidate>();
  for (const c of [...fromFeeds.flat(), ...fromLobsters.flat(), ...fromHn]) {
    const k = urlKey(c.url);
    if (seen.has(k)) continue;
    const prev = byUrl.get(k);
    if (prev) prev.votes.push(...c.votes);
    else byUrl.set(k, c);
  }
  return [...byUrl.values()];
}

function editorInput(pool: Candidate[]): string {
  const line = (c: Candidate) =>
    [`${pool.indexOf(c)}. ${c.title}`, c.source, c.summary && cut(c.summary, 100), c.votes.join(', ')].filter(Boolean).join(' | ');
  const sections = [
    ...TEAMS.map((t) => ({ heading: `${t.label.toUpperCase()} CANDIDATES`, items: pool.filter((c) => c.team === t.key) })),
    { heading: 'HACKER NEWS (no team)', items: pool.filter((c) => c.team === null) },
  ];
  return sections.map((s) => `${s.heading}\n${s.items.map(line).join('\n') || '(none)'}`).join('\n\n');
}

// Minutes at 230 words a minute, or null when the page is not readable without JavaScript or a login.
async function readingMinutes(url: string): Promise<number | null> {
  const html = await getText(url).catch(() => '');
  const text = plain(html.replace(/<(script|style|noscript|svg|nav|header|footer)[\s\S]*?<\/\1>/gi, ' '));
  const words = text.split(' ').length;
  return words >= 300 ? Math.max(1, Math.round(words / 230)) : null;
}

async function hnThread(url: string): Promise<string | null> {
  type Hit = { objectID: string; points: number; num_comments: number };
  const { hits } = await getJson<{ hits: Hit[] }>(
    `https://hn.algolia.com/api/v1/search?tags=story&restrictSearchableAttributes=url&query=${encodeURIComponent(url)}`,
  ).catch(() => ({ hits: [] as Hit[] }));
  const top = hits.sort((a, b) => b.points - a.points)[0];
  return top && top.points >= 10
    ? `[${top.points} points · ${top.num_comments} comments on Hacker News](https://news.ycombinator.com/item?id=${top.objectID})`
    : null;
}

export const resources: Job<State> = {
  name: 'resources',
  webhook: 'resources',
  async run({ now, state }) {
    const seen = state?.seen ?? [];
    const pool = await gather(now, new Set(seen.map(urlKey)));
    if (pool.length === 0) return { messages: [], state: { seen } };

    const picks = await askJson<Record<Team, Pick>>(SYSTEM, editorInput(pool));
    const embeds: Embed[] = [];
    const posted: string[] = [];
    for (const team of TEAMS) {
      const pick = picks[team.key];
      const c = pick && Number.isInteger(pick.id) ? pool[pick.id] : undefined;
      if (!pick || !c || posted.includes(c.url)) continue;
      posted.push(c.url);
      const [minutes, thread] = await Promise.all([readingMinutes(c.url), hnThread(c.url)]);
      embeds.push({
        author: { name: team.label.toUpperCase() },
        title: cut(c.title, 256),
        url: c.url,
        description: [cut(pick.why, 300), thread].filter(Boolean).join('\n\n'),
        color: team.color,
        footer: { text: [c.source, minutes && `${minutes} min read`, istDay(c.date)].filter(Boolean).join(' · ') },
      });
    }
    if (embeds.length === 0) return { messages: [], state: { seen } };

    return {
      messages: [{ username: "Richard's Reading List", content: "**Today's reads**", embeds }],
      state: { seen: [...seen, ...posted].slice(-500) },
    };
  },
};
