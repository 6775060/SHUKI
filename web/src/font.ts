export interface FontSetting {
  file: string | null;
  family: string | null;
  name: string | null;
  variable?: boolean;
}

const STYLE_ID = 'user-font';
const FALLBACK = "system-ui, -apple-system, 'Segoe UI', 'Arial Hebrew', sans-serif";

// Apply the user's own font across the whole interface.
export function applyFont(f: FontSetting | null): void {
  document.getElementById(STYLE_ID)?.remove();
  if (!f || (!f.file && !f.family)) {
    document.documentElement.style.removeProperty('--font');
    return;
  }
  if (f.file) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    // A variable font serves every weight (300 for light, 700 for bold) from one file.
    const weight = f.variable ? 'font-weight: 100 900;' : '';
    style.textContent = `@font-face { font-family: 'ShefaUser'; src: url('/fonts/${f.file}'); ${weight} font-display: swap; }`;
    document.head.appendChild(style);
    document.documentElement.style.setProperty('--font', `'ShefaUser', ${FALLBACK}`);
  } else if (f.family) {
    document.documentElement.style.setProperty('--font', `'${f.family.replace(/'/g, '')}', ${FALLBACK}`);
  }
}
