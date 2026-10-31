<?php
/**
 * Licence certificate per registered domain (spec §1.3, §6). Same layout as the prototype's cert().
 * PDF through mPDF when installed (composer require mpdf/mpdf in this folder); otherwise a printable HTML page.
 */
defined( 'ABSPATH' ) || exit;

final class FS_Acc2_Certificates {

	const PLAN_NAMES = array(
		'extra' => array( 'אקסטרה', 'Extra Brand' ),
		'web'   => array( 'וובסטופ', 'Webstop' ),
		'buy'   => array( 'רכישה בודדת', 'Single license' ),
	);

	private static function body_text( array $row ): string {
		if ( 'lic' === $row['source'] ) {
			return 'רישיון וובפונט לפונט שנרכש. השימוש מותר לעיצוב ממשק משתמש (UI) ולהטמעה באתר שכתובתו מצוינת לעיל. הרישיון לצמיתות.';
		}
		if ( 'extra' === $row['plan'] ) {
			return 'רישיון זה מכסה את הדומיין הרשום במסגרת מינוי אקסטרה, הכולל רישום דומיינים ללא הגבלה, אתרים, אפליקציות ודסקטופ. הרישיון בתוקף כל עוד המינוי פעיל.';
		}
		return sprintf( 'רישיון זה מכסה את הדומיין הרשום בלבד, במסגרת מכסת %d דומיינים חודשיים במינוי וובסטופ. השימוש מותר לעיצוב ממשק משתמש (UI) ולהטמעה באתר שכתובתו מצוינת לעיל, כל עוד המינוי פעיל.', FS_Acc2_Rules::WEB_MONTHLY_QUOTA );
	}

	public static function html( array $row, ?array $lic, WP_User $user, bool $valid ): string {
		$plan  = self::PLAN_NAMES[ 'lic' === $row['source'] ? 'buy' : $row['plan'] ] ?? self::PLAN_NAMES['web'];
		$fonts = implode( ', ', json_decode( $row['fonts'] ?: '[]', true ) ?: array() );
		$biz   = (string) get_user_meta( $user->ID, 'billing_company', true );
		$e     = 'esc_html';
		$css   = 'body{font-family:Discovery_Fs,Heebo,Arial,sans-serif;direction:rtl;margin:0;color:#151515;font-size:13px}'
			. '.cert{border:1.5px solid #151515;margin:18px;position:relative}.head{background:#F6F1FF;border-bottom:1.5px solid #151515;text-align:center;padding:22px}'
			. '.head h2{margin:0;font-size:26px}.b{padding:22px 30px}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 10px}dt{font-weight:700}dd{margin:0}'
			. '.void{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:72px;color:rgba(255,30,30,.18);transform:rotate(-20deg);pointer-events:none}';
		$removed = 'removed' === $row['status'] && $row['removed_at']
			? '<p style="color:#B00000">הדומיין הוסר מהחשבון ב־' . $e( get_date_from_gmt( $row['removed_at'], 'd.m.Y' ) ) . '. הרישיון היה בתוקף בתקופה ' . $e( get_date_from_gmt( $row['created_at'], 'd.m.Y' ) ) . '–' . $e( get_date_from_gmt( $row['removed_at'], 'd.m.Y' ) ) . '.</p>'
			: '';
		return '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>רישיון ' . $e( $row['host'] ) . '</title><style>' . $css . '</style></head><body>'
			. '<div class="cert">' . ( $valid ? '' : '<div class="void">לא בתוקף</div>' )
			. '<div class="head"><h2>רישיון פונט לדומיין</h2></div><div class="b">'
			. '<p><span style="color:#6E6E6E">רושם הרישיון</span><br><b style="font-size:20px">' . $e( $user->display_name ) . '</b><br>' . $e( $user->user_email ) . ( $biz ? '<br>' . $e( $biz ) : '' ) . '</p>'
			. '<p>מונפק על ידי פונטשוק בע״מ · מספר רישיון: ' . (int) $row['cert_no'] . '</p>'
			. '<p>בהתאם להסכם הרישוי ותנאי השימוש של פונטשוק בע״מ, מאושר בזאת כי הפונט הרשום להלן מותר לשימוש בתחומי עיצוב ממשק והטמעה באתר הרשום בלבד, תחת הדומיין שלהלן:</p>'
			. '<dl><dt>שם האתר:</dt><dd>' . $e( $row['site_name'] ) . '</dd><dt>כתובת הדומיין:</dt><dd dir="ltr" style="text-align:right">' . $e( $row['host'] ) . '</dd>'
			. '<dt>רישיון לפונט:</dt><dd>' . $e( $fonts ) . '</dd><dt>תאריך רישום:</dt><dd>' . $e( get_date_from_gmt( $row['created_at'], 'd.m.Y' ) ) . '</dd>'
			. '<dt>מינוי:</dt><dd>' . $e( $plan[0] . ' (' . $plan[1] . ')' ) . '</dd><dt>סוג רישיון:</dt><dd>' . $e( $lic ? $lic['type'] : 'וובפונט' ) . '</dd></dl>'
			. '<p>' . $e( self::body_text( $row ) ) . '</p>' . $removed
			. '<p>בברכה,<br>צוות פונטשוק<br>support@fontshok.co.il</p></div></div></body></html>';
	}

	public static function send( array $row, ?array $lic, WP_User $user, bool $valid, string $format ): void {
		$html = self::html( $row, $lic, $user, $valid );
		nocache_headers();
		header( 'Cache-Control: private, no-store' );
		$autoload = __DIR__ . '/../vendor/autoload.php';
		if ( 'pdf' === $format && is_readable( $autoload ) ) {
			require_once $autoload;
		}
		if ( 'pdf' === $format && class_exists( '\Mpdf\Mpdf' ) ) {
			$mpdf = new \Mpdf\Mpdf( array( 'mode' => 'utf-8', 'format' => 'A4', 'directionality' => 'rtl', 'autoScriptToLang' => true, 'autoLangToFont' => true ) );
			$mpdf->WriteHTML( $html );
			$mpdf->Output( 'fontshok-licence-' . (int) $row['cert_no'] . '.pdf', \Mpdf\Output\Destination::DOWNLOAD );
			return;
		}
		header( 'Content-Type: text/html; charset=utf-8' );
		echo $html; // all dynamic values escaped above
	}
}
