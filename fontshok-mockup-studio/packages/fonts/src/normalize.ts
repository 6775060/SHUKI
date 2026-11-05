/**
 * Normalises a CSS family name, a font file name or a user alias into a comparable key.
 *   "pompei-block-fs"            -> "pompei block"
 *   "FS Discovery"                -> "discovery"
 *   "Sprinter_FS-Black.woff2"     -> "sprinter"
 *   "HangarFS-Bold"               -> "hangar"
 */
const WEIGHT_WORDS = [
  'thin', 'hairline', 'extralight', 'ultralight', 'light', 'book', 'regular', 'normal', 'roman', 'medium',
  'demibold', 'semibold', 'demi', 'semi', 'bold', 'extrabold', 'ultrabold', 'heavy', 'black', 'ultra', 'fat',
  'italic', 'oblique', 'webfont', 'web', 'variable', 'vf',
];
const WEIGHT_RE = new RegExp(`\\b(${WEIGHT_WORDS.join('|')})\\b`, 'g');
const FILE_EXT_RE = /\.(woff2?|ttf|otf|eot|svg)(\?.*)?$/i;

export function normalizeFontKey(input: string): string {
  let s = input.trim();
  // last path segment for URLs / file paths
  s = s.split(/[\\/]/).pop() ?? s;
  s = s.replace(FILE_EXT_RE, '');
  s = s.replace(/["'`]/g, '');
  // split camelCase: "HangarFS" -> "Hangar FS"
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  s = s.toLowerCase();
  s = s.replace(/[_\-+.,]+/g, ' ');
  s = s.replace(/\b[1-9]00\b/g, ' ');
  s = s.replace(/\bfs\b/g, ' ');
  s = s.replace(WEIGHT_RE, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Generic or system families that are never FontShok fonts. */
const GENERIC = new Set([
  'serif', 'sans serif', 'monospace', 'cursive', 'fantasy', 'system ui', 'ui sans serif', 'ui serif', 'inherit', 'initial',
  'arial', 'helvetica', 'helvetica neue', 'times new roman', 'times', 'georgia', 'verdana', 'tahoma', 'segoe ui',
  'roboto', 'apple system', 'blinkmacsystemfont', 'courier new', 'font awesome', 'fontawesome', 'dashicons', 'eicons',
  'material icons', 'icomoon', 'swiper icons', 'slick',
]);

export function isGenericFamily(input: string): boolean {
  const k = normalizeFontKey(input);
  return k.length === 0 || GENERIC.has(k) || /^font awesome/.test(k) || /icons?$/.test(k);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}
