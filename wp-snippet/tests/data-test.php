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
function home_url( $p = '' ) { return 'https://fontshok.co.il' . $p; } function add_query_arg( $a, $u ) { return $u . '?' . http_build_query( $a ); }
function get_transient( $k ) { return $GLOBALS['transients'][ $k ] ?? false; } function set_transient( $k, $v, $t ) { $GLOBALS['transients'][ $k ] = $v; }
function get_post_modified_time() { return 1; }
function get_field( $k, $o ) { return array( array( 'font-name' => 'נוסטלה', 'font-file' => array( 'url' => 'https://x/d.zip' ), 'font-file-web' => array( 'url' => 'https://x/w.zip' ) ) ); }
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
$GLOBALS['user']->roles = array( 'customer', 'member-webstop' ); $GLOBALS['user']->user_login = 'someone'; $dl( $q ); $t( $GLOBALS['died'] && ! $GLOBALS['served'], 'non-preview user refused (stage 1)' );
$GLOBALS['user']->user_login = 'claude-test';
// purchased licence read from the variation
$d = fsa_v2_data(); $l = $d['lic'][0];
$t( 'נוסטלה' === $l['f'] && 'רגיל' === $l['w'] && 'וובפונט' === $l['t'] && 1 === $l['web'], "licence row: {$l['f']} / {$l['w']} / {$l['t']}" );
$t( 3 === count( $d['fonts'][0]['weights'] ), 'subscription data carries the weights' );
echo $fail ? "\n$fail FAILED\n" : "\nALL PASSED\n"; exit( $fail ? 1 : 0 );
