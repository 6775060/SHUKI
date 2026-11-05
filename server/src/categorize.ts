import type { DB } from './db.js';

export interface Rule {
  id: number;
  pattern: string;
  category_id: number;
  scope: 'private' | 'business' | null;
  account_kind: 'bank' | 'card' | 'cash' | null;
  priority: number;
  kind: 'expense' | 'income' | 'transfer';
  match: 'contains' | 'merchant';
}

export interface CategorizeInput {
  description: string;
  memo?: string | null;
  amount: number;
  accountKind: 'bank' | 'card' | 'cash';
  accountScope: 'private' | 'business';
}

export interface CategorizeResult {
  categoryId: number;
  scope: 'private' | 'business';
}

export function normalize(text: string): string {
  return text
    .toUpperCase()
    .replace(/[\u0591-\u05C7]/g, '') // niqqud
    .replace(/[״”“]/g, '"')
    .replace(/[׳’‘]/g, "'")
    .replace(/[-_/\\.,:;*()|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A stable merchant key: "שופרסל דיל 123" and "שופרסל-דיל 456" match.
export function merchantKey(description: string): string {
  return normalize(description)
    .replace(/\d+/g, ' ')
    .replace(/["']/g, '')
    .split(' ')
    .filter((w) => w.length > 1)
    .slice(0, 3)
    .join(' ');
}

export class Categorizer {
  private rules: Rule[] = [];
  private slugs = new Map<string, number>();

  constructor(private db: DB) {
    this.reload();
  }

  reload(): void {
    // User rules (is_default = 0) beat default ones; longer patterns beat shorter.
    this.rules = this.db
      .prepare(
        `SELECT r.id, r.pattern, r.category_id, r.scope, r.account_kind, r.priority, c.kind, r.match
         FROM rules r JOIN categories c ON c.id = r.category_id
         ORDER BY r.match = 'merchant' DESC, r.is_default ASC, r.priority DESC, length(r.pattern) DESC, r.id DESC`,
      )
      .all() as unknown as Rule[];
    for (const row of this.db.prepare('SELECT id, slug FROM categories WHERE slug IS NOT NULL').all() as { id: number; slug: string }[]) {
      this.slugs.set(row.slug, row.id);
    }
  }

  categoryIdBySlug(slug: string): number {
    const id = this.slugs.get(slug);
    if (id === undefined) throw new Error(`Missing category ${slug}`);
    return id;
  }

  categorize(input: CategorizeInput): CategorizeResult {
    // Pad with spaces so whole-word patterns like " דן " match at either end of the text.
    const haystack = ` ${normalize(`${input.description} ${input.memo ?? ''}`)} `;
    const key = merchantKey(input.description);
    // Money coming in tries income rules first ("קצבת ילדים ביטוח לאומי" is an
    // allowance, not a Bituach Leumi payment). Income rules never match money out.
    const ordered = input.amount > 0 ? [...this.rules.filter((r) => r.kind === 'income'), ...this.rules.filter((r) => r.kind !== 'income')] : this.rules;
    for (const rule of ordered) {
      if (rule.account_kind && rule.account_kind !== input.accountKind) continue;
      if (rule.kind === 'income' && input.amount < 0) continue;
      // "This business is always this category" – the user's own choice, exact.
      if (rule.match === 'merchant') {
        if (rule.pattern === key) return { categoryId: rule.category_id, scope: rule.scope ?? input.accountScope };
        continue;
      }
      const needle = normalize(rule.pattern);
      if (!needle) continue;
      const padded = `${rule.pattern.startsWith(' ') ? ' ' : ''}${needle}${rule.pattern.endsWith(' ') ? ' ' : ''}`;
      if (haystack.includes(padded)) {
        return { categoryId: rule.category_id, scope: rule.scope ?? input.accountScope };
      }
    }
    if (input.amount > 0) {
      const slug = input.accountScope === 'business' ? 'income_business' : 'income_other';
      return { categoryId: this.categoryIdBySlug(slug), scope: input.accountScope };
    }
    return { categoryId: this.categoryIdBySlug('uncategorized'), scope: input.accountScope };
  }
}
