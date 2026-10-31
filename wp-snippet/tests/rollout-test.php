<?php
/* Who gets the new area at /my-account/. Each case runs in its own php process (the settings are constants).
   Usage: php wp-snippet/tests/rollout-test.php */
$fail = 0; $t = function ( $ok, $m, $got ) use ( &$fail ) { echo ( $ok ? 'ok   ' : 'FAIL ' ) . $m . ( $ok ? '' : "  (got: $got)" ) . "\n"; if ( ! $ok ) $fail++; };
$run = function ( $mode, $list, $who, $setup = '' ) {
	$src = file_get_contents( __DIR__ . '/../fsa-v2-snippet.php' );
	$src = preg_replace( "/define\( 'FSA_V2_LIVE_FOR', '[a-z]+' \);/", "define( 'FSA_V2_LIVE_FOR', '$mode' );", $src );
	$src = preg_replace( "/define\( 'FSA_V2_LIVE_USERS', '[^']*' \);/", "define( 'FSA_V2_LIVE_USERS', '$list' );", $src );
	$stub = '<?php
define( "ABSPATH", "/" ); define( "DAY_IN_SECONDS", 86400 ); define( "COOKIEPATH", "/" ); define( "COOKIE_DOMAIN", "" );
$GLOBALS["u"] = ' . var_export( $who, true ) . '; if ( $GLOBALS["u"] ) $GLOBALS["u"] = (object) $GLOBALS["u"];
' . $setup . '
function add_action( ...$a ) {} function add_filter( ...$a ) {} function add_shortcode( ...$a ) {}
function is_user_logged_in() { return (bool) $GLOBALS["u"]; } function wp_get_current_user() { return $GLOBALS["u"]; }
function current_user_can( $c ) { return ! empty( $GLOBALS["admin"] ); } function is_account_page() { return true; }
function is_wc_endpoint_url( $e = null ) { $ep = $GLOBALS["ep"] ?? ""; return null === $e ? ! empty( $ep ) : $ep === $e; }
function get_query_var( $k ) { return $GLOBALS["qv"][ $k ] ?? ""; } function absint( $v ) { return abs( (int) $v ); } function is_ssl() { return true; }
function untrailingslashit( $s ) { return rtrim( $s, "/" ); } function wp_parse_url( $u, $c = -1 ) { return parse_url( $u, $c ); } function wp_unslash( $s ) { return $s; }
function wc_get_page_permalink( $p ) { return "https://fontshok.co.il/my-account/"; }
if ( ! isset( $_SERVER["REQUEST_URI"] ) ) $_SERVER["REQUEST_URI"] = "/my-account/";
' . $src . '
echo ( fsa_v2_takes_account_page() ? "NEW" : "OLD" ) . ( isset( $GLOBALS["want_target"] ) ? "|" . fsa_v2_old_page_target() : "" );';
	$f = tempnam( sys_get_temp_dir(), 'fsa' ); file_put_contents( $f, $stub );
	$out = trim( (string) shell_exec( 'php ' . escapeshellarg( $f ) . ' 2>&1' ) ); unlink( $f ); return $out;
};
$cust = array( 'user_login' => 'dana', 'user_email' => 'Dana@Mail.com', 'roles' => array( 'customer' ) );
$sub  = array( 'user_login' => 'noa', 'user_email' => 'noa@mail.com', 'roles' => array( 'customer', 'member-webstop' ) );
$cases = array(
	array( 'OLD', 'admins', '', $cust, '', "'admins': a customer keeps the old area" ),
	array( 'NEW', 'admins', '', array( 'user_login' => 'claude-test', 'user_email' => 'x@y', 'roles' => array() ), '', "'admins': the test account gets the new area" ),
	array( 'NEW', 'admins', '', array( 'user_login' => 'boss', 'user_email' => 'b@y', 'roles' => array() ), '$GLOBALS["admin"]=true;', "'admins': an admin gets the new area" ),
	array( 'NEW', 'list', 'someone, dana@mail.com', $cust, '', "'list': a listed customer (by email, any case) gets it" ),
	array( 'OLD', 'list', 'someone', $cust, '', "'list': an unlisted customer keeps the old area" ),
	array( 'NEW', 'all', '', $cust, '', "'all': every customer gets it" ),
	array( 'NEW', 'subscribers', '', $sub, '', "'subscribers': a Webstop subscriber gets it" ),
	array( 'NEW', 'subscribers', '', array( 'user_login' => 'x', 'user_email' => 'x@y', 'roles' => array( 'member-extra' ) ), '', "'subscribers': an Extra subscriber gets it" ),
	array( 'OLD', 'subscribers', '', $cust, '', "'subscribers': a customer without a subscription keeps the old area" ),
	array( 'OLD', 'subscribers', '', null, '', "'subscribers': logged out keeps the login form" ),
	array( 'OLD', 'subscribers', '', $sub, '$_COOKIE["fsa_old"]="1";', "'subscribers': a subscriber who chose the previous area keeps it" ),
	array( 'OLD', 'all', '', null, '', 'logged out: the login form stays as it is' ),
	array( 'OLD', 'all', '', $cust, '$GLOBALS["ep"]=true;', 'orders / password / addresses pages stay as they are' ),
	array( 'OLD', 'all', '', $cust, '$_COOKIE["fsa_old"]="1";', 'a customer who chose the previous area keeps it' ),
	array( 'OLD', 'all', '', $cust, '$_GET["fsa_old"]="1";', '?fsa_old=1 switches to the previous area' ),
	array( 'NEW', 'all', '', $cust, '$_COOKIE["fsa_old"]="1";$_GET["fsa_old"]="0";', '?fsa_old=0 switches back to the new one' ),
	array( 'OLD', 'all', '', $cust, '$_SERVER["REQUEST_URI"]="/my-account/domains/";', 'a plugin\'s own sub-page (the old Domains tab) stays as it is' ),
	array( 'NEW', 'all', '', $cust, '$_SERVER["REQUEST_URI"]="/my-account/?utm_source=mail";', '/my-account/ with a query string still gets the new area' ),
);
// old account sub-pages lead into the new area (unless the customer chose the previous one)
$tg = '$GLOBALS["want_target"]=1;';
$cases = array_merge( $cases, array(
	array( 'OLD|orders', 'all', '', $cust, $tg . '$GLOBALS["ep"]="orders";', 'old orders page leads to the new orders view' ),
	array( 'OLD|order-12345', 'all', '', $cust, $tg . '$GLOBALS["ep"]="view-order";$GLOBALS["qv"]=array("view-order"=>"12345");', 'one order (e-mail link) opens that order in the new area' ),
	array( 'OLD|profile', 'all', '', $cust, $tg . '$GLOBALS["ep"]="edit-account";', 'account details lead to the new profile' ),
	array( 'OLD|profile', 'all', '', $cust, $tg . '$GLOBALS["ep"]="edit-address";', 'addresses lead to the new profile' ),
	array( 'OLD|lic', 'all', '', $cust, $tg . '$GLOBALS["ep"]="downloads";', 'downloads lead to "my fonts"' ),
	array( 'OLD|dom', 'all', '', $cust, $tg . '$_SERVER["REQUEST_URI"]="/my-account/domains/";', 'the old Domains tab leads to the new domains view' ),
	array( 'OLD|', 'all', '', $cust, $tg . '$GLOBALS["ep"]="payment-methods";', 'payment methods stay as they are' ),
	array( 'OLD|', 'all', '', $cust, $tg . '$GLOBALS["ep"]="customer-logout";', 'logout stays as it is' ),
	array( 'OLD|', 'all', '', $cust, $tg . '$GLOBALS["ep"]="orders";$_COOKIE["fsa_old"]="1";', 'a customer who chose the previous area keeps its pages' ),
	array( 'OLD|', 'all', '', null, $tg . '$GLOBALS["ep"]="orders";', 'logged out: nothing is redirected' ),
	array( 'OLD|', 'admins', '', $cust, $tg . '$GLOBALS["ep"]="orders";', 'not live for this customer: nothing is redirected' ),
) );
foreach ( $cases as $c ) { $got = $run( $c[1], $c[2], $c[3], $c[4] ); $t( $c[0] === $got, $c[5], $got ); }
echo $fail ? "\n$fail FAILED\n" : "\nALL PASSED\n"; exit( $fail ? 1 : 0 );
