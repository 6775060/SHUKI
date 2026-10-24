import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { money } from './format';

// Hand-built SVG charts. Time runs left→right (as in Israeli banking apps);
// text stays RTL. Colors come from CSS tokens so dark mode is its own palette.

export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    setW(Math.floor(ref.current.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function compact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1000) return `${sign}${(a / 1000).toFixed(a >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return `${sign}${Math.round(a)}`;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (max === min) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

// Column with a 4px rounded data end, square at the baseline.
function columnPath(x: number, w: number, yBase: number, yTop: number): string {
  const h = yBase - yTop;
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${yBase} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${yBase} Z`;
}

// Horizontal bar anchored at xRight, growing leftward (RTL), rounded at its data end.
function barPathRtl(xRight: number, w: number, y: number, h: number): string {
  if (w <= 0) return '';
  const r = Math.min(4, h / 2, w);
  const xl = xRight - w;
  return `M${xRight},${y} H${xl + r} Q${xl},${y} ${xl},${y + r} V${y + h - r} Q${xl},${y + h} ${xl + r},${y + h} H${xRight} Z`;
}

interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

function Tip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x, 90), width - 90);
  return (
    <div className="viz-tip" style={{ left, top: tip.y }} role="status">
      {tip.content}
    </div>
  );
}

export function TableToggle({ children, table }: { children: ReactNode; table: ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <>
      {show ? table : children}
      <button className="link small" onClick={() => setShow(!show)}>
        {show ? 'הצג כגרף' : 'הצג כטבלה'}
      </button>
    </>
  );
}

// ---------- monthly income vs expenses ----------

export interface MonthDatum {
  label: string;
  income: number;
  expenses: number;
}

export function IncomeExpenseChart({ data, height = 240 }: { data: MonthDatum[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 12, right: 8, bottom: 26, left: 40 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expenses]));
  const ticks = niceTicks(0, max);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => pad.top + innerH - (v / top) * innerH;
  const band = innerW / Math.max(1, data.length);
  const barW = Math.min(24, Math.max(4, (band - 10) / 2 - 1));

  return (
    <div className="viz" ref={ref}>
      <div className="viz-legend">
        <span>
          <i className="key rect s1" /> נכנס
        </span>
        <span>
          <i className="key rect s2" /> יצא
        </span>
      </div>
      {width > 0 && (
        <svg width={width} height={height} style={{ direction: "ltr" }} role="img" aria-label="הכנסות והוצאות לפי חודש">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
              <text x={pad.left - 6} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
                {compact(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = pad.left + band * i + band / 2;
            const x1 = cx - barW - 1;
            const x2 = cx + 1;
            return (
              <g key={d.label} opacity={hover === null || hover === i ? 1 : 0.45}>
                <path d={columnPath(x1, barW, y(0), y(d.income))} className="s1-fill" />
                <path d={columnPath(x2, barW, y(0), y(d.expenses))} className="s2-fill" />
                <text x={cx} y={height - 8} className="tick" textAnchor="middle">
                  {d.label}
                </text>
                <rect
                  x={pad.left + band * i}
                  y={pad.top}
                  width={band}
                  height={innerH}
                  fill="transparent"
                  tabIndex={0}
                  onPointerMove={() => {
                    setHover(i);
                    setTip({ x: cx, y: pad.top, content: <MonthTip d={d} /> });
                  }}
                  onFocus={() => {
                    setHover(i);
                    setTip({ x: cx, y: pad.top, content: <MonthTip d={d} /> });
                  }}
                  onPointerLeave={() => {
                    setHover(null);
                    setTip(null);
                  }}
                  onBlur={() => {
                    setHover(null);
                    setTip(null);
                  }}
                />
              </g>
            );
          })}
        </svg>
      )}
      <Tip tip={tip} width={width} />
    </div>
  );
}

function MonthTip({ d }: { d: MonthDatum }) {
  const net = d.income - d.expenses;
  return (
    <>
      <div className="tip-title">{d.label}</div>
      <div className="tip-row">
        <i className="key line s1" />
        <b>{money(d.income)}</b> נכנס
      </div>
      <div className="tip-row">
        <i className="key line s2" />
        <b>{money(d.expenses)}</b> יצא
      </div>
      <div className="tip-row muted">
        {net >= 0 ? 'נשאר' : 'פער'} <b>{money(Math.abs(net))}</b>
      </div>
    </>
  );
}

// ---------- balance forecast ----------

