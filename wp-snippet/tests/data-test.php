<?php
/* Server-side checks with fake WordPress/WooCommerce objects: weights list, per-weight download rules, purchased-licence data.
   Usage: php wp-snippet/tests/data-test.php */
define( 'ABSPATH', '/' ); define( 'HOUR_IN_SECONDS', 3600 );
$GLOBALS['user'] = (object) array( 'ID' => 7, 'user_login' => 'claude-test', 'roles' => array( 'customer', 'member-webstop' ), 'first_name' => 'T', 'last_name' => '', 'display_name' => 'T', 'user_email' => 't@x' );
$GLOBALS['admin'] = false; $GLOBALS['died'] = null; $GLOBALS['served'] = null; $GLOBALS['transients'] = array();
function add_action( ...$a ) {} function add_filter( ...$a ) {} function add_shortcode( ...$a ) {}
function current_user_can( $c ) { return $GLOBALS['admin']; } function is_user_logged_in() { return true; } function wp_get_current_user() { return $GLOBALS['user']; }
function auth_redirect() {} function wp_strip_all_tags( $s ) { return strip_tags( $s ); } function sanitize_text_field( $s ) { return $s; } function wp_unslash( $s ) { return $s; }
function wp_create_nonce( $a ) { return 'N'; } function wp_verify_nonce( $n, $a ) { return 'N' === $n; }
function wp_die( $m ) { $GLOBALS['died'] = $m; throw new Exception( 'die' ); }
function home_url( $p = '' ) { return 'https://fontshok.co.il' . $p; } function add_query_arg( ...$x ) { if ( is_array( $x[0] ) ) { $a = $x[0]; $u = $x[1]; } else { $a = array( $x[0] => $x[1] ); $u = $x[2]; } return $u . '?' . http_build_query( $a ); }
function get_transient( $k ) { return $GLOBALS['transients'][ $k ] ?? false; } function set_transient( $k, $v, $t ) { $GLOBALS['transients'][ $k ] = $v; }
function get_post_modified_time() { return 1; }
function get_field( $k, $o ) { return $GLOBALS['ff'] ?? array( array( 'font-name' => 'נוסטלה', 'font-file' => array( 'url' => 'https://x/d.zip' ), 'font-file-web' => array( 'url' => 'https://x/w.zip' ) ) ); }
$GLOBALS['up'] = sys_get_temp_dir() . '/fsa-all-test-' . getmypid(); @mkdir( $GLOBALS['up'] . '/fonts', 0777, true );
function wp_upload_dir() { return array( 'basedir' => $GLOBALS['up'], 'baseurl' => 'https://fontshok.co.il/up', 'error' => false ); }
function get_attached_file( $id ) { return $GLOBALS['up'] . '/fonts/by-id-' . $id . '.zip'; } function wp_mkdir_p( $d ) { return is_dir( $d ) || mkdir( $d, 0777, true ); } function wp_salt() { return 'salt'; }
class Post { function __construct( public $ID, public $post_title ) {} }
$GLOBALS['posts'] = array( 20335 => new Post( 20335, 'נוסטלה' ), 22311 => new Post( 22311, 'פלינקו' ) );
function get_posts( $a ) { foreach ( $GLOBALS['posts'] as $p ) if ( $p->post_title === $a['title'] ) return array( $p->ID ); return array(); }
function get_post( $id ) { return $GLOBALS['posts'][ $id ] ?? null; }
$GLOBALS['terms'] = array( '100' => 'דקיק', '300' => 'קל', '400' => 'רגיל', 'family' => 'משפחה' );
function get_term_by( $f, $slug, $tax ) { return isset( $GLOBALS['terms'][ $slug ] ) ? (object) array( 'name' => $GLOBALS['terms'][ $slug ] ) : false; }
class Dl { function __construct( public $f ) {} function get_file() { return $this->f; } function get_name() { return basename( $this->f ); } }
class Prod { public $kids = array(); function __construct( public $id, public $type, public $parent = 0, public $att = array() ) {}
	function is_type( $t ) { return $t === $this->type; } function get_children() { return $this->kids; } function get_id() { return $this->id; } function get_parent_id() { return $this->parent; }
	function get_attributes() { return $this->att; } function get_attribute( $k ) { $s = $this->att[ $k ] ?? ''; return 'pa_weight' === $k ? ( $GLOBALS['terms'][ $s ] ?? $s ) : ( 'desktop' === $s ? 'דסקטופ' : ( $s ? 'וובפונט' : '' ) ); }
	function get_downloads() { return array( 'dl-' . $this->id => new Dl( '/files/' . $this->id . '.zip' ) ); } }
