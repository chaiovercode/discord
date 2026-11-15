import { XMLParser } from 'fast-xml-parser';
import { getText } from './util.ts';

// Reads RSS 2.0 and Atom feeds into one shape.

export type FeedItem = { title: string; url: string; date: Date; summary: string };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  htmlEntities: true,
  isArray: (name) => name === 'item' || name === 'entry' || name === 'link',
});

type Node = string | { '#text'?: string; '@_href'?: string; '@_rel'?: string } | undefined;

const text = (n: Node): string => (typeof n === 'string' ? n : (n?.['#text'] ?? ''));

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// Feed summaries are HTML. Discord wants plain text.
export const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(Number(e[1] === 'x' ? `0${e.slice(1)}` : e.slice(1))) : (ENTITIES[e] ?? m),
    )
    .replace(/\s+/g, ' ')
    .trim();

function atomLink(links: Node[] | undefined): string {
  const alt = links?.find((l) => typeof l === 'object' && (l['@_rel'] ?? 'alternate') === 'alternate');
  return typeof alt === 'object' ? (alt['@_href'] ?? '') : text(links?.[0]);
}

export async function readFeed(url: string): Promise<FeedItem[]> {
  const doc = parser.parse(await getText(url));
  const rss: Record<string, Node & Node[]>[] = doc.rss?.channel?.item ?? [];
  const atom: Record<string, Node & Node[]>[] = doc.feed?.entry ?? [];
  const items = [
    ...rss.map((i) => ({
      title: text(i.title),
      url: text(i.link?.[0]),
      date: new Date(text(i.pubDate)),
      summary: text(i.description),
    })),
    ...atom.map((e) => ({
      title: text(e.title),
      url: atomLink(e.link),
      date: new Date(text(e.published) || text(e.updated)),
      summary: text(e.summary) || text(e.content),
    })),
  ];
  return items
    .filter((i) => i.title && i.url && !Number.isNaN(i.date.getTime()))
    .map((i) => ({ ...i, title: plain(i.title), summary: plain(i.summary) }));
}