export function ForecastChart({ points, height = 220 }: { points: { date: string; balance: number }[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const pad = { top: 16, right: 12, bottom: 26, left: 44 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const vals = points.map((p) => p.balance);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const lo = ticks[0];
  const top = ticks[ticks.length - 1];
  const x = (i: number) => pad.left + (i / Math.max(1, points.length - 1)) * innerW;
  const y = (v: number) => pad.top + innerH - ((v - lo) / (top - lo)) * innerH;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${y(Math.max(lo, 0))} L${x(0)},${y(Math.max(lo, 0))} Z`;
  const lowIdx = vals.indexOf(Math.min(...vals));
  const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const xTicks = points.map((p, i) => ({ p, i })).filter(({ i }) => i % 14 === 0 || i === points.length - 1);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (points.length - 1));
    setHi(Math.max(0, Math.min(points.length - 1, i)));
  };

  return (
    <div className="viz" ref={ref}>
      {width > 0 && points.length > 1 && (
        <svg width={width} height={height} style={{ direction: "ltr" }} role="img" aria-label="תחזית יתרה">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis zero' : 'grid'} />
              <text x={pad.left - 6} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
                {compact(t)}
              </text>
            </g>
          ))}
          {xTicks.map(({ p, i }) => (
            <text key={p.date} x={x(i)} y={height - 8} className="tick" textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
              {i === 0 ? 'היום' : fmtDate(p.date)}
            </text>
          ))}
          <path d={area} className="s1-area" />
          <path d={line} className="s1-line" fill="none" />
          <circle cx={x(lowIdx)} cy={y(vals[lowIdx])} r={4.5} className="s1-dot" />
          <text x={x(lowIdx)} y={y(vals[lowIdx]) + 18} className="label" textAnchor="middle" direction="rtl" unicodeBidi="plaintext">
            הנקודה הנמוכה: {compact(vals[lowIdx])}
          </text>
          {hi !== null && (
            <g>
              <line x1={x(hi)} x2={x(hi)} y1={pad.top} y2={pad.top + innerH} className="crosshair" />
              <circle cx={x(hi)} cy={y(vals[hi])} r={4.5} className="s1-dot" />
            </g>
          )}
          <rect
            x={pad.left}
            y={pad.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            tabIndex={0}
            onPointerMove={onMove}
            onPointerLeave={() => setHi(null)}
            onFocus={() => setHi(0)}
            onBlur={() => setHi(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') setHi((h) => Math.min(points.length - 1, (h ?? 0) + 1));
              if (e.key === 'ArrowLeft') setHi((h) => Math.max(0, (h ?? 0) - 1));
            }}
          />
        </svg>
      )}
      {hi !== null && (
        <Tip
          tip={{
            x: x(hi),
            y: pad.top,
            content: (
              <>
                <div className="tip-title">{hi === 0 ? 'היום' : fmtDate(points[hi].date)}</div>
                <div className="tip-row">
                  <b>{money(points[hi].balance)}</b> יתרה צפויה
                </div>
              </>
            ),
          }}
          width={width}
        />
      )}
    </div>
  );
}

// ---------- sparkline ----------

export function Sparkline({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 6);
  const y = (v: number) => 3 + (height - 6) * (1 - (v - min) / (max - min || 1));
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} style={{ direction: "ltr" }} aria-hidden className="spark">
      <path d={d} className="spark-line" fill="none" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={3} className="spark-dot" />
    </svg>
  );
}

// ---------- category vs usual ----------

export interface CatDatum {
  id: number;
  name: string;
  total: number;
  avg: number;
}

export function CategoryCompareChart({ data, onSelect }: { data: CatDatum[]; onSelect?: (id: number) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const rowH = 30;
  const labelW = Math.min(150, Math.max(90, width * 0.3));
  const valueW = 64;
  const max = Math.max(1, ...data.flatMap((d) => [d.total, d.avg]));
  // RTL: bars grow from the right edge (where the labels are) toward the left.
  const x0 = width - labelW - 8;
  const scale = (v: number) => (v / max) * Math.max(0, x0 - valueW - 8);
  const height = data.length * rowH + 4;

  return (
    <div className="viz" ref={ref}>
      <div className="viz-legend">
        <span>
          <i className="key rect s1" /> החודש
        </span>
        <span>
          <i className="key tick-key" /> חודש רגיל (ממוצע 3 חודשים)
        </span>
      </div>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="הוצאות לפי קטגוריה מול חודש רגיל">
          {data.map((d, i) => {
            const yTop = i * rowH + 6;
            const w = scale(d.total);
            const avgX = x0 - scale(d.avg);
            const delta = d.avg > 0 ? (d.total - d.avg) / d.avg : null;
            const show = () => setTip({ x: x0 - w / 2, y: yTop, content: <CatTip d={d} delta={delta} /> });
            return (
              <g key={d.id} className="cat-row" onClick={() => onSelect?.(d.id)}>
                <text x={width} y={yTop + 9} className="label-strong" direction="rtl" textAnchor="start" dominantBaseline="middle">
                  {d.name.length > 18 ? `${d.name.slice(0, 17)}…` : d.name}
                </text>
                <path d={barPathRtl(x0, w, yTop + 2, 14)} className="s1-fill" />
                {d.avg > 0 && <line x1={avgX} x2={avgX} y1={yTop - 1} y2={yTop + 19} className="avg-tick" />}
                <text x={Math.min(x0 - w, avgX) - 6} y={yTop + 9} className="tick" direction="ltr" textAnchor="end" dominantBaseline="middle">
                  {compact(d.total)}
                </text>
                <rect
                  x={0}
                  y={yTop - 4}
                  width={width}
                  height={rowH}
                  fill="transparent"
                  tabIndex={0}
                  style={{ cursor: onSelect ? 'pointer' : undefined }}
                  onPointerMove={show}
                  onFocus={show}
                  onPointerLeave={() => setTip(null)}
                  onBlur={() => setTip(null)}
                  onKeyDown={(e) => e.key === 'Enter' && onSelect?.(d.id)}
                />
              </g>
            );
          })}
        </svg>
      )}
      <Tip tip={tip} width={width} />
    </div>
  );
}

function CatTip({ d, delta }: { d: CatDatum; delta: number | null }) {
  return (
    <>
      <div className="tip-title">{d.name}</div>
      <div className="tip-row">
        <i className="key line s1" />
        <b>{money(d.total)}</b> החודש
      </div>
      <div className="tip-row">
        <i className="key line muted-key" />
        <b>{money(d.avg)}</b> חודש רגיל
      </div>
      {delta !== null && (
        <div className="tip-row muted">
          {delta >= 0 ? '▲' : '▼'} {Math.abs(Math.round(delta * 100))}% {delta >= 0 ? 'מעל' : 'מתחת'} לרגיל
        </div>
      )}
    </>
  );
}

// ---------- calendar heat ----------

export function CalendarHeat({ month, days }: { month: string; days: { date: string; total: number; count: number }[] }) {
  const [tip, setTip] = useState<TipState | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay(); // 0 = Sunday
  const dim = new Date(y, m, 0).getDate();
  const byDay = new Map(days.map((d) => [Number(d.date.slice(8, 10)), d]));
  const max = Math.max(1, ...days.map((d) => d.total));
  const step = (v: number) => (v <= 0 ? 0 : Math.min(5, Math.ceil((v / max) * 5)));
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];
  const names = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

  return (
    <div className="viz" ref={ref}>
      <div className="cal" role="grid" aria-label="הוצאות לפי יום">
        {names.map((n) => (
          <div key={n} className="cal-head">
            {n}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} />;
          const d = byDay.get(day);
          const show = (e: React.SyntheticEvent<HTMLDivElement>) => {
            const el = e.currentTarget;
            const parent = ref.current!.getBoundingClientRect();
            const r = el.getBoundingClientRect();
            setTip({
              x: r.left - parent.left + r.width / 2,
              y: r.bottom - parent.top + 6,
              content: (
                <>
                  <div className="tip-title">
                    {day}/{m}
                  </div>
                  <div className="tip-row">{d ? <><b>{money(d.total)}</b> ב-{d.count} תנועות</> : 'בלי הוצאות'}</div>
                </>
              ),
            });
          };
          return (
            <div
              key={day}
              className={`cal-cell h${step(d?.total ?? 0)}`}
              tabIndex={0}
              role="gridcell"
              aria-label={`${day}: ${d ? money(d.total) : 'בלי הוצאות'}`}
              onPointerEnter={show}
              onFocus={show}
              onPointerLeave={() => setTip(null)}
              onBlur={() => setTip(null)}
            >
              {day}
            </div>
          );
        })}
      </div>
      <div className="cal-scale">
        <span>פחות</span>
        {[1, 2, 3, 4, 5].map((s) => (
          <i key={s} className={`cal-swatch h${s}`} />
        ))}
        <span>יותר</span>
      </div>
      <Tip tip={tip} width={width} />
    </div>
  );
}

// ---------- meter ----------

export function Meter({ value, max, marker, tone = 'accent', label }: { value: number; max: number; marker?: number; tone?: 'accent' | 'warning' | 'good'; label?: string }) {
  const pctv = Math.max(0, Math.min(1, value / (max || 1)));
  const m = marker !== undefined ? Math.max(0, Math.min(1, marker / (max || 1))) : null;
  return (
    <div className={`meter ${tone}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <div className="meter-fill" style={{ width: `${pctv * 100}%` }} />
      {m !== null && <div className="meter-marker" style={{ insetInlineStart: `${m * 100}%` }} />}
    </div>
  );
}

// ---------- score ring ----------

export function ScoreRing({ score, size = 132 }: { score: number; size?: number }) {
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShown(score), 60);
    return () => clearTimeout(t);
  }, [score]);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`ציון ${score} מתוך 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        className="ring-fill"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - shown / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="ring-value">
        {score}
      </text>
    </svg>
  );
}
