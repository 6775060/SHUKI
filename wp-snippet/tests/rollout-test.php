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
function is_wc_endpoint_url() { return ! empty( $GLOBALS["ep"] ); } function is_ssl() { return true; }
' . $src . '
echo fsa_v2_takes_account_page() ? "NEW" : "OLD";';
	$f = tempnam( sys_get_temp_dir(), 'fsa' ); file_put_contents( $f, $stub );
	$out = trim( (string) shell_exec( 'php ' . escapeshellarg( $f ) . ' 2>&1' ) ); unlink( $f ); return $out;
};
$cust = array( 'user_login' => 'dana', 'user_email' => 'Dana@Mail.com' );
$cases = array(
	array( 'OLD', 'admins', '', $cust, '', "'admins': a customer keeps the old area" ),
	array( 'NEW', 'admins', '', array( 'user_login' => 'claude-test', 'user_email' => 'x@y' ), '', "'admins': the test account gets the new area" ),
	array( 'NEW', 'admins', '', array( 'user_login' => 'boss', 'user_email' => 'b@y' ), '$GLOBALS["admin"]=true;', "'admins': an admin gets the new area" ),
	array( 'NEW', 'list', 'someone, dana@mail.com', $cust, '', "'list': a listed customer (by email, any case) gets it" ),
	array( 'OLD', 'list', 'someone', $cust, '', "'list': an unlisted customer keeps the old area" ),
	array( 'NEW', 'all', '', $cust, '', "'all': every customer gets it" ),
	array( 'OLD', 'all', '', null, '', 'logged out: the login form stays as it is' ),
	array( 'OLD', 'all', '', $cust, '$GLOBALS["ep"]=true;', 'orders / password / addresses pages stay as they are' ),
	array( 'OLD', 'all', '', $cust, '$_COOKIE["fsa_old"]="1";', 'a customer who chose the previous area keeps it' ),
	array( 'OLD', 'all', '', $cust, '$_GET["fsa_old"]="1";', '?fsa_old=1 switches to the previous area' ),
	array( 'NEW', 'all', '', $cust, '$_COOKIE["fsa_old"]="1";$_GET["fsa_old"]="0";', '?fsa_old=0 switches back to the new one' ),
);
foreach ( $cases as $c ) { $got = $run( $c[1], $c[2], $c[3], $c[4] ); $t( $c[0] === $got, $c[5], $got ); }
echo $fail ? "\n$fail FAILED\n" : "\nALL PASSED\n"; exit( $fail ? 1 : 0 );
