import path from 'node:path';
import type { Classification } from '../shared/types';

export function normalizedTitle(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s*\((?:loop|[a-f0-9]{6})\)/g, '').replace(/[^\p{L}\p{N}]/gu, '');
}

export function structuredClassification(relativePath: string): Classification | undefined {
  const parts = relativePath.split(/[\\/]/);
  if (parts.length < 5) return undefined;
  const type = parts[1]?.toLowerCase() === 'music' ? 'Music'
    : parts[1]?.toLowerCase() === 'ambience' ? 'Ambience'
    : parts[1]?.toLowerCase() === 'sfx' ? 'SFX' : undefined;
  return type ? { type, era: parts[2].toLowerCase(), genre: parts[3], needsReview: false, reason: 'Structured folder hierarchy' } : undefined;
}

const genreRules: [RegExp, string][] = [
  [/tavern|\binn\b|alehouse|pub\b/, 'Taverns and Inns'],
  [/battle|combat|\bfray\b|warfare|siege|skirmish|conquer/, 'Combat'],
  [/arctic|frozen|blizzard|snow|glacier|\bice\b|tundra/, 'Arctic'],
  [/desert|sands|wasteland|oasis|arid/, 'Arid'],
  [/jungle|tropical|rainforest/, 'Tropical'],
  [/forest|woods|woodland|feywild|botanical/, 'Forest'],
  [/dungeon|cave|cavern|sewer|underground|below the surface|subterranean|mines?\b/, 'Dungeon'],
  [/gothic|haunted|graveyard|crypt|vampire|curse|horror|nightmare|creepy/, 'Gothic'],
  [/temple|holy|cathedral|church|monastery|shrine/, 'Temple'],
  [/harbou?r|coast|shore|beach|seaside/, 'Coastal'],
  [/ship|sailing|aboard|pirate/, 'Ships'],
  [/city|town|village|hamlet|market|slums|streets|square/, 'Towns and Streets'],
  [/mountain|summit|peak/, 'Mountains'],
  [/volcan|lava|infernal|hell|plane of fire/, 'Volcanic'],
  [/rain|thunder|storm|wind/, 'Weather'],
  [/river|stream|waterfall|lake|water/, 'Water'],
  [/savannah|grassland|meadow|prairie/, 'Grassland'],
  [/magic|alchemy|wizard|enchant|crystal/, 'Magical'],
  [/myster|secret|intrigue|investigat/, 'Mystery'],
  [/adventure|quest|horizon|journey|travell?ing/, 'Adventure'],
  [/explor|unknown|odyssey|stargaz/, 'Exploration'],
  [/ballad|song|flutes|lutes/, 'Ballad'],
  [/farewell|remember|until we meet|sorrow|lament/, 'Emotional'],
  [/library|laboratory|palace|castle|prison|shop/, 'Buildings'],
  [/campfire|swamp|marsh|nature/, 'Nature'],
];

export function classify(relativePath: string, matches = new Map<string, Classification>()): Classification {
  const parts = relativePath.split(/[\\/]/);
  const title = path.parse(parts.at(-1)!).name;
  const structured = structuredClassification(relativePath);
  if (structured) return structured;
  const album = parts[1] ?? '';
  const type = /ambience/i.test(album) ? 'Ambience' : 'Music';
  const matching = matches.get(normalizedTitle(title));
  if (matching && matching.type === type) return { ...matching, reason: 'Title matches a consistently classified structured track', needsReview: true };
  const text = `${album} ${title}`.normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g, '').toLowerCase();
  let era = /sci.?fi|space|stardust|starship|cyber|robot/.test(text) ? 'scifi'
    : /modern/.test(text) ? 'modern'
    : /middle.?eastern/.test(text) ? 'middle-eastern' : 'fantasy';
  const trackGenre = genreRules.find(([pattern]) => pattern.test(title.toLowerCase()))?.[1];
  const albumGenre = genreRules.find(([pattern]) => pattern.test(album.toLowerCase()))?.[1];
  // The themed music collections describe genre more reliably than individual titles.
  const genre = type === 'Music' && /music collection/i.test(album) && albumGenre
    ? albumGenre : trackGenre ?? albumGenre ?? (type === 'Ambience' ? 'Nature' : 'Exploration');
  if (type === 'Ambience' && era === 'fantasy' &&
      ['Arctic', 'Arid', 'Tropical', 'Forest', 'Mountains', 'Weather', 'Water', 'Grassland', 'Coastal', 'Nature'].includes(genre) &&
      !/elven|magic|haunted|fey|monster|dream|evil|hell|plane/.test(title.toLowerCase())) era = 'generic';
  return { type, era, genre, needsReview: true, reason: trackGenre || albumGenre
    ? `Inferred from album/track title (${album}); review to confirm`
    : `Uncertain: default ${era}/${genre} for ${album || 'unstructured folder'}` };
}

export function titleMatches(paths: string[]): Map<string, Classification> {
  const matches = new Map<string, Classification>();
  const ambiguous = new Set<string>();
  for (const file of paths) {
    const category = structuredClassification(file);
    if (!category) continue;
    const key = normalizedTitle(path.parse(file).name);
    const previous = matches.get(key);
    if (previous && (previous.type !== category.type || previous.era !== category.era || previous.genre !== category.genre)) ambiguous.add(key);
    matches.set(key, category);
  }
  for (const key of ambiguous) matches.delete(key);
  return matches;
}
