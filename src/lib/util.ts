import { readFileSync, writeFileSync } from 'node:fs';

const DATA = new URL('../../data/', import.meta.url);

export function readData<T>(file: string): T {
  return JSON.parse(readFileSync(new URL(file, DATA), 'utf8')) as T;
}

export function writeData(file: string, value: unknown): void {
  writeFileSync(new URL(file, DATA), `${JSON.stringify(value, null, 2)}\n`);
}

// Wikimedia asks API clients to identify themselves with a contact URL.
const USER_AGENT = 'chaiovercode-discord/1.0 (https://github.com/chaiovercode/discord)';

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

export const getJson = async <T>(url: string): Promise<T> => (await (await get(url)).json()) as T;
export const getText = async (url: string): Promise<string> => (await get(url)).text();

// Calendar helpers. The server lives in IST.
export const IST = 'Asia/Kolkata';

// YYYY-MM-DD for the given instant in IST.
export const istDate = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// Days since 1970-01-01 for a YYYY-MM-DD date.
export const dayNumber = (isoDate: string) => Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000);

// "Sun, 15 Nov" style dates, read in IST.
export const istDay = (d: Date, withYear = false) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  }).format(d);

export const istTime = (d: Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: IST, hour: 'numeric', minute: '2-digit' }).format(d);
