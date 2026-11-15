// Minimal Discord webhook client. Only the fields these bots use.

export type Embed = {
  author?: { name: string };
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  image?: { url: string };
  thumbnail?: { url: string };
  footer?: { text: string };
  fields?: { name: string; value: string; inline?: boolean }[];
};

export type Message = {
  username: string;
  content?: string;
  embeds?: Embed[];
};

export const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// One env var per channel: DISCORD_WEBHOOK_MEMES -> "memes". Empty ones are ignored
// (GitHub passes an unset secret as ""). A job whose webhook is missing is switched off.
// None set means dry run.
export function webhooks(): Record<string, string> | null {
  const hooks = Object.fromEntries(
    Object.entries(process.env)
      .filter(([k, v]) => k.startsWith('DISCORD_WEBHOOK_') && v)
      .map(([k, v]) => [k.slice('DISCORD_WEBHOOK_'.length).toLowerCase(), v as string]),
  );
  return Object.keys(hooks).length ? hooks : null;
}

export async function post(webhook: string, msg: Message): Promise<void> {
  // Content comes from feeds; never let it ping anyone.
  const body = { ...msg, allowed_mentions: { parse: [] } };
  const res = await fetch(`${webhook}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Discord webhook ${res.status}: ${await res.text()}`);
}
