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
