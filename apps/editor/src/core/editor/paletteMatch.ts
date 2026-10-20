// SPDX-License-Identifier: Apache-2.0
/**
 * The fuzzy search of the command palette. The letters of the query must be in their sequence in the title or the ID
 * of a command. A match at the start of a word and a series of adjacent letters get a higher score. Thus "pm" finds
 * "prop.move" and "turn" finds "Turn the prop" first. The functions are pure.
 */

/** The score of a query in a text (more is better), or null when the letters of the query are not in the text. */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.trim().toLowerCase();
  if (needle === "") return 0;
  const hay = text.toLowerCase();
  let score = 0;
  let from = 0;
  let last = -2;
  for (const letter of needle) {
    if (letter === " ") continue;
    const at = hay.indexOf(letter, from);
    if (at < 0) return null;
    const start = at === 0 || /[\s._:-]/.test(hay.charAt(at - 1));
    score += 1 + (start ? 3 : 0) + (at === last + 1 ? 4 : 0) - Math.min(3, (at - from) / 8);
    last = at;
    from = at + 1;
  }
  // A text that holds the query as one word scores the most.
  if (hay.includes(needle)) score += needle.length * 2;
  return score;
}

/** The items whose title or ID match the query, best first. An equal score keeps the sequence of the list. */
export function matchCommands<T extends { readonly id: string; readonly title: string }>(
  items: readonly T[],
  query: string,
): T[] {
  if (query.trim() === "") return [...items];
  return items
    .map((item, index) => {
      const scores = [fuzzyScore(query, item.title), fuzzyScore(query, item.id)].filter(
        (value): value is number => value !== null,
      );
      return { item, index, score: scores.length === 0 ? null : Math.max(...scores) };
    })
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
