import { cut } from '../lib/discord.ts';
import { getJson } from '../lib/util.ts';
import type { Job } from './types.ts';

// The highest-voted image post among r/ProgrammerHumor's current hot posts.
// Reddit blocks unauthenticated API calls, so this goes through meme-api.com.

type Meme = { postLink: string; title: string; url: string; nsfw: boolean; spoiler: boolean; ups: number };
type State = { seen: string[] };

const SUBREDDIT = 'ProgrammerHumor';
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

export const memes: Job<State> = {
  name: 'memes',
  webhook: 'memes',
  async run({ state }) {
    const seen = state?.seen ?? [];
    const { memes } = await getJson<{ memes: Meme[] }>(`https://meme-api.com/gimme/${SUBREDDIT}/50`);
    const best = memes
      .filter((m) => !m.nsfw && !m.spoiler && IMAGE.test(m.url) && !seen.includes(m.postLink))
      .sort((a, b) => b.ups - a.ups)[0];
    if (!best) return { messages: [], state: { seen } };

    return {
      messages: [
        {
          username: "Jian-Yang's Memes",
          embeds: [
            {
              title: cut(best.title, 256),
              url: best.postLink,
              image: { url: best.url },
              color: 0xf0b232,
              footer: { text: `r/${SUBREDDIT} · ${best.ups.toLocaleString('en-US')} upvotes` },
            },
          ],
        },
      ],
      state: { seen: [...seen, best.postLink].slice(-200) },
    };
  },
};
