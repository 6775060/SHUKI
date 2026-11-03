/**
 * A miniature of fontshok.co.il with the structure observed on the real site (Nov 2026):
 * Elementor menu items linking to /font/<slug>/, and font pages whose <style> declares the
 * page's own font plus the site-wide UI fonts (Sprinter, Discovery_Fs).
 */
const face = (family: string, file: string) =>
  `@font-face { font-family: '${family}'; font-style: normal; font-weight: 400; src: url('https://fontshok.co.il/wp-content/uploads/2025/02/${file}.woff') format('woff'); }`;
const SITE_WIDE = face('Discovery_Fs', 'Discovery_Fs-Regular-2') + face('Sprinter', 'Sprinter_FS-Regular');

const page = (title: string, faces: string) => `<!doctype html><html><head><title>${title} | פונטשוק</title><style>${SITE_WIDE}${faces}</style></head><body></body></html>`;

export const FONTSHOK_FIXTURE: Record<string, string> = {
  '/': `<!doctype html><html><head><title>פונטשוק - פונטים עבריים - FontShok</title><style>${SITE_WIDE}</style></head><body>
    <nav><ul>
      <li class="menu-item menu-item-type-post_type"><a href="https://fontshok.co.il/font/discovery/" class="elementor-item">דיסקברי</a></li>
      <li class="menu-item"><a href="https://fontshok.co.il/font/sprinter/">ספרינטר</a></li>
      <li class="menu-item"><a href="https://fontshok.co.il/font/pompei-block/"><span>פומפאי בלוק</span></a></li>
      <li class="menu-item"><a href="https://fontshok.co.il/font/kissufim/">כיסופים</a></li>
      <li class="menu-item"><a href="https://fontshok.co.il/font/hangar/">האנגר</a></li>
      <li class="menu-item"><a href="https://fontshok.co.il/font/discovery/">דיסקברי</a></li>
      <li class="menu-item"><a href="https://fontshok.co.il/contact/">צור קשר</a></li>
    </ul></nav></body></html>`,
  '/font/discovery/': page('פונט דיסקברי Discovery – סנס סריף גאומטרי בעברית', face('Discovery_Fs_VF', 'Discovery_Fs-VF-1')),
  '/font/sprinter/': page('פונט ספרינטר Sprinter – סנס סריף דינמי בעברית', face('Sprinter_VF', 'Sprinter_FS-VF') + face('Pompei_Block', 'Pompei_Block_FS-Regular')),
  '/font/pompei-block/': page('פונט פומפאי בלוק Pompei Block – סנס מודולרי ועוצמתי', face('Pompei_Block', 'Pompei_Block_FS-Black') + face('Pompei_Block_VF', 'Pompei_Block_FS-VF')),
  '/font/kissufim/': page('פונט כיסופים Kissufim – אות מקורות קליגרפית', face('KissofinFS', 'KissofinFS-Extrablack') + face('KissofinFS-VF', 'KissufimFS-VF')),
  '/font/hangar/': page('פונט האנגר Hangar – וינטג\' בהשראת שנות ה-70', face('SdHangar', 'SdHangar-Crunchy') + face('PortoFs', 'SdPorto-Regular')),
};
