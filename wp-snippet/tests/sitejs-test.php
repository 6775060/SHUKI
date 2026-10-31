<?php
/* The site-wide script guards (fsa_v2_fix_site_js) on the three original scripts as the theme prints them.
   Writes two pages for the browser check: one without the elements (must not throw), one with them (must still work).
   Usage: php wp-snippet/tests/sitejs-test.php <out dir> */
define( 'ABSPATH', '/' ); define( 'HOUR_IN_SECONDS', 3600 );
function add_action( ...$a ) {} function add_filter( ...$a ) {} function add_shortcode( ...$a ) {}
eval( file_get_contents( __DIR__ . '/../fsa-v2-snippet.php' ) );
$d = __DIR__ . '/../site-fixes/';
$purchase = file_get_contents( $d . 'orig-1-purchase.js' ); $greet = file_get_contents( $d . 'orig-2-greeting.js' ); $fb = file_get_contents( $d . 'orig-3-feedback.js' );
$scripts = "<script>\n$purchase</script>\n<script>\n$greet</script>\n<script>\n$fb</script>";
$fail = 0; $t = function ( $ok, $m ) use ( &$fail ) { echo ( $ok ? 'ok   ' : 'FAIL ' ) . $m . "\n"; if ( ! $ok ) $fail++; };
$page = function ( $body ) use ( $scripts ) { return "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>$body\n$scripts</body></html>"; };
$bare = $page( '<p>plain page</p>' );
$fixed = fsa_v2_fix_site_js( $bare );
$t( 1 === substr_count( $fixed, 'FS guard: font pages only' ), 'purchase script wrapped once' );
$t( false !== strpos( $fixed, 'if (!spanElement) return;' ), 'greeting guarded' );
$t( false !== strpos( $fixed, '(document.querySelector(".r-feedback-btn")||document.createElement("i")).addEventListener(' ), 'feedback guarded' );
$t( fsa_v2_fix_site_js( $fixed ) === $fixed, 'running twice changes nothing more' );
$t( fsa_v2_fix_site_js( '<p>no scripts</p>' ) === '<p>no scripts</p>', 'pages without these scripts are untouched' );
$other = '<script>var a=1;</script>'; $t( fsa_v2_fix_site_js( $other ) === $other, 'other scripts are untouched' );
$full = $page( '<div id="go_to_account"><span class="elementor-button-text">שוקי</span></div><button class="r-feedback-btn">משוב</button><div class="r-feedback"></div>' );
$out = $argv[1] ?? sys_get_temp_dir();
file_put_contents( "$out/sitejs-bare.html", $fixed );
file_put_contents( "$out/sitejs-orig.html", $bare );
file_put_contents( "$out/sitejs-full.html", fsa_v2_fix_site_js( $full ) );
echo $fail ? "\n$fail FAILED\n" : "\nALL PASSED\n"; exit( $fail ? 1 : 0 );
