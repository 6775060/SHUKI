<?php
/* Licence sites and the ₪79 add-on with fake WooCommerce orders and user meta.
   Usage: php wp-snippet/tests/addon-test.php */
define( 'ABSPATH', '/' ); define( 'HOUR_IN_SECONDS', 3600 ); define( 'DAY_IN_SECONDS', 86400 );
$GLOBALS['user'] = (object) array( 'ID' => 7, 'user_login' => 'claude-test', 'user_email' => 't@x', 'first_name' => 'T', 'last_name' => '', 'roles' => array( 'customer', 'member-webstop' ) );
$GLOBALS['meta'] = array( 7 => array( 'billing_phone' => '050-1234567' ) ); $GLOBALS['orders'] = array(); $GLOBALS['nonce_ok'] = true;
function add_action( ...$a ) {} function add_filter( ...$a ) {} function add_shortcode( ...$a ) {}
function current_user_can( $c ) { return false; } function is_user_logged_in() { return true; } function wp_get_current_user() { return $GLOBALS['user']; } function get_current_user_id() { return $GLOBALS['user']->ID; }
function check_ajax_referer() { return $GLOBALS['nonce_ok']; } function sanitize_key( $s ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $s ) ); }
function sanitize_text_field( $s ) { return trim( strip_tags( (string) $s ) ); } function wp_unslash( $s ) { return $s; }
function current_time( $f ) { return array( 'Y' => 2026, 'n' => 10, 'd.m.Y' => '22.10.2026', 'Y-m-d' => '2026-10-22' )[ $f ]; }
function wp_list_pluck( $l, $f ) { return array_map( function ( $x ) use ( $f ) { return is_array( $x ) ? $x[ $f ] : $x->$f; }, $l ); }
function wp_generate_password( $n ) { static $i = 0; return 'id' . ( ++$i ); }
function get_user_meta( $u, $k, $s ) { return $GLOBALS['meta'][ $u ][ $k ] ?? ''; } function update_user_meta( $u, $k, $v ) { $GLOBALS['meta'][ $u ][ $k ] = $v; }
function wc_get_page_permalink( $p ) { return 'https://fontshok.co.il/my-account/'; } function add_query_arg( $a, $u ) { return $u . '?' . http_build_query( $a ); }
class Done extends Exception { public $ok; public $data; function __construct( $ok, $d ) { $this->ok = $ok; $this->data = $d; } }
function wp_send_json_error( $d ) { throw new Done( false, $d ); } function wp_send_json_success( $d ) { throw new Done( true, $d ); }
class Prod { function __construct( public $id, public $lic ) {} function get_attribute( $k ) { return 'pa_license' === $k ? $this->lic : ''; } }
$GLOBALS['prods'] = array( 501 => new Prod( 501, 'וובפונט' ), 502 => new Prod( 502, 'דסקטופ' ), 900 => new Prod( 900, '' ) );
function wc_get_product( $id ) { return $GLOBALS['prods'][ $id ] ?? null; }
function wc_get_customer_available_downloads( $u ) { return 7 === $u ? array( array( 'product_id' => 501, 'order_id' => 1 ), array( 'product_id' => 502, 'order_id' => 1 ) ) : array(); }
class Item { public $meta = array(); function __construct( public $qty = 1 ) {} function get_meta( $k ) { return $this->meta[ $k ] ?? ''; } function get_quantity() { return $this->qty; } }
class Order { public $meta = array(), $items = array(), $notes = array(), $paid = false, $id;
	function __construct( $c ) { $this->id = count( $GLOBALS['orders'] ) + 100; $this->c = $c; $GLOBALS['orders'][ $this->id ] = $this; }
	function get_meta( $k ) { return $this->meta[ $k ] ?? ''; } function update_meta_data( $k, $v ) { $this->meta[ $k ] = $v; } function save() {} function add_order_note( $n ) { $this->notes[] = $n; }
	function add_product( $p, $q ) { $this->items[] = new Item( $q ); return count( $this->items ) - 1; } function get_items() { return $this->items; }
	public $billing = array(), $status = 'pending';
	function set_billing_email() {} function set_billing_first_name() {} function set_billing_last_name() {} function calculate_totals() {}
	function set_billing_phone( $v ) { $this->billing['phone'] = $v; } function set_billing_company( $v ) { $this->billing['company'] = $v; }
	function get_checkout_payment_url() { return 'https://fontshok.co.il/checkout/order-pay/' . $this->id . '/'; }
	function get_customer_id() { return $this->c; } function is_paid() { return $this->paid; } function get_date_paid() { return null; } function get_id() { return $this->id; } }
