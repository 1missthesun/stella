const EMBEDDED_INIT_SCRIPT = /* javascript */ `
(() => {
  try {
    var STORAGE_KEY = 'stella-embedded-theme';
    var html = document.documentElement;
    var p = new URLSearchParams(window.location.search);

    var fromUrl = p.get('embedded') === '1';
    var stored = null;
    try {
      var raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch (e) {}

    if (!fromUrl && !stored) return;

    html.setAttribute('data-embedded', 'true');

    var theme = stored && typeof stored === 'object' ? Object.assign({}, stored) : {};
    var pickUrl = function (key) {
      var v = p.get(key);
      return v && v.length > 0 ? v : null;
    };
    var assign = function (target, key, value) {
      if (value && value.length > 0) target[key] = value;
    };
    if (fromUrl) {
      assign(theme, 'fg', pickUrl('fg'));
      assign(theme, 'fgWeak', pickUrl('fg-weak'));
      assign(theme, 'border', pickUrl('border'));
      assign(theme, 'primary', pickUrl('primary'));
      assign(theme, 'surface', pickUrl('surface'));
      assign(theme, 'bg', pickUrl('bg'));
      var modeFromUrl = pickUrl('mode');
      if (modeFromUrl === 'light' || modeFromUrl === 'dark') {
        theme.mode = modeFromUrl;
      }
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
      } catch (e) {}
    }

    var setVar = function (name, value) {
      if (value && value.length > 0) html.style.setProperty(name, value);
    };
    setVar('--embedded-fg', theme.fg);
    setVar('--embedded-fg-weak', theme.fgWeak);
    setVar('--embedded-border', theme.border);
    setVar('--embedded-primary', theme.primary);
    setVar('--embedded-surface', theme.surface);
    setVar('--embedded-bg', theme.bg);
    if (theme.mode === 'light' || theme.mode === 'dark') {
      html.style.setProperty('color-scheme', theme.mode);
    }
  } catch (e) {}
})();
`;

export function EmbeddedInitScript() {
  return (
    <script
      dangerouslySetInnerHTML={{ __html: EMBEDDED_INIT_SCRIPT }}
    />
  );
}
