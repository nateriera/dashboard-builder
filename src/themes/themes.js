// Theme registry: a handful of selectable, brand-neutral visual themes.
//
// A theme has two faces:
// - `css`: custom properties applied to :root. The composer chrome
//   (src/style.css) and the chart card CSS (src/charts/charts.js) style
//   themselves exclusively through these variables, so switching themes is
//   just swapping variable values.
// - `chart`: plain JS tokens for chart internals (Plot/SVG fills, palettes),
//   which can't read CSS variables at render time.
//
// Paper bundles its brand fonts locally; other themes retain system stacks.

const SYSTEM_BODY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const SYSTEM_MONO =
  "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

export const THEMES = [
  {
    id: "paper",
    name: "Paper",
    blurb: "Warm light, editorial",
    css: {
      "--paper": "#F5F1EA",
      "--white": "#FFFFFF",
      "--ink": "#1E2347",
      "--dusk": "#4A5278",
      "--periwinkle": "#B7BFD9",
      "--brush-fill": "rgba(183,191,217,.30)",
      "--scrim": "rgba(14,31,42,.45)",
      "--slate": "#E7E3D9",
      "--slate-200": "#E7E3D9",
      "--slate-300": "#9AA0AE",
      "--slate-400": "#9AA0AE",
      "--slate-500": "#5F6575",
      "--slate-600": "#3A4054",
      "--slate-700": "#3A4054",
      "--danger": "#C0452F",
      "--success": "#2F7D5B",
      "--warning": "#B97F26",
      "--shadow-card": "0 1px 3px rgba(30,35,71,.08)",
      "--shadow-overlay": "0 8px 24px rgba(30,35,71,.10)",
      "--shadow-focus": "0 0 0 3px rgba(183,191,217,.45)",
      "--card-shadow": "0 1px 2px rgba(35, 40, 57, 0.07), 0 1px 1px rgba(35, 40, 57, 0.05)",
      "--font-display": "'Raleway', Georgia, serif",
      "--font-body": "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
      "--font-mono": "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
    },
    chart: {
      ink: "#232839",
      card: "#ffffff",
      primary: "#3e5c76",
      highlight: "#c9803a",
      muted: "#6e6a5e",
      mutedStrong: "#4a463c",
      onDark: "#ffffff",
      mutedLight: "#d8d2c2",
      border: "#b3ac99",
      grid: "#e7e1d2",
      categorical: ["#3e5c76", "#c9803a", "#6a8b6f", "#b0413e", "#7a6c9b", "#8a8d93"],
      sequential: [
        "#f4f6f8", "#e6ebf1", "#d3dce8", "#bcc9dc", "#a3b4cc",
        "#8a9dbd", "#6f87ad", "#546d99", "#3e5c76"
      ],
      divNeg: "#3e5c76",
      divMid: "#f6f3ea",
      divPos: "#b0413e",
      unknown: "#e9e4d4",
      semantic: { success: "#5f8268", warning: "#c9803a", danger: "#b0413e", info: "#3e5c76" },
      fonts: { display: `Raleway, Georgia, serif`, body: `Inter, ${SYSTEM_BODY}`, mono: `'JetBrains Mono', ${SYSTEM_MONO}` }
    }
  },
  {
    id: "slate",
    name: "Slate",
    blurb: "Cool light, corporate",
    css: {
      "--paper": "#f2f4f7",
      "--white": "#ffffff",
      "--ink": "#1e2732",
      "--dusk": "#2b6cb0",
      "--periwinkle": "#d97706",
      "--slate-200": "#dfe3e8",
      "--slate-300": "#b9c1cb",
      "--slate-500": "#67707c",
      "--slate-600": "#434a54",
      "--danger": "#c0392b",
      "--success": "#0e9f6e",
      "--warning": "#d97706",
      "--card-shadow":
        "0 1px 2px rgba(30, 39, 50, 0.08), 0 1px 1px rgba(30, 39, 50, 0.05)",
      "--font-display": SYSTEM_BODY,
      "--font-body": SYSTEM_BODY,
      "--font-mono": SYSTEM_MONO
    },
    chart: {
      ink: "#1e2732",
      card: "#ffffff",
      primary: "#2b6cb0",
      highlight: "#d97706",
      muted: "#67707c",
      mutedStrong: "#434a54",
      onDark: "#ffffff",
      mutedLight: "#dfe3e8",
      border: "#b9c1cb",
      grid: "#e8ecf1",
      categorical: ["#2b6cb0", "#d97706", "#0e9f6e", "#e02424", "#7c3aed", "#6b7280"],
      sequential: [
        "#f0f6fd", "#dcebfb", "#c2dbf7", "#a3c8f2", "#7faded",
        "#5b92e3", "#3b78d8", "#2b6cb0", "#1e4e8c"
      ],
      divNeg: "#2b6cb0",
      divMid: "#f2f4f7",
      divPos: "#e02424",
      unknown: "#e8ecf1",
      semantic: { success: "#0e9f6e", warning: "#d97706", danger: "#e02424", info: "#2b6cb0" },
      fonts: { display: SYSTEM_BODY, body: SYSTEM_BODY, mono: SYSTEM_MONO }
    }
  },
  {
    id: "dusk",
    name: "Dusk",
    blurb: "Dark mode",
    css: {
      "--paper": "#14161d",
      "--white": "#1e2230",
      "--ink": "#e9ebf2",
      "--dusk": "#e8a33d",
      "--periwinkle": "#6cb2e8",
      "--slate-200": "#2c3145",
      "--slate-300": "#3a415a",
      "--slate-500": "#9aa0b4",
      "--slate-600": "#c3c8d8",
      "--danger": "#e87a7a",
      "--success": "#7bc79a",
      "--warning": "#e8a33d",
      "--card-shadow":
        "0 1px 2px rgba(0, 0, 0, 0.4), 0 1px 1px rgba(0, 0, 0, 0.3)",
      "--font-display": SYSTEM_BODY,
      "--font-body": SYSTEM_BODY,
      "--font-mono": SYSTEM_MONO
    },
    chart: {
      ink: "#e9ebf2",
      card: "#1e2230",
      primary: "#e8a33d",
      highlight: "#6cb2e8",
      muted: "#9aa0b4",
      mutedStrong: "#c3c8d8",
      onDark: "#e9ebf2",
      mutedLight: "#2c3145",
      border: "#3a415a",
      grid: "#262b3d",
      categorical: ["#e8a33d", "#6cb2e8", "#7bc79a", "#e87a7a", "#b79ced", "#9aa0b4"],
      sequential: [
        "#232838", "#2e3a4e", "#3a4a63", "#4a5c7d", "#5d7194",
        "#7186a8", "#8ba0bd", "#a9bcd4", "#c9d6e8"
      ],
      divNeg: "#6cb2e8",
      divMid: "#1e2230",
      divPos: "#e87a7a",
      unknown: "#262b3d",
      semantic: { success: "#7bc79a", warning: "#e8a33d", danger: "#e87a7a", info: "#6cb2e8" },
      fonts: { display: SYSTEM_BODY, body: SYSTEM_BODY, mono: SYSTEM_MONO }
    }
  },
  {
    id: "mono",
    name: "Mono",
    blurb: "High-contrast grayscale",
    css: {
      "--paper": "#ffffff",
      "--white": "#ffffff",
      "--ink": "#111111",
      "--dusk": "#111111",
      "--periwinkle": "#666666",
      "--slate-200": "#e5e5e5",
      "--slate-300": "#d4d4d4",
      "--slate-500": "#737373",
      "--slate-600": "#404040",
      "--danger": "#b0413e",
      "--success": "#2f6b4f",
      "--warning": "#8a6d1a",
      "--card-shadow":
        "0 1px 2px rgba(0, 0, 0, 0.1), 0 1px 1px rgba(0, 0, 0, 0.06)",
      "--font-display": SYSTEM_BODY,
      "--font-body": SYSTEM_BODY,
      "--font-mono": SYSTEM_MONO
    },
    chart: {
      ink: "#111111",
      card: "#ffffff",
      primary: "#111111",
      highlight: "#666666",
      muted: "#737373",
      mutedStrong: "#404040",
      onDark: "#ffffff",
      mutedLight: "#e5e5e5",
      border: "#d4d4d4",
      grid: "#eeeeee",
      categorical: ["#111111", "#4d4d4d", "#808080", "#b3b3b3", "#d9d9d9", "#666666"],
      sequential: [
        "#ffffff", "#f0f0f0", "#e0e0e0", "#c7c7c7", "#a8a8a8",
        "#858585", "#666666", "#404040", "#111111"
      ],
      divNeg: "#666666",
      divMid: "#ffffff",
      divPos: "#111111",
      unknown: "#f0f0f0",
      semantic: { success: "#2f6b4f", warning: "#8a6d1a", danger: "#b0413e", info: "#444444" },
      fonts: { display: SYSTEM_BODY, body: SYSTEM_BODY, mono: SYSTEM_MONO }
    }
  }
];

