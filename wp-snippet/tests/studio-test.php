<?php
/* "בסטודיו" vote, the gallery approval queue, site pictures, the share page lookup and the admin save, against fake WordPress options / user meta.
   Usage: php wp-snippet/tests/studio-test.php */
define( 'ABSPATH', '/' ); define( 'HOUR_IN_SECONDS', 3600 );
$GLOBALS['users'] = array(
	7 => (object) array( 'ID' => 7, 'user_login' => 'dana', 'user_email' => 'dana@x', 'roles' => array( 'customer', 'member-webstop' ) ),
	8 => (object) array( 'ID' => 8, 'user_login' => 'noa', 'user_email' => 'noa@x', 'roles' => array( 'customer', 'member-extra' ) ),
	9 => (object) array( 'ID' => 9, 'user_login' => 'guest', 'user_email' => 'g@x', 'roles' => array( 'customer' ) ),
);
$GLOBALS['cur'] = 7; $GLOBALS['admin'] = false; $GLOBALS['meta'] = array(); $GLOBALS['opt'] = array(); $GLOBALS['nonce_ok'] = true; $GLOBALS['today'] = '2026-10-25';
function add_action( ...$a ) {} function add_filter( ...$a ) {} function add_shortcode( ...$a ) {}
function current_user_can( $c ) { return $GLOBALS['admin']; } function is_user_logged_in() { return true; }
function wp_get_current_user() { return $GLOBALS['users'][ $GLOBALS['cur'] ]; } function get_current_user_id() { return $GLOBALS['cur']; } function get_userdata( $id ) { return $GLOBALS['users'][ $id ] ?? false; }
function check_ajax_referer() { return $GLOBALS['nonce_ok']; } function check_admin_referer() { return true; }
function sanitize_key( $s ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $s ) ); } function sanitize_text_field( $s ) { return trim( strip_tags( (string) $s ) ); } function wp_unslash( $s ) { return $s; }
function esc_html( $s ) { return htmlspecialchars( (string) $s ); } function esc_attr( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); } function esc_url( $s ) { return $s; }
function sanitize_file_name( $s ) { return preg_replace( '/[^a-z0-9._-]/i', '', $s ); } function esc_url_raw( $s ) { return $s; }
function current_time( $f ) { return array( 'Y' => 2026, 'n' => 10, 'Y-m-d' => $GLOBALS['today'], 'd.m.Y' => '25.10.2026' )[ $f ]; }
function wp_list_pluck( $l, $f, $k = null ) { $o = array(); foreach ( $l as $x ) { $x = (array) $x; if ( $k ) $o[ $x[ $k ] ] = $x[ $f ]; else $o[] = $x[ $f ]; } return $o; }
function get_option( $k, $d = false ) { return $GLOBALS['opt'][ $k ] ?? $d; } function update_option( $k, $v, $a = null ) { $GLOBALS['opt'][ $k ] = $v; return true; }
function get_user_meta( $u, $k, $s = false ) { return $GLOBALS['meta'][ $u ][ $k ] ?? ''; } function update_user_meta( $u, $k, $v ) { $GLOBALS['meta'][ $u ][ $k ] = $v; }
function wp_generate_password( $n = 12, $s = true, $e = false ) { static $i = 0; $i++; return substr( 'Abcdefghjkmnpqrstu' . $i, -$n ); }
function get_users( $q ) { $o = array(); foreach ( $GLOBALS['meta'] as $u => $m ) if ( ( $m[ $q['meta_key'] ] ?? null ) === $q['meta_value'] ) $o[] = $u; return $o; }
function get_field( $k, $o ) { return ''; } function wc_get_product( $id ) { return null; }
$GLOBALS['ups'] = array(); function wp_upload_bits( $n, $x, $bin ) { $GLOBALS['ups'][] = $n; return array( 'file' => "/up/$n", 'url' => "https://site/up/$n", 'error' => false ); }
function wp_insert_attachment( $a, $f ) { return 55; }
/* the screenshot service: $GLOBALS['shot'] = what it answers (a real picture, or the small "loading" one) */
$GLOBALS['shot'] = ''; $GLOBALS['asked'] = array(); function wp_remote_get( $u, $a = array() ) { $GLOBALS['asked'][] = $u; return array( 'code' => 200, 'body' => $GLOBALS['shot'] ); }
function is_wp_error( $x ) { return false; } function wp_remote_retrieve_response_code( $r ) { return $r['code']; } function wp_remote_retrieve_body( $r ) { return $r['body']; }
function wp_upload_dir() { return array( 'basedir' => sys_get_temp_dir() . '/fsa-up', 'baseurl' => 'https://site/up', 'error' => false ); } function trailingslashit( $s ) { return rtrim( $s, '/' ) . '/'; } function wp_mkdir_p( $d ) { return is_dir( $d ) || mkdir( $d, 0777, true ); }
$jpg = function ( $w, $h ) { $i = imagecreatetruecolor( $w, $h ); ob_start(); imagejpeg( $i ); return ob_get_clean(); };
function wp_safe_redirect( $u ) { throw new Exception( 'redirect:' . $u ); } function admin_url( $p = '' ) { return 'https://site/wp-admin/' . $p; } function wp_die( $m ) { throw new Exception( 'die:' . $m ); }
class Done extends Exception { public $ok; public $data; function __construct( $ok, $d ) { $this->ok = $ok; $this->data = $d; } }
function wp_send_json_error( $d ) { throw new Done( false, $d ); } function wp_send_json_success( $d ) { throw new Done( true, $d ); }
/* the votes table: SELECT … usermeta WHERE meta_key = <key> GROUP BY meta_value; the domains table: none here, sites come from licence meta */
class FakeDB { public $usermeta = 'wp_usermeta', $prefix = 'wp_';
	function prepare( $q, ...$a ) { return array( $q, $a ); }
	function get_var( $q ) { return null; }
	function get_col( $q ) { $o = array(); foreach ( $GLOBALS['meta'] as $u => $m ) if ( isset( $m[ $q[1][0] ] ) ) $o[] = $u; return $o; }
	function get_results( $q ) { if ( false === strpos( $q[0], 'GROUP BY meta_value' ) ) return array(); $c = array(); foreach ( $GLOBALS['meta'] as $m ) if ( isset( $m[ $q[1][0] ] ) ) $c[ $m[ $q[1][0] ] ] = ( $c[ $m[ $q[1][0] ] ] ?? 0 ) + 1; $o = array(); foreach ( $c as $v => $n ) $o[] = (object) array( 'v' => $v, 'n' => $n ); return $o; } }
