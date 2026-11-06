/**
 * Local test websites served over HTTP on <name>.localhost:<port>.
 * Each uses a different "FontShok" CSS family (mapped to a system font via local()).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FixtureSite {
  host: string;
  family: string;
  brand: string;
  title: string;
  footer: string;
}

export const FIXTURE_SITES: FixtureSite[] = [
  { host: 'zinka.localhost', family: 'pompei-block-fs', brand: '#F89E38', title: 'Zinka | סטודיו', footer: 'כל הזכויות שמורות © Zinka | עיצוב ופיתוח: <a href="https://studio-example.co.il">סטודיו לדוגמה</a>' },
  { host: 'contreal.localhost', family: 'FS Discovery', brand: '#15B79E', title: 'קונטריל – ניהול פרויקטים', footer: '© קונטריל · Designed by <a href="https://eden-example.com">עדן לדוגמה</a>' },
  { host: 'grafigan.localhost', family: 'talent-fs', brand: '#2F6FE4', title: 'גרפי-גן', footer: 'עיצוב אתר: סטודיו C | פיתוח: משה לדוגמה' },
  { host: 'gr.localhost', family: 'Nostalgia FS', brand: '#000CFF', title: 'GR', footer: 'כל הזכויות שמורות 2025' },
  { host: 'craft.localhost', family: 'Hangar', brand: '#871B12', title: 'קראפט', footer: 'Website by <a href="https://wordpress.org">WordPress</a>' },
];

export function fixtureHtml(s: FixtureSite): string {
  return `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${s.title}</title>
<meta property="og:site_name" content="${s.title.split(/[|–]/)[0]!.trim()}">
<style>
@font-face{font-family:"${s.family}";src:local("DejaVu Sans Bold"),local("DejaVu Sans");font-weight:400 900}
body{margin:0;font-family:Arial,sans-serif;color:#111}
header{height:820px;background:#fff7ee;padding:80px}
h1{font:900 72px/1.1 "${s.family}",sans-serif;color:${s.brand};margin:0 0 30px}
.cta{display:inline-block;background:${s.brand};color:#fff;padding:24px 48px;font:700 28px "${s.family}"}
section{height:700px;background:#141414;color:#fff;padding:60px}
section h2{font:700 54px "${s.family}"}
p{font:20px/1.6 Arial}
footer{padding:30px;background:#eee}
</style></head><body>
<header><h1>הוא ירגיש שהוא חייב להישאר</h1><p>אנחנו יוצרים אתרים אינטראקטיביים שמספרים את הסיפור שלכם.</p><span class="cta">בואו נדבר</span></header>
<section><h2>איך זה עובד</h2><p>שלב אחר שלב, מהרעיון ועד ההשקה.</p><h2>שיחת היכרות</h2></section>
<section style="background:#fafafa;color:#111"><h2>לקוחות מספרים</h2><p>טקסט ארוך לדוגמה.</p></section>
<footer>${s.footer}</footer>
</body></html>`;
}

export async function startFixtureServer(): Promise<{ port: number; url: (host: string) => string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const host = (req.headers.host ?? '').split(':')[0];
    const site = FIXTURE_SITES.find((s) => s.host === host);
    if (!site) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(fixtureHtml(site));
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    url: (host) => `http://${host}:${port}/`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
