import type { SearchEngine } from '@screentime/schemas';

export interface ParsedTitle {
  /** The page the title names, or null for a new tab or a title that is only the browser's name. */
  page: string | null;
  /** A private / incognito window. */
  private: boolean;
  /** The search the page shows, when the title names one. */
  search: { engine: SearchEngine; query: string } | null;
}

/** The browsers whose window titles are read on a PC (docs/SPEC.md §12.10). */
const BROWSER_NAMES: Record<string, string[]> = {
  'msedge.exe': ['microsoft edge'],
  'chrome.exe': ['google chrome'],
  'brave.exe': ['brave'],
  'firefox.exe': ['mozilla firefox', 'firefox'],
};

/** A title that names no page: the browser's new tab, start page and blank page (any case). */
const NO_PAGE = new Set(['new tab', 'new inprivate tab', 'new private tab', 'new incognito tab', 'start', 'about:blank']);

/** A query is at most 200 characters (docs/SPEC.md §12.10, step 5). */
function query(text: string): string {
  return text.trim().slice(0, 200).trim();
}

/**
 * Reads a browser window's title into the page, whether it was a private window, and the search it shows
 * (docs/SPEC.md §12.10 "Title rules"). Pure, so the rules can change without a PC update. Only Edge's titles are
 * proven by the spikes; the others follow each browser's usual window title.
 */
export function parseTitle(pkg: string, title: string): ParsedTitle {
  const browser = pkg.toLowerCase();
  let rest = title.trim();
  let isPrivate = false;

  const strip = (suffix: string): boolean => {
    if (!rest.endsWith(suffix)) return false;
    rest = rest.slice(0, -suffix.length);
    return true;
  };

  // 1. Take off the browser's ending by package. A title that is only the browser's name has no page.
  if (browser === 'msedge.exe') {
    strip(' - Microsoft Edge');
  } else if (browser === 'chrome.exe') {
    if (strip(' - Google Chrome (Incognito)')) isPrivate = true;
    else strip(' - Google Chrome');
  } else if (browser === 'brave.exe') {
    if (strip(' - Brave (Private)')) isPrivate = true;
    else strip(' - Brave');
  } else if (browser === 'firefox.exe') {
    const endings = [
      { suffix: ' — Mozilla Firefox Private Browsing', private: true },
      { suffix: ' - Mozilla Firefox Private Browsing', private: true },
      { suffix: ' — Firefox Private Browsing', private: true },
      { suffix: ' - Firefox Private Browsing', private: true },
      { suffix: ' — Mozilla Firefox', private: false },
      { suffix: ' - Mozilla Firefox', private: false },
      { suffix: ' — Firefox', private: false },
      { suffix: ' - Firefox', private: false },
    ];
    for (const ending of endings) {
      if (strip(ending.suffix)) {
        isPrivate = ending.private;
        break;
      }
    }
  }

  // 2. Edge only: the private marker, else the profile.
  if (browser === 'msedge.exe') {
    if (rest.endsWith(' - [InPrivate]')) {
      isPrivate = true;
      rest = rest.slice(0, -' - [InPrivate]'.length);
    } else {
      rest = rest.replace(/ - (Profile \d+|Personal|Work)$/, '');
    }
  }

  // 3. Edge's other tabs.
  rest = rest.replace(/ and \d+ more pages?$/, '');

  // 4. What is left, trimmed, is the page.
  let page: string | null = rest.trim() || null;
  if (page === null) return { page: null, private: isPrivate, search: null };
  const lower = page.toLowerCase();
  if (NO_PAGE.has(lower)) page = null;
  if (page !== null && BROWSER_NAMES[browser]?.includes(lower)) page = null;
  if (page === null) return { page: null, private: isPrivate, search: null };

  // 5. A search page.
  const google = /^(.*) - Google Search$/.exec(page);
  const bing = /^(.*) - (?:Search|Bing)$/.exec(page);
  const duckduckgo = /^(.*) at DuckDuckGo$/.exec(page);
  let search: ParsedTitle['search'] = null;
  if (google && query(google[1] ?? '')) search = { engine: 'google', query: query(google[1] ?? '') };
  else if (bing && query(bing[1] ?? '')) search = { engine: 'bing', query: query(bing[1] ?? '') };
  else if (duckduckgo && query(duckduckgo[1] ?? '')) search = { engine: 'duckduckgo', query: query(duckduckgo[1] ?? '') };

  return { page, private: isPrivate, search };
}
