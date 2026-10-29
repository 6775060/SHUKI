<?php
/* A small WooCommerce stand-in for the purchase area: a font product with variations (pa_weight × pa_license), the plan products,
   a cart that behaves like WC()->cart (lines keyed by product + variation + item data), orders for the "order received" page.
   Prices here play the store's prices (VAT included, taxes off in WooCommerce, as on the site). Used by buy-test.php and harness-buy.php. */
if ( ! defined( 'ABSPATH' ) ) define( 'ABSPATH', '/' );
if ( ! defined( 'HOUR_IN_SECONDS' ) ) define( 'HOUR_IN_SECONDS', 3600 );
if ( ! defined( 'DAY_IN_SECONDS' ) ) define( 'DAY_IN_SECONDS', 86400 );
$GLOBALS['user'] = $GLOBALS['user'] ?? (object) array( 'ID' => 0, 'user_login' => '', 'user_email' => '', 'first_name' => '', 'last_name' => '', 'roles' => array() );
$GLOBALS['is_admin'] = $GLOBALS['is_admin'] ?? false;
$GLOBALS['transients'] = array(); $GLOBALS['created_orders'] = 0; $GLOBALS['cookie_set'] = 0;
function add_action( ...$a ) {} function add_filter( ...$a ) {} function add_shortcode( ...$a ) {}
function current_user_can( $c ) { return $GLOBALS['is_admin']; } function is_user_logged_in() { return $GLOBALS['user']->ID > 0; }
function wp_get_current_user() { return $GLOBALS['user']; } function get_current_user_id() { return $GLOBALS['user']->ID; }
function check_ajax_referer() { return true; } function sanitize_key( $s ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $s ) ); }
function sanitize_text_field( $s ) { return trim( strip_tags( (string) $s ) ); } function wp_unslash( $s ) { return $s; } function wc_clean( $s ) { return trim( (string) $s ); } function absint( $n ) { return abs( (int) $n ); }
function current_time( $f ) { return 'timestamp' === $f ? mktime( 12, 0, 0, 10, 29, 2026 ) : array( 'Y' => 2026, 'n' => 10, 'd.m.Y' => '29.10.2026', 'Y-m-d' => '2026-10-29' )[ $f ]; }
function get_transient( $k ) { return $GLOBALS['transients'][ $k ] ?? false; } function set_transient( $k, $v, $t ) { $GLOBALS['transients'][ $k ] = $v; }
function get_post_modified_time() { return 1700000000; } function get_permalink( $id ) { return 'https://site.test/product/plan-' . $id . '/'; }
function admin_url( $p = '' ) { return 'https://site.test/wp-admin/' . $p; } function home_url( $p = '' ) { return 'https://site.test' . $p; }
function wc_get_page_permalink( $p ) { return 'https://site.test/my-account/'; } function wc_get_checkout_url() { return 'https://site.test/checkout/'; }
function add_query_arg( $a, $u ) { return $u . '?' . http_build_query( $a ); } function wp_json_encode( $d, $f = 0 ) { return json_encode( $d, $f ); }
function get_term_by( $f, $slug, $tax ) { $n = array( '100' => 'דקיק', '200' => 'קל מאוד', '300' => 'קל', '400' => 'רגיל', '500' => 'בינוני', '600' => 'דמוי מודגש', '700' => 'מודגש', '900' => 'שחור' ); return isset( $n[ $slug ] ) ? (object) array( 'name' => $n[ $slug ] ) : false; }
class Done extends Exception { public $ok; public $data; function __construct( $ok, $d ) { $this->ok = $ok; $this->data = $d; } }
function wp_send_json_error( $d ) { throw new Done( false, $d ); } function wp_send_json_success( $d ) { throw new Done( true, $d ); }
class Prod {
	public $children = array(), $parent = 0, $att = array(), $ok = true, $regular = '';
	function __construct( public $id, public $type, public $name, public $price ) { $GLOBALS['prods'][ $id ] = $this; }
	function get_regular_price() { return $this->regular ?: $this->price; } function get_id() { return $this->id; } function get_name() { return $this->name; } function get_price() { return $this->price; }
	function is_type( $t ) { return $this->type === $t; } function get_children() { return $this->children; } function get_parent_id() { return $this->parent; }
	function get_attributes() { return $this->att; } function is_purchasable() { return $this->ok; } function is_in_stock() { return true; }
	function get_attribute( $k ) { return $this->att[ $k ] ?? ''; } function get_downloads() { return array( 'f' => 1 ); }
	function get_variation_attributes() { $o = array(); foreach ( $this->att as $k => $v ) $o[ 'attribute_' . $k ] = $v; return $o; }
}
function wc_get_product( $id ) { return $GLOBALS['prods'][ (int) $id ] ?? null; }
function wc_get_price_including_tax( $p, $a = array() ) { return (float) ( $a['price'] ?? $p->get_price() ); } function wc_get_price_excluding_tax( $p ) { return (float) $p->get_price(); }
// the font "נוסטלה": family 2400, single weights 300 (prices as the store has them), webfont and desktop
$GLOBALS['prods'] = array();
$font = new Prod( 500, 'variable', 'נוסטלה', '' ); $vid = 600;
foreach ( array( 'webfont' => 1, 'desktop' => 1 ) as $l => $_ ) {
	foreach ( array( 'family', '100', '200', '300', '400', '500', '600', '700', '900' ) as $w ) {
		$v = new Prod( ++$vid, 'variation', 'נוסטלה', 'family' === $w ? ( 'webfont' === $l ? '2400' : '1800' ) : ( 'webfont' === $l ? '300' : '250' ) );
		$v->parent = 500; $v->att = array( 'pa_weight' => $w, 'pa_license' => $l ); $font->children[] = $vid;
	}
}
$GLOBALS['prods'][601]->regular = '2832'; // webfont family on sale: 2832 struck, 2400 now (as the live store shows it)
$GLOBALS['prods'][610]->ok = false; // desktop family: not for sale (left out)
new Prod( 12652, 'simple', 'וובסטופ', '320' ); new Prod( 14162, 'simple', 'אקסטרה', '680' ); new Prod( 22785, 'simple', 'דסקטופ', '179' );
new Prod( 777, 'simple', 'חולצה', '90' );
class Cart {
	public $items = array();
	function get_cart() { return $this->items; } function is_empty() { return ! $this->items; }
	function add_to_cart( $pid, $q = 1, $vid = 0, $va = array(), $data = array() ) { $k = md5( $pid . '|' . $vid . '|' . json_encode( $data ) ); if ( isset( $this->items[ $k ] ) ) { $this->items[ $k ]['quantity'] += $q; return $k; } $this->items[ $k ] = array_merge( $data, array( 'product_id' => $pid, 'variation_id' => $vid, 'quantity' => $q, 'data' => wc_get_product( $vid ?: $pid ) ) ); return $k; }
	function remove_cart_item( $k ) { unset( $this->items[ $k ] ); } function set_quantity( $k, $q ) { $this->items[ $k ]['quantity'] = $q; }
}
class Sess { public $has = false; function has_session() { return $this->has; } function set_customer_session_cookie( $s ) { $this->has = true; $GLOBALS['cookie_set']++; } }
class WCMain { public $cart, $session; function __construct() { $this->cart = new Cart(); $this->session = new Sess(); } }
$GLOBALS['wc'] = new WCMain(); function WC() { return $GLOBALS['wc']; }
function wc_create_order( $a = array() ) { $GLOBALS['created_orders']++; return null; }
class OItem { function __construct( public $pid, public $meta = array() ) {} function get_meta( $k ) { return $this->meta[ $k ] ?? ''; } function get_product_id() { return $this->pid; } }
class Order { function __construct( public $id, public $key, public $items, public $status ) {} function get_regular_price() { return $this->regular ?: $this->price; } function get_id() { return $this->id; } function get_order_key() { return $this->key; } function get_items() { return $this->items; }
	function is_paid() { return in_array( $this->status, array( 'processing', 'completed' ), true ); } function has_status( $s ) { return $this->status === $s; } function get_checkout_payment_url() { return 'https://site.test/checkout/order-pay/' . $this->id . '/?pay_for_order=true&key=' . $this->key; } }
