/** Display helpers shared by library and chat views. */
export function formatAuthors(authors: string[], max = 3): string {
  if (!authors.length) return "";
  if (authors.length <= max) return authors.join(", ");
  return `${authors.slice(0, max).join(", ")} and ${authors.length - max} more`;
}

export function paperByline(p: { authors: string[]; year: number | null; venue: string | null }): string {
  return [formatAuthors(p.authors), p.year, p.venue].filter(Boolean).join(", ");
}
