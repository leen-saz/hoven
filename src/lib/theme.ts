// Every HTML page this Worker sends gets /assets/theme.js first in its <head>, so a dark choice applies before the page paints
// (docs/PRD.md §4.2). One place instead of a line in each of the 30 pages. Runs before versionAssets, which then points the
// script at its versioned copy.
export const THEME_SCRIPT = '<script src="/assets/theme.js"></script>';

export function withTheme(res: Response): Response {
  if (typeof HTMLRewriter === 'undefined' || !(res.headers.get('content-type') ?? '').startsWith('text/html')) return res;
  return new HTMLRewriter().on('head', { element(el) { el.prepend(THEME_SCRIPT, { html: true }); } }).transform(res);
}
