import { useEffect, useState } from 'react';
import type { CycleView } from '../api';
import { money } from '../format';

// The "pause" protocol from the spec (9.4), for the moment stress about money
// rises – the kid asks for a burekas and the old fear answers. Four short
// steps, with the real numbers on screen so the answer comes from today.

export function CalmButton({ cycle }: { cycle: CycleView | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="calm-btn" onClick={() => setOpen(true)}>
        🫶 רגע של לחץ?
      </button>
      {open && <CalmDialog cycle={cycle} onClose={() => setOpen(false)} />}
    </>
  );
}

function CalmDialog({ cycle, onClose }: { cycle: CycleView | null; onClose: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const joy = cycle?.week.joy ?? 0;
  const steps = [
    {
      title: 'עצור',
      body: (
        <>
          <p className="big-calm">נשימה אחת עמוקה. ועוד אחת.</p>
          <p>מה שמרגישים עכשיו הוא תגובת לחץ – לא סכנה. הגוף זוכר משהו מפעם. אתה כאן, היום, עם תוכנית.</p>
        </>
      ),
    },
    {
      title: 'בדוק מציאות',
      body: cycle ? (
        <div className="calm-facts">
          <div>
            <span>השבוע נשארו להוצאות משתנות</span>
            <b className={cycle.week.left < 0 ? 'warm' : 'pos'}>{money(cycle.week.left)}</b>
          </div>
          <div>
            <span>כסף קטן לשמחה השבוע, מופרש מראש</span>
            <b>{money(joy)}</b>
          </div>
          <div>
            <span>צפי לסוף החודש התזרימי</span>
            <b className={cycle.forecastEnd < 0 ? 'warm' : 'pos'}>{money(cycle.forecastEnd)}</b>
          </div>
          <div>
            <span>חיובים קבועים, תשלומים וקופות</span>
            <b>כבר בחשבון ✓</b>
          </div>
        </div>
      ) : (
        <p>המספרים יופיעו כאן אחרי שהחשבונות יסונכרנו.</p>
      ),
    },
    {
      title: 'הפרד',
      body: (
        <>
          <p className="big-calm">זו ההחלטה של היום – או הפחד של אז?</p>
          <p>הילד שראה חובות בבית למד לוותר כדי לא להיות נטל. היום אתה המבוגר, והמספרים מולך.</p>
        </>
      ),
    },
    {
      title: 'בחר',
      body:
        joy > 0 ? (
          <>
            <p className="big-calm">יש {money(joy)} לשמחה השבוע.</p>
            <p>אפשר לומר "כן" – בשמחה ובלב שלם. זה תוכנן בדיוק בשביל הרגע הזה.</p>
          </>
        ) : (
          <>
            <p className="big-calm">"לא היום – בוא נתכנן את זה לשישי."</p>
            <p>אפשר לומר "לא" בקול רגוע וחם. "לא עכשיו" הוא לא "אין לנו". ואם הייתה כבר תגובה חריפה – "אבא נלחץ קודם, זה לא קשור אליך" מתקן הכול.</p>
          </>
        ),
    },
  ];

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="calm-title" onClick={onClose}>
      <div className="calm-card" onClick={(e) => e.stopPropagation()}>
        <div className="calm-steps">
          {steps.map((s, i) => (
            <button key={s.title} className={i === step ? 'calm-step active' : i < step ? 'calm-step done' : 'calm-step'} onClick={() => setStep(i)}>
              {i + 1}. {s.title}
            </button>
          ))}
        </div>
        <h2 id="calm-title">{steps[step].title}</h2>
        <div className="calm-body">{steps[step].body}</div>
        <div className="row between">
          <button className="ghost" onClick={onClose}>
            סגירה
          </button>
          {step < steps.length - 1 ? (
            <button className="primary" onClick={() => setStep(step + 1)}>
              הלאה
            </button>
          ) : (
            <button className="primary" onClick={onClose}>
              אני רגוע יותר 🙏
            </button>
          )}
        </div>
        <p className="calm-quote">"כל מזונותיו של אדם קצובים לו מראש השנה" – ביצה טז.</p>
      </div>
    </div>
  );
}