$P = array( 20335 => new Prod( 20335, 'variable' ), 22311 => new Prod( 22311, 'variable' ) ); $vid = 30000;
foreach ( array( 20335, 22311 ) as $pp ) foreach ( array( 'family', '400', '100', '300' ) as $w ) foreach ( array( 'desktop', 'webfont' ) as $l ) { $P[ ++$vid ] = new Prod( $vid, 'variation', $pp, array( 'pa_weight' => $w, 'pa_license' => $l ) ); $P[ $pp ]->kids[] = $vid; }
$GLOBALS['P'] = $P;
function wc_get_product( $id ) { return $GLOBALS['P'][ $id ] ?? null; }
class WC_Download_Handler { static function download( $f, $pid ) { $GLOBALS['served'] = array( $f, $pid ); throw new Exception( 'served' ); } }
function wc_get_customer_available_downloads( $u ) { return array( array( 'product_id' => 30004, 'product_name' => 'נוסטלה - רגיל, וובפונט', 'order_id' => 0, 'download_url' => 'https://x/dl', 'download_name' => 'Nostela_Regular_Web' ) ); }
function wc_get_order( $id ) { return null; } function wc_get_orders( $a ) { return array(); } function get_user_meta() { return ''; } function wc_get_page_permalink() { return '/'; } function wc_logout_url() { return '/'; } function get_permalink() { return '/'; }
class NoTableDB { public $prefix = 'wp_'; function prepare( $q, ...$a ) { return $q; } function get_var( $q ) { return null; } function get_results( $q ) { return array(); } }
$GLOBALS['wpdb'] = new NoTableDB(); function current_time( $f ) { return array( 'Y' => 2026, 'n' => 10, 'd.m.Y' => '22.10.2026', 'Y-m-d' => '2026-10-22' )[ $f ]; } function admin_url( $p = '' ) { return 'https://fontshok.co.il/wp-admin/' . $p; }
function get_option( $k, $d = false ) { return $GLOBALS['opt'][ $k ] ?? $d; } function update_user_meta( $u, $k, $v ) { $GLOBALS['umeta'][ $u ][ $k ] = $v; }
if ( ! function_exists( 'wp_generate_password' ) ) { function wp_generate_password( $n = 12, $s = true, $e = false ) { return substr( str_repeat( 'abcdefgh23456789', 2 ), 0, $n ); } }
eval( file_get_contents( __DIR__ . '/../fsa-v2-snippet.php' ) );

