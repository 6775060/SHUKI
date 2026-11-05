const ils = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
const ils2 = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (n: number) => ils.format(n);
export const moneyExact = (n: number) => ils2.format(n);

export function date(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
}

export function relativeTime(iso: string | null): string {
  if (!iso) return 'עוד לא סונכרן';
  const diff = (Date.now() - new Date(iso).getTime()) / 60000;
  if (diff < 2) return 'עכשיו';
  if (diff < 60) return `לפני ${Math.round(diff)} דקות`;
  if (diff < 60 * 24) return `לפני ${Math.round(diff / 60)} שעות`;
  return `לפני ${Math.round(diff / 60 / 24)} ימים`;
}

export const currentMonth = () => new Date().toISOString().slice(0, 7);

export const scopeLabel = (s: string) => (s === 'business' ? 'עסקי' : 'פרטי');

export const PROGRESS_LABELS: Record<string, string> = {
  INITIALIZING: 'מתכונן…',
  START_SCRAPING: 'מתחבר…',
  LOGGING_IN: 'נכנס לאתר…',
  LOGIN_SUCCESS: 'נכנס בהצלחה, מושך תנועות…',
  LOGIN_FAILED: 'הכניסה נכשלה',
  CHANGE_PASSWORD: 'נדרש שינוי סיסמה',
  END_SCRAPING: 'מסיים…',
  TERMINATING: 'סוגר…',
};
