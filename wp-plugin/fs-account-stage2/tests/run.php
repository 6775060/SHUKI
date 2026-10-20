<?php
/** Plain-PHP tests for FS_Acc2_Rules (no WordPress needed): php tests/run.php */
define( 'FS_ACC2_TESTING', true );
require __DIR__ . '/../includes/class-rules.php';

$fail = 0;
$n    = 0;
function eq( $got, $want, string $msg ): void {
	global $fail, $n;
	$n++;
	if ( $got !== $want ) {
		$fail++;
		echo "FAIL $msg\n  got:  " . var_export( $got, true ) . "\n  want: " . var_export( $want, true ) . "\n";
	}
}
$R = 'FS_Acc2_Rules';

// host normalisation (prototype cleanHost + port/IDN/label checks)
eq( $R::normalize_host( 'https://www.Studio-Dayan.co.il/about?x=1' ), 'studio-dayan.co.il', 'scheme, www, path, case' );
eq( $R::normalize_host( '  agala.co.il  ' ), 'agala.co.il', 'trim' );
eq( $R::normalize_host( 'shop.example.com:8080' ), 'shop.example.com', 'port' );
eq( $R::normalize_host( 'example.com.' ), 'example.com', 'trailing dot' );
eq( $R::normalize_host( 'localhost' ), null, 'needs a dot' );
eq( $R::normalize_host( '' ), null, 'empty' );
eq( $R::normalize_host( 'bad_host.com' ), null, 'underscore' );
eq( $R::normalize_host( '-bad.com' ), null, 'leading hyphen' );
eq( $R::normalize_host( str_repeat( 'a', 64 ) . '.com' ), null, 'label > 63' );
if ( function_exists( 'idn_to_ascii' ) ) {
	$puny = $R::normalize_host( 'פונטשוק.co.il' );
	eq( is_string( $puny ) && 0 === strpos( $puny, 'xn--' ) ? idn_to_utf8( $puny ) : $puny, 'פונטשוק.co.il', 'IDN to punycode (round-trip)' );
}

// site names (prototype siteName)
eq( $R::site_name( 'studio-dayan.co.il' ), 'Studio Dayan', 'co.il' );
eq( $R::site_name( 'or-org.org.il' ), 'Or Org', 'org.il' );
eq( $R::site_name( 'fontshok.com' ), 'Fontshok', '.com' );
eq( $R::site_name( 'shop.brand.co.il' ), 'Brand', 'subdomain' );

// cycles in Israel time
$utc = new DateTimeZone( 'UTC' );
eq( $R::cycle( new DateTimeImmutable( '2026-10-31 22:30:00', $utc ) ), '2026-11', '00:30 on 1 Nov (UTC+2 after DST ends) is November' );
eq( $R::cycle( new DateTimeImmutable( '2026-10-31 21:59:00', $utc ) ), '2026-10', '23:59 on 31 Oct is October' );
eq( $R::cycle( new DateTimeImmutable( '2026-06-30 21:30:00', $utc ) ), '2026-07', '00:30 on 1 Jul (UTC+3, summer) is July' );
eq( $R::next_cycle_start( '2026-12' )->format( 'Y-m-d H:i' ), '2027-01-01 00:00', 'year rollover' );

// locking
eq( $R::is_locked( 'sub', '2026-09', '2026-10' ), true, 'last month locked' );
eq( $R::is_locked( 'sub', '2026-10', '2026-10' ), false, 'this month editable' );
eq( $R::is_locked( 'lic', '2025-01', '2026-10' ), false, 'licence sites never lock' );

// quota
eq( $R::quota( 'web', 2, 0 )['left'], 1, 'web 2/3' );
eq( $R::quota( 'web', 3, 0 )['left'], 0, 'web full' );
eq( $R::quota( 'web', 3, 1 )['limit'], 4, 'add-on +1' );
eq( $R::quota( 'extra', 50, 0 )['unlimited'], true, 'extra unlimited' );
eq( $R::quota( null, 0, 0 )['allowed'], false, 'no plan' );

// fonts
eq( $R::clean_fonts( array( 'פורטו', ' טאלנט ', 'פורטו' ) ), array( array( 'פורטו', 'טאלנט' ), null ), 'trim + dedupe' );
eq( $R::clean_fonts( array() )[1], 'fonts_required', 'none' );
eq( $R::clean_fonts( 'x' )[1], 'fonts_required', 'not array' );
eq( $R::clean_fonts( array( 'a', 'b', 'c' ) )[1], 'fonts_max_2', 'max 2' );

// migration: default classification of order lines (names as they appear in "הזמנות")
eq( $R::classify_item_name( 'וובסטופ · חידוש חודשי' )['plan'], 'web', 'webstop renewal' );
eq( $R::classify_item_name( 'אקסטרה · חידוש חודשי' )['plan'], 'extra', 'extra renewal' );
eq( $R::classify_item_name( 'תניא · וובפונט' ), array( 'kind' => 'licence', 'plan' => null, 'font' => 'תניא', 'type' => 'וובפונט' ), 'web licence' );
eq( $R::classify_item_name( 'דיסקברי · דסקטופ' )['type'], 'דסקטופ', 'desktop licence' );
eq( $R::classify_item_name( 'פורטו · וובפונט + דסקטופ' )['type'], 'וובפונט + דסקטופ', 'web + desktop' );
eq( $R::classify_item_name( 'דומיין נוסף' )['kind'], 'addon', 'add-on' );
eq( $R::classify_item_name( 'אומץ · פרינט' )['kind'], null, 'print licence is not a web/desktop licence' );

echo ( $fail ? "$fail of $n FAILED\n" : "all $n passed\n" );
exit( $fail ? 1 : 0 );
