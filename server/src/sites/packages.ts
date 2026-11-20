/**
 * Shared lists for the websites feature (docs/SPEC.md §12.10, CARD-070). The kinds and categories come from
 * `@screentime/schemas` (`SiteKind`, `SiteCategory`), never from a second list here.
 */

/**
 * The server's echo packages: Bark resolves every host a browser opens a moment later, so its lookups are kept in
 * the raw data but left out of the report and the classifier (docs/SPEC.md §12.10).
 */
export const ECHO_PACKAGES = ['com.pt.bark'];

/** The known Android browsers and PC browser programs (docs/SPEC.md §12.10). */
export const BROWSER_PACKAGES = [
  'com.android.chrome',
  'org.mozilla.firefox',
  'com.brave.browser',
  'com.microsoft.emmx',
  'com.sec.android.app.sbrowser',
  'com.mi.globalbrowser',
  'com.opera.browser',
  'com.duckduckgo.mobile.android',
  'msedge.exe',
  'chrome.exe',
  'brave.exe',
  'firefox.exe',
];

/** True for a package the report shows as a browser. */
export function isBrowser(pkg: string): boolean {
  return BROWSER_PACKAGES.includes(pkg);
}
