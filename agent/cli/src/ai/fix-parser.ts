/**
 * Parses AI fix responses into structured patch objects.
 *
 * The AI returns XML like:
 *   <fixes>
 *     <fix>
 *       <file>src/index.html</file>
 *       <description>Add fetchpriority to LCP image</description>
 *       <search><img src="/hero.jpg"></search>
 *       <replace><img src="/hero.jpg" fetchpriority="high"></replace>
 *     </fix>
 *   </fixes>
 */
import { XMLParser } from 'fast-xml-parser';

export interface FilePatch {
  file:        string;   // relative path inside --source dir
  description: string;
  search:      string;   // exact text to find in the file
  replace:     string;   // replacement text
}

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue:    false,
  trimValues:       false,   // preserve whitespace in search/replace
});

type RawFix = Record<string, unknown>;

export function parseFixResponse(xml: string): FilePatch[] {
  // Strip any prose the AI may have added before/after the XML block
  const start = xml.indexOf('<fixes>');
  const end   = xml.lastIndexOf('</fixes>');
  if (start === -1 || end === -1) return [];

  const snippet = xml.slice(start, end + '</fixes>'.length);

  let root: Record<string, unknown>;
  try {
    root = parser.parse(snippet) as Record<string, unknown>;
  } catch {
    return [];
  }

  const fixesEl = root['fixes'] as Record<string, unknown> | undefined;
  if (!fixesEl) return [];

  const raw = fixesEl['fix'];
  if (!raw) return [];

  const items: RawFix[] = Array.isArray(raw) ? raw as RawFix[] : [raw as RawFix];

  return items
    .map((el): FilePatch | null => {
      const file        = str(el, 'file');
      const description = str(el, 'description');
      const search      = str(el, 'search');
      const replace     = str(el, 'replace');

      if (!file || !search || replace === undefined) return null;

      return {
        file,
        description: description ?? '',
        search,
        replace:     replace ?? '',
      };
    })
    .filter((p): p is FilePatch => p !== null)
    .slice(0, 5);   // hard cap — never apply more than 5 patches per round
}

function str(el: RawFix, key: string): string | undefined {
  const v = el[key];
  if (v == null) return undefined;
  return String(v);
}
