<?php
/* Purchase area (2m) on the server: prices from the store, the cart lines, plans, payment, who may buy, the thank-you page, the styles.
   Usage: php wp-snippet/tests/buy-test.php */
require __DIR__ . '/wcstub.php';
$mode = $argv[1] ?? '';
eval( fsa_stub_snippet( 'all' === $mode ? 'all' : 'admins' ) );

$fail = 0; $t = function ( $ok, $m ) use ( &$fail ) { echo ( $ok ? 'ok   ' : 'FAIL ' ) . $m . "\n"; if ( ! $ok ) $fail++; };
$call = function ( $post ) { $_POST = $post; try { fsa_v2_buy_ajax(); } catch ( Done $d ) { return $d; } return null; };
if ( 'all' === $mode ) { // FSA_V2_BUY_FOR = 'all': a guest can buy, and gets a store session
	$r = $call( array( 'op' => 'plan', 'k' => 'web' ) );
	$t( $r->ok && 1 === count( $r->data['lines'] ) && $GLOBALS['cookie_set'] === 1, 'open to all: a guest can add a plan, with a store session' );
	echo $fail ? "\n$fail FAILED\n" : "\nALL PASSED\n"; exit( $fail ? 1 : 0 );
}

// who may buy here: before launch only admins and the test account
$t( ! $call( array( 'op' => 'cart' ) )->ok, 'switch "admins": a guest is refused' );
$GLOBALS['user'] = (object) array( 'ID' => 7, 'user_login' => 'someone', 'roles' => array( 'customer' ) );
$t( ! $call( array( 'op' => 'cart' ) )->ok, 'switch "admins": a plain customer is refused' );
$GLOBALS['user'] = (object) array( 'ID' => 8, 'user_login' => 'claude-test', 'roles' => array( 'customer' ) );
$t( $call( array( 'op' => 'cart' ) )->ok, 'switch "admins": the test account may buy' );
exec( 'php ' . escapeshellarg( __FILE__ ) . ' all', $o, $rc ); $t( 0 === $rc, 'switch "all": ' . trim( (string) end( $o ) ) );

// the font from the store: licences, family first, prices exactly the store's, a variation not for sale left out
$f = fsa_v2_buy_font( wc_get_product( 500 ) );
$web = $f['lics'][0]; $desk = $f['lics'][1];
$t( 'web' === $web['k'] && 'desk' === $desk['k'] && 'וובפונט' === $web['label'], 'two licences, webfont first' );
$t( $web['items'][0]['fam'] && 'משפחת נוסטלה' === $web['items'][0]['n'] && 2400.0 === $web['items'][0]['price'], 'the full family comes first, at the store price (2400)' );
$t( 2832.0 === $web['items'][0]['was'] && 0 === $web['items'][1]['was'], 'a sale shows the price before it (2832), a weight without a sale shows none' );
$t( 'דקיק' === $web['items'][1]['n'] && 300.0 === $web['items'][1]['price'] && 'שחור' === end( $web['items'] )['n'], 'single weights by weight, named from the store, at the store price (300)' );
$t( 8 === count( $desk['items'] ) && ! $desk['items'][0]['fam'], 'a variation that is not for sale is left out (desktop family)' );
$t( abs( $web['items'][0]['vat'] - ( 2400 - 2400 / 1.18 ) ) < 0.01, 'VAT is the part inside the price (prices include VAT)' );
$GLOBALS['prods'][602]->price = '310'; $t( 300.0 === fsa_v2_buy_font( wc_get_product( 500 ) )['lics'][0]['items'][1]['price'], 'the font is cached per product version' );
$GLOBALS['prods'][602]->price = '300';