$fail = 0; $t = function ( $ok, $m ) use ( &$fail ) { echo ( $ok ? 'ok   ' : 'FAIL ' ) . $m . "\n"; if ( ! $ok ) $fail++; };
// weights: exact product, no family, numeric order, both formats
$w = fsa_v2_weights( 'נוסטלה', true );
$t( array_column( $w, 'n' ) === array( 'דקיק', 'קל', 'רגיל' ), 'weights in order, family left out: ' . implode( ',', array_column( $w, 'n' ) ) );
$t( $w && strpos( $w[0]['web'], 'fsa_wdl=' ) && strpos( $w[0]['desk'], 'fsa_wdl=' ), 'each weight has a site and a desktop link' );
$t( ! array_filter( array_column( fsa_v2_weights( 'נוסטלה', false ), 'web' ) ), 'desktop-only plan gets no site links' );
$t( fsa_v2_weights( 'לא קיים', true ) === array(), 'unknown font: no weights' );
// download rules
$dl = function ( $q ) { $GLOBALS['died'] = null; $GLOBALS['served'] = null; $_GET = $q; try { fsa_v2_weight_download(); } catch ( Exception $e ) {} };
parse_str( parse_url( $w[0]['desk'], PHP_URL_QUERY ), $q ); $q['k'] = rawurldecode( $q['k'] );
$dl( $q ); $t( $GLOBALS['served'] && ! $GLOBALS['died'], 'subscriber downloads a weight of a subscription font' );
$dl( array_merge( $q, array( '_wpnonce' => 'bad' ) ) ); $t( $GLOBALS['died'] && ! $GLOBALS['served'], 'bad nonce is refused' );
$other = array_search( true, array_map( function ( $p ) { return $p->type === 'variation' && $p->parent === 22311; }, $GLOBALS['P'] ) );
$dl( array( 'fsa_wdl' => $other, 'k' => 'dl-' . $other, '_wpnonce' => 'N' ) ); $t( $GLOBALS['died'] && ! $GLOBALS['served'], 'font outside the subscription list is refused' );
$dl( array_merge( $q, array( 'k' => 'nope' ) ) ); $t( $GLOBALS['died'] && ! $GLOBALS['served'], 'unknown file key is refused' );
$GLOBALS['user']->roles = array( 'customer', 'member-desktop' ); parse_str( parse_url( $w[0]['web'], PHP_URL_QUERY ), $qw );
$dl( $qw ); $t( $GLOBALS['died'] && ! $GLOBALS['served'], 'desktop-only plan cannot download the site format' );
$dl( $q ); $t( $GLOBALS['served'] && ! $GLOBALS['died'], 'desktop-only plan can download the desktop format' );
$GLOBALS['user']->roles = array( 'customer' ); $dl( $q ); $t( $GLOBALS['died'] && ! $GLOBALS['served'], 'no subscription: refused' );
$GLOBALS['user']->roles = array( 'customer', 'member-webstop' ); $GLOBALS['user']->user_login = 'someone'; $dl( $q ); $t( $GLOBALS['served'] && ! $GLOBALS['died'], 'open to subscribers: any Webstop subscriber can download' );
$GLOBALS['user']->roles = array( 'customer' ); $dl( $q ); $t( $GLOBALS['died'] && ! $GLOBALS['served'], 'a customer without a subscription is refused' );
$GLOBALS['user']->roles = array( 'customer', 'member-webstop' );
$GLOBALS['user']->user_login = 'claude-test';
// purchased licence read from the variation
$d = fsa_v2_data(); $l = $d['lic'][0];
$t( 'נוסטלה' === $l['f'] && 'רגיל' === $l['w'] && 'וובפונט' === $l['t'] && 1 === $l['web'], "licence row: {$l['f']} / {$l['w']} / {$l['t']}" );
$t( 3 === count( $d['fonts'][0]['weights'] ), 'subscription data carries the weights' );
$t( array() === $d['domains'] && isset( $d['domNonce'], $d['domAjax'] ), 'no domains table: empty list, no error' );
// all fonts in one ZIP: the family file of each subscription font, per format
$u = $GLOBALS['up'];
foreach ( array( 'A_Web', 'A_Desk', 'B_Web', 'B_Desk' ) as $n ) file_put_contents( "$u/fonts/$n.zip", "data $n" ); file_put_contents( "$u/fonts/by-id-9.zip", 'data C_Desk' );
$GLOBALS['ff'] = array(
	array( 'font-name' => 'א', 'font-file' => array( 'url' => 'https://fontshok.co.il/up/fonts/A_Desk.zip' ), 'font-file-web' => array( 'url' => 'https://fontshok.co.il/up/fonts/A_Web.zip' ) ),
	array( 'font-name' => 'ב', 'font-file' => array( 'url' => 'https://fontshok.co.il/up/fonts/B_Desk.zip' ), 'font-file-web' => array( 'url' => 'https://fontshok.co.il/up/fonts/B_Web.zip' ) ),
	array( 'font-name' => 'ג', 'font-file' => array( 'ID' => 9, 'url' => 'https://elsewhere/c.zip' ), 'font-file-web' => array() ) );
