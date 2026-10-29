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
function current_time( $f ) { return array( 'Y' => 2026, 'n' => 10, 'Y-m-d' => $GLOBALS['today'], 'd.m.Y' => '25.10.2026', 'd.m.Y H:i' => '25.10.2026 10:00' )[ $f ]; }
function wp_list_pluck( $l, $f, $k = null ) { $o = array(); foreach ( $l as $x ) { $x = (array) $x; if ( $k ) $o[ $x[ $k ] ] = $x[ $f ]; else $o[] = $x[ $f ]; } return $o; }
function get_option( $k, $d = false ) { return $GLOBALS['opt'][ $k ] ?? $d; } function update_option( $k, $v, $a = null ) { $GLOBALS['opt'][ $k ] = $v; return true; }
function get_user_meta( $u, $k, $s = false ) { return $GLOBALS['meta'][ $u ][ $k ] ?? ''; } function update_user_meta( $u, $k, $v ) { $GLOBALS['meta'][ $u ][ $k ] = $v; }
function wp_generate_password( $n = 12, $s = true, $e = false ) { static $i = 0; $i++; return substr( 'Abcdefghjkmnpqrstu' . $i, -$n ); }
function get_users( $q ) { $o = array(); foreach ( $GLOBALS['meta'] as $u => $m ) if ( ( $m[ $q['meta_key'] ] ?? null ) === $q['meta_value'] ) $o[] = $u; return $o; }
function get_field( $k, $o ) { return ''; } function wc_get_product( $id ) { return null; }
$GLOBALS['ups'] = array(); function wp_upload_bits( $n, $x, $bin ) { $GLOBALS['ups'][] = $n; return array( 'file' => "/up/$n", 'url' => "https://site/up/$n", 'error' => false ); }
function wp_insert_attachment( $a, $f ) { return 55; }
/* the screenshot service: $GLOBALS['shot'] = what it answers (a real picture, or the small "loading" one) */
/* the site itself: $GLOBALS['page'] = its home page, $GLOBALS['ogimg'] = the og:image it points to */
$GLOBALS['shot'] = ''; $GLOBALS['asked'] = array(); $GLOBALS['woken'] = array(); $GLOBALS['page'] = ''; $GLOBALS['ogimg'] = '';
function wp_remote_get( $u, $a = array() ) {
	if ( false === strpos( $u, 'mshots' ) ) { $GLOBALS['asked'][] = $u; return array( 'code' => 200, 'body' => preg_match( '#^https://[^/]+/$#', $u ) ? $GLOBALS['page'] : $GLOBALS['ogimg'] ); }
	if ( isset( $a['blocking'] ) && false === $a['blocking'] ) { $GLOBALS['woken'][] = $u; return array( 'code' => 0, 'body' => '' ); }
	$GLOBALS['asked'][] = $u; return array( 'code' => $GLOBALS['shotcode'] ?? 200, 'body' => $GLOBALS['shot'] );
}
$GLOBALS['events'] = array(); function wp_schedule_single_event( $t, $h ) { $GLOBALS['events'][] = array( $t - time(), $h ); }
function get_transient( $k ) { return $GLOBALS['tr'][ $k ] ?? false; } function set_transient( $k, $v, $e = 0 ) { $GLOBALS['tr'][ $k ] = $v; } function delete_transient( $k ) { unset( $GLOBALS['tr'][ $k ] ); }
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

