import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'info' | 'ok' | 'error';
export type Toast = (kind: ToastKind, text: string, ms?: number) => void;

export function useToasts() {
  const [items, setItems] = useState<{ id: number; kind: ToastKind; text: string }[]>([]);
  const seq = useRef(0);
  const push = useCallback<Toast>((kind, text, ms = 6000) => {
    const id = ++seq.current;
    setItems((x) => [...x.slice(-4), { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), ms);
  }, []);
  return useMemo(() => ({ items, push }), [items, push]);
}

export function Toasts({ items }: { items: { id: number; kind: ToastKind; text: string }[] }) {
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** Runs an async action with a busy flag and error toast. */
export function useAction(toast: Toast) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, okText?: string): Promise<T | undefined> => {
      setBusy(key);
      try {
        const r = await fn();
        if (okText) toast('ok', okText);
        return r;
      } catch (e) {
        toast('error', e instanceof Error ? e.message : String(e));
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}

export function Confidence({ value }: { value: number }) {
  const cls = value >= 0.9 ? 'high' : value >= 0.6 ? 'mid' : 'low';
  return <span className={`conf ${cls}`}>{Math.round(value * 100)}%</span>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'accent' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export const STATUS_HE: Record<string, string> = {
  queued: 'בתור',
  running: 'בסריקה',
  done: 'נסרק',
  failed: 'נכשל',
  pending: 'ממתין לבנייה',
  built: 'נבנה',
  validated: 'מוכן לאישור',
  approved: 'מאושר',
  rejected: 'נדחה',
  exported: 'יוצא',
  draft: 'טיוטה',
  review: 'בסקירה',
  suggested: 'הצעה',
  confirmed: 'מאושר',
};

export const FIELD_HE: Record<string, string> = {
  font: 'פונט',
  project_name: 'שם פרויקט',
  designer: 'עיצוב',
  developer: 'פיתוח',
  source_url: 'כתובת',
  site_type: 'סוג אתר',
  brand_color: 'צבע מותג',
};