$GLOBALS['wpdb'] = new FakeDB();
eval( file_get_contents( __DIR__ . '/../fsa-v2-snippet.php' ) );
$fail = 0; $t = function ( $ok, $m ) use ( &$fail ) { echo ( $ok ? 'ok   ' : 'FAIL ' ) . $m . "\n"; if ( ! $ok ) $fail++; };
$call = function ( $fn, $post ) { $_POST = $post; try { $fn(); } catch ( Done $d ) { return $d; } catch ( Exception $e ) { return (object) array( 'ok' => 'x', 'data' => array( 'message' => $e->getMessage() ) ); } return null; };
$vote = function ( $f, $why = null ) use ( $call ) { $p = array( 'font' => $f ); if ( null !== $why ) $p['why'] = $why; return $call( 'fsa_v2_vote_ajax', $p ); };

// off for customers until FSA_V2_FEATURES lists them; admins / the test account always
$t( array() === fsa_v2_features(), 'features are off for a customer by default' );
$GLOBALS['admin'] = true; $t( array( 'studio', 'show' ) === fsa_v2_features(), 'an admin sees them (to check before launch)' );
$t( ! $vote( 'a' )->ok, 'no vote before the owner set up the fonts' );
// the owner saves three fonts from the admin screen, one with a picture made in the browser
$jpeg = (function () { $im = imagecreatetruecolor( 1200, 600 ); ob_start(); imagejpeg( $im ); return 'data:image/jpeg;base64,' . base64_encode( ob_get_clean() ); })();
$_POST = array( 'open' => '1', 'closes' => '2026-11-30', 'f' => array( array( 'name' => 'שחף', 'desc' => 'צר', 'he' => 'ים', 'en' => 'Sea', 'img' => $jpeg ), array( 'name' => 'מגדלור', 'desc' => 'סריף', 'he' => 'אור', 'en' => 'Light', 'img' => 'data:image/png;base64,AAAA' ), array( 'name' => 'גלגל', 'desc' => 'שמן', 'he' => 'כוח', 'en' => 'Power', 'img' => 'data:image/jpeg;base64,' . base64_encode( 'not an image' ) ) ) );
try { fsa_v2_studio_save(); } catch ( Exception $e ) {}
$s = fsa_v2_studio();
$t( 3 === count( $s['fonts'] ) && $s['round'] && $s['open'] && '2026-11-30' === $s['closes'], 'admin save: three fonts, a round, open, closing day' );
$t( false !== strpos( $s['fonts'][0]['img'], '/up/fsa-studio-' ) && '' === $s['fonts'][1]['img'] && '' === $s['fonts'][2]['img'], 'only a real JPEG becomes a picture (png / fake data refused)' );
$t( 1 === count( $GLOBALS['ups'] ), 'one file uploaded' );
$GLOBALS['admin'] = false; $GLOBALS['opt']['fsa_v2_studio'] = $s;
// customers vote (features on for everyone now)
$t( ! $vote( 'a' )->ok, 'with the features off, a customer cannot vote' );
$GLOBALS['admin'] = true; // stands in for "features on" below (fsa_v2_features() lets admins in); plan rules still apply
$r = $vote( 'a' ); $t( $r->ok && 'a' === $r->data['vote'] && 100 === $r->data['fonts'][0]['pct'], 'a Webstop subscriber votes; 100% for the only vote' );
$GLOBALS['cur'] = 8; $r = $vote( 'b', 'כותרות לספר' ); $t( $r->ok && 50 === $r->data['fonts'][0]['pct'] && 50 === $r->data['fonts'][1]['pct'] && 'כותרות לספר' === $r->data['why'], 'second subscriber: 50/50 and the answer is kept' );
$r = $vote( 'c' ); $t( $r->ok && 0 === $r->data['fonts'][1]['pct'] && 50 === $r->data['fonts'][2]['pct'], 'changing the vote moves it (one vote per customer)' );
$t( ! $vote( 'z' )->ok, 'unknown font refused' );
$r = $vote( 'c', str_repeat( 'א', 300 ) ); $t( 140 === mb_strlen( $r->data['why'] ), 'the answer is cut at 140 characters' );
$GLOBALS['cur'] = 9; $t( ! $vote( 'a' )->ok, 'a customer without a subscription cannot vote' );
$GLOBALS['cur'] = 7; $GLOBALS['today'] = '2026-12-01'; $r = $vote( 'b' ); $t( ! $r->ok && false !== strpos( $r->data['message'], 'נסגרה' ), 'after the closing day the vote is closed' );
$d = fsa_v2_studio_for( 7 ); $t( false === $d['open'] && 'a' === $d['vote'] && '30 בנובמבר' === $d['closes'], 'the area still shows the choice and the closing day' );
$GLOBALS['today'] = '2026-10-25';
$GLOBALS['nonce_ok'] = false; $t( ! $vote( 'a' )->ok, 'bad nonce refused' ); $GLOBALS['nonce_ok'] = true;
// a new round starts from zero
$_POST = array( 'open' => '1', 'closes' => '', 'new_round' => '1', 'f' => array( array( 'name' => 'שחף' ), array( 'name' => 'מגדלור' ), array( 'name' => 'גלגל' ) ) );
sleep( 1 ); try { fsa_v2_studio_save(); } catch ( Exception $e ) {} $s2 = fsa_v2_studio();
$t( $s2['round'] !== $s['round'] && 0 === fsa_v2_studio_for( 7 )['total'] && null === fsa_v2_studio_for( 7 )['vote'], 'a new round: no votes counted yet' );
$t( false !== strpos( $s2['fonts'][0]['img'], '/up/' ), 'saving without a new picture keeps the old one' );
// gallery: every customer site waits for the owner by itself; the owner picks what goes up
$GLOBALS['meta'][7]['fsa_v2_lic_sites'] = array( '501' => array( array( 'id' => 'x1', 'd' => '05.10.2026', 'name' => 'סטודיו', 'host' => 'studio.co.il' ) ) );
$GLOBALS['meta'][8]['fsa_v2_lic_sites'] = array( '502' => array( array( 'id' => 'x2', 'd' => '01.03.2025', 'name' => '', 'host' => 'www.Noa.co.il' ), array( 'id' => 'x3', 'd' => '02.03.2025', 'name' => 'שוב', 'host' => 'studio.co.il' ) ) );
$q = fsa_v2_showcase_queue();
$t( array( 'studio.co.il', 'noa.co.il' ) === array_keys( $q ) && 7 === $q['studio.co.il']['uid'] && 'noa.co.il' === $q['noa.co.il']['name'], 'every registered site is waiting, newest first, once per address' );
$t( array() === fsa_v2_showcase_public(), 'nothing is public before the owner approves' );
$GLOBALS['admin'] = true;
$_POST = array( 'op' => 'ok', 'host' => 'studio.co.il', 'by' => 'סטודיו דנה', 'img' => '' ); try { fsa_v2_show_save(); } catch ( Exception $e ) {}
$pub = fsa_v2_showcase_public(); $t( 1 === count( $pub ) && 'studio.co.il' === $pub[0]['host'] && 'סטודיו דנה' === $pub[0]['by'], 'approved: in the public gallery' );
$t( array( 'noa.co.il' ) === array_keys( fsa_v2_showcase_queue() ), 'and out of the queue' );
$_POST = array( 'op' => 'ok', 'host' => 'not-registered.co.il' ); try { fsa_v2_show_save(); } catch ( Exception $e ) {} $t( 1 === count( fsa_v2_showcase_public() ), 'only a site that is in the queue can be approved' );
$_POST = array( 'op' => 'no', 'host' => 'noa.co.il' ); try { fsa_v2_show_save(); } catch ( Exception $e ) {}
$t( array() === fsa_v2_showcase_queue() && 1 === count( fsa_v2_showcase_public() ), 'turned down: leaves the queue, not shown' );
$_POST = array( 'op' => 'del', 'host' => 'studio.co.il' ); try { fsa_v2_show_save(); } catch ( Exception $e ) {}
$t( array() === fsa_v2_showcase_public() && array() === fsa_v2_showcase_queue(), 'taken off the gallery, and does not come back to the queue' );
$_POST = array( 'op' => 'add', 'name' => 'קפה לבנה', 'host' => 'https://lavana.co.il/', 'fonts' => 'פורטו, טאלנט', 'year' => '2025', 'by' => 'סטודיו נועה', 'img' => '' );
try { fsa_v2_show_save(); } catch ( Exception $e ) {}
$pub = fsa_v2_showcase_public(); $t( 1 === count( $pub ) && 'lavana.co.il' === $pub[0]['host'] && array( 'פורטו', 'טאלנט' ) === $pub[0]['fonts'], 'the owner adds a site directly' );
$GLOBALS['admin'] = false;
// real pictures: the hourly round asks the service, keeps a real picture, retries while it is still being made
$GLOBALS['opt']['fsa_v2_showcase_no'] = array();
$GLOBALS['shot'] = $jpg( 400, 300 ); fsa_v2_snap_run();
$t( 3 === count( $GLOBALS['asked'] ) && false !== strpos( $GLOBALS['asked'][0], rawurlencode( 'https://lavana.co.il/' ) ) && '' === fsa_v2_snap( 'lavana.co.il' ), 'service still making it: no picture yet' );
$GLOBALS['shot'] = $jpg( 1280, 800 ); fsa_v2_snap_run();
$u = fsa_v2_snap( 'studio.co.il' ); $t( 0 === strpos( $u, 'https://site/up/fsa-sites/studio.co.il-' ) && is_file( sys_get_temp_dir() . '/fsa-up/fsa-sites/' . basename( $u ) ), 'real picture kept on the site' );
$GLOBALS['asked'] = array(); fsa_v2_snap_run(); $t( array() === $GLOBALS['asked'], 'sites with a picture are not asked again' );
$t( array( 'studio.co.il' => $u ) === fsa_v2_user_snaps( 7 ), 'the customer gets the pictures of their own sites' );
$t( $u === fsa_v2_showcase_public()[0]['img'] || 'lavana.co.il' === fsa_v2_showcase_public()[0]['host'], 'gallery uses the picture' );
$t( false !== strpos( fsa_v2_site_card_html( 'סטודיו', 'studio.co.il', array( 'פורטו' ), '2026' ), $u ), 'the share page shows the real picture' );
$GLOBALS['shot'] = ''; $GLOBALS['opt']['fsa_v2_snaps']['gone.co.il'] = array( 'u' => '', 'n' => 6, 't' => 0 );
// share page: a token per customer, found again from the link; nonsense tokens find nobody
$tok = fsa_v2_share_token( 7 ); $t( 16 === strlen( $tok ) && $tok === fsa_v2_share_token( 7 ), 'share token made once and kept' );
$t( 7 === fsa_v2_share_user( $tok ) && 0 === fsa_v2_share_user( 'nope' ) && 0 === fsa_v2_share_user( '' ), 'the link finds the customer; anything else finds nobody' );
$sites = fsa_v2_user_sites( 7 ); $t( isset( $sites['studio.co.il'] ) && '2026' === $sites['studio.co.il']['year'], 'their sites for the share page' );
$h = fsa_v2_site_card_html( 'סטודיו', 'studio.co.il', array( 'פורטו' ), '2026' ); $t( false !== strpos( $h, 'https://studio.co.il' ) && false === strpos( $h, 'dana@x' ), 'share card: the site, no personal details' );
$GLOBALS['asked'] = array(); fsa_v2_snap_run(); $t( array() === $GLOBALS['asked'], 'a site that failed 6 times is left as a sketch' );
echo $fail ? "\n$fail FAILED\n" : "\nALL PASSED\n"; exit( $fail ? 1 : 0 );
