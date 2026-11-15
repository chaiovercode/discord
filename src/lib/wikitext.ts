// Just enough wikitext handling to read cricket match templates.

// Every top-level {{Name ...}} block whose name matches, with the nearest heading above it.
export function templates(wikitext: string, name: RegExp): { heading: string; params: Record<string, string> }[] {
  const out: { heading: string; params: Record<string, string> }[] = [];
  const open = new RegExp(`\\{\\{\\s*(?:${name.source})\\s*\\|`, 'g');
  for (const m of wikitext.matchAll(open)) {
    const start = m.index;
    let depth = 0;
    let end = start;
    for (let i = start; i < wikitext.length - 1; i++) {
      if (wikitext.startsWith('{{', i)) (depth++, i++);
      else if (wikitext.startsWith('}}', i)) {
        depth--;
        i++;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    const headings = [...wikitext.slice(0, start).matchAll(/^=+\s*(.+?)\s*=+\s*$/gm)];
    out.push({ heading: headings.at(-1)?.[1] ?? '', params: params(wikitext.slice(m.index + m[0].length, end - 2)) });
  }
  return out;
}

// Splits `a = b | c = d` on pipes that are not inside nested {{ }} or [[ ]].
function params(body: string): Record<string, string> {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') (depth++, i++);
    else if (two === '}}' || two === ']]') (depth--, i++);
    else if (body[i] === '|' && depth === 0) {
      parts.push(body.slice(last, i));
      last = i + 1;
    }
  }
  parts.push(body.slice(last));
  return Object.fromEntries(
    parts.filter((p) => p.includes('=')).map((p) => [p.slice(0, p.indexOf('=')).trim(), p.slice(p.indexOf('=') + 1).trim()]),
  );
}

// Wikitext to plain text: links become their label; refs, templates and comments go.
export const plain = (s: string) =>
  s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[\s\S]*?<\/ref>/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\S+\s([^\]]*)\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
