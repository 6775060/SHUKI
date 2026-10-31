# תיקון 3 השגיאות באתר

שלושה קטעי קוד באתר רצים בכל עמוד, ונופלים בעמודים שבהם האלמנט שהם מחפשים לא קיים. התיקון בכל אחד: לבדוק שהאלמנט קיים לפני שמשתמשים בו. ההתנהגות בעמודים שבהם הם כן עובדים לא משתנה (נבדק על עמוד הפונט נוסטלה, דף הבית והאזור האישי: 0 שגיאות, והכפתורים "לסל", הדמו וההוספה לסל עובדים כמו קודם).

## איפה הם נמצאים
הקוד מופיע בכל עמוד, אז הוא כנראה באחד מאלה. בכל מקום מחפשים את המילה שבסוגריים:
1. **Snippets** (תיבת החיפוש למעלה)
2. **Elementor ← Custom Code**
3. **Elementor ← Templates ← Theme Builder**: תבנית ה-Header או ה-Footer, ובתוכה ווידג'ט **HTML**
4. **הגדרות האתר של Elementor ← Custom JS**

## 1. חלון הרכישה (מחפשים: `open purchase popup`)
**שינוי של שתי שורות:**
- בהתחלה, לפני השורה `//open purchase popup`, מוסיפים:
```
if (document.querySelector(".r-font-purchase")) {
```
- בסוף, אחרי השורה האחרונה של הקוד (לפני `</script>` אם יש), מוסיפים:
```
}
```
(הגרסה המלאה אחרי התיקון: `fix-1-purchase.js`)

## 2. הברכה בכותרת (מחפשים: `updateGreeting`)
**מוסיפים שורה אחת** מיד אחרי השורה `const spanElement = document.querySelector('#go_to_account .elementor-button-text');`:
```
  if (!spanElement) return;
```

## 3. כפתור המשוב (מחפשים: `r-feedback-btn`)
**מחליפים** את שלוש השורות:
```
document.querySelector(".r-feedback-btn").addEventListener("click", function(){
document.querySelector(".r-feedback").classList.toggle("open");
});
```
**ב:**
```
var rFeedbackBtn = document.querySelector(".r-feedback-btn");
if (rFeedbackBtn) { // the feedback button is not on every page
  rFeedbackBtn.addEventListener("click", function(){
    document.querySelector(".r-feedback").classList.toggle("open");
  });
}
```

## אחרי השמירה
לנקות מטמון אם יש תוסף מטמון (למשל LiteSpeed / WP Rocket), ולכתוב לי. אבדוק שוב בעצמי שהשגיאות נעלמו.
