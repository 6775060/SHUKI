<?php
/* Domain register/edit/remove against an in-memory copy of the Easy Font Table table.
   Usage: php wp-snippet/tests/domains-test.php */
define( 'ABSPATH', '/' ); define( 'HOUR_IN_SECONDS', 3600 );
$GLOBALS['user'] = (object) array( 'ID' => 7, 'user_login' => 'claude-test', 'roles' => array( 'customer', 'member-webstop' ) );
$GLOBALS['nonce_ok'] = true; $GLOBALS['now'] = array( 2026, 10 );
function add_action( ...$a ) {} function add_filter( ...$a ) {} function add_shortcode( ...$a ) {}
$GLOBALS['admin'] = false; function current_user_can( $c ) { return $GLOBALS['admin']; }
function update_user_meta( $u, $k, $v ) { $GLOBALS['meta'][ $u ][ $k ] = $v; } function delete_user_meta( $u, $k ) { unset( $GLOBALS['meta'][ $u ][ $k ] ); } function is_user_logged_in() { return true; } function wp_get_current_user() { return $GLOBALS['user']; } function get_current_user_id() { return $GLOBALS['user']->ID; }
function check_ajax_referer() { return $GLOBALS['nonce_ok']; } function sanitize_key( $s ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( $s ) ); }
function sanitize_text_field( $s ) { return trim( strip_tags( (string) $s ) ); } function wp_unslash( $s ) { return $s; }
$GLOBALS['meta'] = array(); function get_user_meta( $u, $k, $x = false ) { return $GLOBALS['meta'][ $u ][ $k ] ?? ''; }
$GLOBALS['day'] = 15; define( 'DAY_IN_SECONDS', 86400 );
function current_time( $f ) { $n = $GLOBALS['now']; if ( 'j' === $f ) return $GLOBALS['day']; if ( 't' === $f ) return (int) date( 't', mktime( 0, 0, 0, $n[1], 1, $n[0] ) ); if ( 'd.m.Y H:i' === $f ) return 'now'; return 'Y-m-d' === $f ? sprintf( '%d-%02d-15', $n[0], $n[1] ) : ( 'Y' === $f ? $n[0] : $n[1] ); }
function get_field( $k, $o ) { return 'list_of_fonts_for_domain_registration' === $k ? 'פורטו, טאלנט, דיסקברי' : array(); }
function wp_list_pluck( $l, $f ) { return array_map( function ( $x ) use ( $f ) { return is_array( $x ) ? $x[ $f ] : $x->$f; }, $l ); }
class Done extends Exception { public $ok; public $data; function __construct( $ok, $d ) { $this->ok = $ok; $this->data = $d; } }
function wp_send_json_error( $d ) { throw new Done( false, $d ); } function wp_send_json_success( $d ) { throw new Done( true, $d ); }
/* a tiny wpdb over an array, enough for the queries the snippet runs */
class FakeDB {
	public $prefix = 'wp_'; public $rows = array(); public $next = 1;
	function prepare( $q, ...$a ) { $i = 0; return preg_replace_callback( '/%[dsf]/', function ( $m ) use ( &$i, $a ) { $v = $a[ $i++ ]; return '%d' === $m[0] ? (int) $v : "'" . addslashes( $v ) . "'"; }, $q ); }
	private function where( $q ) { preg_match( '/WHERE (.*?)(ORDER BY|$)/s', $q, $m ); $conds = $m ? preg_split( '/\s+AND\s+/', trim( $m[1] ) ) : array();
		return array_values( array_filter( $this->rows, function ( $r ) use ( $conds ) { foreach ( $conds as $c ) { if ( ! preg_match( "/(\w+)\s*(<>|=)\s*'?(.*?)'?$/", trim( $c ), $x ) ) continue; $v = stripslashes( $x[3] ); $eq = (string) $r[ $x[1] ] === $v; if ( '=' === $x[2] ? ! $eq : $eq ) return false; } return true; } ) ); }
	function get_var( $q ) { if ( 0 === strpos( $q, 'SHOW TABLES' ) ) return 'wp_easy_font_domains'; $r = $this->where( $q ); if ( false !== strpos( $q, 'COUNT(*)' ) ) return count( $r ); return $r ? $r[0]['id'] : null; }
	function get_row( $q ) { $r = $this->where( $q ); return $r ? (object) $r[0] : null; }
	function get_results( $q ) { $r = $this->where( $q ); usort( $r, function ( $a, $b ) { return [ $b['year'], $b['month'], $a['domain_slot'] ] <=> [ $a['year'], $a['month'], $b['domain_slot'] ]; } ); return array_map( function ( $x ) { return (object) $x; }, $r ); }
	function insert( $t, $d ) { foreach ( $this->rows as $r ) if ( $r['user_id'] == $d['user_id'] && $r['year'] == $d['year'] && $r['month'] == $d['month'] && $r['domain_slot'] == $d['domain_slot'] ) return false; $d['id'] = $this->next++; $d['created_at'] = sprintf( '%d-%02d-05 10:00:00', $d['year'], $d['month'] ); $this->rows[] = $d; return 1; }
	function update( $t, $d, $w ) { $n = 0; foreach ( $this->rows as &$r ) { if ( array_diff_assoc( array_map( 'strval', $w ), array_map( 'strval', array_intersect_key( $r, $w ) ) ) ) continue; $r = array_merge( $r, $d ); $n++; } return $n; }
	function delete( $t, $w ) { $b = count( $this->rows ); $this->rows = array_values( array_filter( $this->rows, function ( $r ) use ( $w ) { foreach ( $w as $k => $v ) if ( (string) $r[ $k ] !== (string) $v ) return true; return false; } ) ); return $b - count( $this->rows ); }
}
$GLOBALS['wpdb'] = new FakeDB();
$GLOBALS['mails'] = array(); function wp_mail( $to, $s, $b, $h ) { $GLOBALS['mails'][] = array( $to, $s, $b ); return true; }
function get_userdata( $id ) { return (object) array( 'ID' => $id, 'first_name' => 'דנה', 'last_name' => 'לוי', 'display_name' => 'd', 'user_email' => "u$id@x" ); }
function get_option( $k, $d = false ) { return 'admin_email' === $k ? 'owner@x' : ( $GLOBALS['opt'][ $k ] ?? $d ); } function admin_url( $p = '' ) { return 'https://fontshok.co.il/wp-admin/' . $p; }
function home_url( $p = '' ) { return 'https://fontshok.co.il' . $p; } function wp_salt() { return 'salt'; } function add_query_arg( $a, $u ) { return $u . '?' . http_build_query( $a ); }
function esc_html( $s ) { return htmlspecialchars( $s ); } function esc_url( $s ) { return $s; }
eval( file_get_contents( __DIR__ . '/../fsa-v2-snippet.php' ) );