$GLOBALS['user']->roles = array( 'customer', 'member-webstop' );
$names = function ( $z ) { $a = new ZipArchive(); $a->open( $z ); $o = array(); for ( $i = 0; $i < $a->numFiles; $i++ ) $o[] = $a->getNameIndex( $i ); sort( $o ); return $o; };
$zw = fsa_v2_all_zip( 'web' ); $zd = fsa_v2_all_zip( 'desk' );
$t( array( 'A_Web.zip', 'B_Web.zip' ) === $names( $zw ), 'all-for-sites ZIP holds every family web file' );
$t( array( 'A_Desk.zip', 'B_Desk.zip', 'by-id-9.zip' ) === $names( $zd ), 'all-for-desktop ZIP holds every family desktop file (also by attachment ID)' );
$t( 0 === strpos( basename( $zw ), 'web-' ) && 36 < strlen( basename( $zw ) ), 'the bundle has an unguessable name' );
$m = filemtime( $zw ); $t( $zw === fsa_v2_all_zip( 'web' ) && $m === filemtime( $zw ), 'the bundle is kept, not rebuilt each time' );
file_put_contents( "$u/fonts/A_Web.zip", 'new data, longer' ); $zw2 = fsa_v2_all_zip( 'web' ); $t( $zw2 !== $zw && ! is_file( $zw ) && is_file( $zw2 ), 'a changed file makes a new bundle and removes the old one' );
$GLOBALS['user']->roles = array( 'customer', 'member-desktop' ); $GLOBALS['died'] = null; try { fsa_v2_all_zip( 'web' ); } catch ( Exception $e ) {} $t( (bool) $GLOBALS['died'], 'desktop-only plan cannot get the sites bundle' );
$GLOBALS['died'] = null; try { fsa_v2_all_zip( 'desk' ); } catch ( Exception $e ) {} $t( ! $GLOBALS['died'], 'desktop-only plan gets the desktop bundle' );
$GLOBALS['user']->roles = array( 'customer' ); $GLOBALS['died'] = null; try { fsa_v2_all_zip( 'desk' ); } catch ( Exception $e ) {} $t( (bool) $GLOBALS['died'], 'no subscription: refused' );
$GLOBALS['user']->roles = array( 'customer', 'member-webstop' ); $GLOBALS['transients'] = array(); $d = fsa_v2_data();
$t( false !== strpos( $d['allDl']['web'], 'fsa_wall=web' ) && false !== strpos( $d['allDl']['desk'], 'fsa_wall=desk' ), 'the area gets both "all fonts" links' );
$GLOBALS['user']->roles = array( 'customer', 'member-desktop' ); $d = fsa_v2_data(); $t( '' === $d['allDl']['web'] && '' !== $d['allDl']['desk'], 'desktop-only: only the desktop bundle link' );
$GLOBALS['user']->roles = array( 'customer', 'member-desktop', 'member-barter' ); $d = fsa_v2_data(); $t( 'desk' === $d['plan'] && '' === $d['allDl']['web'] && ! array_filter( array_column( $d['fonts'], 'web' ) ) && ! array_filter( array_merge( ...array_map( function ( $f ) { return array_column( $f['weights'], 'web' ); }, $d['fonts'] ) ) ), 'Desktop shown with a leftover barter role: no web files at all' );
$GLOBALS['died'] = null; try { fsa_v2_all_zip( 'web' ); } catch ( Exception $e ) {} $t( (bool) $GLOBALS['died'], 'Desktop + barter cannot get the sites bundle' );
array_map( 'unlink', glob( "$u/*/*" ) + glob( "$u/*/*.*" ) ?: array() );
// the area's style and script as files the browser keeps: the address carries a hash of the content, one per kind
$cu = fsa_v2_asset_url( 'css' ); $ju = fsa_v2_asset_url( 'js' ); parse_str( (string) parse_url( $cu, PHP_URL_QUERY ), $cq ); parse_str( (string) parse_url( $ju, PHP_URL_QUERY ), $jq );
$t( 'css' === ( $cq['fsa_asset'] ?? '' ) && 'js' === ( $jq['fsa_asset'] ?? '' ) && preg_match( '/^[0-9a-f]{10}$/', $cq['v'] ?? '' ) && ( $cq['v'] ?? '' ) !== ( $jq['v'] ?? '' ), 'assets: one address per file, with a content hash' );
$t( $cu === fsa_v2_asset_url( 'css' ) && 'file' === FSA_V2_ASSETS, 'assets: the address is stable, and files are the default' );
$t( false === strpos( fsa_v2_js(), '<?php' ) && false === strpos( fsa_v2_js(), 'FS_DATA=' ), 'assets: the script file holds no customer data (it comes inline, before it)' );
echo $fail ? "\n$fail FAILED\n" : "\nALL PASSED\n"; exit( $fail ? 1 : 0 );