const THEME_KEY = "dashbuilder.theme.v1";
const LEGACY_THEME_KEY = "klaroDash.theme.v1";

function storedThemeId() {
  try {
    if (typeof localStorage === "undefined") return null;
    return (
      localStorage.getItem(THEME_KEY) || localStorage.getItem(LEGACY_THEME_KEY)
    );
  } catch {
    return null;
  }
}

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

let currentId = storedThemeId() || "paper";
if (!THEMES.some((t) => t.id === currentId)) currentId = "paper";

export function getTheme() {
  return themeById(currentId);
}

export function getThemeId() {
  return currentId;
}

/** Apply a theme's CSS variables to a document (defaults to the page). */
export function applyTheme(theme, doc) {
  const root = (doc || document).documentElement;
  root.setAttribute("data-theme", theme.id);
  for (const [prop, value] of Object.entries(theme.css)) {
    root.style.setProperty(prop, value);
  }
}

/** Switch the active theme: persists the choice and applies it to the page. */
export function setTheme(id) {
  activate(id);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(THEME_KEY, currentId);
      localStorage.removeItem(LEGACY_THEME_KEY);
    }
  } catch {
    /* storage unavailable: theme still applies for this session */
  }
}

/**
 * Activate a theme for rendering without persisting it. Used by the static
 * export viewer: an exported file renders in its own theme without
 * overwriting the viewer's stored composer preference.
 */
export function previewTheme(id) {
  activate(id);
}

function activate(id) {
  currentId = themeById(id).id;
  applyTheme(themeById(currentId));
}