// FSA_V2_FEATURES = 'studio': every customer gets the studio; the sites view stays for admins / the test account
$t( array( 'studio' ) === fsa_v2_features(), 'customers get the studio, not the sites view' );
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
$GLOBALS['admin'] = true; // admins too; plan rules still apply
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
// real pictures, light: a round first only wakes a site (non-blocking call), the next round, minutes later, collects the picture
$GLOBALS['opt']['fsa_v2_showcase_no'] = array();
$back = function () { foreach ( $GLOBALS['opt']['fsa_v2_snaps'] as $h => $x ) $GLOBALS['opt']['fsa_v2_snaps'][ $h ]['w'] = $x['w'] ? $x['w'] - 200 : 0; }; // a few minutes pass
fsa_v2_snap_run();
$t( 3 === count( $GLOBALS['woken'] ) && array() === $GLOBALS['asked'] && false !== strpos( $GLOBALS['woken'][0], rawurlencode( 'https://lavana.co.il/' ) ), 'first round: the three sites are only woken, nothing waited for' );
$t( 0 === $GLOBALS['opt']['fsa_v2_snaps']['lavana.co.il']['n'] && array( 180, 'fsa_v2_snaps' ) === end( $GLOBALS['events'] ), 'no try counted; a pickup round is set for 3 minutes later' );
fsa_v2_snap_run(); $t( array() === $GLOBALS['asked'] && 3 === count( $GLOBALS['woken'] ), 'right away: nothing asked again (the service needs a couple of minutes)' );
$back(); $GLOBALS['shotcode'] = 429; fsa_v2_snap_run(); $GLOBALS['shotcode'] = 200;
$t( 1 === count( $GLOBALS['asked'] ) && 0 === $GLOBALS['opt']['fsa_v2_snaps']['lavana.co.il']['n'] && false !== strpos( $GLOBALS['opt']['fsa_v2_snap_log']['err'], 'עמוס' ), 'service busy (429): the round stops at once and no try is counted' );
$GLOBALS['asked'] = array();
$GLOBALS['shot'] = $jpg( 400, 300 ); fsa_v2_snap_run();
$t( 3 === count( $GLOBALS['asked'] ) && '' === fsa_v2_snap( 'lavana.co.il' ) && 1 === $GLOBALS['opt']['fsa_v2_snaps']['lavana.co.il']['n'], 'service still making it: no picture yet, one try counted' );
$lg = $GLOBALS['opt']['fsa_v2_snap_log']; $t( 3 === $lg['asked'] && 0 === $lg['got'] && false !== strpos( $lg['err'], 'בהכנה' ), 'the round is logged for the approval screen, with the reason' );
$back(); $GLOBALS['shot'] = $jpg( 1280, 800 ); fsa_v2_snap_run();
$u = fsa_v2_snap( 'studio.co.il' ); $t( 0 === strpos( $u, 'https://site/up/fsa-sites/studio.co.il-' ) && is_file( sys_get_temp_dir() . '/fsa-up/fsa-sites/' . basename( $u ) ), 'real picture kept on the site' );
$t( 3 === $GLOBALS['opt']['fsa_v2_snap_log']['got'], 'the log counts the pictures that arrived' );
$GLOBALS['asked'] = array(); $GLOBALS['woken'] = array(); $back(); fsa_v2_snap_run(); $t( array() === $GLOBALS['asked'] && array() === $GLOBALS['woken'], 'sites with a picture are not asked again' );
// the service never makes it (blocked site): after 3 empty pickups, the site's own og:image
$GLOBALS['opt']['fsa_v2_snaps']['og.co.il'] = array( 'u' => '', 'n' => 2, 't' => 0, 'w' => time() - 300 );
$GLOBALS['opt']['fsa_v2_showcase'][] = array( 'id' => 'o2', 'uid' => 0, 'name' => 'OG', 'host' => 'og.co.il', 'fonts' => array( 'תניא' ), 'year' => '2026', 'by' => '', 'img' => '', 'ok' => true, 't' => '2026-10-26' );
$GLOBALS['shot'] = $jpg( 400, 300 ); $GLOBALS['page'] = '<head><meta property="og:image" content="/wp-content/share.jpg"></head>'; $GLOBALS['ogimg'] = $jpg( 1200, 630 );
fsa_v2_snap_run();
$t( in_array( 'https://og.co.il/wp-content/share.jpg', $GLOBALS['asked'], true ) && 0 === strpos( fsa_v2_snap( 'og.co.il' ), 'https://site/up/fsa-sites/og.co.il-' ), 'og:image of the site is used (relative link made whole)' );
$GLOBALS['opt']['fsa_v2_snaps']['logo.co.il'] = array( 'u' => '', 'n' => 2, 't' => 0, 'w' => time() - 300 ); $GLOBALS['ogimg'] = $jpg( 200, 200 );
$GLOBALS['opt']['fsa_v2_showcase'][] = array( 'id' => 'o3', 'uid' => 0, 'name' => 'L', 'host' => 'logo.co.il', 'fonts' => array(), 'year' => '', 'by' => '', 'img' => '', 'ok' => true, 't' => '2026-10-26' );
fsa_v2_snap_run(); $t( '' === fsa_v2_snap( 'logo.co.il' ), 'a small og:image (a logo) is not used; the sketch stays' );
array_pop( $GLOBALS['opt']['fsa_v2_showcase'] ); $GLOBALS['page'] = ''; $GLOBALS['ogimg'] = '';
$t( array( 'studio.co.il' => $u ) === fsa_v2_user_snaps( 7 ), 'the customer gets the pictures of their own sites' );
$t( array( 'noa.co.il', 'studio.co.il' ) === array_keys( fsa_v2_user_sites( 8 ) ), 'a site typed as https://www.… is keyed by the bare domain, so its picture is found' );
$t( fsa_v2_snap( 'lavana.co.il' ) === fsa_v2_showcase_public()[0]['img'], 'gallery uses the picture' );
$t( false !== strpos( fsa_v2_site_card_html( 'סטודיו', 'studio.co.il', array( 'פורטו' ), '2026' ), $u ), 'the share page shows the real picture' );
// the public gallery page [fontshok_gallery]: newest first, a filter per font, pictures from the site, kept ready until something changes
$g = fsa_v2_gallery_html();
$t( strpos( $g, 'og.co.il' ) < strpos( $g, 'lavana.co.il' ) && 2 === substr_count( $g, '<figure class="sc"' ), 'approved sites only, newest first' );
$t( false !== strpos( $g, 'data-f="פורטו">פורטו<small>1' ) && false !== strpos( $g, 'data-f="תניא"' ) && false !== strpos( $g, 'data-f="">הכל<small>2' ), 'one filter button per font, with counts' );
$t( false !== strpos( $g, '<dt>עיצוב</dt><dd>סטודיו נועה</dd>' ) && false !== strpos( $g, 'loading="lazy"' ) && false === strpos( $g, 'mshots' ), 'designer credit; lazy pictures kept on the site (never from the service)' );
$GLOBALS['opt']['fsa_v2_showcase'] = array(); $t( $g === fsa_v2_gallery_html(), 'kept ready: the next visit does no work' );
if ( ! function_exists( 'home_url' ) ) { function home_url( $p = '' ) { return 'https://fontshok.co.il' . $p; } }
// header menu: "גלריה" after "פונט־בלוג" in both mega-menus, with its own empty panel; nothing twice, other templates untouched
$hd = json_decode( file_get_contents( __DIR__ . '/../../docs/backups/header-10689-elementor-before-gallery.json' ), true ); $hd = is_string( $hd ) ? json_decode( $hd, true ) : ( isset( $hd['value'] ) ? json_decode( $hd['value'], true ) : $hd );
$menus = function ( $d ) { $o = array(); $w = function ( $els ) use ( &$w, &$o ) { foreach ( $els as $e ) { if ( 'mega-menu' === ( $e['widgetType'] ?? '' ) ) $o[ $e['id'] ] = array( array_map( 'trim', array_column( $e['settings']['menu_items'], 'item_title' ) ), count( $e['elements'] ), $e['settings']['menu_items'] ); if ( ! empty( $e['elements'] ) ) $w( $e['elements'] ); } }; $w( $d ); return $o; };
$after = $menus( fsa_v2_menu_gallery( $hd, 10689 ) ); $ok = 2 === count( $after );
foreach ( $after as $mm ) { $k = array_search( 'גלריה', $mm[0], true ); $ok = $ok && false !== $k && 'פונט־בלוג' === $mm[0][ $k - 1 ] && count( $mm[0] ) === $mm[1] && false !== strpos( $mm[2][ $k ]['item_link']['url'], '/gallery/' ); }
$t( $ok, 'menu: gallery after the blog in both menus, items and panels line up' );
$twice = $menus( fsa_v2_menu_gallery( fsa_v2_menu_gallery( $hd, 10689 ), 10689 ) ); $t( array_map( function ( $m ) { return $m[0]; }, $twice ) === array_map( function ( $m ) { return $m[0]; }, $after ), 'menu: added once' );
$t( $hd === fsa_v2_menu_gallery( $hd, 999 ), 'menu: other templates untouched' );
delete_transient( 'fsa_v2_gallery' ); $t( false !== strpos( fsa_v2_gallery_html(), 'קרנינג' ) && false === strpos( fsa_v2_gallery_html(), '<button' ), 'empty gallery: a short friendly line, no filter' );
$GLOBALS['shot'] = ''; $GLOBALS['opt']['fsa_v2_snaps']['gone.co.il'] = array( 'u' => '', 'n' => 6, 't' => 0, 'w' => 1 );
// share page: a token per customer, found again from the link; nonsense tokens find nobody
$tok = fsa_v2_share_token( 7 ); $t( 16 === strlen( $tok ) && $tok === fsa_v2_share_token( 7 ), 'share token made once and kept' );
$t( 7 === fsa_v2_share_user( $tok ) && 0 === fsa_v2_share_user( 'nope' ) && 0 === fsa_v2_share_user( '' ), 'the link finds the customer; anything else finds nobody' );
$sites = fsa_v2_user_sites( 7 ); $t( isset( $sites['studio.co.il'] ) && '2026' === $sites['studio.co.il']['year'], 'their sites for the share page' );
$h = fsa_v2_site_card_html( 'סטודיו', 'studio.co.il', array( 'פורטו' ), '2026' ); $t( false !== strpos( $h, 'https://studio.co.il' ) && false === strpos( $h, 'dana@x' ), 'share card: the site, no personal details' );
$GLOBALS['asked'] = array(); $GLOBALS['woken'] = array(); fsa_v2_snap_run(); $t( array() === $GLOBALS['asked'] && array() === $GLOBALS['woken'], 'a site that failed 6 times is left as a sketch' );
echo $fail ? "\n$fail FAILED\n" : "\nALL PASSED\n"; exit( $fail ? 1 : 0 );