$GLOBALS['orders'] = array(
	901 => new Order( 901, 'wc_order_ok', array( new OItem( 500, array( '_fsa_v2_buy' => 1 ) ) ), 'processing' ),
	902 => new Order( 902, 'wc_order_bad', array( new OItem( 500, array( '_fsa_v2_buy' => 1 ) ) ), 'failed' ),
	903 => new Order( 903, 'wc_order_plan', array( new OItem( 22785, array( '_fsa_v2_buy' => 1 ) ) ), 'completed' ),
	904 => new Order( 904, 'wc_order_old', array( new OItem( 500 ) ), 'completed' ),
	905 => new Order( 905, 'wc_order_wait', array( new OItem( 500, array( '_fsa_v2_buy' => 1 ) ) ), 'on-hold' ),
);
function wc_get_order( $id ) { return $GLOBALS['orders'][ $id ] ?? null; }
// page context: set $GLOBALS['page'] = array( 'product' => id ) / array( 'received' => id, 'key' => … ) / array( 'pricing' => 1 )
$GLOBALS['page'] = array();
function is_order_received_page() { return isset( $GLOBALS['page']['received'] ); } function get_query_var( $v ) { return $GLOBALS['page']['received'] ?? 0; }
function is_page( $id ) { return ! empty( $GLOBALS['page']['pricing'] ) && 13376 === $id; } function is_product() { return isset( $GLOBALS['page']['product'] ); }
function get_queried_object_id() { return $GLOBALS['page']['product'] ?? 0; } function is_admin() { return false; }
function fsa_stub_snippet( $buy_for = 'admins' ) {
	$src = file_get_contents( __DIR__ . '/../fsa-v2-snippet.php' );
	return str_replace( "define( 'FSA_V2_BUY_FOR', 'admins' );", "define( 'FSA_V2_BUY_FOR', '$buy_for' );", $src );
}
