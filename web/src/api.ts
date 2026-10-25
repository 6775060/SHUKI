const TOKEN_KEY = 'shefa-session';

function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode – stays in memory only */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

let onLocked: () => void = () => {};
export function setOnLocked(fn: () => void): void {
  onLocked = fn;
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('x-session', token);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, { ...init, headers, body });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && data?.error === 'LOCKED') onLocked();
    throw new ApiError(res.status, data?.error ?? 'ERROR');
  }
  return data as T;
}

export interface Category {
  id: number;
  slug: string | null;
  name: string;
  grp: string;
  kind: 'expense' | 'income' | 'transfer';
}

export interface Account {
  id: number;
  kind: 'bank' | 'card' | 'cash';
  companyId: string | null;
  accountNumber: string;
  label: string;
  defaultScope: 'private' | 'business';
  balance: number | null;
  balanceDate: string | null;
  txnCount: number;
}

export interface Txn {
  id: number;
  date: string;
  amount: number;
  originalAmount: number | null;
  originalCurrency: string | null;
  description: string;
  memo: string | null;
  status: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
  categoryId: number | null;
  categoryName: string | null;
  categoryKind: string | null;
  scope: 'private' | 'business';
  note: string | null;
  source: string;
  accountId: number;
  accountLabel: string;
  accountKind: string;
  reviewStatus?: 'open' | 'done' | null;
}

export interface Institution {
  id: string;
  name: string;
  kind: 'bank' | 'card';
  loginFields: { key: string; label: string; secret: boolean }[];
}

export interface Connection {
  id: number;
  companyId: string;
  label: string;
  defaultScope: 'private' | 'business';
  enabled: number;
  lastSyncAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastAdded: number | null;
}

export interface SyncStatus {
  running: number | null;
  queued: number[];
  progress: Record<string, string>;
}

export interface Summary {
  month: string;
  months: string[];
  income: number;
  expenses: number;
  net: number;
  byScope: { scope: string; income: number; expenses: number }[];
  byCategory: { categoryId: number; name: string; grp: string; total: number; count: number }[];
  uncategorizedCount: number;
  futureInstallments: { total: number; series: { description: string; perPayment: number; remaining: number; left: number }[] };
  balances: { id: number; label: string; kind: string; balance: number | null; balanceDate: string | null }[];
}

export interface Recurring {
  key: string;
  name: string;
  categoryName: string | null;
  amount: number;
  periodMonths: 1 | 2;
  monthsSeen: number;
  lastDate: string;
  nextDate: string;
  annual: number;
  priceChangePct: number | null;
  isNew: boolean;
  isTax: boolean;
  accountKind: string;
  scope: string | null;
}

export interface Insight {
  tone: 'good' | 'neutral' | 'attention';
  icon: string;
  title: string;
  body: string;
  link?: { page: string; params?: Record<string, string> };
}

export interface Fund {
  id: number;
  name: string;
  icon: string | null;
  annualAmount: number;
  monthly: number;
  dueMonth: number | null;
  nextDue: string | null;
  categoryId: number | null;
  categoryName: string | null;
  spentLast12: number;
  spentThisYear: number;
}

export interface InsightsData {
  month: string;
  today: string;
  isCurrent: boolean;
  trend: { month: string; income: number; expenses: number; net: number; bizIncome: number; bizExpenses: number }[];
  categories: { categoryId: number; slug: string | null; name: string; grp: string; total: number; avg: number; deltaPct: number | null; steady: boolean }[];
  recurring: Recurring[];
  pace: { day: number; daysInMonth: number; spentToDate: number; avgToDate: number | null; avgFull: number | null; projected: number };
  daily: { date: string; total: number; count: number }[];
  balance: number | null;
  forecast: {
    start: number;
    points: { date: string; balance: number }[];
    low: { date: string; balance: number };
    firstNegative: string | null;
    assumptions: { dailyVariableSpend: number; dailyIrregularIncome: number; cardChargesAhead: number; recurringItems: number };
  } | null;
  business: {
    hasBusiness: boolean;
    income: number;
    expenses: number;
    avgIncome: number | null;
    vatOnSales: number;
    vatOnPurchases: number;
    vatEstimate: number;
    topSources: { name: string; total: number; share: number }[];
  };
  merchants: { name: string; total: number; count: number }[];
  installments: { total: number; series: { description: string; perPayment: number; remaining: number; left: number }[] };
  health: { score: number; label: string; parts: { key: string; label: string; score: number; detail: string }[] } | null;
  safeToSpend: {
    perDay: number;
    daysLeft: number;
    available: number;
    parts: { label: string; amount: number }[];
    nextCardCharge: { date: string; amount: number } | null;
  } | null;
  funds: Fund[];
  insights: Insight[];
  uncategorized: number;
  cycle: CycleView | null;
  cards: CardBill[];
  businessTips: Tip[];
  reviews: { n: number; total: number; oldest: string | null };
}

export interface Review {
  id: number;
  date: string;
  processedDate: string | null;
  amount: number;
  originalAmount: number | null;
  originalCurrency: string | null;
  description: string;
  memo: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  identifier: string | null;
  categoryId: number | null;
  categoryName: string | null;
  scope: string;
  accountLabel: string;
  accountKind: string;
  companyId: string | null;
  status: 'open' | 'done';
  note: string | null;
  resolution: 'ok' | 'refund' | 'disputed' | 'cancelled' | null;
  openedAt: string;
  closedAt: string | null;
  history: { count: number; first: string | null; last: string | null; sameAmount: number; months: number };
}

export interface CycleView {
  start: string;
  end: string;
  day: number;
  days: number;
  income: { expected: number; received: number; basis: 'history' | 'received' | 'none' };
  fixed: { monthly: number; items: { name: string; amount: number }[] };
  installments: number;
  funds: number;
  joy: number;
  variableBudget: number;
  variableSpent: number;
  projectedVariable: number;
  forecastEnd: number;
  week: { start: string; end: string; budget: number; spent: number; left: number; joy: number; daysLeft: number };
  settings: { startDay: number; startDayDetected: number; startDayIsAuto: boolean; weeklyJoy: number };
}

export interface CardBill {
  accountId: number;
  label: string;
  nextDate: string | null;
  amount: number;
  chargeDay: number | null;
  daysUntil: number | null;
}

export interface Tip {
  key: string;
  icon: string;
  title: string;
  why: string;
  action: string;
  impact: number | null;
  relevance: 'high' | 'medium';
}

export interface BusinessData {
  month: string;
  trend: InsightsData['trend'];
  income: number;
  expenses: number;
  net: number;
  margin: number | null;
  avgIncome: number | null;
  avgNet: number | null;
  vat: { sales: number; purchases: number; estimate: number };
  taxReservePct: number;
  allocation: { label: string; pct: number; amount: number }[];
  ownerPay: { sustainable: number | null; actualAvg: number | null; months: number; businessNetAvg: number | null };
  categories: InsightsData['categories'];
  clients: { name: string; total: number; share: number; count: number }[];
  clientSource: 'documents' | 'bank';
  activeClients: number[];
  fees: { total: number; pctOfTurnover: number | null; bySource: { name: string; total: number }[] };
  docs: {
    count: number;
    lastDate: string | null;
    openInvoices: { number: string | null; counterparty: string | null; date: string; amount: number; days: number }[];
    expensesWithoutInvoice: { date: string; description: string; amount: number }[];
  };
  tips: Tip[];
  connections: { sumit: boolean; sumitLastSync: string | null; sumitError: string | null; sources: { source: string; n: number; last: string }[] };
}
