import type { Embed } from '../lib/discord.ts';
import { dayNumber, getJson, istDate, istDay } from '../lib/util.ts';
import { plain, templates } from '../lib/wikitext.ts';
import type { Job } from './types.ts';

// India men's results and next fixture, read from the Wikipedia pages of India's series.
// Fans update those pages within hours of a match, with scores and player of the match.

type Match = {
  id: string; // page title # section heading
  label: string; // "5th ODI"
  page: string;
  teams: [string, string];
  start: string; // YYYY-MM-DD
  end: string;
  time: string; // local start time, may be empty
  venue: string;
  result: string;
  scores: [string, string];
  motm: string;
};
type State = { posted?: string[]; nextId?: string | null };

const WIKI = 'https://en.wikipedia.org';
const RESULT_DAYS = 1; // post results at most a day after the match, so a first run does not dump old ones

const TEAMS: Record<string, string> = {
  IND: 'India', NZ: 'New Zealand', AUS: 'Australia', ENG: 'England', SA: 'South Africa', PAK: 'Pakistan',
  SL: 'Sri Lanka', BAN: 'Bangladesh', WI: 'West Indies', AFG: 'Afghanistan', ZIM: 'Zimbabwe', IRE: 'Ireland',
  SCO: 'Scotland', NED: 'Netherlands', NEP: 'Nepal', UAE: 'United Arab Emirates', USA: 'United States',
  OMA: 'Oman', NAM: 'Namibia', CAN: 'Canada', JPN: 'Japan',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "15 November 2026", "19–23 November 2026", "29 November – 3 December 2026" -> first and last day.
function dateRange(raw: string): { start: string; end: string } | null {
  const days: { d: number; m?: number; y?: number }[] = [];
  for (const tok of plain(raw).match(/\d{4}|\d{1,2}|[A-Z][a-z]+/g) ?? []) {
    if (/^\d{4}$/.test(tok)) days.filter((x) => x.y === undefined).forEach((x) => (x.y = Number(tok)));
    else if (/^\d+$/.test(tok)) days.push({ d: Number(tok) });
    else if (MONTHS.includes(tok)) days.filter((x) => x.m === undefined).forEach((x) => (x.m = MONTHS.indexOf(tok) + 1));
  }
  const iso = (x: (typeof days)[number]) =>
    x.m && x.y ? `${x.y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}` : null;
  const start = days[0] && iso(days[0]);
  const end = days.length ? iso(days[days.length - 1]) : null;
  return start && end ? { start, end } : null;
}

// India's men's series pages, from Wikipedia's season categories around today.
async function seriesPages(year: number): Promise<string[]> {
  const seasons = [`${year - 1}–${String(year).slice(2)}`, `${year}`, `${year}–${String(year + 1).slice(2)}`, `${year + 1}`];
  const titles: string[] = [];
  for (const season of seasons) {
    const res = await getJson<{ query: { categorymembers: { title: string }[] } }>(
      `${WIKI}/w/api.php?action=query&format=json&list=categorymembers&cmlimit=500&cmtitle=${encodeURIComponent(`Category:International cricket competitions in ${season}`)}`,
    );
    titles.push(
      ...res.query.categorymembers
        .map((m) => m.title)
        .filter((t) => /^Indian cricket team (in|against) | cricket team in India in /.test(t))
        .filter((t) => !/women|\bA cricket team|under-19/i.test(t)),
    );
  }
  return [...new Set(titles)];
}

async function matches(page: string): Promise<Match[]> {
  const res = await getJson<{ parse?: { wikitext: { '*': string } } }>(
    `${WIKI}/w/api.php?action=parse&format=json&prop=wikitext&redirects=1&page=${encodeURIComponent(page)}`,
  );
  if (!res.parse) return [];
  const out: Match[] = [];
  for (const { heading, params: p } of templates(res.parse.wikitext['*'], /Single-innings cricket match|Two-innings cricket match/)) {
    const codes = [p.team1, p.team2].map((t) => /\{\{\s*cr(?:-rt)?\s*\|\s*([A-Z]+)/.exec(t ?? '')?.[1] ?? '');
    const dates = dateRange(p.date ?? '');
    if (!codes.includes('IND') || !dates) continue;
    const inns = (team: 1 | 2) =>
      plain(p[`score${team}`] ?? [p[`score-team${team}-inns1`], p[`score-team${team}-inns2`]].filter((s) => s && plain(s)).join(' & '));
    out.push({
      id: `${page}#${heading}`,
      label: plain(heading),
      page,
      teams: [TEAMS[codes[0]] ?? codes[0], TEAMS[codes[1]] ?? codes[1]],
      ...dates,
      time: plain(p.time ?? ''),
      venue: plain(p.venue ?? ''),
      result: plain(p.result ?? ''),
      scores: [inns(1), inns(2)],
      motm: plain(p.motm ?? ''),
    });
  }
  return out;
}

const title = (m: Match) => `${m.label} · ${m.teams[0]} vs ${m.teams[1]}`;

function resultEmbed(m: Match): Embed {
  const color = /^India won/.test(m.result) ? 0x23a55a : / won /.test(m.result) ? 0xf23f43 : 0x80848e;
  return {
    author: { name: 'RESULT' },
    title: title(m),
    url: `${WIKI}/wiki/${encodeURIComponent(m.page.replaceAll(' ', '_'))}`,
    description: `**${m.result}**`,
    color,
    fields: [
      ...m.teams.map((t, i) => ({ name: t, value: m.scores[i] || 'Did not bat', inline: true })),
      ...(m.motm ? [{ name: 'Player of the match', value: m.motm }] : []),
    ],
    footer: { text: `${m.venue} · ${istDay(new Date(`${m.end}T00:00:00Z`))}` },
  };
}

function nextEmbed(m: Match): Embed {
  const first = istDay(new Date(`${m.start}T00:00:00Z`));
  const days = m.start === m.end ? first : `${first} – ${istDay(new Date(`${m.end}T00:00:00Z`))}`;
  return {
    author: { name: 'NEXT MATCH' },
    title: title(m),
    url: `${WIKI}/wiki/${encodeURIComponent(m.page.replaceAll(' ', '_'))}`,
    color: 0x5865f2,
    fields: [
      { name: 'Venue', value: m.venue || 'To be announced', inline: true },
      { name: 'When', value: m.time ? `${days} · ${m.time} local time` : days, inline: true },
    ],
  };
}

export const indiaMatch: Job<State> = {
  name: 'india-match',
  webhook: 'sports',
  async run({ now, state }) {
    const posted = state?.posted ?? [];
    const today = dayNumber(istDate(now));

    // Sequential on purpose: Wikipedia rate-limits bursts.
    const all: Match[] = [];
    for (const page of await seriesPages(Number(istDate(now).slice(0, 4)))) all.push(...(await matches(page)));

    const results = all
      .filter((m) => m.result && !posted.includes(m.id) && today - dayNumber(m.end) <= RESULT_DAYS)
      .sort((a, b) => a.start.localeCompare(b.start));
    const next = all
      .filter((m) => !m.result && dayNumber(m.end) >= today)
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    const announceNext = next && next.id !== state?.nextId;

    const embeds = [...results.map(resultEmbed), ...(announceNext ? [nextEmbed(next)] : [])].slice(0, 10);
    return {
      messages: embeds.length ? [{ username: "Russ's Match Day", embeds }] : [],
      state: { posted: [...posted, ...results.map((m) => m.id)].slice(-200), nextId: next?.id ?? state?.nextId ?? null },
    };
  },
};
