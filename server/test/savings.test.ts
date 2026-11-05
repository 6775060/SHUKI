import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { parseSavingsFile, productOf, saveSavings, savingsView } from '../src/savings.js';

const CSV = [
  'דוח מסלקה פנסיונית,,,,,,,',
  'שם הגוף המנהל,סוג מוצר,מספר פוליסה/חשבון,מסלול השקעה,סטטוס,יתרה צבורה,דמי ניהול מהצבירה,דמי ניהול מההפקדה,תאריך נכונות',
  'הראל,קרן פנסיה מקיפה,111,מסלול כללי,פעיל,"182,400",0.45%,2.5%,30/06/2026',
  'הפניקס,קרן פנסיה מקיפה,222,כללי,לא פעיל,23100,0.0025,0,31/12/2025',
  'אלטשולר שחם,קרן השתלמות,333,מנייתי,פעיל,61200,0.7,,30/06/2026',
  'סה"כ,,,,,266700,,,',
].join('\n');

describe('savings', () => {
  it('reads a clearing-house style export', async () => {
    const r = await parseSavingsFile('mislaka.csv', Buffer.from(CSV));
    expect(r.accounts).toHaveLength(3);
    expect(r.accounts[0]).toMatchObject({ provider: 'הראל', product: 'pension', balance: 182400, feeBalancePct: 0.45, feeDepositPct: 2.5, balanceDate: '2026-06-30', status: 'active' });
    expect(r.accounts[1]).toMatchObject({ status: 'inactive', feeBalancePct: 0.25 });
    expect(r.accounts[2]).toMatchObject({ product: 'hishtalmut', feeBalancePct: 0.7 });
  });

  it('names products', () => {
    expect(productOf('ביטוח מנהלים')).toBe('managers');
    expect(productOf('קופת גמל להשקעה')).toBe('gemel_invest');
    expect(productOf('תגמולים ופיצויים')).toBe('gemel');
  });

  it('points at high fees and forgotten accounts, and re-import updates in place', async () => {
    const db = openDb('', ':memory:');
    const r = await parseSavingsFile('mislaka.csv', Buffer.from(CSV));
    expect(saveSavings(db, r.accounts.map((a) => (a.provider === 'הראל' ? { ...a, monthlyDeposit: 1500 } : a)), 'import')).toEqual({ added: 3, updated: 0 });
    expect(saveSavings(db, r.accounts, 'import')).toEqual({ added: 0, updated: 3 });
    const v = savingsView(db, '2026-10-27');
    expect(v.total).toBe(266700);
    expect(v.insights.some((i) => i.title.includes('הראל'))).toBe(true);
    expect(v.insights.some((i) => i.title.includes('לא פעיל'))).toBe(true);
    expect(v.feeSave).toBeGreaterThan(400);
  });
});
