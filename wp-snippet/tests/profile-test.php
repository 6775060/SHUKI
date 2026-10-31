<?php
/* Profile saving (personal details, invoice details, password) against fake WordPress users.
   Usage: php wp-snippet/tests/profile-test.php */
define( 'ABSPATH', '/' ); define( 'HOUR_IN_SECONDS', 3600 );
$GLOBALS['users'] = array(
	7 => (object) array( 'ID' => 7, 'user_login' => 'dana', 'user_email' => 'dana@mail.com', 'first_name' => 'דנה', 'last_name' => 'לוי', 'display_name' => 'דנה', 'roles' => array( 'customer', 'member-webstop' ), 'user_pass' => 'hash:Secret123' ),
	8 => (object) array( 'ID' => 8, 'user_login' => 'other', 'user_email' => 'taken@mail.com', 'roles' => array( 'customer' ), 'user_pass' => 'hash:x' ),
);
$GLOBALS["cur"] = 7; $GLOBALS['meta'] = array(); $GLOBALS['nonce_ok'] = true;
function add_action( ...$a ) {} function add_filter( ...$a ) {} function add_shortcode( ...$a ) {}
function current_user_can( $c ) { return false; } function is_user_logged_in() { return true; }
function wp_get_current_user() { return $GLOBALS['users'][ $GLOBALS["cur"] ]; } function get_current_user_id() { return $GLOBALS["cur"]; } function get_userdata( $id ) { return $GLOBALS['users'][ $id ] ?? false; }
function check_ajax_referer() { return $GLOBALS['nonce_ok']; } function sanitize_text_field( $s ) { return trim( strip_tags( (string) $s ) ); } function wp_unslash( $s ) { return $s; }
function sanitize_email( $s ) { return strtolower( trim( $s ) ); } function is_email( $s ) { return (bool) filter_var( $s, FILTER_VALIDATE_EMAIL ); }
function email_exists( $e ) { foreach ( $GLOBALS['users'] as $u ) if ( strtolower( $u->user_email ) === strtolower( $e ) ) return $u->ID; return false; }
function wp_check_password( $p, $h, $id ) { return 'hash:' . $p === $h; }
function wp_update_user( $a ) { $u = $GLOBALS['users'][ $a['ID'] ]; foreach ( $a as $k => $v ) { if ( 'user_pass' === $k ) $u->user_pass = 'hash:' . $v; elseif ( 'ID' !== $k ) $u->$k = $v; } return $a['ID']; }
function is_wp_error( $x ) { return false; }
function get_user_meta( $u, $k, $s = false ) { return $GLOBALS['meta'][ $u ][ $k ] ?? ''; } function update_user_meta( $u, $k, $v ) { $GLOBALS['meta'][ $u ][ $k ] = $v; }
class Done extends Exception { public $ok; public $data; function __construct( $ok, $d ) { $this->ok = $ok; $this->data = $d; } }
function wp_send_json_error( $d ) { throw new Done( false, $d ); } function wp_send_json_success( $d ) { throw new Done( true, $d ); }
eval( file_get_contents( __DIR__ . '/../fsa-v2-snippet.php' ) );
function fsa_v2_data_stub() {}
$fail = 0; $t = function ( $ok, $m ) use ( &$fail ) { echo ( $ok ? 'ok   ' : 'FAIL ' ) . $m . "\n"; if ( ! $ok ) $fail++; };
$call = function ( $post ) { $_POST = $post; try { fsa_v2_profile_ajax(); } catch ( Done $d ) { return $d; } catch ( Error $e ) { return (object) array( "ok" => "error", "data" => array( "message" => $e->getMessage() . " @" . $e->getLine() . " " . $e->getFile() ) ); } return null; };
$me = array( 'tab' => 'me', 'first' => 'דנה', 'last' => 'כהן', 'email' => 'Dana.New@Mail.com', 'phone' => '050-1234567', 'company' => 'סטודיו דנה' );
$r = $call( $me ); 
$u = $GLOBALS['users'][7];
$t( true === $r->ok && 'כהן' === $r->data['user']['last'] && 'סטודיו דנה' === $r->data['user']['company'], 'personal details save and come back to the page' );
$t( 'כהן' === $u->last_name && 'dana.new@mail.com' === $u->user_email, 'name and e-mail saved on the user' );
$t( 'dana.new@mail.com' === $GLOBALS['meta'][7]['billing_email'] && '050-1234567' === $GLOBALS['meta'][7]['billing_phone'] && 'סטודיו דנה' === $GLOBALS['meta'][7]['billing_company'], 'billing e-mail, phone and company match (as the checkout uses them)' );
$t( ! $call( array_merge( $me, array( 'email' => 'taken@mail.com' ) ) )->ok, 'an e-mail of another account is refused' );
$t( ! $call( array_merge( $me, array( 'email' => 'not-an-email' ) ) )->ok, 'invalid e-mail refused' );
$t( ! $call( array_merge( $me, array( 'first' => '' ) ) )->ok, 'empty first name refused' );
$t( ! $call( array_merge( $me, array( 'phone' => 'abc' ) ) )->ok, 'invalid phone refused' );
$r = $call( array( 'tab' => 'biz', 'company' => 'דנה בע"מ', 'vat' => '515123456' ) );
$t( 'דנה בע"מ' === $GLOBALS['meta'][7]['billing_company'] && '515123456' === $GLOBALS['meta'][7]['billing_id_or_company_number'], 'invoice name and ID number saved to the checkout fields' );
$t( ! $call( array( 'tab' => 'biz', 'company' => 'x', 'vat' => '12ab' ) )->ok, 'ID number with letters refused' );
$t( ! $call( array( 'tab' => 'pwd', 'current' => 'wrong', 'new' => 'NewPass123' ) )->ok, 'wrong current password refused' );
$t( ! $call( array( 'tab' => 'pwd', 'current' => 'Secret123', 'new' => 'short1' ) )->ok, 'short new password refused' );
$t( ! $call( array( 'tab' => 'pwd', 'current' => 'Secret123', 'new' => 'onlyletters' ) )->ok, 'new password without digits refused' );
$t( ! $call( array( 'tab' => 'pwd', 'current' => 'Secret123', 'new' => '12345678' ) )->ok, 'new password without letters refused' );
$r = $call( array( 'tab' => 'pwd', 'current' => 'Secret123', 'new' => 'NewPass123' ) );
$t( $r->ok && ! empty( $r->data['reload'] ) && 'hash:NewPass123' === $GLOBALS['users'][7]->user_pass, 'password changed' );
$t( ! $call( array( 'tab' => 'nope' ) )->ok, 'unknown tab refused' );
$GLOBALS['nonce_ok'] = false; $t( ! $call( $me )->ok, 'bad nonce refused' );
echo $fail ? "\n$fail FAILED\n" : "\nALL PASSED\n"; exit( $fail ? 1 : 0 );
