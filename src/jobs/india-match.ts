import tzLookup from '@photostructure/tz-lookup';
import type { Embed } from '../lib/discord.ts';
import { dayNumber, getJson, istDate, istDay, istTime } from '../lib/util.ts';
import { plain, templates } from '../lib/wikitext.ts';
import type { Job } from './types.ts';

// India men's results and next fixture, read from Wikipedia: India's bilateral series pages and the
// pages of multi-team tournaments (World Cup, Asia Cup, Champions Trophy, tri-series).
// Fans update those pages within hours of a match, with scores and player of the match.

type Match = {
  id: string; // page title # section heading
  label: string; // "5th ODI", "Group A"
  page: string;
  teams: [string, string];
  start: string; // YYYY-MM-DD, local to the venue
  end: string;
  time: string; // raw wikitext of the start time, may be empty
  venue: string; // raw wikitext, keeps the links for the time zone lookup
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
  OMA: 'Oman', NAM: 'Namibia', CAN: 'Canada', JPN: 'Japan', HK: 'Hong Kong', ITA: 'Italy', WIN: 'West Indies',
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const BILATERAL = /^Indian cricket team (in|against) | cricket team in India in /;
const TOURNAMENT = /World Cup|Asia Cup|Champions Trophy|World Test Championship|Tri-Nation|Tri-Series|Quadrangular|Asian Games|Commonwealth Games/i;
const NOT_INDIA_MEN = /women|\bA cricket team|under-19|U19|qualif|Challenge League|League 2|Sub-regional|squads|statistics|records/i;
// Tournament sub-pages that hold matches, e.g. "2027 Cricket World Cup group stage", "... final".
const STAGE = /group|stage|super|knockout|final|round|play-?off/i;

const api = <T>(params: Record<string, string>) =>
  getJson<T>(`${WIKI}/w/api.php?${new URLSearchParams({ format: 'json', redirects: '1', ...params })}`);

// "15 November 2026", "19–23 November 2026", "29 November – 3 December 2026", "{{start date|2026|02|04}}"
// -> first and last day.
function dateRange(raw: string): { start: string; end: string } | null {
  const text = plain(
    raw.replace(/\{\{\s*[Ss]tart date\s*\|([^{}]*)\}\}/g, (_, args: string) => {
      const [y, m, d] = args.split('|').map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
      return d ? `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}` : '';
    }),
  );
  const days: { d: number; m?: number; y?: number }[] = [];
  for (const tok of text.match(/\d{4}|\d{1,2}|[A-Z][a-z]+/g) ?? []) {
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

// UTC offset in ms of a time zone at an instant.
function tzOffset(tz: string, at: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(at)).map((x) => [x.type, x.value]),
  );
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - at;
}

// The match's start as an instant. Uses the offset written in the page ({{UTZ|19:00|+5:30}}) when there is one,
// else the time zone at the venue's coordinates. Null when the page has no start time.
async function startInstant(m: Match): Promise<Date | null> {
  const hm = /(\d{1,2}):(\d{2})/.exec(m.time);
  if (!hm) return null;
  const [y, mo, d] = m.start.split('-').map(Number);
  const wall = Date.UTC(y, mo - 1, d, Number(hm[1]), Number(hm[2]));

  const utz = /UTZ\s*\|[^|]*\|\s*([+−-])\s*(\d{1,2})(?::(\d{2}))?/.exec(m.time);
  if (utz) {
    const minutes = (Number(utz[2]) * 60 + Number(utz[3] ?? 0)) * (utz[1] === '+' ? 1 : -1);
    return new Date(wall - minutes * 60_000);
  }

  // Venue first, then its city: "[[Bay Oval]], [[Mount Maunganui]]".
  for (const [, title] of m.venue.matchAll(/\[\[([^|\]]+)/g)) {
    const res = await api<{ query?: { pages?: Record<string, { coordinates?: { lat: number; lon: number }[] }> } }>({
      action: 'query', prop: 'coordinates', titles: title,
    });
    const c = Object.values(res.query?.pages ?? {})[0]?.coordinates?.[0];
    if (!c) continue;
    const tz = tzLookup(c.lat, c.lon);
    // Local wall time minus the zone's offset; the second pass settles DST edges.
    return new Date(wall - tzOffset(tz, wall - tzOffset(tz, wall)));
  }
  return null;
}

// India's bilateral series pages plus tournament pages (and their stage sub-pages) around today.
async function pages(year: number): Promise<string[]> {
  const seasons = [`${year - 1}–${String(year).slice(2)}`, `${year}`, `${year}–${String(year + 1).slice(2)}`, `${year + 1}`];
  const out: string[] = [];
  for (const season of seasons) {
    const res = await api<{ query: { categorymembers: { title: string; ns: number }[] } }>({
      action: 'query', list: 'categorymembers', cmlimit: '500', cmnamespace: '0',
      cmtitle: `Category:International cricket competitions in ${season}`,
    });
    for (const { title } of res.query.categorymembers) {
      if (NOT_INDIA_MEN.test(title) || out.includes(title)) continue;
      if (BILATERAL.test(title)) out.push(title);
      else if (TOURNAMENT.test(title)) {
        out.push(title);
        const links = await api<{ query: { pages: Record<string, { links?: { title: string }[] }> } }>({
          action: 'query', prop: 'links', plnamespace: '0', pllimit: 'max', titles: title,
        });
        for (const l of Object.values(links.query.pages)[0]?.links ?? []) {
          const rest = l.title.startsWith(`${title} `) ? l.title.slice(title.length + 1) : '';
          if (rest && STAGE.test(rest) && !NOT_INDIA_MEN.test(rest) && !out.includes(l.title)) out.push(l.title);
        }
      }
    }
  }
  return out;
}

async function matches(page: string): Promise<Match[]> {
  const res = await api<{ parse?: { wikitext: { '*': string } } }>({ action: 'parse', prop: 'wikitext', page });
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
      time: p.time ?? '',
      venue: p.venue ?? '',
      result: plain(p.result ?? ''),
      scores: [inns(1), inns(2)],
      motm: plain(p.motm ?? ''),
    });
  }
  return out;
}