// choose weights: the cart holds exactly the chosen ones; choosing again replaces, never doubles
$r = $call( array( 'op' => 'set', 'product' => 500, 'vids' => '602,603,612' ) );
$t( $r->ok && 3 === count( $r->data['lines'] ), 'three chosen weights, three lines' );
$t( 'נוסטלה' === $r->data['lines'][0]['name'] && 'דקיק · רישיון וובפונט' === $r->data['lines'][0]['sub'] && 'רישיון דסקטופ' === substr( $r->data['lines'][2]['sub'], -strlen( 'רישיון דסקטופ' ) ), 'each line says the font, the weight and the licence' );
$t( 850.0 === $r->data['total'] && abs( $r->data['total'] - array_sum( array_column( $r->data['lines'], 'price' ) ) ) < 0.001, 'the total equals the sum of the lines (300+300+250)' );
$t( abs( $r->data['vat'] - array_sum( array_column( $r->data['lines'], 'vat' ) ) ) < 0.001, 'the VAT equals the sum of the lines\' VAT' );
$r = $call( array( 'op' => 'set', 'product' => 500, 'vids' => '601' ) );
$t( 1 === count( $r->data['lines'] ) && 'משפחה מלאה · רישיון וובפונט' === $r->data['lines'][0]['sub'] && 2400.0 === $r->data['total'], 'choosing the family replaces the single weights' );
$r = $call( array( 'op' => 'set', 'product' => 500, 'vids' => '601,601' ) ); $t( 1 === count( $r->data['lines'] ) && 1 === $r->data['lines'][0]['qty'], 'the same weight twice is one line' );
$t( ! $call( array( 'op' => 'set', 'product' => 500, 'vids' => '610' ) )->ok, 'a variation not for sale is refused' );
$t( ! $call( array( 'op' => 'set', 'product' => 500, 'vids' => '777' ) )->ok && ! $call( array( 'op' => 'set', 'product' => 777, 'vids' => '602' ) )->ok, 'another product, or a weight of another font, is refused' );
$t( 1 === count( WC()->cart->items ), 'a refused choice leaves the cart as it was' );

// plans: one plan per order, renewal said plainly
$r = $call( array( 'op' => 'plan', 'k' => 'web' ) ); $r = $call( array( 'op' => 'plan', 'k' => 'web' ) );
$pl = array_values( array_filter( $r->data['lines'], function ( $l ) { return 'plan' === $l['kind']; } ) );
$t( 1 === count( $pl ) && 1 === $pl[0]['qty'] && 320.0 === $pl[0]['price'], 'a plan clicked twice is one line, at the store price' );
$t( false !== strpos( $pl[0]['sub'], 'מתחדש כל חודש' ) && false !== strpos( $pl[0]['sub'], 'החיוב הבא ב־29.11.2026' ), 'the plan says how often it renews and when the next charge is' );
$r = $call( array( 'op' => 'plan', 'k' => 'desk' ) );
$pl = array_values( array_filter( $r->data['lines'], function ( $l ) { return 'plan' === $l['kind']; } ) );
$t( 1 === count( $pl ) && 'desk' === $pl[0]['plan'] && false !== strpos( $pl[0]['sub'], 'בהתחייבות ל־24 חודשים' ), 'another plan replaces the first; desktop shows its 24-month commitment' );
$t( 2 === count( $r->data['lines'] ) && 2579.0 === $r->data['total'], 'the font stays next to the plan, total 2400+179' );
$t( ! $call( array( 'op' => 'plan', 'k' => 'acad' ) )->ok, 'a plan that is not for sale is refused' );
$plans = fsa_v2_buy_plans(); $t( 3 === count( $plans ) && 680.0 === $plans['extra']['price'] && 24 === $plans['desk']['commit'] && 0 === $plans['web']['commit'], 'plans for sale with their store prices' );

// remove a line
$key = $r->data['lines'][0]['key']; $r = $call( array( 'op' => 'del', 'key' => $key ) );
$t( 1 === count( $r->data['lines'] ) && 179.0 === $r->data['total'], 'removing a line recalculates the total' );

// pay: the store's checkout page; no order is created here, so a second click cannot create a second one
$r1 = $call( array( 'op' => 'pay' ) ); $r2 = $call( array( 'op' => 'pay' ) );
$t( $r1->ok && 'https://site.test/checkout/' === $r1->data['url'], 'pay goes to the store checkout' );
$t( 0 === $GLOBALS['created_orders'] && $r2->data['url'] === $r1->data['url'] && 1 === count( WC()->cart->items ), 'a second click: same page, no order created, the cart unchanged' );
WC()->cart->items = array(); $t( ! $call( array( 'op' => 'pay' ) )->ok, 'an empty cart cannot go to payment' );
WC()->cart->add_to_cart( 777, 2 ); $r = $call( array( 'op' => 'cart' ) );
$t( 'other' === $r->data['lines'][0]['kind'] && 180.0 === $r->data['total'], 'something else already in the cart is shown too (nothing hidden before payment)' );

