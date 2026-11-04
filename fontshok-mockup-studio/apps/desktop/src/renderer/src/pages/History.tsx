import { useEffect, useState } from 'react';
import type { ExportRecord } from '@fontshok/shared';
import { api } from '../api';
import { Empty } from '../ui';

export function HistoryPage() {
  const [exports, setExports] = useState<(ExportRecord & { groupCode: string })[]>([]);
  const [audit, setAudit] = useState<{ at: string; actor: string; action: string; data: unknown }[]>([]);
  useEffect(() => {
    void api.listExports().then(setExports);
    void api.listAudit().then(setAudit);
  }, []);
  return (
    <div className="split">
      <section className="panel list">
        <h2>ייצואים ({exports.length})</h2>
        {exports.length === 0 ? (
          <Empty>עוד לא יוצאו קבצים</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>תאריך</th>
                <th>קבוצה</th>
                <th>קובץ</th>
              </tr>
            </thead>
            <tbody>
              {exports.map((e) => (
                <tr key={e.id}>
                  <td>{e.exportedAt}</td>
                  <td>{e.groupCode}</td>
                  <td>
                    <button className="link" onClick={() => void window.studio.reveal(e.path)}>
                      {e.path.split(/[\\/]/).pop()}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="panel detail">
        <h2>יומן פעולות</h2>
        <table className="table small">
          <tbody>
            {audit.map((a, i) => (
              <tr key={i}>
                <td>{a.at}</td>
                <td>{a.actor}</td>
                <td dir="ltr">{a.action}</td>
                <td dir="ltr" className="muted">
                  {JSON.stringify(a.data).slice(0, 140)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
