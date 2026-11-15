import { getJson, istDay, istTime } from '../lib/util.ts';
import type { Job } from './types.ts';

// Posts India's next cricket match once, when the next fixture changes.

type Event = {
  idEvent: string;
  strEvent: string;
  strLeague: string;
  strVenue: string | null;
  strTimestamp: string | null; // UTC, no zone suffix
  dateEvent: string;
};
type State = { eventId: string | null };

const INDIA_CRICKET = '137143'; // TheSportsDB team ID
const KEY = process.env.THESPORTSDB_KEY ?? '123'; // TheSportsDB's public free key

export const indiaMatch: Job<State> = {
  name: 'india-match',
  webhook: 'sports',
  async run({ state }) {
    const { events } = await getJson<{ events: Event[] | null }>(
      `https://www.thesportsdb.com/api/v1/json/${KEY}/eventsnext.php?id=${INDIA_CRICKET}`,
    );
    const next = events?.[0];
    if (!next || next.idEvent === state?.eventId) return { messages: [], state: { eventId: state?.eventId ?? null } };

    const start = next.strTimestamp ? new Date(`${next.strTimestamp}Z`) : null;
    const when = start
      ? `${istDay(start)} · ${istTime(start)} IST (<t:${Math.floor(start.getTime() / 1000)}:R>)`
      : istDay(new Date(`${next.dateEvent}T00:00:00Z`));

    return {
      messages: [
        {
          username: "Jared's Match Day",
          content: '**Next India match**',
          embeds: [
            {
              title: next.strEvent.replaceAll(' Cricket', ''),
              color: 0xf23f43,
              fields: [
                { name: 'Series', value: next.strLeague, inline: true },
                { name: 'Venue', value: next.strVenue || 'To be announced', inline: true },
                { name: 'When', value: when, inline: true },
              ],
            },
          ],
        },
      ],
      state: { eventId: next.idEvent },
    };
  },
};
