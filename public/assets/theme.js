// The viewer's theme (light, dark or automatic = the device's), before the page paints: the Worker adds this script to the
// top of every page's <head> (src/lib/theme.ts). Kept in this browser only. The ClientRouter swaps <html> attributes on each
// tab change, so the attribute is set again after every swap.
(function () {
  var KEY = 'hoven-theme', THEMES = ['light', 'dark', 'auto'], cur = 'light';
  try { var v = localStorage.getItem(KEY); if (THEMES.indexOf(v) >= 0) cur = v; } catch (e) { /* storage blocked: light */ }
  function apply() { document.documentElement.setAttribute('data-theme', cur); }
  apply();
  document.addEventListener('astro:after-swap', apply);
  window.hovenTheme = {
    THEMES: THEMES,
    get: function () { return cur; },
    set: function (v) {
      if (THEMES.indexOf(v) < 0) return;
      cur = v;
      try { localStorage.setItem(KEY, v); } catch (e) { /* this visit only */ }
      apply();
    },
  };
})();
