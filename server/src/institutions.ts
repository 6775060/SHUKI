import { SCRAPERS } from 'israeli-bank-scrapers';

export type AccountKind = 'bank' | 'card';

export interface Institution {
  id: string;
  name: string;
  kind: AccountKind;
  loginFields: { key: string; label: string; secret: boolean }[];
}

const FIELD_LABELS: Record<string, string> = {
  userCode: 'קוד משתמש',
  username: 'שם משתמש',
  id: 'תעודת זהות',
  password: 'סיסמה',
  num: 'קוד מזהה / מספר משתמש',
  card6Digits: '6 ספרות אחרונות של הכרטיס',
  nationalID: 'תעודת זהות',
  email: 'אימייל',
  phoneNumber: 'מספר טלפון',
};

const HEBREW: Record<string, { name: string; kind: AccountKind }> = {
  pagi: { name: 'פאגי', kind: 'bank' },
  hapoalim: { name: 'בנק הפועלים', kind: 'bank' },
  discount: { name: 'בנק דיסקונט', kind: 'bank' },
  max: { name: 'מקס', kind: 'card' },
  isracard: { name: 'ישראכרט', kind: 'card' },
  leumi: { name: 'בנק לאומי', kind: 'bank' },
  mizrahi: { name: 'מזרחי-טפחות', kind: 'bank' },
  beinleumi: { name: 'הבינלאומי', kind: 'bank' },
  mercantile: { name: 'מרכנתיל', kind: 'bank' },
  otsarHahayal: { name: 'אוצר החייל', kind: 'bank' },
  massad: { name: 'מסד', kind: 'bank' },
  yahav: { name: 'יהב', kind: 'bank' },
  union: { name: 'איגוד', kind: 'bank' },
  visaCal: { name: 'כאל', kind: 'card' },
  amex: { name: 'אמריקן אקספרס', kind: 'card' },
};

// The user's institutions first, in the order they asked for.
const ORDER = ['pagi', 'hapoalim', 'discount', 'max', 'isracard'];

// OneZero needs an OTP flow that is not wired up yet.
const UNSUPPORTED = new Set(['oneZero', 'behatsdaa', 'beyahadBishvilha']);

export function listInstitutions(): Institution[] {
  const ids = Object.keys(SCRAPERS).filter((id) => !UNSUPPORTED.has(id) && HEBREW[id]);
  ids.sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || HEBREW[a].name.localeCompare(HEBREW[b].name, 'he');
  });
  return ids.map((id) => ({
    id,
    name: HEBREW[id].name,
    kind: HEBREW[id].kind,
    loginFields: (SCRAPERS as Record<string, { loginFields: string[] }>)[id].loginFields.map((key) => ({
      key,
      label: FIELD_LABELS[key] ?? key,
      secret: key === 'password',
    })),
  }));
}

export function getInstitution(id: string): Institution | undefined {
  return listInstitutions().find((i) => i.id === id);
}
