<?php
/* Renders the purchase screens for the browser check (buy.js), from the stand-in store in wcstub.php, as the live site would:
   a font page (like the theme's: the "קנה אותי" bar and its old purchase window), the pricing page, "order received" pages.
   Usage: php wp-snippet/tests/harness-buy.php OUTDIR */
require __DIR__ . '/wcstub.php';
$GLOBALS['user'] = (object) array( 'ID' => 8, 'user_login' => 'claude-test', 'roles' => array( 'customer' ) );
eval( fsa_stub_snippet() );
$O = $argv[1];
$head = '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>נוסטלה</title>%s</head><body>';
$font_page = '<header class="site-header" style="height:70px;background:#fff;border-bottom:1px solid #ddd"></header>
<div class="elementor-widget-container"><div class="entry-content">
<h1 style="font-size:80px;margin:40px 0;text-align:center">נוסטלה</h1>
<div class="elementor-widget-GlyphsViewWidget"><p class="gliph_box_large" style="font-family:Georgia,serif;font-size:40px;text-align:center">אבג</p></div><span class="fonts-weight" hidden>400</span>
<div class="r-bar" style="background:#d9d9d9;display:flex;justify-content:space-around;align-items:center;height:74px"><span>נוסטלה ▾</span><span>נסו אותי · המשקלים · האותיות</span><button class="r-open-purchase" style="background:linear-gradient(90deg,#B06BFF,#5B3FFF);color:#fff;border:0;border-radius:99px;padding:12px 24px;font-weight:700">קנה אותי</button></div>
<div style="height:900px"></div>
<div class="r-font-purchase" style="display:none;position:fixed;inset:0;background:#fff;z-index:50"><div class="r-font-purchase-div">חלון הרכישה הישן
<div class="r-license-info-webstop"><div><div class="elementor-widget-container"><span class="elementor-heading-title">רישיון וובפונט בקצרה</span></div><div class="elementor-widget-container"><p>מקבלים את הפורמטים otf, ttf, wof להתקנה במחשבי Mac ו-Pc ולהטמעה באתרים, עד 3 דומיינים וסאב דומיינים.</p><p>במסגרת הרישיון ניתן לעצב:</p><ul><li>תוצרי אינטרנט: אתרים, בלוגים, אינדקסים</li><li>תוצרי UI/UX: פיגמה (figma) אקסדי (Xd) לעיצוב האתר</li></ul><p><span><a href="https://site.test/licenses/">להרחבה</a></span></p></div></div></div>
<div class="r-license-info-desktop"><div><span class="elementor-heading-title">רישיון דקסטופ בקצרה</span><p>רישיון דסקטופ בקצרה<br>מקבלים פורמטים Otf, Ttf להתקנה על תוכנות גרפיות במחשבי מק (Mac) ופיסי (Pc).</p><ul><li>תוצרי תדפיס: פוסטרים, שלטים, אריזות</li></ul></div></div>
<div class="r-font-text"><div class="r-font-text-before">עמוד על סוג המשקל לתצוגה מקדימה</div><div class="r-font-text-demo">אבגדהוזחטיכלמנסעפצקרשת</div></div>
<a href="https://site.test/licenses/">למידע על רישיונות שימוש</a> <a href="https://site.test/contact/">לרישיון שמותאם לצרכים שלכם דברו איתנו</a></div></div>
</div></div>
<script>document.querySelectorAll(".r-open-purchase").forEach(e=>e.addEventListener("click",()=>{document.querySelector(".r-font-purchase").style.display="flex"}))</script>';
$pricing_page = '<div class="entry-content"><h1>תוכניות המינוי שלנו</h1>
<a class="elementor-button" id="pWeb" href="https://site.test/product/plan-12652/">אני רוצה וובסטופ</a>
<a class="elementor-button" id="pExtra" href="https://site.test/product/plan-14162">אני רוצה אקסטרה</a>
<a class="elementor-button" id="pDesk" href="https://site.test/?add-to-cart=22785">אני רוצה דסקטופ</a>
<a id="pNav" href="https://site.test/product/plan-12652/">מה זה וובסטופ?</a></div>';
$theme = file_get_contents( __DIR__ . '/theme.css' );
$render = function ( $name, $ctx, $body, $theme_css = '', $look = '' ) use ( $O, $head ) {
	$GLOBALS['page'] = $ctx['page']; $_GET = $ctx['get'] ?? array();
	$d = fsa_v2_buy_context();
	if ( ! $d ) { fwrite( STDERR, "no purchase screens for $name\n" ); exit( 1 ); }
	if ( $look ) $d['look'] = $look;
	ob_start(); echo sprintf( $head, $theme_css ? '<style>' . $theme_css . '</style>' : '' ) . $body . fsa_v2_buy_markup( $d, true ) . '</body></html>';
	file_put_contents( "$O/buy-$name.html", ob_get_clean() );
};
$render( 'font', array( 'page' => array( 'product' => 500 ) ), $font_page );
$render( 'font-theme', array( 'page' => array( 'product' => 500 ) ), $font_page, $theme );
$render( 'font-sheet', array( 'page' => array( 'product' => 500 ) ), $font_page, $theme, 'sheet' );
$render( 'pricing', array( 'page' => array( 'pricing' => 1 ) ), $pricing_page, $theme );
$render( 'paid', array( 'page' => array( 'received' => 901 ), 'get' => array( 'key' => 'wc_order_ok' ) ), '<h1>ההזמנה התקבלה</h1>' );
$render( 'failed', array( 'page' => array( 'received' => 902 ), 'get' => array( 'key' => 'wc_order_bad' ) ), '<h1>ההזמנה התקבלה</h1>' );
echo "ok\n";
