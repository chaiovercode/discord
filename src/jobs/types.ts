import type { Message } from '../lib/discord.ts';

export type JobResult<S> = {
  messages: Message[];
  // Saved to data/state.json only after every message posted.
  state: S;
};

export type Job<S = unknown> = {
  name: string;
  // Key in DISCORD_WEBHOOKS. Several jobs can share one channel.
  webhook: string;
  run(ctx: { now: Date; state: S | undefined }): Promise<JobResult<S>>;
};