const title = (m: Match) => `${m.label} · ${m.teams[0]} vs ${m.teams[1]}`;
const pageUrl = (page: string) => `${WIKI}/wiki/${encodeURIComponent(page.replaceAll(' ', '_'))}`;

function resultEmbed(m: Match): Embed {
  const color = /^India won/.test(m.result) ? 0x23a55a : / won /.test(m.result) ? 0xf23f43 : 0x80848e;
  return {
    author: { name: 'RESULT' },
    title: title(m),
    url: pageUrl(m.page),
    description: `**${m.result}**`,
    color,
    fields: [
      ...m.teams.map((t, i) => ({ name: t, value: m.scores[i] || 'Did not bat', inline: true })),
      ...(m.motm ? [{ name: 'Player of the match', value: m.motm }] : []),
    ],
    footer: { text: `${plain(m.venue)} · ${istDay(new Date(`${m.end}T00:00:00Z`))}` },
  };
}

async function nextEmbed(m: Match): Promise<Embed> {
  const start = await startInstant(m);
  const day = (iso: string) => istDay(new Date(`${iso}T00:00:00Z`));
  // With a start time, the IST date can differ from the venue's date (NZ mornings are the previous evening in India).
  const first = start ? istDay(start) : day(m.start);
  const days = m.start === m.end ? first : `${first} – ${day(m.end)}`;
  const when = start ? `${days} · ${istTime(start)} IST (<t:${Math.floor(start.getTime() / 1000)}:R>)` : days;
  return {
    author: { name: 'NEXT MATCH' },
    title: title(m),
    url: pageUrl(m.page),
    color: 0x5865f2,
    fields: [
      { name: 'Venue', value: plain(m.venue) || 'To be announced', inline: true },
      { name: 'When', value: when, inline: true },
    ],
  };
}

export const indiaMatch: Job<State> = {
  name: 'india-match',
  webhook: 'sports',
  async run({ now, state }) {
    const posted = state?.posted ?? [];
    const today = dayNumber(istDate(now));

    // Sequential on purpose: Wikipedia rate-limits bursts. A tournament can list a match on two pages,
    // so keep one per date and pair of teams.
    const byFixture = new Map<string, Match>();
    for (const page of await pages(Number(istDate(now).slice(0, 4)))) {
      for (const m of await matches(page)) {
        const key = `${m.start}|${[...m.teams].sort().join('|')}`;
        if (!byFixture.has(key) || (m.result && !byFixture.get(key)!.result)) byFixture.set(key, m);
      }
    }
    const all = [...byFixture.values()];

    const results = all
      // Started (the venue's date can run a day ahead of IST) and finished within RESULT_DAYS. A Test can end
      // before its scheduled last day, so the end date alone is not enough.
      .filter((m) => m.result && !posted.includes(m.id) && dayNumber(m.start) <= today + 1 && today - dayNumber(m.end) <= RESULT_DAYS)
      .sort((a, b) => a.start.localeCompare(b.start));
    const next = all
      .filter((m) => !m.result && dayNumber(m.end) >= today)
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    const announceNext = next && next.id !== state?.nextId;

    const embeds = [...results.map(resultEmbed), ...(announceNext ? [await nextEmbed(next)] : [])].slice(0, 10);
    return {
      messages: embeds.length ? [{ username: "Russ's Match Day", embeds }] : [],
      state: { posted: [...posted, ...results.map((m) => m.id)].slice(-200), nextId: next?.id ?? state?.nextId ?? null },
    };
  },
};
