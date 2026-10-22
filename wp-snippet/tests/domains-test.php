<?php
/* Domain register/edit/remove against an in-memory copy of the Easy Font Table table.
   Usage: php wp-snippet/tests/domains-test.php */
define( 'ABSPATH', '/' ); define( 'HOUR_IN_SECONDS', 3600 );
$GLOBALS['user'] = (object) array( 'ID' => 7, 'user_login' => 'claude-test', 'roles' => array( 'customer', 'member-webstop' ) );
$GLOBALS['nonce_ok'] = true; $GLOBALS['now'] = array( 2026, 10 );
function add_action( ...$a ) {} function add_filter( ...$a ) {} function add_shortcode( ...$a ) {}
function current_user_can( $c ) { return false; } function is_user_logged_in() { return true; } function wp_get_current_user() { return $GLOBALS['user']; } function get_current_user_id() { return $GLOBALS['user']->ID; }
function check_ajax_referer() { return $GLOBALS['nonce_ok']; } function sanitize_key( $s ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( $s ) ); }
function sanitize_text_field( $s ) { return trim( strip_tags( (string) $s ) ); } function wp_unslash( $s ) { return $s; }
$GLOBALS['meta'] = array(); function get_user_meta( $u, $k, $x = false ) { return $GLOBALS['meta'][ $u ][ $k ] ?? ''; }
function current_time( $f ) { return 'Y' === $f ? $GLOBALS['now'][0] : $GLOBALS['now'][1]; }
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
	function get_var( $q ) { if ( 0 === strpos( $q, 'SHOW TABLES' ) ) return 'wp_easy_font_domains'; $r = $this->where( $q ); return $r ? $r[0]['id'] : null; }
	function get_row( $q ) { $r = $this->where( $q ); return $r ? (object) $r[0] : null; }
	function get_results( $q ) { $r = $this->where( $q ); usort( $r, function ( $a, $b ) { return [ $b['year'], $b['month'], $a['domain_slot'] ] <=> [ $a['year'], $a['month'], $b['domain_slot'] ]; } ); return array_map( function ( $x ) { return (object) $x; }, $r ); }
	function insert( $t, $d ) { foreach ( $this->rows as $r ) if ( $r['user_id'] == $d['user_id'] && $r['year'] == $d['year'] && $r['month'] == $d['month'] && $r['domain_slot'] == $d['domain_slot'] ) return false; $d['id'] = $this->next++; $d['created_at'] = sprintf( '%d-%02d-05 10:00:00', $d['year'], $d['month'] ); $this->rows[] = $d; return 1; }
	function update( $t, $d, $w ) { $n = 0; foreach ( $this->rows as &$r ) { if ( array_diff_assoc( array_map( 'strval', $w ), array_map( 'strval', array_intersect_key( $r, $w ) ) ) ) continue; $r = array_merge( $r, $d ); $n++; } return $n; }
	function delete( $t, $w ) { $b = count( $this->rows ); $this->rows = array_values( array_filter( $this->rows, function ( $r ) use ( $w ) { foreach ( $w as $k => $v ) if ( (string) $r[ $k ] !== (string) $v ) return true; return false; } ) ); return $b - count( $this->rows ); }
}
$GLOBALS['wpdb'] = new FakeDB();
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
$r = $add( 'd.co.il' ); $t( ! $r->ok && false !== strpos( $r->data['message'], 'ניצלת' ), 'webstop: the 4th domain this month is refused' );
$GLOBALS['meta'][7]['fsa_v2_bonus_2026_10'] = 1; $t( $add( 'bought.co.il' )->ok, 'after buying the ₪79 add-on: a 4th domain fits this month' );
$t( ! $add( 'e.co.il' )->ok, 'and a 5th does not' );
$wpdb->rows = array_values( array_filter( $wpdb->rows, function ( $r ) { return 'bought.co.il' !== $r['domain_url']; } ) ); unset( $GLOBALS['meta'][7]['fsa_v2_bonus_2026_10'] );
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
$GLOBALS['user']->roles = array( 'customer' ); $t( ! $add( 'z.co.il' )->ok, 'no subscription: refused' );
$GLOBALS['user']->roles = array( 'customer', 'member-webstop' ); $GLOBALS['nonce_ok'] = false; $t( ! $add( 'z.co.il' )->ok, 'bad nonce refused' );
$GLOBALS['nonce_ok'] = true; $GLOBALS['user']->user_login = 'someone'; $t( ! $add( 'z.co.il' )->ok, 'not a preview viewer: refused (until the area opens to everyone)' );
echo $fail ? "\n$fail FAILED\n" : "\nALL PASSED\n"; exit( $fail ? 1 : 0 );