$fail = 0; $t = function ( $ok, $m ) use ( &$fail ) { echo ( $ok ? 'ok   ' : 'FAIL ' ) . $m . "\n"; if ( ! $ok ) $fail++; };
$call = function ( $post ) { $_POST = $post; try { fsa_v2_dom_ajax(); } catch ( Done $d ) { return $d; } return null; };
$add = function ( $host, $fonts = 'פורטו' ) use ( $call ) { return $call( array( 'op' => 'add', 'host' => $host, 'name' => '', 'fonts' => $fonts ) ); };
global $wpdb;
// old record from September (history), like the ones customers already have
$wpdb->rows[] = array( 'id' => 900, 'user_id' => 7, 'year' => 2026, 'month' => 9, 'domain_slot' => 1, 'domain_name' => 'ישן', 'domain_url' => 'old.co.il', 'font_name' => 'טאלנט', 'created_at' => '2026-09-03 09:00:00' );
$t( 1 === count( fsa_v2_domains( 7 ) ) && '03.09.2026' === fsa_v2_domains( 7 )[0][0], 'existing records are read, dated by when they were registered' );
$r = $add( 'https://www.Studio-A.co.il/about' ); $t( $r->ok && 'studio-a.co.il' === $r->data['domains'][0][2], 'register: address is cleaned (https, www, path)' );
$t( 1 === $wpdb->rows[1]['domain_slot'] && 10 === $wpdb->rows[1]['month'], 'register uses slot 1 of this month, same as the old form' );
$t( ! $add( 'studio-a.co.il' )->ok, 'the same address twice in a month is refused' );
$t( $add( 'b.co.il' )->ok && $add( 'c.co.il' )->ok, 'second and third domains' );
$r = $add( 'd.co.il' ); $t( ! $r->ok && false !== strpos( $r->data['message'], 'כבר רשומים' ), 'webstop: the 4th domain this month is refused' );
$GLOBALS['meta'][7]['fsa_v2_bonus_2026_10'] = 1; $t( $add( 'bought.co.il' )->ok, 'after buying the ₪79 add-on: a 4th domain fits this month' );
$t( ! $add( 'e.co.il' )->ok, 'and a 5th does not' );
$wpdb->rows = array_values( array_filter( $wpdb->rows, function ( $r ) { return 'bought.co.il' !== $r['domain_url']; } ) ); unset( $GLOBALS['meta'][7]['fsa_v2_bonus_2026_10'] );
// special arrangement (admin page): +2 a month, optionally until a date
$_POST = array( 'fsa_deal_extra' => '2', 'fsa_deal_until' => '2026-10-31', 'fsa_deal_note' => 'קמפיין' ); fsa_v2_deal_save( 7 );
$t( ! isset( $GLOBALS['meta'][7]['fsa_v2_deal_extra'] ), 'a customer cannot give themselves an arrangement' );
$GLOBALS['admin'] = true; fsa_v2_deal_save( 7 ); $GLOBALS['admin'] = false;
$t( 2 === $GLOBALS['meta'][7]['fsa_v2_deal_extra'] && '2026-10-31' === $GLOBALS['meta'][7]['fsa_v2_deal_until'], 'admin saves the arrangement' );
$t( $add( 'deal1.co.il' )->ok && $add( 'deal2.co.il' )->ok, 'arrangement +2: a 4th and 5th domain fit this month' );
$t( ! $add( 'deal3.co.il' )->ok, 'and a 6th does not' );
$GLOBALS['meta'][7]['fsa_v2_deal_until'] = '2026-10-14'; $t( 0 === fsa_v2_deal_extra( 7 ), 'after the end date the arrangement stops' );
$GLOBALS['meta'][7]['fsa_v2_deal_until'] = ''; $t( 2 === fsa_v2_deal_extra( 7 ), 'no end date: always on' );
$_POST = array( 'fsa_deal_extra' => '0', 'fsa_deal_until' => 'nonsense', 'fsa_deal_note' => '' ); $GLOBALS['admin'] = true; fsa_v2_deal_save( 7 ); $GLOBALS['admin'] = false;
$t( ! isset( $GLOBALS['meta'][7]['fsa_v2_deal_extra'] ) && 0 === fsa_v2_deal_extra( 7 ), 'setting 0 removes the arrangement' );
$wpdb->rows = array_values( array_filter( $wpdb->rows, function ( $r ) { return 0 !== strpos( $r['domain_url'], 'deal' ); } ) );
$t( ! $add( 'bad address' )->ok, 'invalid address refused' );
$t( ! $add( 'e.co.il', 'פורטו, טאלנט, דיסקברי' )->ok, 'more than 2 fonts refused' );
$t( ! $add( 'e.co.il', 'פונט אחר' )->ok, 'font outside the registration list refused' );
$t( ! $add( 'e.co.il', '' )->ok, 'no font refused' );
$id = $wpdb->rows[1]['id'];
$r = $call( array( 'op' => 'edit', 'id' => $id, 'host' => 'studio-b.co.il', 'name' => 'סטודיו', 'fonts' => 'טאלנט' ) ); $t( $r->ok && 'studio-b.co.il' === $wpdb->rows[1]['domain_url'] && 'סטודיו' === $wpdb->rows[1]['domain_name'], 'edit this month\'s domain' );
$t( ! $call( array( 'op' => 'edit', 'id' => 900, 'host' => 'x.co.il', 'fonts' => 'טאלנט' ) )->ok, 'a domain from last month is locked' );
$t( ! $call( array( 'op' => 'del', 'id' => 900 ) )->ok && 'old.co.il' === $wpdb->rows[0]['domain_url'], 'and cannot be removed' );
$r = $call( array( 'op' => 'del', 'id' => $id ) ); $t( $r->ok && 3 === count( $r->data['domains'] ), 'remove frees the slot' );
$t( $add( 'd.co.il' )->ok, 'after removing, a new domain fits in the freed slot' );
$wpdb->rows[] = array( 'id' => 950, 'user_id' => 8, 'year' => 2026, 'month' => 10, 'domain_slot' => 1, 'domain_name' => 'זר', 'domain_url' => 'other.co.il', 'font_name' => 'פורטו', 'created_at' => '2026-10-02 09:00:00' );
$t( ! $call( array( 'op' => 'del', 'id' => 950 ) )->ok && in_array( 'other.co.il', wp_list_pluck( $wpdb->rows, 'domain_url' ), true ), 'another customer\'s domain cannot be touched' );
$GLOBALS['user']->roles = array( 'customer', 'member-extra' );
$ok = true; foreach ( array( 'e1', 'e2', 'e3', 'e4', 'e5' ) as $h ) $ok = $ok && $add( "$h.co.il" )->ok; $t( $ok, 'extra: unlimited domains' );
$GLOBALS['user']->roles = array( 'customer', 'member-desktop' ); $t( ! $add( 'z.co.il' )->ok, 'desktop plan: no domains' );
$GLOBALS['user']->roles = array( 'customer', 'member-barter' ); $GLOBALS['user']->ID = 9;
$t( array( 'barter', false ) === fsa_v2_plan_info( $GLOBALS['user'] ), 'barter: same as Webstop (web files too)' );
$t( $add( 'b1.co.il' )->ok && $add( 'b2.co.il' )->ok && $add( 'b3.co.il' )->ok && ! $add( 'b4.co.il' )->ok, 'barter: 3 domains a month, like Webstop' );
$GLOBALS['user']->ID = 7;
$GLOBALS['user']->roles = array( 'customer' ); $t( ! $add( 'z.co.il' )->ok, 'no subscription: refused' );
$GLOBALS['user']->roles = array( 'customer', 'member-webstop' ); $GLOBALS['nonce_ok'] = false; $t( ! $add( 'z.co.il' )->ok, 'bad nonce refused' );
$GLOBALS['nonce_ok'] = true; $GLOBALS['user']->user_login = 'someone'; $GLOBALS['user']->ID = 8; $GLOBALS['user']->roles = array( 'customer', 'member-webstop' );
$t( $add( 'z.co.il' )->ok, 'open to subscribers: any Webstop subscriber can register' );
$GLOBALS['user']->roles = array( 'customer' ); $t( ! $add( 'zz.co.il' )->ok, 'a customer without a subscription cannot' );
// academic: 3 domains a calendar year (not a month), no paid add-on
$GLOBALS['user']->ID = 12; $GLOBALS['user']->roles = array( 'customer', 'member-academic' ); $GLOBALS['now'] = array( 2026, 3 );
$t( $add( 'a1.co.il' )->ok && $add( 'a2.co.il' )->ok, 'academic: first two domains in March' );
$GLOBALS['now'] = array( 2026, 10 ); $t( ! $add( 'a1.co.il' )->ok, 'academic: the same address again in the same year is refused' );
$t( $add( 'a3.co.il' )->ok, 'academic: third domain in October' );
$r = $add( 'a4.co.il' ); $t( ! $r->ok && false !== strpos( $r->data['message'], 'השנה' ), 'academic: a 4th domain in the same year is refused' );
$GLOBALS['meta'][12]['fsa_v2_bonus_2026_10'] = 1; $t( ! $add( 'a4.co.il' )->ok, 'academic: a bought monthly add-on does not raise the yearly quota' ); unset( $GLOBALS['meta'][12]['fsa_v2_bonus_2026_10'] );
$a1 = array_values( array_filter( $wpdb->rows, function ( $r ) { return 'a1.co.il' === $r['domain_url']; } ) )[0]['id'];
$r = $call( array( 'op' => 'edit', 'id' => $a1, 'host' => 'a1-new.co.il', 'name' => '', 'fonts' => 'פורטו' ) ); $t( $r->ok, 'academic: a domain from March can still be edited in October (same year)' );
$GLOBALS['now'] = array( 2027, 1 ); $t( $add( 'a4.co.il' )->ok, 'academic: a new year, a new quota' );
$r = $call( array( 'op' => 'del', 'id' => $a1 ) ); $t( ! $r->ok, 'academic: last year\'s domain is closed' );
// the owner hears once per cycle when a customer fills the quota
$GLOBALS['mails'] = array(); $GLOBALS['meta'][40] = array(); $GLOBALS['now'] = array( 2026, 10 ); $GLOBALS['user']->ID = 40; $GLOBALS['user']->roles = array( 'customer', 'member-webstop' );
$add( 'q1.co.il' ); $add( 'q2.co.il' ); $t( array() === $GLOBALS['mails'], 'quota alert: nothing while there is room' );
$add( 'q3.co.il' ); $t( 1 === count( $GLOBALS['mails'] ) && 'owner@x' === $GLOBALS['mails'][0][0] && false !== strpos( $GLOBALS['mails'][0][2], 'user_id=40' ), 'quota alert: the owner gets one email when the third site is registered' );
$call( array( 'op' => 'del', 'id' => $wpdb->rows[ count( $wpdb->rows ) - 1 ]['id'] ) ); $add( 'q4.co.il' ); $t( 1 === count( $GLOBALS['mails'] ), 'quota alert: once per month, even when the customer fills it again' );
$r = $add( 'q5.co.il' ); $t( ! $r->ok && false === strpos( $r->data['message'], 'ניצלת' ), 'full month: the refusal does not say "used up"' );
// "אפשר להציג כדוגמה" is kept for the owner's gallery queue
$GLOBALS['user']->ID = 41; $call( array( 'op' => 'add', 'host' => 'show.co.il', 'name' => '', 'fonts' => 'פורטו', 'show' => '1' ) ); $call( array( 'op' => 'add', 'host' => 'quiet.co.il', 'name' => '', 'fonts' => 'פורטו' ) );
$t( array( 'show.co.il' ) === array_keys( fsa_v2_show_ok( 41 ) ), 'show consent: only the site that was ticked' );
// "built something?" email: about two weeks after a web-font download, once, never with a site registered since, stoppable
function get_users( $a ) { return $GLOBALS['subs']; } function update_option( $k, $v, $a = null ) { $GLOBALS['opt'][ $k ] = $v; }
function wc_get_page_permalink( $p ) { return 'https://fontshok.co.il/my-account/'; }
$mk = function ( $id, $role ) { return (object) array( 'ID' => $id, 'roles' => array( 'customer', $role ), 'user_email' => "u$id@x", 'first_name' => 'דנה', 'display_name' => 'd' ); };
$GLOBALS['subs'] = array( $mk( 31, 'member-webstop' ), $mk( 32, 'member-webstop' ), $mk( 33, 'member-extra' ), $mk( 34, 'member-desktop' ), $mk( 35, 'member-webstop' ), $mk( 36, 'member-webstop' ) );
$wpdb->rows = array(); $GLOBALS['mails'] = array(); $day = 86400; $now = time();
foreach ( array( 31, 32, 33, 34, 35 ) as $id ) fsa_v2_note_webdl( $id, 31 === $id ? 'דיסקברי' : '' );
foreach ( array( 31, 32, 33, 34, 35 ) as $id ) $GLOBALS['meta'][ $id ]['fsa_v2_webdl'] = $now - 15 * $day;
$GLOBALS['meta'][36]['fsa_v2_webdl'] = $now - 50 * $day; // too long ago
$wpdb->rows[] = array( 'id' => 700, 'user_id' => 32, 'year' => 2026, 'month' => 10, 'domain_slot' => 1, 'domain_name' => 'x', 'domain_url' => 'done.co.il', 'font_name' => 'פורטו', 'created_at' => date( 'Y-m-d H:i:s', $now - 3 * $day ) );
$GLOBALS['meta'][35]['fsa_v2_nudge_off'] = 1;
fsa_v2_nudge_run(); $to = array_column( $GLOBALS['mails'], 0 ); sort( $to );
$t( array( 'u31@x', 'u33@x' ) === $to, 'nudge: Webstop and Extra after a web download; not after registering a site since, not Desktop, not after "stop", not for an old download' );
$m = $GLOBALS['mails'][ array_search( 'u31@x', array_column( $GLOBALS['mails'], 0 ), true ) ];
$t( false !== strpos( $m[1], 'דיסקברי' ) && false !== strpos( $m[2], 'fontshok-mail-logo.png' ) && false !== strpos( $m[2], '#subdom' ) && false !== strpos( $m[2], 'fsa_nonudge=31' ) && false !== strpos( $m[2], 'dir="rtl"' ), 'nudge: names the font, the FontShok frame with the logo, a link to registration, a stop link' );
$t( false === strpos( $m[2], 'נשאר' ) && false === strpos( $m[2], 'עד סוף' ) && ! preg_match( '/\d+ דומיינים/u', $m[2] ), 'nudge: no counts, no deadline' );
$GLOBALS['mails'] = array(); fsa_v2_nudge_run(); $t( array() === $GLOBALS['mails'], 'nudge: once for a download' );
$GLOBALS['meta'][31]['fsa_v2_webdl'] = $now - 14 * $day - 60; $GLOBALS['meta'][31]['fsa_v2_nudge'] = $now - 20 * $day; fsa_v2_nudge_run(); $t( array() === $GLOBALS['mails'], 'nudge: a new download soon after the last email waits (60 days apart)' );
$GLOBALS['meta'][31]['fsa_v2_nudge'] = $now - 61 * $day; fsa_v2_nudge_run(); $t( 1 === count( $GLOBALS['mails'] ), 'nudge: and goes after 60 days' );
$GLOBALS['meta'][31]['fsa_v2_webdl'] = $now - 5 * $day; unset( $GLOBALS['meta'][31]['fsa_v2_nudge'] ); $GLOBALS['mails'] = array(); fsa_v2_nudge_run(); $t( array() === $GLOBALS['mails'], 'nudge: nothing in the first two weeks' );
$url = fsa_v2_nudge_stop_url( 31 ); parse_str( parse_url( $url, PHP_URL_QUERY ), $q ); $t( '31' === $q['fsa_nonudge'] && 20 === strlen( $q['k'] ) && $q['k'] !== substr( hash_hmac( 'sha256', 'nonudge32', 'salt' ), 0, 20 ), 'stop link: signed for that customer only' );
echo $fail ? "\n$fail FAILED\n" : "\nALL PASSED\n"; exit( $fail ? 1 : 0 );