function wc_create_order( $a ) { return new Order( $a['customer_id'] ); }
function wc_get_orders( $q ) { return array_values( array_filter( array_reverse( $GLOBALS['orders'] ), function ( $o ) use ( $q ) { return $o->c === $q['customer_id'] && in_array( $o->status, $q['status'], true ) && ! $o->paid; } ) ); }
function wc_add_order_item_meta( $i, $k, $v ) { foreach ( $GLOBALS['orders'] as $o ) { if ( isset( $o->items[ $i ] ) && end( $GLOBALS['orders'] ) === $o ) { $o->items[ $i ]->meta[ $k ] = $v; } } }
function wc_get_order( $id ) { if ( 1 === $id ) { $o = new stdClass(); return new class { function get_meta( $k ) { return '_fs_domain' === $k ? 'checkout-site.co.il' : ''; } }; } return $GLOBALS['orders'][ $id ] ?? null; }
class WC_Order {}
eval( preg_replace( "/define\( 'FSA_V2_ADDON_PRODUCT', \d+ \);/", "define( 'FSA_V2_ADDON_PRODUCT', 900 );", file_get_contents( __DIR__ . '/../fsa-v2-snippet.php' ) ) );

$fail = 0; $t = function ( $ok, $m ) use ( &$fail ) { echo ( $ok ? 'ok   ' : 'FAIL ' ) . $m . "\n"; if ( ! $ok ) $fail++; };
$call = function ( $fn, $post ) { $_POST = $post; try { $fn(); } catch ( Done $d ) { return $d; } return null; };
$lic = function ( $op, $a = array() ) use ( $call ) { return $call( 'fsa_v2_lic_ajax', array_merge( array( 'op' => $op, 'key' => '501' ), $a ) ); };
// licence sites
$r = $lic( 'add', array( 'host' => 'https://www.Second.co.il/', 'name' => '' ) );
$t( $r->ok && 'checkout-site.co.il' === $r->data['sites'][0][2] && '' === $r->data['sites'][0][3] && 'second.co.il' === $r->data['sites'][1][2], 'site added after the fixed checkout domain' );
$t( ! $lic( 'add', array( 'host' => 'second.co.il' ) )->ok, 'same site twice refused' );
$t( ! $lic( 'add', array( 'host' => 'checkout-site.co.il' ) )->ok, 'the checkout domain cannot be added again' );
$t( $lic( 'add', array( 'host' => 'third.co.il' ) )->ok, 'third site (1 checkout + 2 here)' );
$r = $lic( 'add', array( 'host' => 'fourth.co.il' ) ); $t( ! $r->ok && false !== strpos( $r->data['message'], 'רשומים' ), 'webfont licence: 4th site refused (3 per licence)' );
$t( ! $lic( 'add', array( 'key' => '502', 'host' => 'x.co.il' ) )->ok, 'desktop licence has no sites' );
$t( ! $lic( 'add', array( 'key' => '777', 'host' => 'x.co.il' ) )->ok, 'a licence that is not yours is refused' );
$id = $GLOBALS['meta'][7]['fsa_v2_lic_sites']['501'][0]['id'];
$r = $lic( 'edit', array( 'id' => $id, 'host' => 'second-new.co.il', 'name' => 'שני' ) ); $t( $r->ok && 'second-new.co.il' === $r->data['sites'][1][2], 'edit a site' );
$t( ! $lic( 'edit', array( 'id' => 'nope', 'host' => 'a.co.il' ) )->ok, 'edit of an unknown site refused' );
$r = $lic( 'del', array( 'id' => $id ) ); $t( $r->ok && 2 === count( $r->data['sites'] ), 'remove a site' );
$t( $lic( 'add', array( 'host' => 'fourth.co.il' ) )->ok, 'freed place can be used again' );
// add-on: order created, nothing granted before payment
$r = $call( 'fsa_v2_addon_ajax', array( 'kind' => 'lic', 'key' => '501' ) );
$t( $r->ok && false !== strpos( $r->data['url'], '/checkout/order-pay/' ), 'add-on creates a pending order and returns the payment page' );
$o = end( $GLOBALS['orders'] ); $n = count( $GLOBALS['orders'] );
$r2 = $call( 'fsa_v2_addon_ajax', array( 'kind' => 'lic', 'key' => '501' ) );
$t( $r2->ok && $r2->data['url'] === $r->data['url'] && count( $GLOBALS['orders'] ) === $n, 'a second click reuses the unpaid order (no pile of pending orders)' );
$t( '050-1234567' === $o->billing['phone'], 'the order carries the customer\'s billing phone' );
$t( 1 === $o->meta['_fsa_v2_addon'] && 'lic' === $o->items[0]->meta['_fsa_v2_kind'] && '501' === $o->items[0]->meta['_fsa_v2_key'], 'the order remembers what it is for' );
fsa_v2_addon_grant( $o->id ); $t( 3 === fsa_v2_lic_limit( 7, '501' ), 'unpaid order grants nothing' );
$o->paid = true; fsa_v2_addon_grant( $o->id ); fsa_v2_addon_grant( $o->id ); $t( 4 === fsa_v2_lic_limit( 7, '501' ), 'paid: +1 site, once (hooks can fire twice)' );
$t( $lic( 'add', array( 'host' => 'fifth.co.il' ) )->ok, 'the extra site can be registered' );
fsa_v2_addon_revoke( $o->id ); $t( 3 === fsa_v2_lic_limit( 7, '501' ), 'refund / cancel takes the allowance back' );
$r = $call( 'fsa_v2_addon_ajax', array( 'kind' => 'sub' ) ); $s = end( $GLOBALS['orders'] ); $s->paid = true; fsa_v2_addon_grant( $s->id );
$t( $r->ok && 1 === fsa_v2_bonus_sub( 7, 2026, 10 ), 'subscription add-on: +1 domain this month' );
$GLOBALS['user']->roles = array( 'customer', 'member-barter' ); $t( $call( 'fsa_v2_addon_ajax', array( 'kind' => 'sub' ) )->ok, 'barter (like Webstop) can buy an extra domain' );
$GLOBALS['user']->roles = array( 'customer', 'member-desktop' ); $t( ! $call( 'fsa_v2_addon_ajax', array( 'kind' => 'sub' ) )->ok, 'desktop (no domains) cannot buy subscription slots' );
$t( 79.0 === fsa_v2_addon_price() || 79 === fsa_v2_addon_price(), 'add-on price falls back to 79 when the product has none' );
$GLOBALS['user']->roles = array( 'customer', 'member-extra' ); $t( ! $call( 'fsa_v2_addon_ajax', array( 'kind' => 'sub' ) )->ok, 'extra (unlimited) cannot buy subscription slots' );
$t( ! $call( 'fsa_v2_addon_ajax', array( 'kind' => 'lic', 'key' => '502' ) )->ok, 'desktop licence cannot buy sites' );
$GLOBALS['nonce_ok'] = false; $t( ! $call( 'fsa_v2_addon_ajax', array( 'kind' => 'lic', 'key' => '501' ) )->ok, 'bad nonce refused' );
echo $fail ? "\n$fail FAILED\n" : "\nALL PASSED\n"; exit( $fail ? 1 : 0 );
