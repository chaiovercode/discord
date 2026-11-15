import { setTimeout as sleep } from 'node:timers/promises';

// One JSON-mode chat call to Groq, the same provider and model the chai newsroom uses.

const MODEL = 'openai/gpt-oss-120b';

export async function askJson<T>(system: string, user: string): Promise<T> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        reasoning_effort: 'medium',
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.status === 429) {
      // Free-tier limits are per minute.
      console.warn('  groq 429, waiting 30s');
      await sleep(30_000);
      continue;
    }
    if (!res.ok) throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return JSON.parse(data.choices?.[0]?.message?.content || '{}') as T;
  }
  throw new Error('groq rate limit did not clear');
}
