import type { Embed } from '../lib/discord.ts';
import { dayNumber, getJson, istDate, istDay, readData } from '../lib/util.ts';
import type { Job } from './types.ts';

// Announces each film in data/movies.json 30 days before release, 7 days before, and on the day.
// Release dates come from the film's Wikipedia infobox, so they follow date changes without edits here.

const MILESTONES = [30, 7, 0];

// Film title -> milestones already announced, so a missed run still catches up.
type State = Record<string, number[]>;

type Parse = { parse?: { title: string; wikitext: { '*': string } } };
type Summary = { thumbnail?: { source: string }; content_urls: { desktop: { page: string } } };

const WIKI = 'https://en.wikipedia.org';

// Reads `released = {{Film date|2026|12|18|India|...}}`. Prefers an India date, else the first full date.
function releaseDate(wikitext: string): string | null {
  const field = /\|\s*released\s*=([\s\S]*?)\n\s*\|/.exec(wikitext.replace(/<!--[\s\S]*?-->/g, ''))?.[1];
  if (!field) return null;
  const dates: { date: string; place: string }[] = [];
  for (const [, args] of field.matchAll(/\{\{\s*[Ff]ilm date\s*\|([^{}]*)\}\}/g)) {
    const p = args.split('|').map((s) => s.trim()).filter((s) => !s.includes('='));
    for (let i = 0; i + 2 < p.length; i++) {
      if (!/^\d{4}$/.test(p[i]) || !/^\d{1,2}$/.test(p[i + 1]) || !/^\d{1,2}$/.test(p[i + 2])) continue;
      const place = p[i + 3] && !/^\d/.test(p[i + 3]) ? p[i + 3] : '';
      dates.push({ date: `${p[i]}-${p[i + 1].padStart(2, '0')}-${p[i + 2].padStart(2, '0')}`, place });
      i += 2;
    }
  }
  return (dates.find((d) => /India/.test(d.place)) ?? dates[0])?.date ?? null;
}

export const movies: Job<State> = {
  name: 'movies',
  webhook: 'sports',
  async run({ now, state }) {
    const announced: State = { ...state };
    const today = dayNumber(istDate(now));
    const due = new Map<number, Embed[]>(); // days left -> films

    // Sequential on purpose: Wikipedia rate-limits bursts.
    for (const title of readData<string[]>('movies.json')) {
      const page = await getJson<Parse>(
        `${WIKI}/w/api.php?action=parse&format=json&redirects=1&prop=wikitext&section=0&page=${encodeURIComponent(title)}`,
      );
      const date = page.parse && releaseDate(page.parse.wikitext['*']);
      if (!date) {
        console.log(`  ${title}: no page or release date yet`);
        continue;
      }
      const left = dayNumber(date) - today;
      const done = announced[title] ?? [];
      const crossed = MILESTONES.filter((m) => left <= m && left >= 0 && !done.includes(m));
      if (crossed.length === 0) continue;

      const summary = await getJson<Summary>(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(page.parse!.title)}`);
      due.set(left, [
        ...(due.get(left) ?? []),
        {
          title: page.parse!.title.replace(/ \((\d{4} )?film\)$/, ''), // "King (2026 film)" -> "King"
          url: summary.content_urls.desktop.page,
          color: 0x9b59b6,
          fields: [{ name: 'In cinemas', value: istDay(new Date(`${date}T00:00:00Z`), true) }],
          ...(summary.thumbnail ? { thumbnail: { url: summary.thumbnail.source } } : {}),
          footer: { text: 'Wikipedia' },
        },
      ]);
      announced[title] = [...done, ...crossed];
    }

    const messages = [...due].map(([left, embeds]) => ({
      username: "Erlich's Premieres",
      content: `**In cinemas ${left === 0 ? 'today' : `in ${left} days`}**`,
      embeds: embeds.slice(0, 10),
    }));
    return { messages, state: announced };
  },
};
