/**
 * Locate a cited passage inside page text, tolerating differences in
 * whitespace and hyphenation between the extracted text and the quote.
 */
export function findHighlightRange(text: string, quote: string): { start: number; end: number } | null {
  const wanted = squash(quote);
  if (wanted.length < 4) return null;
  // Map each kept character of `text` back to its original index.
  const kept: number[] = [];
  let flat = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i].toLowerCase();
    if (/[a-z0-9]/.test(ch)) {
      flat += ch;
      kept.push(i);
    }
  }
  let at = flat.indexOf(wanted);
  let len = wanted.length;
  if (at < 0) {
    // Fall back to the longest leading part that matches (quotes can span page breaks).
    for (let n = Math.floor(wanted.length * 0.8); n >= 24; n = Math.floor(n * 0.8)) {
      at = flat.indexOf(wanted.slice(0, n));
      if (at >= 0) {
        len = n;
        break;
      }
    }
  }
  if (at < 0) return null;
  return { start: kept[at], end: kept[at + len - 1] + 1 };
}

/** Lower-case letters and digits only. */
export function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