// which page gets the purchase screens
$GLOBALS['page'] = array( 'product' => 500 ); $d = fsa_v2_buy_context(); $t( $d && 500 === $d['font']['id'], 'a font page: the chooser' );
$GLOBALS['page'] = array( 'product' => 22785 ); $d = fsa_v2_buy_context(); $t( $d && 'desk' === $d['planPage'] && empty( $d['font'] ), 'a plan page: straight to the order details' );
$GLOBALS['page'] = array( 'product' => 777 ); $t( null === fsa_v2_buy_context(), 'another product: nothing' );
$GLOBALS['page'] = array( 'pricing' => 1 ); $d = fsa_v2_buy_context(); $t( $d && 3 === count( $d['plans'] ), 'the pricing page: its plan buttons open the order details' );
$GLOBALS['page'] = array(); $t( null === fsa_v2_buy_context(), 'any other page: nothing (no styles, no script)' );
$rec = function ( $id, $key ) { $GLOBALS['page'] = array( 'received' => $id ); $_GET['key'] = $key; $d = fsa_v2_buy_context(); return $d ? $d['done'] : null; };
$t( 'ok' === ( $rec( 901, 'wc_order_ok' )['state'] ?? '' ), 'order received, paid: thank you' );
$t( 'fail' === ( $rec( 902, 'wc_order_bad' )['state'] ?? '' ) && false !== strpos( $rec( 902, 'wc_order_bad' )['retry'], 'order-pay/902' ), 'payment failed: say so, with a way to try again' );
$t( 'wait' === ( $rec( 905, 'wc_order_wait' )['state'] ?? '' ), 'payment not confirmed yet: we wait, we do not say "paid"' );
$t( true === ( $rec( 903, 'wc_order_plan' )['plan'] ?? null ), 'a plan order is known as one' );
$t( null === $rec( 901, 'wrong' ), 'someone else\'s order (wrong key): nothing' );
$t( null === $rec( 904, 'wc_order_old' ), 'an order not made through the area: the page stays as it was' );

// styles: only what the purchase screens use, from the area's own CSS
$css = fsa_v2_buy_css();
foreach ( array( '--violet:#5B3FFF', '.cart-sheet', '.cart-sum', '.offer .of-top', '.tabs button[aria-selected="true"]', '.chips button', '.btn.btn-grad', '.ibtn', '.toast', '.buy-foot', '@keyframes spin', 'prefers-reduced-motion' ) as $s ) $t( false !== strpos( $css, $s ), "purchase styles include $s" );
foreach ( array( ':is(#fsa,#fsa-layer) .side{', '.tbl thead', '.dl-tbl .wsel{', '.st-card' ) as $s ) $t( false === strpos( $css, $s ), "purchase styles leave out $s" );
$t( strlen( $css ) < strlen( fsa_v2_css() ) / 2, 'purchase styles are less than half of the area\'s (' . round( strlen( $css ) / 1024 ) . ' KB of ' . round( strlen( fsa_v2_css() ) / 1024 ) . ')' );
$t( substr_count( $css, '{' ) === substr_count( $css, '}' ), 'purchase styles: braces balanced' );
$m = fsa_v2_buy_markup( array( 'plans' => array() ), true );
foreach ( array( 'const ICON=', 'const SUBS=', 'function party()', 'function toast(t)', 'const ils=', 'const ea=' ) as $s ) $t( false !== strpos( $m, $s ), "the script reuses the area's $s" );
$t( false !== strpos( $m, '<style id="fsa-buy-css">' ) && false === strpos( fsa_v2_buy_markup( array(), false ), '<style' ), 'styles only outside the area' );
echo $fail ? "\n$fail FAILED\n" : "\nALL PASSED\n"; exit( $fail ? 1 : 0 );
