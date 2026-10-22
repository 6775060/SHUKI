/**
 * FS · אזור אישי v2 — תצוגה מקדימה (שלב 1)
 * Renders the new personal area on the private page /my-account-new/ (shortcode [fs_account_v2]).
 * Admins only; everyone else is sent to the existing /my-account/. Read-only: domains, certificates
 * and the add-on domain are NOT connected yet (stage 2). Deactivating this snippet removes everything.
 */
if ( ! defined( 'ABSPATH' ) ) exit;

define( 'FSA_V2_SLUG', 'my-account-new' );
// a plain customer account (not an admin) that may also open the preview, for testing. Delete the user to remove the access.
define( 'FSA_V2_TESTER', 'claude-test' );

// ── rollout of the new area at /my-account/ ──────────────────────────────
// 'admins' = admins + the test account only · 'list' = also the users below · 'subscribers' = everyone with an active subscription · 'all' = every logged-in customer
define( 'FSA_V2_LIVE_FOR', 'all' );
// for 'list': usernames or emails, separated by commas
define( 'FSA_V2_LIVE_USERS', '' );
// the ₪79 additional domain: ID of a hidden virtual WooCommerce product. 0 = not offered yet (the button says "next stage")
define( 'FSA_V2_ADDON_PRODUCT', 22751 );
// ─────────────────────────────────────────────────────────────────────────

function fsa_v2_is_tester() {
	return is_user_logged_in() && wp_get_current_user()->user_login === FSA_V2_TESTER;
}
function fsa_v2_live_for_user() {
	if ( ! is_user_logged_in() ) return false;
	if ( current_user_can( 'manage_options' ) || fsa_v2_is_tester() ) return true;
	if ( 'all' === FSA_V2_LIVE_FOR ) return true;
	if ( 'subscribers' === FSA_V2_LIVE_FOR ) { list( $plan ) = fsa_v2_plan_info( wp_get_current_user() ); return (bool) $plan; }
	if ( 'list' === FSA_V2_LIVE_FOR ) {
		$u = wp_get_current_user();
		$list = array_filter( array_map( 'trim', explode( ',', strtolower( FSA_V2_LIVE_USERS ) ) ) );
		return in_array( strtolower( $u->user_login ), $list, true ) || in_array( strtolower( $u->user_email ), $list, true );
	}
	return false;
}
function fsa_v2_can_view() {
	return current_user_can( 'manage_options' ) || fsa_v2_is_tester() || fsa_v2_live_for_user();
}
// "back to the previous area": ?fsa_old=1 keeps the old area for 30 days, ?fsa_old=0 returns to the new one
function fsa_v2_wants_old() {
	static $on = null; // decided once per request; the cookie is set before anything is printed
	if ( null !== $on ) return $on;
	if ( isset( $_GET['fsa_old'] ) ) {
		$on = '1' === $_GET['fsa_old'];
		if ( ! headers_sent() ) setcookie( 'fsa_old', $on ? '1' : '', $on ? time() + 30 * DAY_IN_SECONDS : time() - 3600, COOKIEPATH ? COOKIEPATH : '/', COOKIE_DOMAIN, is_ssl(), true );
		return $on;
	}
	return $on = ! empty( $_COOKIE['fsa_old'] );
}
// the account dashboard (/my-account/ itself, not orders, password etc.) shows the new area to whoever it is live for
function fsa_v2_takes_account_page() {
	if ( ! function_exists( 'is_account_page' ) || ! is_account_page() || is_wc_endpoint_url() ) return false;
	// only /my-account/ itself: sub-pages added by plugins (like the old /my-account/domains/) are not WooCommerce endpoints, so compare the path
	$path = function ( $u ) { return untrailingslashit( rawurldecode( (string) wp_parse_url( $u, PHP_URL_PATH ) ) ); };
	$here = $path( isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '' );
	if ( function_exists( 'wc_get_page_permalink' ) && $here !== $path( wc_get_page_permalink( 'myaccount' ) ) ) return false;
	return fsa_v2_live_for_user() && ! fsa_v2_wants_old();
}
add_action( 'template_redirect', function () {
	if ( ! fsa_v2_takes_account_page() ) return;
	$GLOBALS['fsa_v2_mode'] = 'live';
	get_header();
	echo '<main id="content" class="site-main">' . do_shortcode( '[fs_account_v2]' ) . '</main>';
	get_footer();
	exit;
}, 20 );
// the preview page is private, so WordPress shows the test account a 404; let that one account read this one page
add_filter( 'map_meta_cap', function ( $caps, $cap, $uid, $args ) {
	if ( 'read_post' !== $cap || empty( $args[0] ) ) return $caps;
	$u = get_userdata( $uid );
	if ( ! $u || $u->user_login !== FSA_V2_TESTER ) return $caps;
	$page = get_page_by_path( FSA_V2_SLUG );
	return ( $page && (int) $args[0] === (int) $page->ID ) ? array( 'read' ) : $caps;
}, 10, 4 );

// 1. access: admins only, not indexed
add_action( 'template_redirect', function () {
	if ( ! is_page( FSA_V2_SLUG ) ) return;
	if ( ! is_user_logged_in() ) { auth_redirect(); }
	if ( ! fsa_v2_can_view() ) {
		wp_safe_redirect( function_exists( 'wc_get_page_permalink' ) ? wc_get_page_permalink( 'myaccount' ) : home_url( '/' ) );
		exit;
	}
} );
add_filter( 'wp_robots', function ( $r ) {
	if ( is_page( FSA_V2_SLUG ) ) { $r['noindex'] = true; $r['nofollow'] = true; }
	return $r;
} );
add_filter( 'body_class', function ( $c ) {
	if ( is_page( FSA_V2_SLUG ) || fsa_v2_takes_account_page() ) $c[] = 'fsa-v2';
	return $c;
} );

// 2a. subscription plan from the user's roles (same rules as snippet #7): [plan, desktop_only]
function fsa_v2_plan_info( $u ) {
	$roles = (array) $u->roles;
	$plan = null;
	if ( in_array( 'member-extra', $roles, true ) )         $plan = 'extra';
	elseif ( in_array( 'member-webstop', $roles, true ) )   $plan = 'web';
	elseif ( in_array( 'member-academic', $roles, true ) )  $plan = 'acad';
	elseif ( in_array( 'member-desktop', $roles, true ) )   $plan = 'desk';
	elseif ( in_array( 'member-barter', $roles, true ) )    $plan = 'barter'; // given by arrangement, same as Webstop, not for sale
	$desktop_only = in_array( 'member-desktop', $roles, true ) && ! in_array( 'member-webstop', $roles, true ) && ! in_array( 'member-extra', $roles, true ) && ! in_array( 'member-barter', $roles, true );
	return array( $plan, $desktop_only );
}

// 2b. weights of a subscription font, from its store product (variations: pa_weight × pa_license, one file each).
// Cached per product; the links carry the user's nonce and go through fsa_v2_weight_download().
function fsa_v2_weights( $name, $allow_web ) {
	if ( ! function_exists( 'wc_get_product' ) ) return array();
	$ids = get_posts( array( 'post_type' => 'product', 'post_status' => 'publish', 'title' => $name, 'posts_per_page' => 1, 'fields' => 'ids' ) );
	if ( ! $ids ) return array();
	$pid  = (int) $ids[0];
	$key  = 'fsa_v2_w_' . $pid . '_' . get_post_modified_time( 'U', true, $pid );
	$rows = get_transient( $key );
	if ( false === $rows ) {
		$rows = array();
		$p = wc_get_product( $pid );
		if ( $p && $p->is_type( 'variable' ) ) {
			foreach ( $p->get_children() as $vid ) {
				$v = wc_get_product( $vid );
				if ( ! $v ) continue;
				$att = $v->get_attributes();
				$w = isset( $att['pa_weight'] ) ? (string) $att['pa_weight'] : '';
				$l = isset( $att['pa_license'] ) ? (string) $att['pa_license'] : '';
				$dls = $v->get_downloads();
				if ( '' === $w || 'family' === $w || ! $dls ) continue;
				$term = get_term_by( 'slug', $w, 'pa_weight' );
				if ( ! isset( $rows[ $w ] ) ) $rows[ $w ] = array( 'n' => $term ? $term->name : $w );
				$rows[ $w ][ false !== stripos( $l, 'desk' ) ? 'desk' : 'web' ] = array( (int) $vid, (string) array_key_first( $dls ) );
			}
			uksort( $rows, function ( $a, $b ) { return (int) $a - (int) $b; } );
		}
		set_transient( $key, $rows, 12 * HOUR_IN_SECONDS );
	}
	$nonce = wp_create_nonce( 'fsa_wdl' );
	$url = function ( $x ) use ( $nonce ) { return add_query_arg( array( 'fsa_wdl' => $x[0], 'k' => rawurlencode( $x[1] ), '_wpnonce' => $nonce ), home_url( '/' . FSA_V2_SLUG . '/' ) ); };
	$out = array();
	foreach ( $rows as $r ) {
		$out[] = array( 'n' => $r['n'], 'web' => ( $allow_web && isset( $r['web'] ) ) ? $url( $r['web'] ) : '', 'desk' => isset( $r['desk'] ) ? $url( $r['desk'] ) : '' );
	}
	return $out;
}

// 2c. per-weight download: only for viewers of the preview, only fonts in the subscription list, only formats the plan includes
add_action( 'template_redirect', 'fsa_v2_weight_download', 5 );
function fsa_v2_weight_download() {
	if ( empty( $_GET['fsa_wdl'] ) ) return;
	if ( ! is_user_logged_in() ) auth_redirect();
	if ( ! fsa_v2_can_view() || ! wp_verify_nonce( isset( $_GET['_wpnonce'] ) ? sanitize_text_field( wp_unslash( $_GET['_wpnonce'] ) ) : '', 'fsa_wdl' ) ) {
		wp_die( 'הקישור פג תוקף. רעננו את העמוד ונסו שוב.', '', array( 'response' => 403 ) );
	}
	list( $plan, $desktop_only ) = fsa_v2_plan_info( wp_get_current_user() );
	$v = wc_get_product( (int) $_GET['fsa_wdl'] );
	$k = isset( $_GET['k'] ) ? rawurldecode( sanitize_text_field( wp_unslash( $_GET['k'] ) ) ) : '';
	if ( ! $plan || ! $v || ! $v->is_type( 'variation' ) || ! function_exists( 'get_field' ) ) wp_die( 'אין גישה לקובץ הזה.', '', array( 'response' => 403 ) );
	$names = array();
	foreach ( (array) get_field( 'fonts-repeater', 'option' ) as $row ) {
		if ( ! empty( $row['font-name'] ) ) $names[] = wp_strip_all_tags( $row['font-name'] );
	}
	$parent = get_post( $v->get_parent_id() );
	$lic = (string) $v->get_attribute( 'pa_license' ) . ' ' . (string) ( $v->get_attributes()['pa_license'] ?? '' );
	$is_desk = false !== stripos( $lic, 'desk' ) || false !== strpos( $lic, 'דסקטופ' );
	$dls = $v->get_downloads();
	if ( ! $parent || ! in_array( $parent->post_title, $names, true ) || ( ! $is_desk && $desktop_only ) || ! isset( $dls[ $k ] ) ) {
		wp_die( 'אין גישה לקובץ הזה.', '', array( 'response' => 403 ) );
	}
	WC_Download_Handler::download( $dls[ $k ]->get_file(), $v->get_id() );
	exit;
}

// 2e. domains: the same table the Easy Font Table plugin uses (wp_easy_font_domains: user, year, month, slot 1..n, name, url, fonts).
// Reading and writing it here keeps every domain customers already registered, with no migration.
function fsa_v2_eft_table() {
	global $wpdb;
	$t = $wpdb->prefix . 'easy_font_domains';
	return $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $t ) ) === $t ? $t : '';
}
function fsa_v2_domain_limit( $plan ) {
	return 'extra' === $plan ? 0 : ( in_array( $plan, array( 'web', 'barter' ), true ) ? 3 : -1 ); // 0 = unlimited, -1 = no domains in this plan
}
function fsa_v2_domains( $uid ) {
	global $wpdb;
	$t = fsa_v2_eft_table();
	if ( ! $t ) return array();
	$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM `$t` WHERE user_id = %d AND domain_url <> '' ORDER BY year DESC, month DESC, domain_slot ASC", $uid ) );
	$out = array();
	foreach ( $rows as $r ) {
		$c = $r->created_at ? strtotime( $r->created_at ) : 0;
		$d = ( $c && (int) date( 'Y', $c ) === (int) $r->year && (int) date( 'n', $c ) === (int) $r->month ) ? date( 'd.m.Y', $c ) : sprintf( '01.%02d.%d', $r->month, $r->year );
		$out[] = array( $d, (string) $r->domain_name, (string) $r->domain_url, (string) $r->font_name, (int) $r->id );
	}
	return $out;
}
function fsa_v2_domain_fonts() {
	$raw = function_exists( 'get_field' ) ? get_field( 'list_of_fonts_for_domain_registration', 'option' ) : '';
	if ( is_array( $raw ) ) $raw = implode( ',', array_filter( $raw, 'is_scalar' ) ); // the field is plain text today; tolerate a list too
	$raw = (string) $raw;
	return array_values( array_filter( array_map( 'trim', explode( ',', $raw ) ) ) );
}
function fsa_v2_clean_host( $v ) {
	$v = strtolower( trim( (string) $v ) );
	$v = preg_replace( '#^https?://#', '', $v );
	$v = preg_replace( '#^www\.#', '', $v );
	$v = preg_split( '#[/?\#]#', $v )[0];
	return preg_match( '/^[a-z0-9\x{0590}-\x{05FF}-]+(\.[a-z0-9\x{0590}-\x{05FF}-]+)+$/u', $v ) ? $v : '';
}
// register / edit / remove a subscription domain (preview viewers only while the area is being tested)
add_action( 'wp_ajax_fsa_v2_dom', 'fsa_v2_dom_ajax' );
function fsa_v2_dom_ajax() {
	global $wpdb;
	$err = function ( $m ) { wp_send_json_error( array( 'message' => $m ) ); };
	if ( ! fsa_v2_can_view() || ! check_ajax_referer( 'fsa_v2_dom', 'nonce', false ) ) $err( 'פג תוקף העמוד. רעננו ונסו שוב.' );
	$t = fsa_v2_eft_table();
	if ( ! $t ) $err( 'רישום הדומיינים לא זמין כרגע.' );
	$uid = get_current_user_id();
	list( $plan ) = fsa_v2_plan_info( wp_get_current_user() );
	$limit = fsa_v2_domain_limit( $plan );
	if ( $limit < 0 ) $err( 'המינוי שלך לא כולל רישום דומיינים.' );
	if ( $limit ) $limit += fsa_v2_bonus_sub( $uid, (int) current_time( 'Y' ), (int) current_time( 'n' ) ) + fsa_v2_deal_extra( $uid );
	$op = isset( $_POST['op'] ) ? sanitize_key( $_POST['op'] ) : '';
	$y = (int) current_time( 'Y' ); $m = (int) current_time( 'n' );
	$id = isset( $_POST['id'] ) ? (int) $_POST['id'] : 0;
	$host = fsa_v2_clean_host( isset( $_POST['host'] ) ? wp_unslash( $_POST['host'] ) : '' );
	$name = sanitize_text_field( isset( $_POST['name'] ) ? wp_unslash( $_POST['name'] ) : '' );
	$allowed = fsa_v2_domain_fonts();
	$fonts = array_values( array_filter( array_map( 'trim', explode( ',', sanitize_text_field( isset( $_POST['fonts'] ) ? wp_unslash( $_POST['fonts'] ) : '' ) ) ) ) );
	if ( 'del' !== $op ) {
		if ( ! $host ) $err( 'צריך להזין כתובת אתר תקינה, למשל studio.co.il' );
		if ( ! $fonts ) $err( 'צריך לבחור לפחות פונט אחד' );
		if ( count( $fonts ) > 2 ) $err( 'אפשר לבחור עד 2 פונטים לכל אתר' );
		if ( $allowed && array_diff( $fonts, $allowed ) ) $err( 'אחד הפונטים לא זמין לרישום' );
		if ( '' === $name ) $name = $host;
	}
	$mine = $id ? $wpdb->get_row( $wpdb->prepare( "SELECT * FROM `$t` WHERE id = %d AND user_id = %d", $id, $uid ) ) : null;
	if ( 'edit' === $op || 'del' === $op ) {
		if ( ! $mine ) $err( 'הדומיין לא נמצא.' );
		if ( (int) $mine->year !== $y || (int) $mine->month !== $m ) $err( 'דומיין מחודש קודם סגור לעריכה.' );
	}
	$dup = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM `$t` WHERE user_id = %d AND year = %d AND month = %d AND domain_url = %s AND id <> %d", $uid, $y, $m, $host, $id ) );
	if ( 'del' !== $op && $dup ) $err( 'הדומיין הזה כבר רשום החודש.' );
	if ( 'add' === $op ) {
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT domain_slot, domain_url FROM `$t` WHERE user_id = %d AND year = %d AND month = %d", $uid, $y, $m ) );
		$used = 0; $free = 0; $max = 0;
		foreach ( $rows as $r ) { $max = max( $max, (int) $r->domain_slot ); if ( '' !== $r->domain_url ) $used++; elseif ( ! $free ) $free = (int) $r->domain_slot; }
		if ( $limit && $used >= $limit ) $err( 'ניצלת את הדומיינים של החודש.' );
		if ( ! $free ) { for ( $k = 1; $k <= max( $max, 0 ) + 1; $k++ ) { if ( ! in_array( $k, array_map( 'intval', wp_list_pluck( $rows, 'domain_slot' ) ), true ) ) { $free = $k; break; } } }
		$exists = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM `$t` WHERE user_id = %d AND year = %d AND month = %d AND domain_slot = %d", $uid, $y, $m, $free ) );
		$data = array( 'domain_name' => $name, 'domain_url' => $host, 'font_name' => implode( ', ', $fonts ) );
		$ok = $exists ? $wpdb->update( $t, $data, array( 'id' => $exists ) ) : $wpdb->insert( $t, $data + array( 'user_id' => $uid, 'year' => $y, 'month' => $m, 'domain_slot' => $free ) );
	} elseif ( 'edit' === $op ) {
		$ok = $wpdb->update( $t, array( 'domain_name' => $name, 'domain_url' => $host, 'font_name' => implode( ', ', $fonts ) ), array( 'id' => $id ) );
	} elseif ( 'del' === $op ) {
		$ok = $wpdb->delete( $t, array( 'id' => $id, 'user_id' => $uid ) );
	} else {
		$err( 'פעולה לא מוכרת.' );
	}
	if ( false === $ok ) $err( 'השמירה נכשלה. נסו שוב.' );
	wp_send_json_success( array( 'domains' => fsa_v2_domains( $uid ) ) );
}

// 2f. extra allowances bought with the ₪79 add-on (user meta): this month's subscription slots, and extra sites per licence
function fsa_v2_bonus_sub( $uid, $y, $m ) { return (int) get_user_meta( $uid, "fsa_v2_bonus_{$y}_{$m}", true ); }
// a special arrangement set by the owner on the user's admin page: extra domains every month, optionally until a date (inclusive)
function fsa_v2_deal_extra( $uid ) {
	$n = (int) get_user_meta( $uid, 'fsa_v2_deal_extra', true );
	$until = (string) get_user_meta( $uid, 'fsa_v2_deal_until', true );
	if ( $n <= 0 || ( $until && $until < current_time( 'Y-m-d' ) ) ) return 0;
	return $n;
}
function fsa_v2_lic_bonus( $uid ) { $b = get_user_meta( $uid, 'fsa_v2_lic_bonus', true ); return is_array( $b ) ? $b : array(); }
function fsa_v2_lic_sites_all( $uid ) { $s = get_user_meta( $uid, 'fsa_v2_lic_sites', true ); return is_array( $s ) ? $s : array(); }
function fsa_v2_addon_product() {
	return ( FSA_V2_ADDON_PRODUCT && function_exists( 'wc_get_product' ) ) ? wc_get_product( FSA_V2_ADDON_PRODUCT ) : null;
}
// a purchased webfont licence of this user (key = the downloaded product/variation id): its checkout domains, or null if it isn't theirs / isn't a webfont licence
function fsa_v2_user_web_lic( $uid, $key ) {
	if ( ! function_exists( 'wc_get_customer_available_downloads' ) ) return null;
	foreach ( wc_get_customer_available_downloads( $uid ) as $dl ) {
		if ( (string) (int) $dl['product_id'] !== (string) $key ) continue;
		$prod  = wc_get_product( (int) $key );
		$t     = $prod ? (string) $prod->get_attribute( 'pa_license' ) : '';
		$order = wc_get_order( $dl['order_id'] );
		$od    = $order ? (string) $order->get_meta( '_fs_domain' ) : '';
		// the licence type decides; the order's checkout domain counts only when the type is unknown (the domain belongs to the whole order)
		$web = '' !== $t ? ( false !== strpos( $t, 'וובפונט' ) || false !== stripos( $t, 'web' ) ) : '' !== $od;
		if ( ! $web ) return null;
		return array( 'order_domains' => $od ? array( $od ) : array() );
	}
	return null;
}
function fsa_v2_lic_limit( $uid, $key ) { $b = fsa_v2_lic_bonus( $uid ); return 3 + (int) ( $b[ (string) $key ] ?? 0 ); }

// register / edit / remove a site on a purchased webfont licence (sites are kept in user meta; the checkout domain stays fixed)
add_action( 'wp_ajax_fsa_v2_lic', 'fsa_v2_lic_ajax' );
function fsa_v2_lic_ajax() {
	$err = function ( $m ) { wp_send_json_error( array( 'message' => $m ) ); };
	if ( ! fsa_v2_can_view() || ! check_ajax_referer( 'fsa_v2_dom', 'nonce', false ) ) $err( 'פג תוקף העמוד. רעננו ונסו שוב.' );
	$uid = get_current_user_id();
	$key = isset( $_POST['key'] ) ? (string) (int) $_POST['key'] : '';
	$lic = $key ? fsa_v2_user_web_lic( $uid, $key ) : null;
	if ( ! $lic ) $err( 'הרישיון הזה לא כולל רישום אתרים.' );
	$op   = isset( $_POST['op'] ) ? sanitize_key( $_POST['op'] ) : '';
	$id   = isset( $_POST['id'] ) ? sanitize_key( $_POST['id'] ) : '';
	$host = fsa_v2_clean_host( isset( $_POST['host'] ) ? wp_unslash( $_POST['host'] ) : '' );
	$name = sanitize_text_field( isset( $_POST['name'] ) ? wp_unslash( $_POST['name'] ) : '' );
	$all  = fsa_v2_lic_sites_all( $uid );
	$list = isset( $all[ $key ] ) && is_array( $all[ $key ] ) ? $all[ $key ] : array();
	$idx  = null;
	foreach ( $list as $k => $r ) { if ( $r['id'] === $id ) $idx = $k; }
	if ( 'del' !== $op ) {
		if ( ! $host ) $err( 'צריך להזין כתובת אתר תקינה, למשל studio.co.il' );
		$taken = array_merge( $lic['order_domains'], wp_list_pluck( array_filter( $list, function ( $r ) use ( $id ) { return $r['id'] !== $id; } ), 'host' ) );
		if ( in_array( $host, $taken, true ) ) $err( 'האתר הזה כבר רשום ברישיון.' );
		if ( '' === $name ) $name = $host;
	}
	if ( 'add' === $op ) {
		if ( count( $lic['order_domains'] ) + count( $list ) >= fsa_v2_lic_limit( $uid, $key ) ) $err( 'כל האתרים של הרישיון רשומים.' );
		$list[] = array( 'id' => strtolower( wp_generate_password( 8, false ) ), 'd' => current_time( 'd.m.Y' ), 'name' => $name, 'host' => $host );
	} elseif ( 'edit' === $op || 'del' === $op ) {
		if ( null === $idx ) $err( 'האתר לא נמצא.' );
		if ( 'del' === $op ) { array_splice( $list, $idx, 1 ); } else { $list[ $idx ]['host'] = $host; $list[ $idx ]['name'] = $name; }
	} else {
		$err( 'פעולה לא מוכרת.' );
	}
	$all[ $key ] = array_values( $list );
	update_user_meta( $uid, 'fsa_v2_lic_sites', $all );
	wp_send_json_success( array( 'sites' => fsa_v2_lic_site_rows( $uid, $key, $lic['order_domains'] ), 'n' => fsa_v2_lic_limit( $uid, $key ) ) );
}
// rows for the area: checkout domains first (fixed, no id), then the ones registered here
function fsa_v2_lic_site_rows( $uid, $key, $order_domains, $order_date = '' ) {
	$rows = array();
	foreach ( $order_domains as $d ) $rows[] = array( $order_date, '', $d, '' );
	$all = fsa_v2_lic_sites_all( $uid );
	foreach ( (array) ( $all[ (string) $key ] ?? array() ) as $r ) $rows[] = array( $r['d'], $r['name'], $r['host'], $r['id'] );
	return $rows;
}

// ₪79 add-on: a pending order for the hidden product; the allowance is granted only after payment (and taken back on refund / cancel)
add_action( 'wp_ajax_fsa_v2_addon', 'fsa_v2_addon_ajax' );
function fsa_v2_addon_ajax() {
	$err = function ( $m ) { wp_send_json_error( array( 'message' => $m ) ); };
	if ( ! fsa_v2_can_view() || ! check_ajax_referer( 'fsa_v2_dom', 'nonce', false ) ) $err( 'פג תוקף העמוד. רעננו ונסו שוב.' );
	$product = fsa_v2_addon_product();
	if ( ! $product || ! function_exists( 'wc_create_order' ) ) $err( 'הרכישה לא זמינה כרגע.' );
	$uid  = get_current_user_id();
	$kind = isset( $_POST['kind'] ) && 'lic' === $_POST['kind'] ? 'lic' : 'sub';
	$key  = isset( $_POST['key'] ) ? (string) (int) $_POST['key'] : '';
	if ( 'sub' === $kind ) {
		list( $plan ) = fsa_v2_plan_info( wp_get_current_user() );
		if ( 'web' !== $plan ) $err( 'הרחבת מכסה זמינה למינוי וובסטופ.' );
	} elseif ( ! fsa_v2_user_web_lic( $uid, $key ) ) {
		$err( 'הרישיון הזה לא כולל רישום אתרים.' );
	}
	$order = wc_create_order( array( 'customer_id' => $uid ) );
	$item  = $order->add_product( $product, 1 );
	wc_add_order_item_meta( $item, '_fsa_v2_kind', $kind );
	if ( 'lic' === $kind ) wc_add_order_item_meta( $item, '_fsa_v2_key', $key );
	$u = wp_get_current_user();
	$order->set_billing_email( $u->user_email );
	$order->set_billing_first_name( (string) $u->first_name );
	$order->set_billing_last_name( (string) $u->last_name );
	$order->update_meta_data( '_fsa_v2_addon', 1 );
	$order->calculate_totals();
	$order->save();
	wp_send_json_success( array( 'url' => $order->get_checkout_payment_url() ) );
}
function fsa_v2_addon_lines( $order ) {
	$out = array();
	foreach ( $order->get_items() as $it ) {
		$kind = $it->get_meta( '_fsa_v2_kind' );
		if ( $kind ) $out[] = array( 'kind' => $kind, 'key' => (string) $it->get_meta( '_fsa_v2_key' ), 'qty' => max( 1, (int) $it->get_quantity() ) );
	}
	return $out;
}
foreach ( array( 'woocommerce_payment_complete', 'woocommerce_order_status_processing', 'woocommerce_order_status_completed' ) as $fsa_h ) {
	add_action( $fsa_h, 'fsa_v2_addon_grant' );
}
function fsa_v2_addon_grant( $order_id ) {
	$order = function_exists( 'wc_get_order' ) ? wc_get_order( $order_id ) : null;
	if ( ! $order || ! $order->get_meta( '_fsa_v2_addon' ) || $order->get_meta( '_fsa_v2_granted' ) || ! $order->is_paid() ) return;
	$uid  = (int) $order->get_customer_id();
	$paid = $order->get_date_paid();
	$ym   = $paid ? array( (int) $paid->date( 'Y' ), (int) $paid->date( 'n' ) ) : array( (int) current_time( 'Y' ), (int) current_time( 'n' ) );
	foreach ( fsa_v2_addon_lines( $order ) as $l ) {
		if ( 'sub' === $l['kind'] ) {
			update_user_meta( $uid, "fsa_v2_bonus_{$ym[0]}_{$ym[1]}", fsa_v2_bonus_sub( $uid, $ym[0], $ym[1] ) + $l['qty'] );
		} else {
			$b = fsa_v2_lic_bonus( $uid ); $b[ $l['key'] ] = (int) ( $b[ $l['key'] ] ?? 0 ) + $l['qty']; update_user_meta( $uid, 'fsa_v2_lic_bonus', $b );
		}
	}
	$order->update_meta_data( '_fsa_v2_granted', $ym[0] . '-' . $ym[1] );
	$order->save();
	$order->add_order_note( 'FS: הרחבת דומיינים הוענקה' );
}
foreach ( array( 'woocommerce_order_status_refunded', 'woocommerce_order_status_cancelled' ) as $fsa_h ) {
	add_action( $fsa_h, 'fsa_v2_addon_revoke' );
}
function fsa_v2_addon_revoke( $order_id ) {
	$order = function_exists( 'wc_get_order' ) ? wc_get_order( $order_id ) : null;
	if ( ! $order || ! $order->get_meta( '_fsa_v2_granted' ) || $order->get_meta( '_fsa_v2_revoked' ) ) return;
	$uid = (int) $order->get_customer_id();
	list( $y, $m ) = array_map( 'intval', explode( '-', $order->get_meta( '_fsa_v2_granted' ) ) );
	foreach ( fsa_v2_addon_lines( $order ) as $l ) {
		if ( 'sub' === $l['kind'] ) {
			update_user_meta( $uid, "fsa_v2_bonus_{$y}_{$m}", max( 0, fsa_v2_bonus_sub( $uid, $y, $m ) - $l['qty'] ) );
		} else {
			$b = fsa_v2_lic_bonus( $uid ); $b[ $l['key'] ] = max( 0, (int) ( $b[ $l['key'] ] ?? 0 ) - $l['qty'] ); update_user_meta( $uid, 'fsa_v2_lic_bonus', $b );
		}
	}
	$order->update_meta_data( '_fsa_v2_revoked', 1 );
	$order->save();
	$order->add_order_note( 'FS: הרחבת דומיינים בוטלה (אתרים שכבר נרשמו נשארים)' );
}
// after paying for an add-on, straight back to the registration form instead of the "order received" page
add_filter( 'woocommerce_get_return_url', function ( $url, $order ) {
	if ( ! $order instanceof WC_Order || ! $order->get_meta( '_fsa_v2_addon' ) ) return $url;
	$l = fsa_v2_addon_lines( $order )[0] ?? null;
	if ( ! $l ) return $url;
	$args = array( 'fs_addon' => 'paid', 'kind' => $l['kind'] );
	if ( 'lic' === $l['kind'] ) $args['licence'] = $l['key'];
	return add_query_arg( $args, wc_get_page_permalink( 'myaccount' ) );
}, 20, 2 );

// 2. data (everything the area shows, read from what already exists on the site)
function fsa_v2_he_date( $ts ) {
	$m = array( 'ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר' );
	return (int) date( 'j', $ts ) . ' ב' . $m[ (int) date( 'n', $ts ) - 1 ] . ' ' . date( 'Y', $ts );
}

function fsa_v2_data() {
	$u   = wp_get_current_user();
	$uid = $u->ID;
	$roles = (array) $u->roles;

	$plan = null;
	if ( in_array( 'member-extra', $roles, true ) )         $plan = 'extra';
	elseif ( in_array( 'member-webstop', $roles, true ) )   $plan = 'web';
	elseif ( in_array( 'member-academic', $roles, true ) )  $plan = 'acad';
	elseif ( in_array( 'member-desktop', $roles, true ) )   $plan = 'desk';
	elseif ( in_array( 'member-barter', $roles, true ) )    $plan = 'barter'; // given by arrangement, same as Webstop, not for sale

	$start = '';
	$raw = get_user_meta( $uid, 'membership-date', true ); // d/m/Y (snippet #8)
	if ( $raw ) {
		$d = DateTime::createFromFormat( 'd/m/Y', $raw );
		$start = $d ? fsa_v2_he_date( $d->getTimestamp() ) : $raw;
	}

	// subscription fonts (ACF option repeater, same rules as snippet #7)
	$fonts = array();
	if ( $plan && function_exists( 'get_field' ) ) {
		$desktop_only = in_array( 'member-desktop', $roles, true ) && ! in_array( 'member-webstop', $roles, true ) && ! in_array( 'member-extra', $roles, true ) && ! in_array( 'member-barter', $roles, true );
		foreach ( (array) get_field( 'fonts-repeater', 'option' ) as $row ) {
			if ( empty( $row['font-name'] ) ) continue;
			$fonts[] = array(
				'name' => wp_strip_all_tags( $row['font-name'] ),
				'web'  => ( ! $desktop_only && ! empty( $row['font-file-web']['url'] ) ) ? $row['font-file-web']['url'] : '',
				'desk' => ! empty( $row['font-file']['url'] ) ? $row['font-file']['url'] : '',
				'weights' => fsa_v2_weights( wp_strip_all_tags( $row['font-name'] ), ! $desktop_only ),
			);
		}
	}

	// purchased fonts = WooCommerce downloads, one row per product
	$lic = array();
	if ( function_exists( 'wc_get_customer_available_downloads' ) ) {
		$by = array();
		foreach ( wc_get_customer_available_downloads( $uid ) as $dl ) {
			$pid = (int) $dl['product_id'];
			if ( isset( $by[ $pid ] ) ) continue;
			$types = array(); $sites = array();
			$order = wc_get_order( $dl['order_id'] );
			// the store sells variations (font × weight × licence): read name, weight and licence from the variation itself
			$prod = wc_get_product( $pid );
			$fname = wp_strip_all_tags( $dl['product_name'] ); $weight = '';
			if ( $prod && $prod->is_type( 'variation' ) ) {
				$parent = get_post( $prod->get_parent_id() );
				if ( $parent ) $fname = wp_strip_all_tags( $parent->post_title );
				$weight = (string) $prod->get_attribute( 'pa_weight' );
				if ( $prod->get_attribute( 'pa_license' ) ) $types[] = (string) $prod->get_attribute( 'pa_license' );
			}
			if ( $order ) {
				if ( ! $types ) {
					foreach ( $order->get_items() as $item ) {
						if ( (int) $item->get_product_id() !== $pid && (int) $item->get_variation_id() !== $pid ) continue;
						$var = $item->get_variation_id() ? wc_get_product( $item->get_variation_id() ) : null;
						$t = $var ? $var->get_attribute( 'pa_license' ) : '';
						if ( $t ) $types[] = $t;
					}
				}
				$domain = $order->get_meta( '_fs_domain' );
				if ( $domain ) {
					$dt = $order->get_date_created();
					$sites[] = array( $dt ? $dt->date( 'd.m.Y' ) : '', '', $domain, '' ); // from checkout: fixed
				}
			}
			$t = $types ? implode( ' + ', array_unique( $types ) ) : 'רישיון';
			// the licence type decides; the order's checkout domain counts only when the type is unknown
			$web = ( stripos( $t, 'webstop' ) !== false || stripos( $t, 'web' ) !== false || strpos( $t, 'וובפונט' ) !== false || ( ! $types && $sites ) ) ? 1 : 0;
			if ( ! $web ) $sites = array();
			$by[ $pid ] = array(
				'f' => $fname, 'w' => $weight, 't' => $t,
				'sub' => 'buy', 'n' => fsa_v2_lic_limit( $uid, $pid ), 'web' => $web, 'key' => (string) $pid,
				'sites' => array_merge( $sites, array_slice( fsa_v2_lic_site_rows( $uid, $pid, array() ), 0 ) ), 'dl' => $dl['download_url'],
				'file' => wp_strip_all_tags( (string) $dl['download_name'] ),
				'oid' => $order ? $order->get_order_number() : '', 'd' => ( $order && $order->get_date_created() ) ? $order->get_date_created()->date( 'd.m.y' ) : '',
			);
		}
		$lic = array_values( $by );
	}

	// orders + Grow / Meshulam invoices
	$orders = array();
	$st = array( 'completed' => 'הושלם', 'processing' => 'בטיפול', 'on-hold' => 'ממתין לתשלום', 'pending' => 'ממתין לתשלום', 'cancelled' => 'בוטל', 'refunded' => 'בוטל', 'failed' => 'בוטל' );
	if ( function_exists( 'wc_get_orders' ) ) {
		foreach ( wc_get_orders( array( 'customer_id' => $uid, 'limit' => 60, 'orderby' => 'date', 'order' => 'DESC' ) ) as $o ) {
			if ( ! $o instanceof WC_Order ) continue;
			$items = array();
			foreach ( $o->get_items() as $it ) $items[] = array( wp_strip_all_tags( $it->get_name() ), round( (float) $it->get_total() + (float) $it->get_total_tax(), 2 ) );
			if ( ! $items ) $items[] = array( 'הזמנה', (float) $o->get_total() );
			$dt  = $o->get_date_created();
			$inv = $o->get_meta( '_grow_invoice_url' ) ?: $o->get_meta( 'meshulam_invoice_url' );
			$orders[] = array(
				'id' => $o->get_order_number(), 'd' => $dt ? $dt->date( 'd.m.Y' ) : '', 'items' => $items,
				'st' => isset( $st[ $o->get_status() ] ) ? $st[ $o->get_status() ] : $o->get_status(),
				'total' => (float) $o->get_total(), 'view' => $o->get_view_order_url(),
				'pay' => $o->needs_payment() ? $o->get_checkout_payment_url() : '',
				'inv' => $inv ? $inv : '', 'invNum' => (string) $o->get_meta( '_grow_invoice_number' ),
			);
		}
	}

	$addr = trim( implode( ', ', array_filter( array( get_user_meta( $uid, 'billing_address_1', true ), get_user_meta( $uid, 'billing_city', true ) ) ) ) );
	$shop = function_exists( 'wc_get_page_permalink' ) ? wc_get_page_permalink( 'shop' ) : home_url( '/' );
	return array(
		'domains' => fsa_v2_domains( $uid ), 'domainFonts' => fsa_v2_domain_fonts(),
		'bonus' => fsa_v2_bonus_sub( $uid, (int) current_time( 'Y' ), (int) current_time( 'n' ) ), 'extra' => fsa_v2_deal_extra( $uid ), 'addon' => (bool) fsa_v2_addon_product(),
		'domAjax' => admin_url( 'admin-ajax.php' ), 'domNonce' => wp_create_nonce( 'fsa_v2_dom' ),
		'mode' => isset( $GLOBALS['fsa_v2_mode'] ) ? $GLOBALS['fsa_v2_mode'] : 'preview', 'oldUrl' => add_query_arg( 'fsa_old', '1', function_exists( 'wc_get_page_permalink' ) ? wc_get_page_permalink( 'myaccount' ) : home_url( '/my-account/' ) ),
		'plan' => $plan, 'planStart' => $start, 'nextPay' => '', 'card' => '',
		'fonts' => $fonts, 'lic' => $lic, 'orders' => $orders,
		'user' => array(
			'id' => $uid, 'first' => $u->first_name ? $u->first_name : $u->display_name, 'last' => $u->last_name, 'email' => $u->user_email,
			'company' => get_user_meta( $uid, 'billing_company', true ), 'phone' => get_user_meta( $uid, 'billing_phone', true ),
			'vat' => '', 'address' => $addr,
		),
		'links' => array(
			'logout' => function_exists( 'wc_logout_url' ) ? wc_logout_url( home_url() ) : wp_logout_url( home_url() ),
			'web' => get_permalink( 12652 ), 'extra' => get_permalink( 14162 ), 'desk' => $shop,
		),
	);
}

// 2g. "פונטשוק · הסדר מיוחד" on the user's admin page (admins only): extra subscription domains every month
add_action( 'show_user_profile', 'fsa_v2_deal_fields' );
add_action( 'edit_user_profile', 'fsa_v2_deal_fields' );
function fsa_v2_deal_fields( $u ) {
	if ( ! current_user_can( 'manage_options' ) ) return;
	$n = (int) get_user_meta( $u->ID, 'fsa_v2_deal_extra', true );
	$until = (string) get_user_meta( $u->ID, 'fsa_v2_deal_until', true );
	$note = (string) get_user_meta( $u->ID, 'fsa_v2_deal_note', true );
	list( $plan ) = fsa_v2_plan_info( $u );
	$base = fsa_v2_domain_limit( $plan );
	$on = fsa_v2_deal_extra( $u->ID );
	if ( $base > 0 ) {
		$sum = $base . ' מהמינוי' . ( $on ? ' + ' . $on . ' הסדר' : '' ) . ' = ' . ( $base + $on ) . ' דומיינים בחודש';
		if ( $n > 0 && ! $on ) $sum .= ' (ההסדר הסתיים)';
	} else {
		$sum = 0 === $base ? 'מינוי אקסטרה: ללא הגבלה, ההסדר לא משנה.' : 'למשתמש אין כרגע מינוי עם דומיינים (וובסטופ או בארטר). ההסדר יחול כשיהיה.';
	}
	$row = function ( $label, $for, $field, $desc ) {
		return '<tr><th>' . ( $for ? '<label for="' . $for . '">' . $label . '</label>' : $label ) . '</th><td>' . $field . ( $desc ? '<p class="description">' . $desc . '</p>' : '' ) . '</td></tr>';
	};
	echo '<h2 id="fsa-deal">פונטשוק · הסדר מיוחד</h2><table class="form-table" role="presentation">'
		. $row( 'דומיינים נוספים בכל חודש', 'fsa_deal_extra', '<input type="number" min="0" max="50" step="1" id="fsa_deal_extra" name="fsa_deal_extra" value="' . esc_attr( $n ) . '" class="small-text">', 'מתווסף למכסת המינוי (וובסטופ ובארטר: 3 בחודש). 0 = בלי הסדר.' )
		. $row( 'בתוקף עד', 'fsa_deal_until', '<input type="date" id="fsa_deal_until" name="fsa_deal_until" value="' . esc_attr( $until ) . '">', 'לא חובה. אחרי התאריך הלקוח חוזר למכסה הרגילה. ריק = בלי הגבלת זמן.' )
		. $row( 'הערה פנימית', 'fsa_deal_note', '<input type="text" id="fsa_deal_note" name="fsa_deal_note" value="' . esc_attr( $note ) . '" class="regular-text">', 'נראית רק כאן, לא ללקוח.' )
		. $row( 'מכסה החודש', '', '<strong>' . esc_html( $sum ) . '</strong>', '' )
		. '</table>';
}
add_action( 'personal_options_update', 'fsa_v2_deal_save' );
add_action( 'edit_user_profile_update', 'fsa_v2_deal_save' );
function fsa_v2_deal_save( $uid ) {
	if ( ! current_user_can( 'manage_options' ) || ! current_user_can( 'edit_user', $uid ) || ! isset( $_POST['fsa_deal_extra'] ) ) return;
	$n = max( 0, min( 50, (int) $_POST['fsa_deal_extra'] ) );
	$until = isset( $_POST['fsa_deal_until'] ) ? sanitize_text_field( wp_unslash( $_POST['fsa_deal_until'] ) ) : '';
	if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $until ) ) $until = '';
	$note = isset( $_POST['fsa_deal_note'] ) ? sanitize_text_field( wp_unslash( $_POST['fsa_deal_note'] ) ) : '';
	foreach ( array( 'fsa_v2_deal_extra' => $n, 'fsa_v2_deal_until' => $until, 'fsa_v2_deal_note' => $note ) as $k => $v ) {
		if ( $v ) update_user_meta( $uid, $k, $v ); else delete_user_meta( $uid, $k );
	}
}

// 3. the shortcode
// 2b. one-off check (admins, ?fsa_debug=1): shows where the store keeps weight names and licence types. Read-only.
function fsa_v2_shape( $v, $depth = 0 ) {
	if ( is_array( $v ) ) {
		if ( $depth > 2 ) return 'array(' . count( $v ) . ')';
		$out = array();
		foreach ( array_slice( $v, 0, 12, true ) as $k => $x ) $out[ $k ] = fsa_v2_shape( $x, $depth + 1 );
		return $out;
	}
	if ( is_object( $v ) ) return 'object ' . get_class( $v );
	$v = (string) $v;
	if ( preg_match( '#^https?://#', $v ) ) return '(link: ' . basename( (string) wp_parse_url( $v, PHP_URL_PATH ) ) . ')'; // file name only, never the link
	return mb_strlen( $v ) > 80 ? mb_substr( $v, 0, 80 ) . '…' : $v;
}
function fsa_v2_debug() {
	$r = array();
	if ( function_exists( 'get_field' ) ) {
		$rows = (array) get_field( 'fonts-repeater', 'option' );
		$r['subscription_fonts_count'] = count( $rows );
		$r['subscription_font_rows'] = fsa_v2_shape( array_slice( $rows, 0, 2 ) );
	}
	$names = array();
	foreach ( array_slice( (array) ( function_exists( 'get_field' ) ? get_field( 'fonts-repeater', 'option' ) : array() ), 0, 2 ) as $row ) {
		if ( ! empty( $row['font-name'] ) ) $names[] = wp_strip_all_tags( $row['font-name'] );
	}
	foreach ( $names as $n ) {
		foreach ( get_posts( array( 'post_type' => 'product', 's' => $n, 'posts_per_page' => 2 ) ) as $post ) {
			$pr = function_exists( 'wc_get_product' ) ? wc_get_product( $post->ID ) : null;
			if ( ! $pr ) continue;
			$attrs = array();
			foreach ( $pr->get_attributes() as $key => $att ) {
				$attrs[ $key ] = is_object( $att ) && $att->is_taxonomy() ? wp_list_pluck( (array) wc_get_product_terms( $post->ID, $att->get_name() ), 'name' ) : ( is_object( $att ) ? $att->get_options() : $att );
			}
			$vars = array();
			if ( $pr->is_type( 'variable' ) ) {
				foreach ( array_slice( $pr->get_children(), 0, 4 ) as $vid ) {
					$v = wc_get_product( $vid );
					if ( $v ) $vars[] = array( 'attributes' => $v->get_attributes(), 'downloads' => array_values( wp_list_pluck( array_map( function ( $d ) { return array( 'name' => $d->get_name() ); }, $v->get_downloads() ), 'name' ) ) );
				}
			}
			$r['products'][] = array(
				'search' => $n, 'id' => $post->ID, 'title' => $post->post_title, 'type' => $pr->get_type(),
				'attributes' => $attrs, 'variations_count' => $pr->is_type( 'variable' ) ? count( $pr->get_children() ) : 0, 'variations_sample' => $vars,
				'downloads' => array_values( array_map( function ( $d ) { return $d->get_name(); }, $pr->get_downloads() ) ),
				'acf_fields' => function_exists( 'get_fields' ) ? fsa_v2_shape( (array) get_fields( $post->ID ) ) : 'no acf',
			);
		}
	}
	if ( function_exists( 'wc_get_customer_available_downloads' ) ) {
		$r['my_downloads_sample'] = array_map( function ( $d ) { return array( 'product' => $d['product_name'], 'file' => $d['download_name'] ); }, array_slice( wc_get_customer_available_downloads( get_current_user_id() ), 0, 6 ) );
	}
	return '<div dir="ltr" style="max-width:1100px;margin:30px auto;padding:20px;background:#fff;border:2px solid #5B3FFF;border-radius:12px"><p style="font:600 16px sans-serif;margin:0 0 10px">FS check: copy everything in the box below and send it</p><textarea readonly style="width:100%;height:420px;font:12px monospace" onclick="this.select()">' . esc_textarea( wp_json_encode( $r, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT ) ) . '</textarea></div>';
}

add_shortcode( 'fs_account_v2', function () {
	if ( ! fsa_v2_can_view() ) return '';
	if ( isset( $_GET['fsa_debug'] ) ) return fsa_v2_debug();
	$data = wp_json_encode( fsa_v2_data(), JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP );
	$css  = <<<'FSACSS'
:is(#fsa,#fsa-layer){direction:rtl;text-align:right;width:100vw;margin-inline:calc(50% - 50vw);position:relative;padding-block:1px}
:is(#fsa,#fsa-layer) button,:is(#fsa,#fsa-layer) input,:is(#fsa,#fsa-layer) select,:is(#fsa,#fsa-layer) textarea{font:inherit;color:inherit;background:none;border:0;border-radius:0;box-shadow:none;text-transform:none;letter-spacing:inherit;margin:0;min-height:0}
:is(#fsa,#fsa-layer) :where(button):hover,:is(#fsa,#fsa-layer) :where(button):focus{background:none;color:inherit}
:is(#fsa,#fsa-layer) a,:is(#fsa,#fsa-layer) a:hover{color:inherit;text-decoration:none}
:is(#fsa,#fsa-layer) table{margin:0;border:0;font-size:inherit;border-collapse:collapse}
:is(#fsa,#fsa-layer) table td,:is(#fsa,#fsa-layer) table th{border:0;background:none;padding:0;vertical-align:middle;line-height:inherit}
:is(#fsa,#fsa-layer) table tbody>tr:nth-child(odd)>td,:is(#fsa,#fsa-layer) table tbody>tr:nth-child(odd)>th,:is(#fsa,#fsa-layer) table tbody tr:hover>td{background:none}
:is(#fsa,#fsa-layer) h1,:is(#fsa,#fsa-layer) h2,:is(#fsa,#fsa-layer) h3,:is(#fsa,#fsa-layer) p,:is(#fsa,#fsa-layer) dl,:is(#fsa,#fsa-layer) dd{margin:0;font-family:inherit;color:inherit;letter-spacing:normal}
:is(#fsa,#fsa-layer) img{max-width:none;height:auto;border:0}
:is(#fsa,#fsa-layer) table td,:is(#fsa,#fsa-layer) table th{text-align:start}
:is(#fsa,#fsa-layer) label{font-weight:inherit;text-align:inherit;display:inline}
:is(#fsa,#fsa-layer) :where(div,p,span,a,button,label,td,th,li,section,nav,main,h1,h2,h3){text-align:inherit}
:is(#fsa,#fsa-layer){
  color-scheme: light;
  --bg:#F4F4F4; --card:#FFFFFF; --ink:#151515; --muted:#6E6E6E; --faint:#A8A8A8; --line:#E8E8E8; --soft:#F2F2F2; --softer:#F8F7FB;
  --violet:#5B3FFF; --violet-text:#9B4DFF;
  --grad:linear-gradient(90deg,#BCB6FF 0%,#EACCFF 100%);
  --ok:#43D61B; --ok-track:#E2FBD6; --warn:#FFC700; --warn-track:#FFF3C4; --bad:#FF1E1E; --bad-track:#FFD6D6;
  --new:#FF6A3D;
  --c-desk:linear-gradient(135deg,#FF9A8B,#E3166F);
  --c-web:linear-gradient(158deg,#6FCFA1,#2C67FF);
  --c-extra:linear-gradient(108deg,#BE68FF 12%,#382CFF 94%);
  --c-barter:linear-gradient(135deg,#C3CAD6,#20232B);
  --font:"Discovery_Fs","Heebo",Arial,sans-serif;
  --r-card:24px; --r-ctl:6px;
}
:is(#fsa,#fsa-layer),:is(#fsa,#fsa-layer) *{box-sizing:border-box}
:is(#fsa,#fsa-layer),:is(#fsa,#fsa-layer){background:var(--bg)}
:is(#fsa,#fsa-layer){font-family:var(--font);color:var(--ink);font-size:16px;line-height:1.5;direction:rtl;-webkit-font-smoothing:antialiased}
:is(#fsa,#fsa-layer) button,:is(#fsa,#fsa-layer) input,:is(#fsa,#fsa-layer) select{font:inherit;color:inherit}
:is(#fsa,#fsa-layer) button{cursor:pointer}
:is(#fsa,#fsa-layer) a{color:inherit}
:is(#fsa,#fsa-layer) :focus-visible{outline:2px solid var(--violet);outline-offset:2px}
:is(#fsa,#fsa-layer) .num{font-variant-numeric:proportional-nums;letter-spacing:-.01em}
:is(#fsa,#fsa-layer) .icon{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex:none}
:is(#fsa,#fsa-layer) .site-head{background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:env(safe-area-inset-top,0px);z-index:10}
:is(#fsa,#fsa-layer) .site-head .in{max-width:1440px;margin:0 auto;padding:0 52px;height:88px;display:flex;align-items:center;gap:40px}
:is(#fsa,#fsa-layer) .logo{font-weight:800;font-size:31px;letter-spacing:-.5px;line-height:1}
:is(#fsa,#fsa-layer) .mainnav{display:flex;gap:24px;color:var(--muted);font-size:17px;flex-wrap:wrap}
:is(#fsa,#fsa-layer) .mainnav a{text-decoration:none}
:is(#fsa,#fsa-layer) .mainnav a.on{color:var(--violet-text);font-weight:700}
:is(#fsa,#fsa-layer) .head-tools{margin-inline-start:auto;display:flex;align-items:center;gap:22px}
:is(#fsa,#fsa-layer) .me{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:99px;padding:4px 4px 4px 14px;font-size:15px;font-weight:500;background:var(--card)}
:is(#fsa,#fsa-layer) .avatar{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:15px;color:#fff;background:var(--c-extra)}
:is(#fsa,#fsa-layer) .page{max-width:1140px;margin:0 auto;padding-block:56px 120px;padding-inline:16px}
:is(#fsa,#fsa-layer) .hello{font-size:16px;color:var(--muted);margin:0 4px 14px;display:inline-block}
:is(#fsa,#fsa-layer) .hello b{color:var(--ink);font-weight:500}
:is(#fsa,#fsa-layer) .shell{display:grid;grid-template-columns:190px minmax(0,1fr);background:var(--card);border-radius:var(--r-card);min-height:780px;overflow:hidden}
:is(#fsa,#fsa-layer) .side{border-inline-end:1px solid var(--line);padding-top:58px;display:flex;flex-direction:column}
:is(#fsa,#fsa-layer) .side button{all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;height:54px;padding-inline:52px 20px;margin-bottom:40px;font-weight:700;font-size:19px;position:relative;transition:color .15s}
:is(#fsa,#fsa-layer) .side button:hover{color:var(--violet-text)}
:is(#fsa,#fsa-layer) .side button[aria-current="page"]{background:var(--soft);color:var(--violet-text)}
:is(#fsa,#fsa-layer) .side button[aria-current="page"]::after{content:"";position:absolute;inset-inline-end:0;top:0;bottom:0;width:3px;background:var(--violet)}
:is(#fsa,#fsa-layer) .side .sep{flex:1}
:is(#fsa,#fsa-layer) .side .logout{font-weight:500;font-size:16px;color:var(--muted);margin-bottom:28px;display:flex;align-items:center;gap:8px}
:is(#fsa,#fsa-layer) .side .logout .icon{width:20px;height:20px;flex:none}
:is(#fsa,#fsa-layer) .side .logout:hover{color:var(--ink)}
:is(#fsa,#fsa-layer) .main{padding:68px 64px 64px;min-width:0}
:is(#fsa,#fsa-layer){--ease:cubic-bezier(.22,.61,.36,1)}
:is(#fsa,#fsa-layer) .main.enter{animation:viewIn .45s var(--ease)}
@keyframes viewIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes drawerIn{from{opacity:0;transform:translateY(-8px);clip-path:inset(0 0 100% 0 round 10px)}to{opacity:1;transform:none;clip-path:inset(0 0 0 0 round 10px)}}
@keyframes drawerOut{from{opacity:1;clip-path:inset(0 0 0 0 round 10px)}to{opacity:0;transform:translateY(-6px);clip-path:inset(0 0 100% 0 round 10px)}}
@keyframes rowIn{from{background:#EEE9FF}to{background:transparent}}
:is(#fsa,#fsa-layer) .drawer.opening .box{animation:drawerIn .5s var(--ease) both}
:is(#fsa,#fsa-layer) .drawer.closing .box{animation:drawerOut .28s ease forwards}
:is(#fsa,#fsa-layer) .fresh td{animation:rowIn 1.8s ease}
:is(#fsa,#fsa-layer) .btn,:is(#fsa,#fsa-layer) .ibtn,:is(#fsa,#fsa-layer) .dl,:is(#fsa,#fsa-layer) .side button,:is(#fsa,#fsa-layer) .tabs button,:is(#fsa,#fsa-layer) .chip{transition:background-color .25s var(--ease),color .25s var(--ease),filter .25s var(--ease),transform .15s var(--ease),box-shadow .25s var(--ease)}
:is(#fsa,#fsa-layer) .tabs button::after{transition:opacity .3s var(--ease)}
:is(#fsa,#fsa-layer) .h1{font-size:27px;font-weight:800;margin:0;line-height:1.2}
:is(#fsa,#fsa-layer) .sub{font-size:15px;margin:4px 0 0;color:var(--muted)}
:is(#fsa,#fsa-layer) .head-row{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:40px}
:is(#fsa,#fsa-layer) .tabs{display:flex;box-shadow:inset 0 -1.5px 0 #BDBDBD;margin-bottom:26px;overflow-x:auto;scrollbar-width:none}
:is(#fsa,#fsa-layer) .tabs::-webkit-scrollbar{display:none}
:is(#fsa,#fsa-layer) .fontpick{position:relative}
:is(#fsa,#fsa-layer) .fp-btn{all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--ink);height:44px;border:1px solid #E3C8F5;border-radius:99px;background:#fff;padding:0 18px;font-size:15px;transition:border-color .2s,box-shadow .2s}
:is(#fsa,#fsa-layer) .fp-btn:focus-visible{outline:2px solid var(--violet)}
:is(#fsa,#fsa-layer) .fp-val{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
:is(#fsa,#fsa-layer) .fp-menu{position:absolute;top:100%;inset-inline:0;margin-top:4px;background:var(--card);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.14);padding:8px;z-index:6;min-width:200px;opacity:0;visibility:hidden;transform:translateY(-6px) scale(.98);transform-origin:top center;transition:opacity .25s var(--ease),transform .3s var(--ease),visibility 0s linear .3s}
:is(#fsa,#fsa-layer) .fp-menu.open{opacity:1;visibility:visible;transform:none;transition-delay:0s}
:is(#fsa,#fsa-layer) .fp-btn svg{transition:transform .3s var(--ease)}
:is(#fsa,#fsa-layer) .fp-btn[aria-expanded="true"] svg{transform:rotate(180deg)}
:is(#fsa,#fsa-layer) .fp-menu label{display:flex!important;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;font-size:15px!important;margin:0!important;cursor:pointer;white-space:nowrap;line-height:1.3}
:is(#fsa,#fsa-layer) .fp-menu label:hover{background:var(--soft)}
:is(#fsa,#fsa-layer) .fp-menu label.off{opacity:.4;cursor:not-allowed}
:is(#fsa,#fsa-layer) .fp-menu{max-height:min(320px,50vh);overflow-y:auto;overscroll-behavior:contain}
:is(#fsa,#fsa-layer) .fp-menu input[type=checkbox]{-webkit-appearance:checkbox;appearance:auto;accent-color:var(--violet);width:16px!important;height:16px!important;min-width:16px;max-width:16px;margin:0!important;padding:0!important;border:0;box-shadow:none;flex:none;transform:none}
:is(#fsa,#fsa-layer) .fp-hint{margin:6px 10px 2px;font-size:12px;color:var(--muted)}
:is(#fsa,#fsa-layer) .fp-hint.max{color:var(--violet);font-weight:700}
:is(#fsa,#fsa-layer) .form-err{color:#B00000;font-size:14px;margin:-14px 0 16px}
:is(#fsa,#fsa-layer) .orow td{white-space:nowrap}
:is(#fsa,#fsa-layer) .oid{display:inline-flex;align-items:center;gap:6px;margin-inline-start:-38px}
:is(#fsa,#fsa-layer) .eye-ph{width:32px;display:inline-block}
:is(#fsa,#fsa-layer) .ibtn.eye{color:var(--muted)}
:is(#fsa,#fsa-layer) .ibtn.eye:hover,:is(#fsa,#fsa-layer) .ibtn.eye.on{color:var(--violet);background:#EEE9FF}
:is(#fsa,#fsa-layer) .odet{font-size:15px}
:is(#fsa,#fsa-layer) .odet span:first-child{display:inline-block;max-width:136px;vertical-align:bottom;overflow:hidden;text-overflow:ellipsis}
:is(#fsa,#fsa-layer) .orow td,:is(#fsa,#fsa-layer) .otbl thead th{padding-inline:10px}
:is(#fsa,#fsa-layer) .otbl thead th:first-child{padding-inline-start:40px}
:is(#fsa,#fsa-layer) .orow .btn{height:34px;padding:0 12px;font-size:15px}
:is(#fsa,#fsa-layer) .orow td:first-child{padding-inline-start:40px}
:is(#fsa,#fsa-layer) .odet .more{margin-inline-start:6px;font-size:12px;font-weight:700;background:var(--soft);border-radius:99px;padding:1px 7px;color:var(--muted)}
@media (max-width:760px){:is(#fsa,#fsa-layer) .oid{margin:0}:is(#fsa,#fsa-layer) .orow td{white-space:normal}
  :is(#fsa,#fsa-layer) .orow>td.odet{flex:1 1 0;min-width:0;white-space:nowrap;overflow:hidden;display:flex!important;align-items:center}
  :is(#fsa,#fsa-layer) .orow>td.odet span:first-child{max-width:none;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  :is(#fsa,#fsa-layer) .orow>td.odet .more{flex:none}
  :is(#fsa,#fsa-layer) .orow>td:nth-child(4){flex:none}
  :is(#fsa,#fsa-layer) .tabs[role=tablist] button{flex:1 1 0;min-width:0;padding:10px 4px 12px;text-align:center;white-space:normal;line-height:1.25;font-size:15px}
  :is(#fsa,#fsa-layer) .dl-tbl tbody tr:not(.zip-row)>td:nth-child(n+3){flex:1 1 0;min-width:0;margin:0!important}
  :is(#fsa,#fsa-layer) .dl-tbl tbody tr:not(.zip-row) .dl,:is(#fsa,#fsa-layer) .dl-tbl .wsel-pop{width:100%;justify-content:center}
  :is(#fsa,#fsa-layer) .dl-tbl .wsel-pop .wsel{width:100%;justify-content:center;gap:8px}
  :is(#fsa,#fsa-layer) .dl-tbl tbody tr:not(.zip-row)>td:nth-child(2){display:none}
  :is(#fsa,#fsa-layer) .dl-tbl tbody tr:not(.zip-row){column-gap:8px}
  :is(#fsa,#fsa-layer) .dl-tbl .wsel-menu{inset-inline-end:0;inset-inline-start:auto}
  :is(#fsa,#fsa-layer) .dl-tbl .wsel{width:auto;height:32px;padding:0 10px;gap:6px;font-size:13px}
  :is(#fsa,#fsa-layer) .dl-tbl .wsel .wsel-l{display:none}
  :is(#fsa,#fsa-layer) .dl-tbl .wsel .wsel-s{display:inline}
  :is(#fsa,#fsa-layer) .dl-tbl tbody tr:not(.zip-row)>td:first-child{display:flex!important;align-items:baseline;gap:8px}
  :is(#fsa,#fsa-layer) .dl-tbl .ver{margin:0 auto 0 0;margin-inline-start:auto;margin-inline-end:0}
  :is(#fsa,#fsa-layer) .plan .plan-more-in{grid-template-columns:1fr 1fr;column-gap:16px}
  :is(#fsa,#fsa-layer) .plan .plan-more-in>div:nth-child(3){grid-column:1/-1}
  :is(#fsa,#fsa-layer) .note{gap:6px;font-size:14px;padding-inline:0}
  :is(#fsa,#fsa-layer) .note .note-ic{display:none}
  :is(#fsa,#fsa-layer) .sub-reg:not(.reg-on){background:transparent;padding:0}
  :is(#fsa,#fsa-layer) .sub-reg .reg-open{display:flex;width:100%;height:46px;font-size:16px;gap:8px}
  :is(#fsa,#fsa-layer) .sub-reg .reg-open .icon{width:20px;height:20px}
  :is(#fsa,#fsa-layer) .sub-reg.reg-on .reg-open{display:none}
  :is(#fsa,#fsa-layer) .sub-reg .reg-head{display:flex;align-items:center;justify-content:space-between;margin:-6px 0 10px;font-size:16px}
  :is(#fsa,#fsa-layer) .sub-reg .reg-close{width:32px;height:32px;color:var(--muted)}
  :is(#fsa,#fsa-layer) .sub-reg .reg-close .icon{width:20px;height:20px}
  :is(#fsa,#fsa-layer) .reg-fold{display:grid;grid-template-rows:0fr;transition:grid-template-rows .45s var(--ease)}
  :is(#fsa,#fsa-layer) .reg-fold>div{overflow:hidden}
  :is(#fsa,#fsa-layer) .reg-fold>div>*{opacity:0;transform:translateY(-6px);transition:opacity .3s ease,transform .4s var(--ease)}
  :is(#fsa,#fsa-layer) .sub-reg.reg-on .reg-fold{grid-template-rows:1fr}
  :is(#fsa,#fsa-layer) .sub-reg.reg-done .reg-fold>div{overflow:visible}
  :is(#fsa,#fsa-layer) .sub-reg.reg-on .reg-fold>div>*{opacity:1;transform:none;transition:opacity .4s ease .12s,transform .45s var(--ease) .08s}
  :is(#fsa,#fsa-layer) .dom-tbl>tbody>tr>td.num{margin-inline-start:auto!important}
  :is(#fsa,#fsa-layer) .tbl tbody tr.zip-row{flex-wrap:nowrap;gap:8px}
  :is(#fsa,#fsa-layer) .tbl tbody tr.zip-row>td:empty{display:none}
  :is(#fsa,#fsa-layer) .tbl tbody tr.zip-row>td{flex:1 1 0;min-width:0;margin:0!important}
  :is(#fsa,#fsa-layer) .tbl tbody tr.zip-row>td:last-child:empty{display:none}
  :is(#fsa,#fsa-layer) .tbl tbody tr.zip-row .btn-line{width:100%;padding:0 8px;font-size:13px;gap:6px}
}
:is(#fsa,#fsa-layer) .seg-f{display:inline-flex;align-items:center;gap:2px;background:var(--soft);border-radius:99px;padding:3px}
:is(#fsa,#fsa-layer) .seg-f button{all:unset;cursor:pointer;padding:6px 14px;border-radius:99px;font-size:14px;color:var(--muted);transition:background-color .25s var(--ease),color .25s var(--ease)}
:is(#fsa,#fsa-layer) .seg-f button:hover{color:var(--ink)}
:is(#fsa,#fsa-layer) .seg-f button[aria-pressed="true"]{background:var(--card);color:var(--ink);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.1)}
:is(#fsa,#fsa-layer) .seg-f button:focus-visible{outline:2px solid var(--violet);outline-offset:2px}
:is(#fsa,#fsa-layer) .demo{display:inline-flex;align-items:center;gap:4px;font-size:13px;color:var(--muted);background:var(--soft);border-radius:99px;padding:3px;margin-bottom:18px}
:is(#fsa,#fsa-layer) .demo span{padding:0 8px}
:is(#fsa,#fsa-layer) .demo button{all:unset;cursor:pointer;padding:3px 12px;border-radius:99px;font-weight:700;color:var(--ink)}
:is(#fsa,#fsa-layer) .demo button.on{background:var(--card);box-shadow:0 1px 3px rgba(0,0,0,.12)}
:is(#fsa,#fsa-layer) .dom-head{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:16px}
:is(#fsa,#fsa-layer) .usage{display:flex;flex-direction:column;gap:6px;min-width:200px;font-size:14px}
:is(#fsa,#fsa-layer) .usage .track{height:6px;border-radius:9px;background:var(--soft);overflow:hidden;display:block}
:is(#fsa,#fsa-layer) .usage .track i{display:block;height:100%;border-radius:9px;margin-inline-start:auto}
:is(#fsa,#fsa-layer) .ltag{display:inline-block;font-size:13px;border:1px solid var(--line);border-radius:6px;padding:1px 8px;white-space:nowrap}
:is(#fsa,#fsa-layer) .src{display:inline-flex;align-items:center;gap:6px;font-size:14px;white-space:nowrap}
:is(#fsa,#fsa-layer) .src.buy{border:1px solid var(--line);border-radius:6px;padding:1px 8px}
:is(#fsa,#fsa-layer) .tabs button{all:unset;cursor:pointer;padding:10px 22px 12px;font-weight:700;font-size:16px;position:relative;white-space:nowrap}
:is(#fsa,#fsa-layer) .tabs button[aria-selected="true"]::after{content:"";display:block;position:absolute;inset-inline:0;bottom:0;height:2px;background:linear-gradient(90deg,var(--violet),#B06BFF)}
:is(#fsa,#fsa-layer) .tbl{width:100%;border-collapse:separate;border-spacing:0}
:is(#fsa,#fsa-layer) .tbl thead th{background:var(--soft);font-weight:700;font-size:16px;text-align:start;padding:12px 16px;height:44px;white-space:nowrap}
:is(#fsa,#fsa-layer) .tbl thead th:first-child{border-start-start-radius:8px;border-end-start-radius:8px;padding-inline-start:40px}
:is(#fsa,#fsa-layer) .tbl thead th:last-child{border-start-end-radius:8px;border-end-end-radius:8px}
:is(#fsa,#fsa-layer) .tbl tbody td{padding:14px 16px;font-size:16px;vertical-align:middle}
:is(#fsa,#fsa-layer) .tbl tbody td:first-child{padding-inline-start:40px;font-weight:700}
:is(#fsa,#fsa-layer) .tbl tbody tr:first-child td{padding-top:30px}
:is(#fsa,#fsa-layer) .tbl tbody tr:not(.drawer):hover td{background:#FBFAFE}
:is(#fsa,#fsa-layer) .tbl .sm{display:block;font-size:13px;color:var(--muted);font-weight:400}
:is(#fsa,#fsa-layer) .tbl bdi.sm{text-align:right;unicode-bidi:isolate}
:is(#fsa,#fsa-layer) .tbl .mini tbody tr:first-child td{padding-top:11px}
:is(#fsa,#fsa-layer) .tbl-wrap{overflow-x:auto}
:is(#fsa,#fsa-layer) .acts{display:flex;gap:14px;justify-content:flex-end;align-items:center}
:is(#fsa,#fsa-layer) .ibtn{all:unset;cursor:pointer;display:inline-grid;place-items:center;width:32px;height:32px;border-radius:8px}
:is(#fsa,#fsa-layer) .ibtn:hover{background:var(--soft)}
:is(#fsa,#fsa-layer){--ic:color-mix(in srgb,var(--ink) 80%,#fff)}
:is(#fsa,#fsa-layer) .ibtn:not(.locked):not(.note-dl):not(.eye):not(.exp):not(.ok-btn):not(.note-x):not(.reg-close),:is(#fsa,#fsa-layer) .head-tools .ic-wrap,:is(#fsa,#fsa-layer) .side .logout .icon{color:var(--ic)}
:is(#fsa,#fsa-layer) .ibtn:not(.locked):not(.note-dl):not(.eye):not(.exp):not(.ok-btn):not(.note-x):not(.reg-close):hover{color:var(--ink)}
:is(#fsa,#fsa-layer) .dom-tbl>tbody>tr>td.num{color:var(--faint)}
:is(#fsa,#fsa-layer) .sublogo{width:22px;height:22px;vertical-align:-6px;margin-inline-start:6px}
:is(#fsa,#fsa-layer) .btn{border:0;border-radius:var(--r-ctl);height:38px;padding:0 20px;font-weight:700;font-size:16px;display:inline-flex;align-items:center;justify-content:center;gap:10px;white-space:nowrap;transition:filter .15s,transform .1s}
:is(#fsa,#fsa-layer) .btn:active{transform:scale(.98)}
:is(#fsa,#fsa-layer) .btn-grad{background:var(--grad);color:var(--ink)}
:is(#fsa,#fsa-layer) .btn-grad:hover{filter:saturate(1.3)}
:is(#fsa,#fsa-layer) .btn.btn-grad{border-radius:99px}
:is(#fsa,#fsa-layer) .btn-ghost{background:var(--card);border:1px solid var(--ink)}
:is(#fsa,#fsa-layer) .btn-soft{background:var(--soft)}
:is(#fsa,#fsa-layer) .dl{all:unset;box-sizing:border-box;cursor:pointer;display:grid;place-items:center;width:132px;max-width:100%;height:32px;border:1px solid #D6D6D6;border-radius:8px;color:var(--ink);transition:background-color .25s var(--ease),border-color .25s var(--ease)}
:is(#fsa,#fsa-layer) .dl .icon{width:18px;height:18px}
:is(#fsa,#fsa-layer) .dl:hover{background:var(--soft);border-color:#BDBDBD}
:is(#fsa,#fsa-layer) .dl .dl-k{display:none}
:is(#fsa,#fsa-layer) .btn.btn-line{width:132px;max-width:100%;height:32px;padding:0 14px;font-size:14px;background:transparent;border:1px solid #D6D6D6;border-radius:8px;color:var(--ink)}
:is(#fsa,#fsa-layer) .btn.btn-line .icon{width:18px;height:18px}
:is(#fsa,#fsa-layer) .btn.btn-line:hover{background:var(--soft);border-color:#BDBDBD}
:is(#fsa,#fsa-layer) .plan{display:flex;align-items:center;gap:20px;background:var(--softer);border-radius:10px;padding:18px 28px;position:relative;margin-bottom:36px;flex-wrap:wrap}
:is(#fsa,#fsa-layer) .plan::after{content:"";position:absolute;inset-inline-end:0;top:0;bottom:0;width:14px;border-start-end-radius:10px;border-end-end-radius:10px;background:var(--c-extra)}
:is(#fsa,#fsa-layer) .plan-web::after{background:var(--c-web)}:is(#fsa,#fsa-layer) .plan-extra::after{background:var(--c-extra)}:is(#fsa,#fsa-layer) .plan-desk::after{background:var(--c-desk)}:is(#fsa,#fsa-layer) .plan-barter::after{background:var(--c-barter)}:is(#fsa,#fsa-layer) .plan-acad::after{background:linear-gradient(135deg,#E1F07D,#FFAD05)}
:is(#fsa,#fsa-layer) .plan img{width:52px;height:52px}
:is(#fsa,#fsa-layer) .plan .name{font-weight:700;font-size:18px;display:flex;gap:8px;align-items:center}
:is(#fsa,#fsa-layer) .plan .dates{margin-inline-start:auto;display:flex;gap:32px;font-size:14px;padding-inline-end:22px;white-space:nowrap}
@media (max-width:1000px){:is(#fsa,#fsa-layer) .plan .dates{flex-wrap:wrap;white-space:normal;margin-inline-start:0}}
:is(#fsa,#fsa-layer) .plan .dates b{display:block;font-size:14px}
:is(#fsa,#fsa-layer) .plan{padding-block:14px;row-gap:0}
:is(#fsa,#fsa-layer) .plan img{width:46px;height:46px}
:is(#fsa,#fsa-layer) .plan-desc{font-size:15px}
:is(#fsa,#fsa-layer) .plan .dates{align-items:center}
:is(#fsa,#fsa-layer) .plan-tg{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:4px;font-size:14px;color:var(--violet);padding:6px 10px;border-radius:99px;transition:background-color .25s var(--ease)}
:is(#fsa,#fsa-layer) .plan-tg:hover{background:#EEE9FF}
:is(#fsa,#fsa-layer) .plan-tg:focus-visible{outline:2px solid var(--violet);outline-offset:2px}
:is(#fsa,#fsa-layer) .plan-tg .icon{width:16px;height:16px;transition:transform .5s var(--ease)}
:is(#fsa,#fsa-layer) .plan.open .plan-tg .icon{transform:rotate(180deg)}
:is(#fsa,#fsa-layer) .plan-more{flex-basis:100%;display:grid;grid-template-rows:0fr;transition:grid-template-rows .5s var(--ease)}
:is(#fsa,#fsa-layer) .plan-more>div{overflow:hidden;min-height:0}
:is(#fsa,#fsa-layer) .plan.open .plan-more{grid-template-rows:1fr}
:is(#fsa,#fsa-layer) .plan-more-in{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,max-content));gap:14px 40px;padding-top:14px;margin-top:14px;border-top:1px solid #E6E3F0;font-size:14px;opacity:0;transform:translateY(-4px);transition:opacity .3s ease,transform .4s var(--ease)}
:is(#fsa,#fsa-layer) .plan.open .plan-more-in{opacity:1;transform:none;transition:opacity .45s ease .1s,transform .5s var(--ease) .05s}
:is(#fsa,#fsa-layer) .plan-more-in b{display:block;font-weight:500;color:var(--muted);font-size:13px}
:is(#fsa,#fsa-layer) .plan-more-in span{font-size:15px}
:is(#fsa,#fsa-layer) .chip{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;border-radius:99px;padding:2px 10px;background:#E9E3FF;color:var(--violet);white-space:nowrap}
:is(#fsa,#fsa-layer) .chip.ok{background:var(--ok-track);color:#1E7A00}
:is(#fsa,#fsa-layer) .chip.wait{background:var(--soft);color:var(--muted)}
:is(#fsa,#fsa-layer) .chip.bad{background:var(--bad-track);color:#B00000}
:is(#fsa,#fsa-layer) .chip::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
:is(#fsa,#fsa-layer) .meter{display:flex;align-items:center;gap:8px;font-size:12px}
:is(#fsa,#fsa-layer) .meter .bar{width:64px;height:5px;border-radius:9px;position:relative;background:var(--ok-track)}
:is(#fsa,#fsa-layer) .meter .bar i{position:absolute;inset-block:0;inset-inline-end:0;border-radius:9px;background:var(--ok)}
:is(#fsa,#fsa-layer) .meter.warn .bar{background:var(--warn-track)} :is(#fsa,#fsa-layer) .meter.warn .bar i{background:var(--warn)}
:is(#fsa,#fsa-layer) .meter.bad .bar{background:var(--bad-track)} :is(#fsa,#fsa-layer) .meter.bad .bar i{background:var(--bad)}
:is(#fsa,#fsa-layer) .drawer>td{padding:0 0 18px!important}
:is(#fsa,#fsa-layer) .drawer .box{background:var(--bg);border-radius:10px;padding:24px 26px}
:is(#fsa,#fsa-layer) .form-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;gap:8px;align-items:end;margin-bottom:26px}
:is(#fsa,#fsa-layer) .fld label{display:block;font-size:12px;margin-bottom:4px}
:is(#fsa,#fsa-layer) .fld input,:is(#fsa,#fsa-layer) .fld select{width:100%;height:44px;border:1px solid #E3C8F5;border-radius:99px;background:#fff;padding:0 18px;font-size:15px;transition:border-color .2s,box-shadow .2s}
:is(#fsa,#fsa-layer) .fld input::placeholder,:is(#fsa,#fsa-layer) .pf input::placeholder{color:#828F9D}
/* every field the customer fills in looks like the domain-registration field: white, lilac hairline, pill; violet ring on focus */
:is(#fsa,#fsa-layer) .fld input:focus,:is(#fsa,#fsa-layer) .fld select:focus,:is(#fsa,#fsa-layer) .pf input:not(.sw):focus,:is(#fsa,#fsa-layer) .ed:focus{outline:none;border-color:#B075FF;box-shadow:0 0 0 3px #EFE3FF}
:is(#fsa,#fsa-layer) .fp-btn:focus-visible,:is(#fsa,#fsa-layer) .fp-btn[aria-expanded="true"]{outline:none;border-color:#B075FF;box-shadow:0 0 0 3px #EFE3FF}
:is(#fsa,#fsa-layer) .mini{width:100%;border-collapse:collapse;font-size:15px}
:is(#fsa,#fsa-layer) .mini th{font-weight:500;text-align:start;padding:8px 14px;border-bottom:1px solid #8C8C8C}
:is(#fsa,#fsa-layer) .mini td{padding:11px 14px}
:is(#fsa,#fsa-layer) .quota{text-align:center;margin-bottom:22px}
:is(#fsa,#fsa-layer) .quota b{display:block;font-size:17px;margin-bottom:12px}
:is(#fsa,#fsa-layer) .qopts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;text-align:start}
:is(#fsa,#fsa-layer) .qopt{background:var(--card);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;border:1px solid transparent}
:is(#fsa,#fsa-layer) .qopt.rec{border-color:var(--violet)}
:is(#fsa,#fsa-layer) .qopt h4{margin:0;font-size:16px}
:is(#fsa,#fsa-layer) .qopt p{margin:0;font-size:14px;color:var(--muted)}
:is(#fsa,#fsa-layer) .qopt .btn{margin-top:auto;height:34px}
:is(#fsa,#fsa-layer) .grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px 28px}
:is(#fsa,#fsa-layer) .pf label{display:block;font-size:16px;margin-bottom:4px}
:is(#fsa,#fsa-layer) .pf input{width:100%;height:44px;border:1px solid #E3C8F5;border-radius:99px;background:#fff;padding:0 18px;font-size:15px;transition:border-color .2s,box-shadow .2s}
:is(#fsa,#fsa-layer) .hint{font-size:13px;margin-top:4px;color:var(--muted)}
:is(#fsa,#fsa-layer) .prefs{display:grid;gap:4px;max-width:640px}
:is(#fsa,#fsa-layer) .pref{display:flex;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid var(--line)}
:is(#fsa,#fsa-layer) .pref div{flex:1}
:is(#fsa,#fsa-layer) .pref b{display:block;font-weight:700}
:is(#fsa,#fsa-layer) .pref span{font-size:14px;color:var(--muted)}
:is(#fsa,#fsa-layer) .pf .pref{display:flex;margin:0;cursor:pointer}
:is(#fsa,#fsa-layer) .pf input.sw{appearance:none;-webkit-appearance:none;width:42px;height:24px;min-width:42px;padding:0;border:0;margin:0;border-radius:99px;background:#D6D6D6;position:relative;cursor:pointer;transition:background .2s;flex:none}
:is(#fsa,#fsa-layer) .pf input.sw::after{content:"";position:absolute;top:3px;right:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:right .2s}
:is(#fsa,#fsa-layer) .pf input.sw:checked{background:var(--violet)}
:is(#fsa,#fsa-layer) .pf input.sw:checked::after{right:21px}
:is(#fsa,#fsa-layer) .modal{position:fixed;inset:0;background:rgba(20,20,30,.45);display:grid;place-items:center;padding:16px;z-index:30;opacity:0;transition:opacity .35s var(--ease)}
:is(#fsa,#fsa-layer) .modal.show{opacity:1}
:is(#fsa,#fsa-layer) .modal .sheet{transform:translateY(16px) scale(.985);transition:transform .45s var(--ease)}
:is(#fsa,#fsa-layer) .modal.show .sheet{transform:none}
:is(#fsa,#fsa-layer) .modal[hidden]{display:none!important}
:is(#fsa,#fsa-layer) .sheet{background:var(--card);border-radius:14px;max-width:560px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)}
:is(#fsa,#fsa-layer) .sheet-bar{display:flex;gap:10px;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--card)}
:is(#fsa,#fsa-layer) .cert{margin:18px;border:1.5px solid var(--ink);aspect-ratio:210/297;display:flex;flex-direction:column;font-size:14px}
:is(#fsa,#fsa-layer) .cert-head{background:#F6F1FF;border-bottom:1.5px solid var(--ink);display:flex;align-items:center;justify-content:center;gap:16px;padding:22px 18px}
:is(#fsa,#fsa-layer) .cert-head h2{margin:0;font-size:27px;font-weight:800}
:is(#fsa,#fsa-layer) .cert-head img{width:54px;height:54px}
:is(#fsa,#fsa-layer) .cert-body{padding:22px 30px;display:flex;flex-direction:column;gap:16px;flex:1}
:is(#fsa,#fsa-layer) .cert-row{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
:is(#fsa,#fsa-layer) .cert-row .who b{display:block;font-size:21px}
:is(#fsa,#fsa-layer) .cert dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:6px 10px}
:is(#fsa,#fsa-layer) .cert dt{font-weight:700} :is(#fsa,#fsa-layer) .cert dd{margin:0}
:is(#fsa,#fsa-layer) .cert-foot{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:10px}
:is(#fsa,#fsa-layer) .seal{width:84px;height:84px;display:block}
:is(#fsa,#fsa-layer) .cart{position:fixed;inset:0;z-index:35;background:rgba(20,20,30,.4);opacity:0;transition:opacity .3s var(--ease)}
:is(#fsa,#fsa-layer) .cart.show{opacity:1}
:is(#fsa,#fsa-layer) .cart[hidden]{display:none!important}
:is(#fsa,#fsa-layer) .cart-sheet{position:absolute;top:0;bottom:0;left:0;width:min(400px,100%);background:var(--card);box-shadow:0 0 40px rgba(0,0,0,.18);padding:22px 24px;display:flex;flex-direction:column;gap:18px;transform:translateX(-100%);transition:transform .4s var(--ease);overflow-y:auto}
:is(#fsa,#fsa-layer) .cart.show .cart-sheet{transform:none}
:is(#fsa,#fsa-layer) .cart-head{display:flex;justify-content:space-between;align-items:center;font-size:19px}
:is(#fsa,#fsa-layer) .cart-body{display:flex;flex-direction:column;gap:18px;flex:1}
:is(#fsa,#fsa-layer) .cart-item{display:flex;gap:12px;align-items:center;padding:14px;background:var(--bg);border-radius:12px}
:is(#fsa,#fsa-layer) .cart-item div{flex:1;min-width:0}
:is(#fsa,#fsa-layer) .cart-item div span{display:block;font-size:14px;color:var(--muted)}
:is(#fsa,#fsa-layer) .cart-ic{width:40px;height:40px;border-radius:10px;background:#EEE9FF;color:var(--violet);display:grid;place-items:center;flex:none}
:is(#fsa,#fsa-layer) .cart-sum{display:grid;grid-template-columns:1fr auto;gap:6px 12px;margin:0}
:is(#fsa,#fsa-layer) .cart-sum dd{margin:0}
:is(#fsa,#fsa-layer) .cart-sum .tot{font-weight:700;font-size:18px}
:is(#fsa,#fsa-layer) .cart-sum .vat{color:var(--muted);font-size:14px}
:is(#fsa,#fsa-layer) .cart-pay{display:flex;justify-content:space-between;align-items:center;border:1px solid var(--line);border-radius:10px;padding:10px 14px;font-size:15px}
:is(#fsa,#fsa-layer) .cart-pay span{display:inline-flex;gap:8px;align-items:center}
:is(#fsa,#fsa-layer) .cart-pay .icon{width:20px;height:20px}
:is(#fsa,#fsa-layer) .cart-go{width:100%;height:46px;font-size:17px;margin-top:auto}
:is(#fsa,#fsa-layer) .cart-note{text-align:center;margin:0}
:is(#fsa,#fsa-layer) .cart-wait,:is(#fsa,#fsa-layer) .cart-ok{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;font-size:16px}
:is(#fsa,#fsa-layer) .cart-ok>span:not(.ok-ic){color:var(--muted);font-size:15px}
:is(#fsa,#fsa-layer) .cart-ok .cart-go{margin-top:12px}
:is(#fsa,#fsa-layer) .spin{width:36px;height:36px;border-radius:50%;border:3px solid #E9E3FF;border-top-color:var(--violet);animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
:is(#fsa,#fsa-layer) .ok-ic{width:56px;height:56px;border-radius:50%;background:var(--ok-track);color:#1E7A00;display:grid;place-items:center}
:is(#fsa,#fsa-layer) .ok-ic .icon{width:32px;height:32px}
@media (max-width:760px){
  :is(#fsa,#fsa-layer) .cart-sheet{top:auto;right:0;width:100%;max-height:90vh;border-radius:20px 20px 0 0;transform:translateY(100%);padding-bottom:calc(22px + env(safe-area-inset-bottom,0px))}
  :is(#fsa,#fsa-layer) .cart-wait,:is(#fsa,#fsa-layer) .cart-ok{min-height:280px}
}
:is(#fsa,#fsa-layer) .toast{position:fixed;bottom:calc(24px + env(safe-area-inset-bottom,0px));left:50%;transform:translate(-50%,10px);background:var(--ink);color:#fff;border-radius:8px;padding:10px 18px;font-size:15px;opacity:0;pointer-events:none;transition:opacity .35s var(--ease),transform .4s var(--ease);z-index:40}
:is(#fsa,#fsa-layer) .toast.show{opacity:1;transform:translate(-50%,0)}
:is(#fsa,#fsa-layer) .x-new{position:relative}
:is(#fsa,#fsa-layer).show-new .x-new{outline:2px dashed var(--new);outline-offset:4px;border-radius:6px}
:is(#fsa,#fsa-layer).show-new .x-new::before{content:attr(data-new);position:absolute;top:-22px;inset-inline-start:0;background:var(--new);color:#fff;font-size:12px;font-weight:700;padding:1px 8px;border-radius:4px;white-space:nowrap;z-index:2}
:is(#fsa,#fsa-layer) .legend{position:fixed;bottom:calc(20px + env(safe-area-inset-bottom,0px));right:20px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px;display:flex;align-items:center;gap:10px;font-size:14px;box-shadow:0 6px 24px rgba(0,0,0,.08);z-index:20}
:is(#fsa,#fsa-layer) .legend input{accent-color:var(--new)}
:is(#fsa,#fsa-layer) .legend .swatch{width:14px;height:14px;border:2px dashed var(--new);border-radius:3px}
:is(#fsa,#fsa-layer) .foot{max-width:1140px;margin:0 auto;padding:0 16px 48px;display:flex;gap:16px;justify-content:space-between;align-items:center;color:var(--muted);font-size:13px;flex-wrap:wrap}
:is(#fsa,#fsa-layer) .h1{font-size:29px;font-weight:800;letter-spacing:-.2px}
:is(#fsa,#fsa-layer) .sub{font-size:15px;color:var(--muted);font-weight:400}
:is(#fsa,#fsa-layer) .side button{font-weight:500;font-size:18px;color:#3a3a3a}
:is(#fsa,#fsa-layer) .side button[aria-current="page"]{font-weight:700}
:is(#fsa,#fsa-layer) .tabs button{font-weight:500;color:var(--muted)}
:is(#fsa,#fsa-layer) .tabs button[aria-selected="true"]{color:var(--ink);font-weight:700}
:is(#fsa,#fsa-layer) .tbl thead th{font-size:14px;font-weight:500;color:var(--muted);background:#F6F6F6;height:40px}
:is(#fsa,#fsa-layer) .tbl>tbody>tr>td{font-weight:400;color:#2a2a2a}
:is(#fsa,#fsa-layer) .tbl>tbody>tr:not(.drawer)>td:first-child{font-weight:600;color:var(--ink)}
:is(#fsa,#fsa-layer) .tbl>tbody>tr.drawer>td{font-weight:400}
@media (min-width:761px){:is(#fsa,#fsa-layer) .tbl>tbody>tr:not(.drawer)>td{border-bottom:1px solid #F0F0F0}}
:is(#fsa,#fsa-layer) .mini th{font-size:13px;font-weight:500;color:var(--muted);border-bottom:1px solid var(--line)}
:is(#fsa,#fsa-layer) .mini td,:is(#fsa,#fsa-layer) .tbl .mini tbody td:first-child{font-weight:400;color:#2a2a2a;padding-inline-start:14px;padding-top:11px}
:is(#fsa,#fsa-layer) .btn{font-weight:600}
:is(#fsa,#fsa-layer) .chip{font-weight:600}
:is(#fsa,#fsa-layer) .plan .name{font-weight:700}
:is(#fsa,#fsa-layer) .plan .dates b{font-weight:500;color:var(--muted);font-size:13px}
:is(#fsa,#fsa-layer) .plan .dates span{font-size:15px}
:is(#fsa,#fsa-layer) .dom-head b{font-weight:700}
:is(#fsa,#fsa-layer) .fld label{font-size:13px;color:var(--muted);font-weight:500}
:is(#fsa,#fsa-layer) .hint{color:var(--muted)}
:is(#fsa,#fsa-layer) .note{display:flex;align-items:center;gap:10px;padding:4px 4px;margin-top:18px;font-size:15px;color:var(--muted)}
:is(#fsa,#fsa-layer) .btn.icon-only{width:44px;height:38px;padding:0}
:is(#fsa,#fsa-layer) .btn.icon-only .icon{width:20px;height:20px}
:is(#fsa,#fsa-layer) .btn.dl-sm{width:34px;height:32px;padding:0;background:transparent;border:1px solid #D6D6D6;color:var(--ink);border-radius:8px}
:is(#fsa,#fsa-layer) .btn.dl-sm .icon{width:18px;height:18px}
:is(#fsa,#fsa-layer) .btn.dl-sm:hover{background:var(--soft);border-color:#BDBDBD;filter:none}
:is(#fsa,#fsa-layer) .ic-wrap{display:inline-grid;place-items:center;line-height:0}
:is(#fsa,#fsa-layer) .hello{cursor:default}
:is(#fsa,#fsa-layer) .smiley{position:relative;display:inline-block;width:20px;height:20px;vertical-align:-4px;margin-inline-start:2px;color:var(--violet-text)}
:is(#fsa,#fsa-layer) .smiley svg{width:100%;height:100%;overflow:visible;display:block}
:is(#fsa,#fsa-layer) .sm-face{transform-origin:12px 22px;transform-box:view-box}
:is(#fsa,#fsa-layer) .sm-ring{fill:#F3ECFF;stroke:currentColor;stroke-width:1.5}
:is(#fsa,#fsa-layer) .sm-eye{fill:currentColor;transform-box:fill-box;transform-origin:center}
:is(#fsa,#fsa-layer) .sm-mouth{fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;transition:opacity .2s}
:is(#fsa,#fsa-layer) .sm-grin{fill:currentColor;opacity:0;transform-box:fill-box;transform-origin:center top;transform:scaleY(.2);transition:opacity .2s,transform .35s cubic-bezier(.34,1.56,.64,1)}
:is(#fsa,#fsa-layer) .sm-cheek{fill:#FF8FB1;opacity:0;transition:opacity .3s}
:is(#fsa,#fsa-layer) .sm-spark{position:absolute;top:50%;left:50%;width:4px;height:4px;border-radius:50%;background:var(--violet-text);opacity:0;pointer-events:none}
:is(#fsa,#fsa-layer) .hello:hover .sm-face,:is(#fsa,#fsa-layer) .smiley.play .sm-face{animation:smHop .9s cubic-bezier(.3,.7,.4,1)}
:is(#fsa,#fsa-layer) .hello:hover .sm-eye-r,:is(#fsa,#fsa-layer) .smiley.play .sm-eye-r{animation:smWink .9s ease}
:is(#fsa,#fsa-layer) .hello:hover .sm-mouth,:is(#fsa,#fsa-layer) .smiley.play .sm-mouth{opacity:0}
:is(#fsa,#fsa-layer) .hello:hover .sm-grin,:is(#fsa,#fsa-layer) .smiley.play .sm-grin{opacity:1;transform:none}
:is(#fsa,#fsa-layer) .hello:hover .sm-cheek,:is(#fsa,#fsa-layer) .smiley.play .sm-cheek{opacity:.8}
:is(#fsa,#fsa-layer) .hello:hover .sm-spark,:is(#fsa,#fsa-layer) .smiley.play .sm-spark{animation:smSpark .8s ease-out .15s}
:is(#fsa,#fsa-layer) .sm-spark.s1{--x:-14px;--y:-12px}:is(#fsa,#fsa-layer) .sm-spark.s2{--x:2px;--y:-17px;background:#FF8FB1}:is(#fsa,#fsa-layer) .sm-spark.s3{--x:15px;--y:-10px;background:#6FCFA1}
@keyframes smHop{0%{transform:none}18%{transform:scale(1.12,.86)}40%{transform:translateY(-7px) rotate(-12deg) scale(.95,1.08)}58%{transform:translateY(0) rotate(8deg) scale(1.08,.92)}74%{transform:rotate(-4deg)}100%{transform:none}}
@keyframes smWink{0%,30%{transform:none}42%,60%{transform:scaleY(.12)}72%,100%{transform:none}}
@keyframes smSpark{0%{opacity:0;transform:translate(-50%,-50%) scale(.3)}30%{opacity:1}100%{opacity:0;transform:translate(calc(-50% + var(--x)),calc(-50% + var(--y))) scale(1)}}
:is(#fsa,#fsa-layer) .fp-btn .icon{width:16px;height:16px}
:is(#fsa,#fsa-layer) .note-ic{color:var(--violet-text);display:inline-grid}
:is(#fsa,#fsa-layer) .note-ic .icon{width:20px;height:20px}
:is(#fsa,#fsa-layer) .note-txt{flex:1;min-width:0}
:is(#fsa,#fsa-layer) .note-txt b{color:var(--ink);font-weight:600}
:is(#fsa,#fsa-layer) .note .linkbtn{font-size:14px}
:is(#fsa,#fsa-layer) .note-x{width:28px;height:28px;color:var(--faint)}
:is(#fsa,#fsa-layer) .nowrap{white-space:nowrap}
:is(#fsa,#fsa-layer) .note-dl{width:32px;height:32px;color:var(--violet-text);flex:none}
:is(#fsa,#fsa-layer) .note-dl .icon{width:20px;height:20px}
:is(#fsa,#fsa-layer) .note-dl:hover{background:#EEE9FF}
:is(#fsa,#fsa-layer) .note-x .icon{width:18px;height:18px}
:is(#fsa,#fsa-layer) .pf{display:flex;flex-direction:column;min-height:360px}
:is(#fsa,#fsa-layer) .form-actions{margin-top:auto;padding-top:32px;display:flex;justify-content:flex-start}
:is(#fsa,#fsa-layer) .form-actions .btn{width:171px}
:is(#fsa,#fsa-layer) .ibtn.locked{color:#C9C9C9;cursor:default}
:is(#fsa,#fsa-layer) .ibtn.locked:hover{background:none}
:is(#fsa,#fsa-layer) .ibtn.ph{visibility:hidden}
:is(#fsa,#fsa-layer) .ibtn.ok-btn{color:var(--violet)}
:is(#fsa,#fsa-layer) tr.editing td{background:#F8F6FF!important;vertical-align:middle}
:is(#fsa,#fsa-layer) .tbl>tbody>tr.editing>td{padding-block:8px}
:is(#fsa,#fsa-layer) .ed-pair.stacked .ed{height:28px;flex:none}
:is(#fsa,#fsa-layer) .ed-pair{display:flex;gap:8px}
:is(#fsa,#fsa-layer) .ed-pair.stacked{flex-direction:column;gap:6px}
:is(#fsa,#fsa-layer) .ed{height:30px;width:100%;font-weight:400;border:1px solid #E3C8F5;border-radius:99px;background:#fff;padding:0 12px;font-size:15px;min-width:0;flex:1;transition:border-color .2s,box-shadow .2s}
:is(#fsa,#fsa-layer) .ed:focus{outline:none;border-color:var(--violet);box-shadow:0 0 0 3px rgba(91,63,255,.12)}
:is(#fsa,#fsa-layer) .ed-fonts .fp-btn{height:30px;border:1px solid #DCD6F7}
:is(#fsa,#fsa-layer) .lock-note{display:flex;align-items:center;gap:6px;font-size:13px;margin-top:12px}
/* "דומיינים": the edit-until note sits on the month line, at its far end; the history header follows the table */
/* order search: a rounded pill like the other fields */
:is(#fsa,#fsa-layer) .fld input#oq{border-radius:99px;padding:0 18px}
:is(#fsa,#fsa-layer) .sec-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
:is(#fsa,#fsa-layer) .sec-row .sec-note{margin-inline-start:auto;display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:400;color:var(--muted)}
:is(#fsa,#fsa-layer) .sec-row .sec-note .icon{width:16px;height:16px}
:is(#fsa,#fsa-layer) .sec-row + .tbl-wrap + .hist-toggle{margin-top:36px}
@media (max-width:760px){:is(#fsa,#fsa-layer) .sec-row .sec-note{order:3;flex-basis:100%;margin:0;font-size:13px}}
:is(#fsa,#fsa-layer) .lock-note .linkbtn{font-size:13px}
:is(#fsa,#fsa-layer) .lock-note.lock-end{justify-content:flex-end}
:is(#fsa,#fsa-layer) .h2-sec{font-size:18px;font-weight:700;margin:8px 0 12px;display:flex;align-items:baseline;gap:10px}
:is(#fsa,#fsa-layer) .hist-toggle{all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;margin-top:14px;padding:14px 0}
:is(#fsa,#fsa-layer) .hist-toggle .icon{width:20px;height:20px;color:var(--muted);transition:transform .6s var(--ease),color .3s var(--ease)}
:is(#fsa,#fsa-layer) .hist-toggle:hover .icon{color:var(--violet)}
:is(#fsa,#fsa-layer) .hist-toggle[aria-expanded="true"] .icon{transform:rotate(180deg);color:var(--violet)}
:is(#fsa,#fsa-layer) .hist-toggle:focus-visible{outline:2px solid var(--violet);outline-offset:4px}
:is(#fsa,#fsa-layer) .hist-body{display:grid;grid-template-rows:0fr;transition:grid-template-rows .6s var(--ease)}
:is(#fsa,#fsa-layer) .hist-body>div{overflow:hidden;min-height:0;opacity:0;transform:translateY(-6px);transition:opacity .35s ease,transform .5s var(--ease),padding-top .6s var(--ease)}
:is(#fsa,#fsa-layer) .hist-body.open{grid-template-rows:1fr}
:is(#fsa,#fsa-layer) .hist-body.open>div{padding-top:12px;opacity:1;transform:none;transition:opacity .5s ease .12s,transform .6s var(--ease) .08s,padding-top .6s var(--ease)}
:is(#fsa,#fsa-layer) .hist-scroll{max-height:440px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
:is(#fsa,#fsa-layer) .hist-scroll thead th{position:sticky;top:0;z-index:2}
:is(#fsa,#fsa-layer) .tbl td.hint{font-weight:400;font-size:15px;color:var(--muted)}
:is(#fsa,#fsa-layer) .tbl.reg-tbl thead th{background:var(--card);color:#333;border-bottom:1px solid var(--line);border-radius:0}
:is(#fsa,#fsa-layer) .tbl tr.mgroup td{position:sticky;top:44px;z-index:1;background:#fff;font-size:13px;font-weight:600!important;color:var(--violet);padding:14px 16px 6px;border-bottom:1px solid var(--line)}
:is(#fsa,#fsa-layer) .tbl>tbody>tr.mgroup>td,:is(#fsa,#fsa-layer) .tbl>tbody>tr.mgroup>td:first-child{color:var(--violet);background:var(--card);font-weight:600;border-bottom:0!important}
:is(#fsa,#fsa-layer) .lock-note .icon{width:14px;height:14px;color:var(--faint)}
:is(#fsa,#fsa-layer) .lic-form{grid-template-columns:repeat(2,minmax(0,1fr)) auto}
:is(#fsa,#fsa-layer) .fname{display:inline-flex;align-items:center;gap:6px;margin-inline-start:-38px}
:is(#fsa,#fsa-layer) .ibtn.exp{color:var(--muted)}
:is(#fsa,#fsa-layer) .ibtn.exp:hover,:is(#fsa,#fsa-layer) tr.is-open .ibtn.exp{color:var(--violet);background:#EEE9FF}
:is(#fsa,#fsa-layer) .exp-ph{display:inline-block;width:32px}
:is(#fsa,#fsa-layer) .sites{display:flex;flex-direction:column;gap:4px}
:is(#fsa,#fsa-layer) .sites-lbl{font-size:12px;color:var(--muted)}
@media (max-width:760px){:is(#fsa,#fsa-layer) .fname{margin:0}}
:is(#fsa,#fsa-layer) .dl-tbl .wcount{color:var(--muted);font-weight:300}
:is(#fsa,#fsa-layer) .ver{display:block;font-size:12px;font-weight:400;color:var(--violet);margin-top:2px;line-height:1.2}
:is(#fsa,#fsa-layer) .wsel{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:space-between;gap:8px;width:150px;height:32px;padding:0 12px;border:1px solid #D6D6D6;border-radius:8px;font-size:14px;transition:background-color .25s var(--ease),border-color .25s var(--ease)}
:is(#fsa,#fsa-layer) .wsel .wsel-s{display:none}
:is(#fsa,#fsa-layer) .wsel:hover,:is(#fsa,#fsa-layer) .pop.open .wsel{background:var(--soft);border-color:#BDBDBD}
:is(#fsa,#fsa-layer) .wsel:focus-visible{outline:2px solid var(--violet);outline-offset:2px}
:is(#fsa,#fsa-layer) .wsel .icon{width:16px;height:16px;transition:transform .3s var(--ease)}
:is(#fsa,#fsa-layer) .pop.open .wsel .icon{transform:rotate(180deg)}
:is(#fsa,#fsa-layer) .pop-menu.wsel-menu{min-width:100%;width:max-content;max-width:min(280px,90vw)}
:is(#fsa,#fsa-layer) .wsel-menu{max-height:min(300px,50vh);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
:is(#fsa,#fsa-layer) .pop-menu.wsel-menu button{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 10px}
:is(#fsa,#fsa-layer) .wsel-menu .icon{width:18px;height:18px;color:var(--violet-text)}
@media (min-width:761px){:is(#fsa,#fsa-layer) .dl-tbl td:nth-child(n+3),:is(#fsa,#fsa-layer) .dl-tbl th:nth-child(n+3){width:1%;white-space:nowrap}
  :is(#fsa,#fsa-layer) .dl-tbl td:first-child,:is(#fsa,#fsa-layer) .dl-tbl th:first-child{width:1%;white-space:nowrap;padding-inline-end:24px}
  :is(#fsa,#fsa-layer) .dl-tbl td:nth-child(n+3),:is(#fsa,#fsa-layer) .dl-tbl th:nth-child(n+3){padding-inline:12px}
  :is(#fsa,#fsa-layer) .dl-tbl td:nth-child(2){white-space:nowrap}}
@media (min-width:761px) and (max-width:1100px){:is(#fsa,#fsa-layer) .dl-tbl td:nth-child(2),:is(#fsa,#fsa-layer) .dl-tbl th:nth-child(2){display:none}:is(#fsa,#fsa-layer) .dl-tbl td:first-child,:is(#fsa,#fsa-layer) .dl-tbl th:first-child{width:auto}}
@media (min-width:761px) and (max-width:920px){:is(#fsa,#fsa-layer) .dl-tbl .dl{width:64px!important}:is(#fsa,#fsa-layer) .dl-tbl .btn-line{width:auto!important;padding:0 10px}:is(#fsa,#fsa-layer) .dl-tbl .btn-line .zl{display:none}:is(#fsa,#fsa-layer) .dl-tbl .wsel{width:96px!important}:is(#fsa,#fsa-layer) .dl-tbl .wsel .wsel-l{display:none}:is(#fsa,#fsa-layer) .dl-tbl .wsel .wsel-s{display:inline}:is(#fsa,#fsa-layer) .dl-tbl td:first-child,:is(#fsa,#fsa-layer) .dl-tbl th:first-child{padding-inline-end:16px}:is(#fsa,#fsa-layer) .dl-tbl th:nth-child(n+3){white-space:normal;line-height:1.25}}
@media (min-width:761px) and (max-width:1200px){:is(#fsa,#fsa-layer) .dl-tbl .dl,:is(#fsa,#fsa-layer) .dl-tbl .btn-line{width:104px}:is(#fsa,#fsa-layer) .dl-tbl .wsel{width:124px}:is(#fsa,#fsa-layer) .dl-tbl td,:is(#fsa,#fsa-layer) .dl-tbl th{padding-inline:10px}:is(#fsa,#fsa-layer) .dl-tbl td:first-child,:is(#fsa,#fsa-layer) .dl-tbl th:first-child{padding-inline-end:24px}}
:is(#fsa,#fsa-layer) .lic-wrap{overflow:visible}
:is(#fsa,#fsa-layer) .pop{position:relative;display:inline-flex}
:is(#fsa,#fsa-layer) .pop-menu{position:absolute;top:calc(100% + 6px);inset-inline-end:0;background:var(--card);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.14);padding:6px;min-width:190px;z-index:7;opacity:0;visibility:hidden;transform:translateY(-4px);transition:opacity .2s var(--ease),transform .25s var(--ease),visibility 0s linear .25s}
:is(#fsa,#fsa-layer) .pop.open .pop-menu{opacity:1;visibility:visible;transform:none;transition-delay:0s}
:is(#fsa,#fsa-layer) .pop-menu button{all:unset;box-sizing:border-box;display:block;width:100%;padding:9px 12px;border-radius:6px;font-size:15px;cursor:pointer;white-space:nowrap;text-align:start}
:is(#fsa,#fsa-layer) .pop-menu button:hover,:is(#fsa,#fsa-layer) .pop-menu button:focus-visible{background:var(--soft)}
:is(#fsa,#fsa-layer) .tbl .mini.lined thead th,:is(#fsa,#fsa-layer) .tbl .mini.lined thead th:first-child,:is(#fsa,#fsa-layer) .tbl .mini.lined thead th:last-child{background:none;height:auto;border-radius:0;padding:10px 14px;font-size:13px;font-weight:500;color:var(--muted);border-bottom:1px solid var(--line)}
:is(#fsa,#fsa-layer) .tbl .mini.lined tbody td,:is(#fsa,#fsa-layer) .tbl .mini.lined tbody tr:first-child td,:is(#fsa,#fsa-layer) .tbl .mini.lined tbody td:first-child{padding:13px 14px;font-weight:400;color:#2a2a2a;border-bottom:1px solid #F0F0F0;font-size:15px}
:is(#fsa,#fsa-layer) .tbl .mini.lined tbody tr:last-child td{border-bottom:0}
:is(#fsa,#fsa-layer) .lic-drawer{padding:4px 0 18px;animation:none}
:is(#fsa,#fsa-layer) .drawer.opening .lic-drawer{animation:drawerIn .5s var(--ease) both}
:is(#fsa,#fsa-layer) .drawer.closing .lic-drawer{animation:drawerOut .28s ease forwards}
:is(#fsa,#fsa-layer) .drawer .lic-drawer .box{animation:none}
:is(#fsa,#fsa-layer) .dom-box .form-row{margin-bottom:0}
:is(#fsa,#fsa-layer) .sub-reg{background:var(--bg);border-radius:10px;padding:22px 24px;transition:background-color .45s var(--ease),padding .45s var(--ease)}
:is(#fsa,#fsa-layer) .sub-reg{background:#FAF6FE;border:1px solid #F1E8FB;border-radius:20px;padding:16px 18px}
:is(#fsa,#fsa-layer) .reg-row{grid-template-columns:minmax(0,1fr) 220px auto;align-items:center;gap:12px}
:is(#fsa,#fsa-layer) .reg-row .reg-host{position:relative}
@media (min-width:761px) and (max-width:1100px){:is(#fsa,#fsa-layer) .reg-row{grid-template-columns:minmax(0,1fr) auto}:is(#fsa,#fsa-layer) .reg-row .reg-host{grid-column:1/-1}}
:is(#fsa,#fsa-layer) .reg-row .reg-host>.icon{position:absolute;inset-inline-start:16px;top:50%;transform:translateY(-50%);width:20px;height:20px;color:#9C59CF;pointer-events:none}
:is(#fsa,#fsa-layer) .reg-row .reg-host input{height:44px;border:1px solid #E3C8F5;border-radius:99px;padding:0 46px 0 18px;background:#fff}
:is(#fsa,#fsa-layer) .reg-row .reg-host input:not(:placeholder-shown){direction:ltr;text-align:right}
:is(#fsa,#fsa-layer) .reg-row .reg-host input::placeholder{color:#828F9D}
:is(#fsa,#fsa-layer) .reg-row .reg-host input:focus{outline:none;border-color:#B075FF;box-shadow:0 0 0 3px #EFE3FF}
:is(#fsa,#fsa-layer) .reg-row .fp-btn{height:44px;border:1px solid #E3C8F5;border-radius:99px;padding:0 18px;background:#fff;color:#828F9D}
:is(#fsa,#fsa-layer) .reg-row .fp-btn:has(+ .fp-menu input:checked){color:var(--ink)}
:is(#fsa,#fsa-layer) .reg-row .reg-add{height:42px;padding:0 24px;gap:8px}
:is(#fsa,#fsa-layer) .reg-row .reg-add .icon{width:20px;height:20px}
:is(#fsa,#fsa-layer) .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:is(#fsa,#fsa-layer) .reg-open{display:none}
:is(#fsa,#fsa-layer) .reg-head{display:none}
:is(#fsa,#fsa-layer) .head-act .btn>.icon{display:none}
:is(#fsa,#fsa-layer) .sec-add{display:none}
:is(#fsa,#fsa-layer) .reg-fold>div{min-height:0}
:is(#fsa,#fsa-layer) .dom-box .form-err{margin:10px 0 0}
:is(#fsa,#fsa-layer) .dom-box .quota-line{padding:0}
:is(#fsa,#fsa-layer) .mini.lined{margin-top:22px}
:is(#fsa,#fsa-layer) .mini.lined th{padding:10px 14px;border-bottom:1px solid var(--line)}
:is(#fsa,#fsa-layer) .mini.lined td{padding:13px 14px;border-bottom:1px solid #F0F0F0}
:is(#fsa,#fsa-layer) .mini.lined tr:last-child td{border-bottom:0}
:is(#fsa,#fsa-layer) .mini.lined tbody tr{transition:background-color .2s var(--ease)}
:is(#fsa,#fsa-layer) .mini.lined tbody tr:hover td{background:#FBFAFE}
:is(#fsa,#fsa-layer) .quota-line{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:4px 0 22px}
:is(#fsa,#fsa-layer) .quota-line .msg{flex:1;min-width:220px}
:is(#fsa,#fsa-layer) .quota-line .msg b{display:block;font-size:16px;font-weight:700}
:is(#fsa,#fsa-layer) .quota-line .msg span{font-size:14px;color:var(--muted)}
:is(#fsa,#fsa-layer) .linkbtn{all:unset;cursor:pointer;font-size:15px;font-weight:500;color:var(--violet);text-decoration:underline;text-underline-offset:3px}
@media (max-width:1000px){:is(#fsa,#fsa-layer) .main{padding:40px 24px}:is(#fsa,#fsa-layer) .qopts{grid-template-columns:1fr}}
@media (max-width:760px){
  :is(#fsa,#fsa-layer) .site-head .in{padding:0 16px;height:64px;gap:12px}
  :is(#fsa,#fsa-layer) .mainnav{display:none}
  :is(#fsa,#fsa-layer) .logo{font-size:25px}
  :is(#fsa,#fsa-layer) .me span{display:none} :is(#fsa,#fsa-layer) .me{padding:3px}
  :is(#fsa,#fsa-layer) .page{padding-block:18px 90px}
  :is(#fsa,#fsa-layer) .shell{grid-template-columns:minmax(0,1fr);grid-template-rows:auto 1fr;min-height:0;overflow:clip}
  :is(#fsa,#fsa-layer) .shell{border-start-start-radius:0;border-start-end-radius:0}
  :is(#fsa,#fsa-layer) .mini thead{display:none}
  :is(#fsa,#fsa-layer) .mini,:is(#fsa,#fsa-layer) .mini tbody,:is(#fsa,#fsa-layer) .mini tr,:is(#fsa,#fsa-layer) .mini td{display:block}
  :is(#fsa,#fsa-layer) .mini tbody tr{display:flex;flex-wrap:wrap;align-items:center;gap:2px 12px;padding:12px 0;border-bottom:1px solid var(--line)}
  :is(#fsa,#fsa-layer) .mini tbody td{padding:0!important;border:0!important}
  :is(#fsa,#fsa-layer) .mini tbody td:last-child{margin-inline-start:auto}
  :is(#fsa,#fsa-layer) .tbl tr.mgroup td{top:0;flex-basis:100%;padding:12px 0 4px!important}
  :is(#fsa,#fsa-layer) .tbl tbody tr.mgroup{border-bottom:0!important}
  :is(#fsa,#fsa-layer) .side .logout{margin:0;padding-inline:16px;height:50px;flex:none}
  :is(#fsa,#fsa-layer) .tbl thead{display:none}
  :is(#fsa,#fsa-layer) .tbl,:is(#fsa,#fsa-layer) .tbl tbody,:is(#fsa,#fsa-layer) .tbl tr,:is(#fsa,#fsa-layer) .tbl td{display:block}
  :is(#fsa,#fsa-layer) .tbl tbody tr:not(.drawer){display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;padding:14px 0;border-bottom:1px solid var(--line)}
  :is(#fsa,#fsa-layer) .tbl tbody td,:is(#fsa,#fsa-layer) .tbl tbody tr:first-child td{padding:0!important;font-size:15px}
  :is(#fsa,#fsa-layer) .tbl tbody td:first-child,:is(#fsa,#fsa-layer) .tbl tbody tr:first-child td:first-child{flex-basis:100%;font-size:17px}
  :is(#fsa,#fsa-layer) .tbl tbody td:last-child{margin-inline-start:auto}
  :is(#fsa,#fsa-layer) .tbl tbody tr:not(.drawer):hover td{background:none}
  :is(#fsa,#fsa-layer) .drawer .box{padding:16px}
  :is(#fsa,#fsa-layer) .dl{width:auto;display:inline-flex;gap:6px;padding:0 10px;font-size:13px;height:32px}
  :is(#fsa,#fsa-layer) .dl .dl-k{display:inline}
  :is(#fsa,#fsa-layer) .h1{font-size:23px}
  :is(#fsa,#fsa-layer) .side{flex-direction:row;align-self:start;overflow-x:auto;padding:0;border-inline-end:0;border-bottom:1px solid var(--line);position:sticky;top:calc(64px + env(safe-area-inset-top,0px));background:var(--card);z-index:5;scrollbar-width:none}
  :is(#fsa,#fsa-layer) .side button{margin:0;padding-inline:16px;height:50px;font-size:16px;flex:none}
  :is(#fsa,#fsa-layer) .side button[aria-current="page"]::after{inset-inline:0;top:auto;bottom:0;width:auto;height:3px}
  :is(#fsa,#fsa-layer) .side .sep{display:none}
  :is(#fsa,#fsa-layer) .main{padding:26px 16px}
  :is(#fsa,#fsa-layer) .grid3,:is(#fsa,#fsa-layer) .form-row{grid-template-columns:1fr}
  :is(#fsa,#fsa-layer) .plan .dates{margin-inline-start:0;gap:20px}
  :is(#fsa,#fsa-layer) .tbl thead th:first-child,:is(#fsa,#fsa-layer) .tbl tbody td:first-child{padding-inline-start:14px}
  :is(#fsa,#fsa-layer) .legend{left:16px;right:16px;justify-content:center}
  :is(#fsa,#fsa-layer) .cert-body{padding:16px}
  :is(#fsa,#fsa-layer) .tbl tbody tr:not(.drawer):has(> td > .acts){row-gap:6px}
  :is(#fsa,#fsa-layer) .tbl tbody tr:not(.drawer):has(> td > .acts)>td:first-child{flex:1 1 0;min-width:0}
  :is(#fsa,#fsa-layer) .tbl tbody tr:not(.drawer):has(> td > .acts)>td:not(:first-child){order:2}
  :is(#fsa,#fsa-layer) .tbl tbody tr:not(.drawer):has(> td > .acts)>td:last-child{order:1}
  :is(#fsa,#fsa-layer) .tbl tbody tr:not(.drawer):has(> td > .acts)::after{content:"";order:1;flex-basis:100%;height:0}
  :is(#fsa,#fsa-layer) .orow>td:nth-child(5){order:1!important;margin-inline-start:auto;font-weight:600;color:var(--ink)}
  :is(#fsa,#fsa-layer) .orow>td:last-child{margin-inline-start:0}
  :is(#fsa,#fsa-layer) .tbl .mini tbody td:first-child{flex-basis:auto;font-size:15px}
  :is(#fsa,#fsa-layer) .mini tbody tr:not(:has(.acts))>td:first-child{flex:1 1 0;min-width:0}
  :is(#fsa,#fsa-layer) .mini tbody tr:has(> td > .acts)>td:not(:last-child){order:2}
  :is(#fsa,#fsa-layer) .mini tbody tr:has(> td > .acts)>td:last-child{order:1}
  :is(#fsa,#fsa-layer) .mini tbody tr:has(> td > .acts)::after{content:"";order:1;flex-basis:100%;height:0}
  :is(#fsa,#fsa-layer) .mini tbody tr:has(> td > .acts)>td:first-child{order:0;flex:1 1 0;min-width:0}
}
@media (max-width:1000px){
  :is(#fsa,#fsa-layer) .plan>.plan-id{flex:1 1 0;min-width:0}
  :is(#fsa,#fsa-layer) .plan>.dates{margin-inline-start:auto;align-self:flex-start;flex-wrap:nowrap}
}
@media (max-width:760px){
  :is(#fsa,#fsa-layer) .plan{padding-inline-start:16px;column-gap:12px}
  :is(#fsa,#fsa-layer) .plan>img{width:40px;height:40px}
  :is(#fsa,#fsa-layer) .plan-tg{padding:4px 8px}
  :is(#fsa,#fsa-layer) .plan>.dates{position:absolute;top:12px;inset-inline-end:14px;margin:0}
  :is(#fsa,#fsa-layer) .plan>.plan-id>.name{padding-inline-end:78px;flex-direction:row;flex-wrap:wrap;align-items:center;column-gap:6px;row-gap:4px}
  :is(#fsa,#fsa-layer) .plan>.plan-id>.name>.chip{font-size:11px;padding:0 7px;height:18px;line-height:18px;gap:4px;background:#FFF3C4;color:#8A6400}
  :is(#fsa,#fsa-layer) .plan>.plan-id>.name>.chip::before{width:5px;height:5px}
  :is(#fsa,#fsa-layer) .dl-tbl tbody tr.zip-row>td:first-child{display:none}
  :is(#fsa,#fsa-layer) .dl-tbl.tbl tbody tr.zip-row>td:last-child:empty{display:block;flex:1 1 0}
  :is(#fsa,#fsa-layer) .sub-reg:not(.reg-on){border-color:transparent}
  :is(#fsa,#fsa-layer) .sub-reg .reg-row{grid-template-columns:1fr;gap:10px}
  :is(#fsa,#fsa-layer) .sub-reg .reg-row .reg-host input{font-size:14px;padding:0 42px 0 12px}
  :is(#fsa,#fsa-layer) .sub-reg .reg-row .reg-host>.icon{inset-inline-start:14px}
  :is(#fsa,#fsa-layer) .sub-reg .reg-row .reg-add{width:100%;justify-content:center}
  :is(#fsa,#fsa-layer) .sub-reg .reg-open{height:44px}
  :is(#fsa,#fsa-layer) .dom-tbl .acts{justify-content:flex-end}
  :is(#fsa,#fsa-layer) .dom-tbl .acts>.ibtn.ph{display:none}
  :is(#fsa,#fsa-layer) .hist-scroll{max-height:none;overflow:visible}
  :is(#fsa,#fsa-layer) .main .head-row{position:relative}
  :is(#fsa,#fsa-layer) .head-act{position:absolute;top:0;inset-inline-end:0}
  :is(#fsa,#fsa-layer) .head-act{display:none}
  :is(#fsa,#fsa-layer) .sec-row{align-items:center}
  :is(#fsa,#fsa-layer) .sec-row .sec-add{all:unset;cursor:pointer;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#EEE9FF;color:var(--violet);margin-inline-start:auto;flex:none;transition:background-color .25s var(--ease)}
  :is(#fsa,#fsa-layer) .sec-row .sec-add:hover,:is(#fsa,#fsa-layer) .sec-row .sec-add:active{background:#E2DAFF}
  :is(#fsa,#fsa-layer) .sec-row .sec-add:focus-visible{outline:2px solid var(--violet);outline-offset:2px}
  :is(#fsa,#fsa-layer) .sec-row .sec-add .icon{width:18px;height:18px}
  :is(#fsa,#fsa-layer) .head-row:has(.head-act) .h1{padding-inline-end:0;min-height:34px;display:flex;align-items:center}
}
@media (max-width:379px){:is(#fsa,#fsa-layer) .plan>.dates{position:static;flex-basis:100%;margin:6px 0 0}:is(#fsa,#fsa-layer) .plan>.plan-id>.name{padding-inline-end:0}}
@media (prefers-reduced-motion:reduce){:is(#fsa,#fsa-layer),:is(#fsa,#fsa-layer) *{animation:none!important;transition:none!important}}
:is(#fsa,#fsa-layer) .modal{z-index:100000}
:is(#fsa,#fsa-layer) .toast{z-index:100001}
:is(#fsa,#fsa-layer) .live-note{margin:0 4px 10px;font-size:12px;color:var(--muted)}
:is(#fsa,#fsa-layer) .empty{padding:30px 0;color:var(--muted)}
:is(#fsa,#fsa-layer) .dl-only-h{margin:36px 0 14px}
:is(#fsa,#fsa-layer) .offers{display:grid;grid-auto-rows:1fr;gap:14px;margin-top:26px}
:is(#fsa,#fsa-layer) .offer{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:20px;padding:20px 28px 20px 40px;border-radius:14px;background:var(--softer);overflow:hidden}
:is(#fsa,#fsa-layer) .offer::after{content:"";position:absolute;inset-inline-end:0;top:0;bottom:0;width:14px;background:var(--c-web)}
:is(#fsa,#fsa-layer) .offer-web{background:linear-gradient(90deg,#EEF3FF,#ECF8F2)}
:is(#fsa,#fsa-layer) .offer-extra{background:linear-gradient(90deg,#F1EDFF,#F6EEFF)}:is(#fsa,#fsa-layer) .offer-extra::after{background:var(--c-extra)}
:is(#fsa,#fsa-layer) .offer-desk{background:linear-gradient(90deg,#FFF0F3,#FFF5EF)}:is(#fsa,#fsa-layer) .offer-desk::after{background:var(--c-desk)}
:is(#fsa,#fsa-layer) .offer .of-line{font-size:14px;color:var(--muted);margin-top:1px}
:is(#fsa,#fsa-layer) .offer .of-id{display:flex;align-items:center;gap:14px;min-width:0}
:is(#fsa,#fsa-layer) .offer .of-id>img{width:52px;height:52px;flex:none}
:is(#fsa,#fsa-layer) .offer .of-name{font-size:19px;font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
:is(#fsa,#fsa-layer) .offer .of-top{font-size:12px;font-weight:700;color:var(--violet);background:#fff;border-radius:99px;padding:1px 10px}
:is(#fsa,#fsa-layer) .offer .of-uses{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
:is(#fsa,#fsa-layer) .offer .of-br{flex-basis:100%;height:0}
:is(#fsa,#fsa-layer) .offer .of-uses span{white-space:nowrap;font-size:13px;background:rgba(255,255,255,.75);border-radius:99px;padding:1px 10px;color:var(--ink)}
:is(#fsa,#fsa-layer) .offer .of-price{display:flex;flex-direction:column;line-height:1.3;white-space:nowrap;min-width:150px}
:is(#fsa,#fsa-layer) .offer .of-price b{font-size:22px;font-weight:700}
:is(#fsa,#fsa-layer) .offer .of-price span{font-size:14px;color:var(--muted)}
:is(#fsa,#fsa-layer) .offer .of-price small{font-size:13px;color:var(--muted);margin-top:2px}
:is(#fsa,#fsa-layer) .offer .of-cta{border-radius:99px;height:44px;padding:0 26px;min-width:150px;text-decoration:none}
:is(#fsa,#fsa-layer) .offer .of-cta.btn-line{background:#fff;border:1px solid var(--ink);color:var(--ink)}
:is(#fsa,#fsa-layer) .cmp{margin-top:56px}
:is(#fsa,#fsa-layer) .cmp h2{font-size:24px;font-weight:700;margin:0;padding-bottom:16px;border-bottom:1px solid var(--ink)}
:is(#fsa,#fsa-layer) .cmp table{width:100%;border-collapse:collapse;font-size:14px;position:relative;z-index:1;table-layout:fixed}
:is(#fsa,#fsa-layer) .cmp th{font-size:19px;font-weight:700;padding:30px 10px 22px;text-align:center;white-space:nowrap;width:20%;background:none;border:0;color:var(--ink)}
:is(#fsa,#fsa-layer) .cmp th:first-child{width:auto}
:is(#fsa,#fsa-layer) .cmp th img{width:auto;height:20px;vertical-align:-4px;margin-inline-start:6px;display:inline}
:is(#fsa,#fsa-layer) .cmp th:first-child,:is(#fsa,#fsa-layer) .cmp td:first-child{text-align:start}
:is(#fsa,#fsa-layer) .cmp td{padding:14px 10px;text-align:center;font-size:14px;color:var(--ink);border:0;background:none}
:is(#fsa,#fsa-layer) .cmp td:first-child b{font-weight:700}
:is(#fsa,#fsa-layer) .cmp tr.grp td{font-weight:700;font-size:16px;padding:34px 10px 12px}
:is(#fsa,#fsa-layer) .cmp tr.grp td:first-child,:is(#fsa,#fsa-layer) .cmp tbody tr:not(.grp) td:first-child{padding-inline-start:0}
:is(#fsa,#fsa-layer) .cmp tbody tr.grp:not(:first-child) td{border-top:1px solid #555}
:is(#fsa,#fsa-layer) .cmp tr.grp + tr td{padding-top:18px}
:is(#fsa,#fsa-layer) .cmp tr:has(+ tr.grp) td{padding-bottom:26px}
:is(#fsa,#fsa-layer) .cmp-in{position:relative;overflow:visible}
:is(#fsa,#fsa-layer) .cmp .web-col{position:absolute;top:0;bottom:0;left:20%;width:20%;background:#FAFAFA;border-radius:0 0 999px 999px;z-index:0}
:is(#fsa,#fsa-layer) .cmp tr.cmp-end td{height:30px;padding:0}
:is(#fsa,#fsa-layer) .cmp .yes,:is(#fsa,#fsa-layer) .cmp .no{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:50%;vertical-align:middle}
:is(#fsa,#fsa-layer) .cmp .yes{background:#EBDDF9;color:var(--ink)}
:is(#fsa,#fsa-layer) .cmp .no{background:#D9D1D1;color:#fff}
:is(#fsa,#fsa-layer) .cmp .yes svg,:is(#fsa,#fsa-layer) .cmp .no svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
:is(#fsa,#fsa-layer) .cmp .cpill{display:inline-block;background:#F3E3F8;border-radius:99px;padding:4px 11px;font-size:13px;font-weight:500;white-space:nowrap}
@media (max-width:760px){
:is(#fsa,#fsa-layer) .cmp table,:is(#fsa,#fsa-layer) .cmp thead,:is(#fsa,#fsa-layer) .cmp tbody{display:block}
:is(#fsa,#fsa-layer) .cmp tr{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
:is(#fsa,#fsa-layer) .cmp th:first-child{display:none}
:is(#fsa,#fsa-layer) .cmp th{width:auto;font-size:15px;padding:16px 4px 10px;white-space:normal}
:is(#fsa,#fsa-layer) .cmp th img{height:15px}
:is(#fsa,#fsa-layer) .cmp td{padding:8px 4px}
:is(#fsa,#fsa-layer) .cmp td:first-child{grid-column:1/-1;padding:14px 0 6px!important;font-size:14px}
:is(#fsa,#fsa-layer) .cmp tr.grp td:not(:first-child),:is(#fsa,#fsa-layer) .cmp tr.cmp-end td:not(:first-child){display:none}
:is(#fsa,#fsa-layer) .cmp tr.grp td:first-child{padding-top:24px!important}
:is(#fsa,#fsa-layer) .cmp tr:has(+ tr.grp) td:not(:first-child){padding-bottom:20px}
:is(#fsa,#fsa-layer) .cmp .cpill{font-size:12px;padding:3px 8px;white-space:normal;line-height:1.3}
:is(#fsa,#fsa-layer) .cmp table{table-layout:auto}
:is(#fsa,#fsa-layer) .cmp .web-col{left:33.333%;width:33.334%}}
:is(#fsa,#fsa-layer) .of-more{display:inline-block;margin-top:18px;font-size:15px;color:var(--violet);text-decoration:underline;text-underline-offset:3px}
@media (max-width:900px){:is(#fsa,#fsa-layer) .offer{grid-template-columns:minmax(0,1fr) auto;padding:18px 20px 18px 34px}:is(#fsa,#fsa-layer) .offer .of-cta{grid-column:1/-1;width:100%}}
@media (max-width:560px){:is(#fsa,#fsa-layer) .offer .of-br{display:none}:is(#fsa,#fsa-layer) .offer .of-id{align-items:flex-start;gap:10px}:is(#fsa,#fsa-layer) .offer .of-id>div{flex:1;min-width:0}:is(#fsa,#fsa-layer) .offer .of-id>img{width:40px;height:40px}}
@media (max-width:420px){:is(#fsa,#fsa-layer) .offer{grid-template-columns:minmax(0,1fr)}}
:is(#fsa,#fsa-layer) .lic-empty{display:flex;align-items:center;gap:40px;margin-top:28px;padding:32px 40px;background:#FAF6FE;border:1px solid #F1E8FB;border-radius:20px}
:is(#fsa,#fsa-layer) .lic-empty .le-art{flex:none;width:260px;height:auto;display:block}
:is(#fsa,#fsa-layer) .lic-empty .le-sp{transform-box:fill-box;transform-origin:center;animation:leTw 3.2s ease-in-out infinite}
@keyframes leTw{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.7)}}
:is(#fsa,#fsa-layer) .lic-empty .le-txt{max-width:420px}
:is(#fsa,#fsa-layer) .lic-empty .le-t{font-size:25px;font-weight:700;line-height:1.3;margin:0 0 8px;color:var(--ink)}
:is(#fsa,#fsa-layer) .lic-empty .le-p{font-size:16px;color:var(--muted);margin:0 0 22px}
:is(#fsa,#fsa-layer) .lic-empty .le-acts{display:flex;align-items:center;flex-wrap:wrap;gap:12px 22px}
:is(#fsa,#fsa-layer) .lic-empty .le-cta{border-radius:99px;height:44px;padding:0 28px;text-decoration:none}
:is(#fsa,#fsa-layer) .lic-empty .le-cta:hover{filter:brightness(.97)}
:is(#fsa,#fsa-layer) .lic-empty .le-link{font-size:15px;color:var(--violet);text-decoration:underline;text-underline-offset:3px}
@media (max-width:760px){:is(#fsa,#fsa-layer) .lic-empty{flex-direction:column;text-align:center;gap:18px;margin-top:20px;padding:24px 18px}
:is(#fsa,#fsa-layer) .lic-empty .le-art{width:min(220px,100%)}
:is(#fsa,#fsa-layer) .lic-empty .le-t{font-size:22px}
:is(#fsa,#fsa-layer) .lic-empty .le-acts{flex-direction:column;gap:14px}
:is(#fsa,#fsa-layer) .lic-empty .le-cta{width:100%}}
@media (max-width:760px){:is(#fsa,#fsa-layer) .side{top:0}}
.fsa-v2 .page-header,.fsa-v2 .entry-title{display:none}
html body.fsa-v2{overflow-x:clip}
:is(#fsa,#fsa-layer) .pop-menu a{display:block;width:100%;padding:9px 12px;border-radius:6px;font-size:15px;cursor:pointer;white-space:nowrap;text-align:start}
:is(#fsa,#fsa-layer) .pop-menu a:hover,:is(#fsa,#fsa-layer) .pop-menu a:focus-visible{background:var(--soft)}
#fsa-layer{width:auto;height:0;margin:0;padding:0;background:none;position:static}
@media print{html.fsa-print body>*:not(#fsa-layer){display:none!important}html.fsa-print #fsa-layer>*:not(#certModal){display:none!important}
 html.fsa-print #certModal{position:static!important;display:block!important;background:none!important;opacity:1!important}html.fsa-print #certModal .sheet{position:static!important;transform:none!important;box-shadow:none!important;max-height:none!important;overflow:visible!important;width:auto!important}
 html.fsa-print #certModal .sheet-bar{display:none!important}html.fsa-print body{background:#fff!important}}
:is(#fsa,#fsa-layer) .wcell{position:relative;display:block;max-width:180px;outline:none}
:is(#fsa,#fsa-layer) .wlist{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
:is(#fsa,#fsa-layer) .wcell.trunc{cursor:help}
:is(#fsa,#fsa-layer) .wtip{display:none;position:absolute;top:calc(100% + 6px);inset-inline-start:0;z-index:8;background:var(--card);box-shadow:0 8px 28px rgba(0,0,0,.14);border-radius:10px;padding:10px 14px;font-size:14px;line-height:1.8;white-space:nowrap}
:is(#fsa,#fsa-layer) .wcell.trunc:hover .wtip,:is(#fsa,#fsa-layer) .wcell.trunc:focus .wtip{display:block}
@media (max-width:760px){:is(#fsa,#fsa-layer) .wcell{max-width:min(180px,55vw)}}
:is(#fsa,#fsa-layer) .tbl tbody tr td.hint{font-weight:400;font-size:15px;color:var(--muted)}
:is(#fsa,#fsa-layer) .pop.up .pop-menu{top:auto;bottom:calc(100% + 6px)}
:is(#fsa,#fsa-layer) .wsel-menu .wrow{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:6px 6px 6px 4px;border-radius:6px}
:is(#fsa,#fsa-layer) .wsel-menu .wrow+.wrow{border-top:1px solid #F0F0F0}
:is(#fsa,#fsa-layer) .wsel-menu .wn{font-size:15px;white-space:nowrap}
:is(#fsa,#fsa-layer) .wsel-menu .wl{display:flex;gap:6px}
:is(#fsa,#fsa-layer) .wsel-menu a.wdl{display:inline-flex;align-items:center;gap:4px;width:auto;height:28px;padding:0 8px;border:1px solid #D6D6D6;border-radius:6px;font-size:13px;white-space:nowrap}
:is(#fsa,#fsa-layer) .wsel-menu a.wdl:hover,:is(#fsa,#fsa-layer) .wsel-menu a.wdl:focus-visible{background:var(--soft);border-color:#BDBDBD}
:is(#fsa,#fsa-layer) .wsel-menu a.wdl .icon{width:15px;height:15px}
:is(#fsa,#fsa-layer) .pop-menu.wsel-menu{max-width:min(340px,92vw)}
FSACSS;
	$html = <<<'FSAHTML'
<div id="fsa"><main class="page">
  <p class="hello x-new" data-new="ברכה עדינה"><span id="greet">ערב טוב</span>, <b id="fsaName"></b> <span class="smiley" aria-hidden="true"><svg viewBox="0 0 24 24"><g class="sm-face"><circle class="sm-ring" cx="12" cy="12" r="10"/><ellipse class="sm-cheek" cx="7.2" cy="14" rx="1.6" ry="1"/><ellipse class="sm-cheek" cx="16.8" cy="14" rx="1.6" ry="1"/><ellipse class="sm-eye sm-eye-l" cx="9" cy="10.2" rx=".75" ry="1.2"/><ellipse class="sm-eye sm-eye-r" cx="15" cy="10.2" rx=".75" ry="1.2"/><path class="sm-mouth" d="M9 15.4c.85.63 1.88 1 3 1s2.15-.37 3-1"/><path class="sm-grin" d="M8 14h8c0 2.4-1.8 4-4 4s-4-1.6-4-4Z"/></g></svg><i class="sm-spark s1"></i><i class="sm-spark s2"></i><i class="sm-spark s3"></i></span></p>
<p class="live-note" id="fsaNote">תצוגה מקדימה של האזור האישי החדש · גלוי רק למנהלים · דומיינים ותעודות יחוברו בשלב הבא</p>
  <div class="shell">
    <nav class="side" aria-label="אזור אישי">
      <button data-view="subs">המינוי שלי</button>
      <button data-view="lic">פונטים שלי</button>
      <button data-view="dom">דומיינים</button>
      <button data-view="orders">הזמנות</button>
      <button data-view="profile">פרופיל</button>
      <span class="sep"></span>
      <button class="logout" id="logout"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M9 7c.01-2.18.11-3.35.88-4.12C10.76 2 12.17 2 15 2h1c2.83 0 4.24 0 5.12.88C22 3.76 22 5.17 22 8v8c0 2.83 0 4.24-.88 5.12C20.24 22 18.83 22 16 22h-1c-2.83 0-4.24 0-5.12-.88C9.11 20.35 9.01 19.18 9 17" opacity=".5"/><path stroke-linejoin="round" d="M15 12H2m3.5 3L2 12l3.5-3"/></g></svg>התנתק/י</button>
    </nav>
    <section class="main" id="view"></section>
  </div>
</main></div>
<div id="fsa-layer">
<div class="modal" id="certModal" hidden role="dialog" aria-modal="true" aria-label="תעודת רישיון">
  <div class="sheet">
    <div class="sheet-bar"><b>תעודת רישיון</b><div style="display:flex;gap:8px"><button class="btn btn-grad" style="height:34px" id="certPdf">הורדת PDF</button><button class="ibtn" id="certClose" aria-label="סגירה"><i data-ic="close"></i></button></div></div>
    <div id="certBody"></div>
  </div>
</div>
<div class="cart" id="cart" hidden role="dialog" aria-modal="true" aria-labelledby="cartTitle">
  <div class="cart-sheet">
    <div class="cart-head"><b id="cartTitle">העגלה שלך</b><button class="ibtn" id="cartClose" aria-label="סגירה"><i data-ic="close"></i></button></div>
    <div id="cartBody" class="cart-body"></div>
  </div>
</div>
<div class="toast" id="toast" role="status"></div></div>
FSAHTML;
	$js   = <<<'FSAJS'
(function(){
/* overlays (certificate, cart, messages) go straight under <body>: theme wrappers with transform would trap position:fixed */
{const L=document.getElementById('fsa-layer');if(L&&L.parentElement!==document.body)document.body.appendChild(L)}

const $=s=>document.querySelector(s);
const ICON={
  plus:'<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  edit:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M4 22H20" opacity=".5"/><path d="M14.6296 2.92142L13.8881 3.66293L7.07106 10.4799C6.60933 10.9416 6.37846 11.1725 6.17992 11.4271C5.94571 11.7273 5.74491 12.0522 5.58107 12.396C5.44219 12.6874 5.33894 12.9972 5.13245 13.6167L4.25745 16.2417L4.04356 16.8833C3.94194 17.1882 4.02128 17.5243 4.2485 17.7515C4.47573 17.9787 4.81182 18.0581 5.11667 17.9564L5.75834 17.7426L8.38334 16.8675L8.3834 16.8675C9.00284 16.6611 9.31256 16.5578 9.60398 16.4189C9.94775 16.2551 10.2727 16.0543 10.5729 15.8201C10.8275 15.6215 11.0583 15.3907 11.5201 14.929L11.5201 14.9289L18.3371 8.11195L19.0786 7.37044C20.3071 6.14188 20.3071 4.14999 19.0786 2.92142C17.85 1.69286 15.8581 1.69286 14.6296 2.92142Z"/><path d="M13.8879 3.66406C13.8879 3.66406 13.9806 5.23976 15.3709 6.63008C16.7613 8.0204 18.337 8.11308 18.337 8.11308M5.75821 17.7437L4.25732 16.2428" opacity=".5"/></g></svg>',
  lock:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M2 16C2 13.1716 2 11.7574 2.87868 10.8787C3.75736 10 5.17157 10 8 10H16C18.8284 10 20.2426 10 21.1213 10.8787C22 11.7574 22 13.1716 22 16C22 18.8284 22 20.2426 21.1213 21.1213C20.2426 22 18.8284 22 16 22H8C5.17157 22 3.75736 22 2.87868 21.1213C2 20.2426 2 18.8284 2 16Z"/><path d="M12 14V18" opacity=".5"/><path d="M6 10V8C6 4.68629 8.68629 2 12 2C15.3137 2 18 4.68629 18 8V10" opacity=".5"/></g></svg>',
  ok:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M4 12.9L7.14286 16.5L15 7.5" opacity=".5"/><path d="M20.0002 7.5625L11.4286 16.5625L11.0002 16"/></g></svg>',  dl:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M3 15C3 17.8284 3 19.2426 3.87868 20.1213C4.75736 21 6.17157 21 9 21H15C17.8284 21 19.2426 21 20.1213 20.1213C21 19.2426 21 17.8284 21 15" opacity=".5"/><path d="M12 3V16M8 11.625L12 16L16 11.625"/></g></svg>',
  eye:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M3.27489 15.2957C2.42496 14.1915 2 13.6394 2 12C2 10.3606 2.42496 9.80853 3.27489 8.70433C4.97196 6.49956 7.81811 4 12 4C16.1819 4 19.028 6.49956 20.7251 8.70433C21.575 9.80853 22 10.3606 22 12C22 13.6394 21.575 14.1915 20.7251 15.2957C19.028 17.5004 16.1819 20 12 20C7.81811 20 4.97196 17.5004 3.27489 15.2957Z" opacity=".5"/><path d="M15 12C15 13.6569 13.6569 15 12 15C10.3431 15 9 13.6569 9 12C9 10.3431 10.3431 9 12 9C13.6569 9 15 10.3431 15 12Z"/></g></svg>',
  doc:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M16.755 2H7.24502C6.08614 2 5.50671 2 5.03939 2.16261C4.15322 2.47096 3.45748 3.18719 3.15795 4.09946C3 4.58055 3 5.17705 3 6.37006V20.3742C3 21.2324 3.985 21.6878 4.6081 21.1176C4.97417 20.7826 5.52583 20.7826 5.8919 21.1176L6.375 21.5597C7.01659 22.1468 7.98341 22.1468 8.625 21.5597C9.26659 20.9726 10.2334 20.9726 10.875 21.5597C11.5166 22.1468 12.4834 22.1468 13.125 21.5597C13.7666 20.9726 14.7334 20.9726 15.375 21.5597C16.0166 22.1468 16.9834 22.1468 17.625 21.5597L18.1081 21.1176C18.4742 20.7826 19.0258 20.7826 19.3919 21.1176C20.015 21.6878 21 21.2324 21 20.3742V6.37006C21 5.17705 21 4.58055 20.842 4.09946C20.5425 3.18719 19.8468 2.47096 18.9606 2.16261C18.4933 2 17.9139 2 16.755 2Z" opacity=".5"/><path d="M10.5 11L17 11"/><path d="M7 11H7.5"/><path d="M7 7.5H7.5"/><path d="M7 14.5H7.5"/><path d="M10.5 7.5H17"/><path d="M10.5 14.5H17"/></g></svg>',
  trash:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M9.17065 4C9.58249 2.83481 10.6937 2 11.9999 2C13.3062 2 14.4174 2.83481 14.8292 4" opacity=".5"/><path d="M20.5001 6H3.5"/><path d="M18.8334 8.5L18.3735 15.3991C18.1965 18.054 18.108 19.3815 17.243 20.1907C16.378 21 15.0476 21 12.3868 21H11.6134C8.9526 21 7.6222 21 6.75719 20.1907C5.89218 19.3815 5.80368 18.054 5.62669 15.3991L5.16675 8.5"/><path d="M9.5 11L10 16" opacity=".5"/><path d="M14.5 11L14 16" opacity=".5"/></g></svg>',
  cart:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M7.5 18C8.32843 18 9 18.6716 9 19.5C9 20.3284 8.32843 21 7.5 21C6.67157 21 6 20.3284 6 19.5C6 18.6716 6.67157 18 7.5 18Z" opacity=".5"/><path d="M16.5 18.0001C17.3284 18.0001 18 18.6716 18 19.5001C18 20.3285 17.3284 21.0001 16.5 21.0001C15.6716 21.0001 15 20.3285 15 19.5001C15 18.6716 15.6716 18.0001 16.5 18.0001Z" opacity=".5"/><path d="M2 3L2.26121 3.09184C3.5628 3.54945 4.2136 3.77826 4.58584 4.32298C4.95808 4.86771 4.95808 5.59126 4.95808 7.03836V9.76C4.95808 12.7016 5.02132 13.6723 5.88772 14.5862C6.75412 15.5 8.14857 15.5 10.9375 15.5H16.2404C17.8014 15.5 18.5819 15.5 19.1336 15.0504C19.6853 14.6008 19.8429 13.8364 20.158 12.3075L20.6578 9.88275C21.0049 8.14369 21.1784 7.27417 20.7345 6.69708C20.2906 6.12 18.7738 6.12 17.0888 6.12H4.95808"/></g></svg>',
  check:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><circle cx="12" cy="12" r="10" opacity=".5"/><path stroke-linejoin="round" d="M8.5 12.5L10.5 14.5L15.5 9.5"/></g></svg>',
  cert:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M7 17.9983C4.82497 17.9862 3.64706 17.8897 2.87868 17.1213C2 16.2426 2 14.8284 2 12L2 8C2 5.17157 2 3.75736 2.87868 2.87868C3.75736 2 5.17157 2 8 2L16 2C18.8284 2 20.2426 2 21.1213 2.87868C22 3.75736 22 5.17157 22 8V12C22 14.8284 22 16.2426 21.1213 17.1213C20.3915 17.8512 19.2921 17.9748 17.3197 17.9957L16.5 17.9983" opacity=".5"/><path d="M9 6L15 6" opacity=".5"/><path d="M7 9.5H17" opacity=".5"/><path d="M10.8907 13.9454C11.53 13.4007 12.4702 13.4007 13.1094 13.9454C13.3833 14.1789 13.7239 14.32 14.0827 14.3486C14.9199 14.4154 15.5847 15.0802 15.6515 15.9174C15.6802 16.2762 15.8212 16.6168 16.0547 16.8907C16.5994 17.53 16.5994 18.4702 16.0547 19.1094C15.8212 19.3833 15.6802 19.7239 15.6515 20.0827C15.5847 20.9199 14.9199 21.5847 14.0827 21.6515C13.7239 21.6802 13.3833 21.8212 13.1094 22.0547C12.4702 22.5994 11.53 22.5994 10.8907 22.0547C10.6168 21.8212 10.2762 21.6802 9.91743 21.6515C9.08021 21.5847 8.41539 20.9199 8.34858 20.0827C8.31995 19.7239 8.17888 19.3833 7.94543 19.1094C7.40068 18.4702 7.40068 17.53 7.94543 16.8907C8.17888 16.6168 8.31995 16.2762 8.34858 15.9174C8.4154 15.0802 9.08021 14.4154 9.91743 14.3486C10.2762 14.32 10.6168 14.1789 10.8907 13.9454Z"/><path stroke-linejoin="round" d="M10.5 18.2L11.3571 19L13.5 17"/></g></svg>',
  search:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><mask id="SVGcfiNQVot"><g fill="none" stroke-width="1.5"><circle cx="11.5" cy="11.5" r="9.5" stroke="gray"/><path stroke="#fff" stroke-linecap="round" d="M18.5 18.5L22 22"/></g></mask></defs><path fill="currentColor" d="M0 0h24v24H0z" mask="url(#SVGcfiNQVot)"/></svg>',
  spark:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M8.03339 3.65784C8.37932 2.78072 9.62068 2.78072 9.96661 3.65785L11.0386 6.37599C11.1442 6.64378 11.3562 6.85576 11.624 6.96137L14.3422 8.03339C15.2193 8.37932 15.2193 9.62068 14.3422 9.96661L11.624 11.0386C11.3562 11.1442 11.1442 11.3562 11.0386 11.624L9.96661 14.3422C9.62067 15.2193 8.37932 15.2193 8.03339 14.3422L6.96137 11.624C6.85575 11.3562 6.64378 11.1442 6.37599 11.0386L3.65784 9.96661C2.78072 9.62067 2.78072 8.37932 3.65785 8.03339L6.37599 6.96137C6.64378 6.85575 6.85576 6.64378 6.96137 6.37599L8.03339 3.65784Z"/><path d="M16.4885 13.3481C16.6715 12.884 17.3285 12.884 17.5115 13.3481L18.3121 15.3781C18.368 15.5198 18.4802 15.632 18.6219 15.6879L20.6519 16.4885C21.116 16.6715 21.116 17.3285 20.6519 17.5115L18.6219 18.3121C18.4802 18.368 18.368 18.4802 18.3121 18.6219L17.5115 20.6519C17.3285 21.116 16.6715 21.116 16.4885 20.6519L15.6879 18.6219C15.632 18.4802 15.5198 18.368 15.3781 18.3121L13.3481 17.5115C12.884 17.3285 12.884 16.6715 13.3481 16.4885L15.3781 15.6879C15.5198 15.632 15.632 15.5198 15.6879 15.3781L16.4885 13.3481Z" opacity=".5"/></g></svg>',
  smile:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round"><circle cx="12" cy="12" r="10" stroke-width="1.5" opacity=".5"/><path stroke-width="1.5" d="M9 16C9.85038 16.6303 10.8846 17 12 17C13.1154 17 14.1496 16.6303 15 16"/><path d="M15.5 10.5C15.5 11.0523 15.2761 11.5 15 11.5C14.7239 11.5 14.5 11.0523 14.5 10.5C14.5 9.94772 14.7239 9.5 15 9.5C15.2761 9.5 15.5 9.94772 15.5 10.5Z"/><ellipse cx="9" cy="10.5" rx=".5" ry="1"/></g></svg>',
  chev:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M19 9L12 15L5 9" opacity=".5"/><path d="M8.5 12L12 15L19 9"/></g></svg>',
  close:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M17 7L7 17M7 7l10 10"/></g></svg>',
  globe:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M2 12H22M16 12C16 13.3132 15.8965 14.6136 15.6955 15.8268C15.4945 17.0401 15.1999 18.1425 14.8284 19.0711C14.457 19.9997 14.016 20.7362 13.5307 21.2388C13.0454 21.7413 12.5253 22 12 22C11.4747 22 10.9546 21.7413 10.4693 21.2388C9.98396 20.7362 9.54301 19.9997 9.17157 19.0711C8.80014 18.1425 8.5055 17.0401 8.30448 15.8268C8.10346 14.6136 8 13.3132 8 12C8 10.6868 8.10346 9.38642 8.30448 8.17316C8.5055 6.95991 8.80014 5.85752 9.17157 4.92893C9.54301 4.00035 9.98396 3.26375 10.4693 2.7612C10.9546 2.25866 11.4747 2 12 2C12.5253 2 13.0454 2.25866 13.5307 2.76121C14.016 3.26375 14.457 4.00035 14.8284 4.92893C15.1999 5.85752 15.4945 6.95991 15.6955 8.17317C15.8965 9.38642 16 10.6868 16 12Z" opacity=".5"/><path d="M22 12C22 13.3132 21.7413 14.6136 21.2388 15.8268C20.7362 17.0401 19.9997 18.1425 19.0711 19.0711C18.1425 19.9997 17.0401 20.7362 15.8268 21.2388C14.6136 21.7413 13.3132 22 12 22C10.6868 22 9.38642 21.7413 8.17317 21.2388C6.95991 20.7362 5.85752 19.9997 4.92893 19.0711C4.00035 18.1425 3.26375 17.0401 2.7612 15.8268C2.25866 14.6136 2 13.3132 2 12C2 10.6868 2.25866 9.38642 2.76121 8.17316C3.26375 6.95991 4.00035 5.85752 4.92893 4.92893C5.85752 4.00035 6.95991 3.26375 8.17317 2.7612C9.38642 2.25866 10.6868 2 12 2C13.3132 2 14.6136 2.25866 15.8268 2.76121C17.0401 3.26375 18.1425 4.00035 19.0711 4.92893C19.9997 5.85752 20.7362 6.95991 21.2388 8.17317C21.7413 9.38642 22 10.6868 22 12L22 12Z"/></g></svg>',
  user:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><circle cx="12" cy="6" r="4"/><ellipse cx="12" cy="17" opacity=".5" rx="7" ry="4"/></g></svg>',
  card:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M2 12C2 8.22876 2 6.34315 3.17157 5.17157C4.34315 4 6.22876 4 10 4H14C17.7712 4 19.6569 4 20.8284 5.17157C22 6.34315 22 8.22876 22 12C22 15.7712 22 17.6569 20.8284 18.8284C19.6569 20 17.7712 20 14 20H10C6.22876 20 4.34315 20 3.17157 18.8284C2 17.6569 2 15.7712 2 12Z"/><path d="M10 16H6" opacity=".5"/><path d="M14 16H12.5" opacity=".5"/><path d="M2 10L22 10" opacity=".5"/></g></svg>',
  crown:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M5 17.5H19" opacity=".5"/><path d="M19.9823 10.4999L20 10.5C20.8284 10.5 21.5 9.82843 21.5 9C21.5 8.17157 20.8284 7.5 20 7.5C19.1716 7.5 18.5 8.17157 18.5 9C18.5 9.37466 18.6374 9.71724 18.8645 9.98013C19.1359 10.2944 19.5357 10.4947 19.9823 10.4999Z"/><path d="M19.9823 10.5C20.033 10.8784 19.9684 11.479 19.8706 12.3885L19.6872 14.0932C19.3851 16.902 19.234 19.3064 18.2879 20.1533C17.3418 21.0001 15.9239 21.0001 13.0879 21.0001H10.9121C8.07613 21.0001 6.65817 21.0001 5.71208 20.1533C4.76598 19.3064 4.61492 16.902 4.3128 14.0932L4.12945 12.3885C4.03162 11.479 3.96702 10.8784 4.01771 10.5"/><path d="M4 10.5L4.01771 10.4999C4.46434 10.4947 4.86406 10.2944 5.13553 9.98012C5.36264 9.71724 5.5 9.37466 5.5 9C5.5 8.17157 4.82843 7.5 4 7.5C3.17157 7.5 2.5 8.17157 2.5 9C2.5 9.82843 3.17157 10.5 4 10.5Z"/><path d="M11.0925 6.78271C10.9345 7.03566 10.7592 7.34991 10.5498 7.72547L8.76027 10.934C8.42077 11.5427 8.25102 11.8471 7.99642 11.9592C7.85535 12.0213 7.69969 12.0431 7.54691 12.0219C7.27118 11.9838 7.02403 11.7376 6.52971 11.2452C5.88806 10.6061 5.46178 10.1814 5.13574 9.98019"/><path d="M11.0923 6.78265C11.3647 6.92163 11.6732 7 12 7C12.3268 7 12.6353 6.92163 12.9077 6.78265C13.556 6.45187 14 5.77778 14 5C14 3.89543 13.1046 3 12 3C10.8954 3 10 3.89543 10 5C10 5.77778 10.444 6.45187 11.0923 6.78265Z"/><path d="M12.9077 6.78271C13.0658 7.03565 13.241 7.34991 13.4505 7.72546L15.24 10.934C15.5795 11.5427 15.7492 11.8471 16.0038 11.9592C16.1449 12.0213 16.3006 12.0431 16.4533 12.0219C16.7291 11.9838 16.9762 11.7376 17.4705 11.2452C18.1122 10.6061 18.5385 10.1814 18.8645 9.98019"/></g></svg>',
  font:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path stroke-linejoin="round" d="M12 7H10C9.05719 7 8.58579 7 8.29289 7.32544C8 7.65087 8 8.17466 8 9.22222V9.75M12 7H14C14.9428 7 15.4142 7 15.7071 7.32544C16 7.65087 16 8.17466 16 9.22222V9.75M12 7V17M9.5 17H15"/><path d="M2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12Z" opacity=".5"/></g></svg>'
};
const SUBS={
 extra:{name:'אקסטרה',en:'Extra Brand',logo:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgZGF0YS1uYW1lPSJMYXllciAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2aWV3Qm94PSIwIDAgNTEwLjcyIDUxMC43MiI+CiAgPGRlZnM+CiAgICA8c3R5bGU+CiAgICAgIC5jbHMtMSB7CiAgICAgICAgZmlsbDogdXJsKCNsaW5lYXItZ3JhZGllbnQtMik7CiAgICAgIH0KCiAgICAgIC5jbHMtMiB7CiAgICAgICAgZmlsbDogI2ZmZjsKICAgICAgICBzdHJva2U6IHVybCgjTmV3X0dyYWRpZW50X1N3YXRjaF80KTsKICAgICAgICBzdHJva2UtbWl0ZXJsaW1pdDogMTA7CiAgICAgICAgc3Ryb2tlLXdpZHRoOiA5cHg7CiAgICAgIH0KCiAgICAgIC5jbHMtMyB7CiAgICAgICAgZmlsbDogdXJsKCNsaW5lYXItZ3JhZGllbnQpOwogICAgICB9CiAgICA8L3N0eWxlPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJOZXdfR3JhZGllbnRfU3dhdGNoXzQiIGRhdGEtbmFtZT0iTmV3IEdyYWRpZW50IFN3YXRjaCA0IiB4MT0iMzgzLjA2IiB5MT0iMzQuMTgiIHgyPSIxMjcuNjYiIHkyPSI0NzYuNTUiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjYjA3YmU5Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iLjE0IiBzdG9wLWNvbG9yPSIjYWE3NmU3Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iLjMxIiBzdG9wLWNvbG9yPSIjOWI2YWU0Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iLjUiIHN0b3AtY29sb3I9IiM4MTU2ZGUiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIuNzEiIHN0b3AtY29sb3I9IiM1ZDNhZDYiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIuOTIiIHN0b3AtY29sb3I9IiMzMDE2Y2MiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMWUwOGM5Ii8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJsaW5lYXItZ3JhZGllbnQiIHgxPSIzNjMuNzciIHkxPSI5OS43NCIgeDI9IjEyNC4wMiIgeTI9IjMyMi42MyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNiMDhmZTkiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIuMTQiIHN0b3AtY29sb3I9IiNhYTg5ZTciLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIuMzEiIHN0b3AtY29sb3I9IiM5YjdiZTQiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIuNSIgc3RvcC1jb2xvcj0iIzgxNjNkZSIvPgogICAgICA8c3RvcCBvZmZzZXQ9Ii43MSIgc3RvcC1jb2xvcj0iIzVkNDJkNiIvPgogICAgICA8c3RvcCBvZmZzZXQ9Ii45MiIgc3RvcC1jb2xvcj0iIzMwMThjYyIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMxZTA4YzkiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImxpbmVhci1ncmFkaWVudC0yIiB4MT0iNDYxLjY1IiB5MT0iMjA1LjAyIiB4Mj0iMjIxLjkxIiB5Mj0iNDI3LjkxIiB4bGluazpocmVmPSIjbGluZWFyLWdyYWRpZW50Ii8+CiAgPC9kZWZzPgogIDxjaXJjbGUgY2xhc3M9ImNscy0yIiBjeD0iMjU1LjM2IiBjeT0iMjU1LjM2IiByPSIyNTAuODYiLz4KICA8cGF0aCBjbGFzcz0iY2xzLTMiIGQ9Ik0zMTIuMzgsMzMzLjg1bC0uMDcsMS4wOGMtMTcuOCwxNi4zOC0zNS44OSwyOC41LTU0LjI5LDM2LjM2LTIwLjQ3LDguNzQtMzcuMDEsMTMuMTItNjIsMTMuMTItMzQuMDYsMC02Ni40Ni0xNC4xMy05MC4xMS0zNi42NC0yNy40MS0yNi4xLTM5Ljc2LTU4Ljk3LTQwLjU4LTEwNC4zNC0uNjgtMzcuOSwxNC44OS02Ny45MiwzOS4zOC05MC4xOCwyMC40OC0xOC42MSw0NC41LTI4LjgyLDcyLjA5LTMwLjYzLDMwLjM4LTIuMDEsNTYuOCw1Ljc3LDc5LjI2LDIzLjMyLDE4LjQ1LDE0LjQxLDMxLjgzLDMzLjAyLDQwLjE4LDU1LjhsLTEuMjEsMS42NC0xNzkuOTYsMTAxLjA0LTE1LjUtMzcuMDUsMTM1Ljc5LTc2LjU4Yy00LjI3LTguNS0xMC45OS0xNS4yOC0yMC4xNi0yMC4zNS0xMC4xMi01LjU5LTIxLjQ2LTcuOTYtMzQuMDQtNy4xMy0xNy4wMywxLjE0LTMyLDcuNTUtNDQuOTEsMTkuMjUtMTUuMzgsMTMuOTMtMjMuMjMsMzIuMzEtMjMuNTYsNTUuMTItLjM3LDI2LjQ2LDUuNjEsNDguODcsMTcuOTMsNjcuMjEsMTQuNDksMjEuNTUsMzguNTEsMzMuNTgsNjUuOTQsMzQuNTksMTYuNjMuNjIsMjkuNzUtMy41LDQ1LjQ2LTEwLjg1LDExLjkzLTUuNTgsMjUuNzktMTQuNzEsNDEuNTgtMjcuNDFoMS4wOWwyNy42OCwzMi42MmguMDFaIi8+CiAgPHBhdGggY2xhc3M9ImNscy0xIiBkPSJNNDM3LjQyLDM4MS42OWwtLjE1LDIuMThoLTYzLjA3bC0xMjEuMDgtMTM4Ljk3LjE2LTIuMzMsMzkuODItMjEuNjQsMzUuODIsMzkuOWMyNi4xMi0yOC40Niw0OC45OC02MC45Myw2NC4zMi04OS4zMWw0Mi4yMywxMC45Ny40LDIuMTdzLTI4LjU3LDQ4Ljc5LTU4LjQxLDg0LjEzYy01LjMxLDYuMjktMTMuMDEsMTQuODYtMjAuNjYsMjMuMDlsODAuNjIsODkuODFoMFoiLz4KPC9zdmc+'},
 web:{name:'וובסטופ',en:'Webstop',logo:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2ZXJzaW9uPSIxLjEiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2aWV3Qm94PSIwIDAgNTEwLjcyIDUxMC43MiI+CiAgPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDMwLjEuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDIuMS4xIEJ1aWxkIDEzNikgIC0tPgogIDxkZWZzPgogICAgPHN0eWxlPgogICAgICAuc3QwIHsKICAgICAgICBmaWxsOiBub25lOwogICAgICAgIHN0cm9rZTogdXJsKCNsaW5lYXItZ3JhZGllbnQxKTsKICAgICAgICBzdHJva2UtbWl0ZXJsaW1pdDogMTA7CiAgICAgICAgc3Ryb2tlLXdpZHRoOiA5cHg7CiAgICAgIH0KCiAgICAgIC5zdDEgewogICAgICAgIGZpbGw6IHVybCgjbGluZWFyLWdyYWRpZW50KTsKICAgICAgfQogICAgPC9zdHlsZT4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0ibGluZWFyLWdyYWRpZW50IiB4MT0iMzUwLjgyIiB5MT0iODUuMjciIHgyPSIxNDIuNzgiIHkyPSIzNzkuNDYiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjNWFjM2I0Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzJiMzE4YiIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0ibGluZWFyLWdyYWRpZW50MSIgeDE9IjM4My4wNiIgeTE9IjM0LjE4IiB4Mj0iMTI3LjY2IiB5Mj0iNDc2LjU1IiB4bGluazpocmVmPSIjbGluZWFyLWdyYWRpZW50Ii8+CiAgPC9kZWZzPgogIDxwYXRoIGNsYXNzPSJzdDEiIGQ9Ik00MzUuNjQsMjQzLjczbC0xNy40MSw0NS4wNi0xLjAyLjUxLTI1LjA5LTIzLjU1LS41MS41MWMuNjEsNS4yOC0uNTEsMTIuMjMtMS4yNiwxNi0xNy4wNSw5My42Mi01OC40LDExNS4wNy0xMDIuMTcsMTE1LjA3LTIwLjQ4LDAtMzQuODEtMTIuMjktNDcuNjEtNDMuNTJoLS41MmMtMTguNDMsMzEuMjMtNDEuNDcsNDMuMDEtNjguNiw0My4wMS00Ni42LDAtNTMuMjUtNDMuNTItNTMuMjUtNzIuMTksMC00My4wOCw1Ljc5LTY3LjM1LDIzLjU1LTEzNS42OCwwLTYuNjYtMy4wNy0xMC43NS05LjczLTEwLjc1LTYuMTQsMC0xMy4zMSwzLjA3LTE4LjQzLDYuMTRsLTIuNTYtMS41NC0xMS4yNi00MC45NiwxLjUzLTIuNTZjMTUuODctNS42MywzMS43NS0xMC43NSw0OS4xNS0xMC43NSwxOC45NSwwLDM5LjQzLDguMTksMzkuNDMsMzYuODcsMCwyMy4wNC0yMi4wMiwxMTUuMi0yMi4wMiwxNDMuODcsMCwyNS42LDEwLjYsMzguODMsMjcuNjUsMzUuMzMsMzcuMzgtNy42OCw0MS40Ny02OS42NCw0MS42Mi05Ny44LjEtMTkuMTEtLjA3LTI3LjQ3LS42Ni0zMS43NGwxLjU0LTEuNTQsNDUuMDUtMS4wMiwxLjU0LDIuMDVjLjUxLDUuMTIsMS4wMiwxMi4yOSwxLjAyLDIwLjQ4LDAsNDIuNDktNC42MSw2Ny4wNy00LjYxLDg3LjA0LDAsMTQuODUsNi4yNSwyNC4yLDI0LjA3LDIyLjUzLDMwLjgyLTIuOSw0NS43Mi02MS4wMyw0My4xNi0xNDIuNDcsMC0yMi40NC0yLjc4LTYyLjQtMy43NC03MS4wNGwyLjU2LTIuMDUsNDQuMDMtMi4wNCwyLjU2LDMuMDdjNC4xLDY3LjU4LDE0Ljg1LDg5LjA5LDQxLjQ4LDExMS42MWwuNTEsMi4wNWgwWiIvPgogIDxjaXJjbGUgY2xhc3M9InN0MCIgY3g9IjI1NS4zNiIgY3k9IjI1NS4zNiIgcj0iMjUwLjg2Ii8+Cjwvc3ZnPg=='},
 desk:{name:'דסקטופ',en:'Desktop',logo:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2ZXJzaW9uPSIxLjEiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2aWV3Qm94PSIwIDAgNTEwLjcyIDUxMC43MiI+CiAgPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDMwLjEuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDIuMS4xIEJ1aWxkIDEzNikgIC0tPgogIDxkZWZzPgogICAgPHN0eWxlPgogICAgICAuc3QwIHsKICAgICAgICBmaWxsOiB1cmwoI2xpbmVhci1ncmFkaWVudDEpOwogICAgICB9CgogICAgICAuc3QxIHsKICAgICAgICBmaWxsOiAjZmZmOwogICAgICAgIHN0cm9rZTogdXJsKCNsaW5lYXItZ3JhZGllbnQpOwogICAgICAgIHN0cm9rZS13aWR0aDogOXB4OwogICAgICB9CiAgICA8L3N0eWxlPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJsaW5lYXItZ3JhZGllbnQiIHgxPSIzODMuMDYiIHkxPSI0NzUuNzEiIHgyPSIxMjcuNjYiIHkyPSIzMy4zNCIgZ3JhZGllbnRUcmFuc2Zvcm09InRyYW5zbGF0ZSgwIDUwOS44OSkgc2NhbGUoMSAtMSkiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjZmY5YThiIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2UzMTY2ZiIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0ibGluZWFyLWdyYWRpZW50MSIgeDE9IjM2Mi42OSIgeTE9IjE4OC42OSIgeDI9IjEzNi41MyIgeTI9IjM5OS44MyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNmZjlhOGIiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIuODUiIHN0b3AtY29sb3I9IiNlMzE2NmYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxjaXJjbGUgY2xhc3M9InN0MSIgY3g9IjI1NS4zNiIgY3k9IjI1NS4zNiIgcj0iMjUwLjg2Ii8+CiAgPHBhdGggY2xhc3M9InN0MCIgZD0iTTM0MC44NCwyOTAuODFjMC00NC4xOCw1Ljk4LTEyMC4yMyw4LjA5LTE2MC4xNGwtNDYuMzUtMjEuMzMtMi4zMy0uMDUtNC43Miw5OC43OC0uOTkuMDZjLTIyLjg4LTMxLjk3LTQzLjQ1LTQyLjA3LTc1LjAxLTQyLjA3LTU3LjE5LDAtOTQuNjYsNTEuNjctOTQuNjYsMTE1LjYxczM5LjM1LDEwMy43OSw5MC44NiwxMDMuNzljMzQuODcsMCw1NC40NS0xNS41NSw3Ny44Ny00OS44OSwzLjYyLDE5LjczLDcuMzcsMzUuODQsMTEuMjUsNDcuNDVoNTEuMjhsLjExLTIuMDNjLTEwLjI3LTMwLjA4LTE1LjQtNTkuOC0xNS40LTkwLjE4Wk0yMjMuMjEsMzQzLjMzYy0yOS4zOCwwLTQ4LjQ2LTIyLjM3LTQ4LjQ2LTY2LDAtNDkuNjcsMjguMDgtNzIuNzEsNTIuMjgtNzMuNzQsNTAuMjItMi4xMiw2NC45NCw1OC44Nyw2NC43OSw3NS43OS0yOS44NCw0OS42My00OC40NCw2My45NS02OC42MSw2My45NVoiLz4KPC9zdmc+'},
 barter:{name:'בארטר',en:'Barter',logo:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2ZXJzaW9uPSIxLjEiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2aWV3Qm94PSIwIDAgNTEwLjcyIDUxMC43MiI+CiAgPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDMwLjEuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDIuMS4xIEJ1aWxkIDEzNikgIC0tPgogIDxkZWZzPgogICAgPHN0eWxlPgogICAgICAuc3QwIHsKICAgICAgICBmaWxsOiB1cmwoI2xpbmVhci1ncmFkaWVudDEpOwogICAgICB9CgogICAgICAuc3QxIHsKICAgICAgICBmaWxsOiAjZmZmOwogICAgICAgIHN0cm9rZTogdXJsKCNsaW5lYXItZ3JhZGllbnQpOwogICAgICAgIHN0cm9rZS13aWR0aDogOXB4OwogICAgICB9CiAgICA8L3N0eWxlPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJsaW5lYXItZ3JhZGllbnQiIHgxPSIzODMuMDYiIHkxPSI0NzUuNzEiIHgyPSIxMjcuNjYiIHkyPSIzMy4zNCIgZ3JhZGllbnRUcmFuc2Zvcm09InRyYW5zbGF0ZSgwIDUwOS44OSkgc2NhbGUoMSAtMSkiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjYzNjYWQ2Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzIwMjMyYiIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0ibGluZWFyLWdyYWRpZW50MSIgeDE9IjEzOC41NyIgeTE9IjI0NC43MSIgeDI9IjM3My43NSIgeTI9IjI0NC43MSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNhN2IwYmYiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIuODUiIHN0b3AtY29sb3I9IiMyMDIzMmIiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxjaXJjbGUgY2xhc3M9InN0MSIgY3g9IjI1NS4zNiIgY3k9IjI1NS4zNiIgcj0iMjUwLjg2Ii8+CiAgPHBhdGggY2xhc3M9InN0MCIgZD0iTTM0Ny4xNCwxODkuNjVjLTE3Ljc0LTE4LjMzLTM4LjU2LTI3LjUtNjIuNDYtMjcuNS0yNy41OSwwLTUyLjYyLDkuODctNzUuMTEsMjkuNjFsLS45NS0uMDksMS4wMi05MC41M2gtMi4yNGwtNDUuODgsMjEuMDQtMS44OSwxNTEuNjZjLS40NywzNi44NC03LjQ4LDcyLjYtMjEuMDQsMTA3LjI1bC0uMDIsMi4xMWg0OS4zNGM0LjQxLTEwLjc5LDguOTctMjYuMzcsMTMuNjktNDYuNzQsMjYuMDcsMzQuNTYsNTMuMDEsNTEuODMsODAuODQsNTEuODMsNTkuOCwwLDkwLjIzLTM4LjU4LDkxLjMxLTExNS43NiwwLTM2LjkyLTguODgtNjQuNTUtMjYuNjEtODIuODhaTTI3NC4zNywzNTAuNTNjLTI0LjYyLDAtNDcuNTgtMjguNjMtNjguODktNTcsMCwwLS40LTQzLjI5LDIzLjktNzQuNTYsMTIuODItMTQuNzUsMjguNjgtMjIuMTMsNDcuNTgtMjIuMTMsMTQuNjcsMCwyNi43NCw1LjkyLDM2LjE5LDE3Ljc4LDkuNDcsMTEuODYsMTQuMTksMzEuMTcsMTQuMTksNTcuOTEsMCw1Mi0xNy42Niw3OC01Mi45Nyw3OFoiLz4KPC9zdmc+'},
 acad:{name:'אקדמיק',en:'Academic',logo:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgZGF0YS1uYW1lPSJMYXllciAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2aWV3Qm94PSIwIDAgNTEwLjcyIDUxMC43MiI+CiAgPGRlZnM+CiAgICA8c3R5bGU+CiAgICAgIC5jbHMtMSB7CiAgICAgICAgZmlsbDogI2ZmZjsKICAgICAgICBzdHJva2U6IHVybCgjbGluZWFyLWdyYWRpZW50KTsKICAgICAgICBzdHJva2UtbWl0ZXJsaW1pdDogMTA7CiAgICAgICAgc3Ryb2tlLXdpZHRoOiA5cHg7CiAgICAgIH0KCiAgICAgIC5jbHMtMiB7CiAgICAgICAgZmlsbDogdXJsKCNOZXdfR3JhZGllbnRfU3dhdGNoXzMpOwogICAgICB9CiAgICA8L3N0eWxlPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJsaW5lYXItZ3JhZGllbnQiIHgxPSIzODMuMDYiIHkxPSIzNC4xOCIgeDI9IjEyNy42NiIgeTI9IjQ3Ni41NSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNlMWYwN2QiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIuODUiIHN0b3AtY29sb3I9IiNmZmFkMDUiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9Ik5ld19HcmFkaWVudF9Td2F0Y2hfMyIgZGF0YS1uYW1lPSJOZXcgR3JhZGllbnQgU3dhdGNoIDMiIHgxPSIxNjIuOTgiIHkxPSI0NDguMzkiIHgyPSIzNDEuNDUiIHkyPSIxMTIuMTMiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIuMTUiIHN0b3AtY29sb3I9IiNmZmFkMDUiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjZTFmMDdkIi8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8Y2lyY2xlIGNsYXNzPSJjbHMtMSIgY3g9IjI1NS4zNiIgY3k9IjI1NS4zNiIgcj0iMjUwLjg2Ii8+CiAgPHBhdGggY2xhc3M9ImNscy0yIiBkPSJNNDA1LjA1LDI1MC4yM2MwLDExNy4wMy03Ni41NywxNDUuMDctMTMwLjUsMTQ1LjA3LTIzLjgxLDAtNTAuMjEtNS43MS03Mi4wOC0yMS43Mi0uNzItLjUzLTEuNzEtLjQ1LTIuMzQuMTctOC4wNCw3Ljk1LTE1LjYzLDE0LjU0LTIzLjIxLDIwLjYxLS4zMi4yNS0uNzIuNC0xLjEzLjRoLTY4LjMyYy0uOTksMC0xLjgtLjgtMS44LTEuOGgwYzAtLjU3LjI3LTEuMS43Mi0xLjQ0LDcyLjktNTQuNzYsMTE1LjA1LTEwMC4yMiwxMTUuMDUtMTQ0LjI5LDAtMjUuMzMtMTIuMjQtMzUuOS0yNi44LTM1LjktMjIuNDUsMC0zMC45LDE1LjkzLTMwLjksMzQuMDQsMCwxNS4xOCw2LjE5LDMxLjA5LDIyLjQyLDUxLjgzLjI0LjMyLjM5LjcxLjM5LDEuMTF2Ljg3YzAsLjQzLS4xNi44NC0uNDMsMS4xN2wtMjQuODYsMjguODhjLS4yOC4zMy0uNjcuNTQtMS4xLjZsLS44Ni4xM2MtLjU0LjA4LTEuMS0uMDgtMS41LS40NS0yMi4xMy0yMC4zNC0zOC45LTQ2LjgyLTM4LjktODMuMSwwLTUxLjM5LDM4LjAyLTc3LjE3LDc1Ljc0LTc3LjE3LDUyLjMxLDAsNzcuMDQsMzIuNDIsNzcuMDQsODAuMDgsMCwyOS42Ni0xOC4wMyw2MC43MS0zOC42LDg1LjgyLS42NC43OC0uNTEsMS45My4yOCwyLjU2LDEwLjU5LDguMzYsMjkuNDUsMTIuMjksNDQuNDEsMTIuMjksNjAuMzksMCw3NC45Ni01Ny43LDc0Ljk2LTk5Ljc3LDAtNjAuODgtMzQuMDctODUuNDItNzIuNjEtODkuMDMtNS4yNS0uNS0xMC41Mi0uNDctMTUuNzgtLjEzbC05LjUyLjY0Yy0uNTIuMDMtMS4wMi0uMTYtMS4zOS0uNTNsLTEuMDUtMS4wNWMtLjM0LS4zNC0uNTMtLjc5LS41My0xLjI3di0zOS40OGMwLS40Ny4xOS0uOTQuNTMtMS4yN2wxLjE3LTEuMTdjLjMxLS4zMS43LS40OCwxLjEyLS41MmwyLjk2LS4yNWM3LjQ2LS42MywyNC0xLjA4LDMxLjQ0LS4zNCw4OC44Niw4Ljg4LDExNS45OCw4My43NCwxMTUuOTgsMTM0LjQxaDBaIi8+Cjwvc3ZnPg=='},
 buy:{name:'רכישה בודדת',en:'Single license',logo:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2ZXJzaW9uPSIxLjEiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2aWV3Qm94PSIwIDAgNTEwLjcyIDUxMC43MiI+CiAgPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDMwLjEuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDIuMS4xIEJ1aWxkIDEzNikgIC0tPgogIDxkZWZzPgogICAgPHN0eWxlPgogICAgICAuc3QwIHsKICAgICAgICBmaWxsOiB1cmwoI2xpbmVhci1ncmFkaWVudDEpOwogICAgICB9CgogICAgICAuc3QxIHsKICAgICAgICBmaWxsOiAjZmZmOwogICAgICAgIHN0cm9rZTogdXJsKCNsaW5lYXItZ3JhZGllbnQpOwogICAgICAgIHN0cm9rZS13aWR0aDogOXB4OwogICAgICB9CiAgICA8L3N0eWxlPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJsaW5lYXItZ3JhZGllbnQiIHgxPSIzODMuMDYiIHkxPSI0NzUuNzEiIHgyPSIxMjcuNjYiIHkyPSIzMy4zNCIgZ3JhZGllbnRUcmFuc2Zvcm09InRyYW5zbGF0ZSgwIDUwOS44OSkgc2NhbGUoMSAtMSkiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjZmY5YThiIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2UzMTY2ZiIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0ibGluZWFyLWdyYWRpZW50MSIgeDE9IjM2Mi42OSIgeTE9IjE4OC42OSIgeDI9IjEzNi41MyIgeTI9IjM5OS44MyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNmZjlhOGIiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIuODUiIHN0b3AtY29sb3I9IiNlMzE2NmYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxjaXJjbGUgY2xhc3M9InN0MSIgY3g9IjI1NS4zNiIgY3k9IjI1NS4zNiIgcj0iMjUwLjg2Ii8+CiAgPHBhdGggY2xhc3M9InN0MCIgZD0iTTM0MC44NCwyOTAuODFjMC00NC4xOCw1Ljk4LTEyMC4yMyw4LjA5LTE2MC4xNGwtNDYuMzUtMjEuMzMtMi4zMy0uMDUtNC43Miw5OC43OC0uOTkuMDZjLTIyLjg4LTMxLjk3LTQzLjQ1LTQyLjA3LTc1LjAxLTQyLjA3LTU3LjE5LDAtOTQuNjYsNTEuNjctOTQuNjYsMTE1LjYxczM5LjM1LDEwMy43OSw5MC44NiwxMDMuNzljMzQuODcsMCw1NC40NS0xNS41NSw3Ny44Ny00OS44OSwzLjYyLDE5LjczLDcuMzcsMzUuODQsMTEuMjUsNDcuNDVoNTEuMjhsLjExLTIuMDNjLTEwLjI3LTMwLjA4LTE1LjQtNTkuOC0xNS40LTkwLjE4Wk0yMjMuMjEsMzQzLjMzYy0yOS4zOCwwLTQ4LjQ2LTIyLjM3LTQ4LjQ2LTY2LDAtNDkuNjcsMjguMDgtNzIuNzEsNTIuMjgtNzMuNzQsNTAuMjItMi4xMiw2NC45NCw1OC44Nyw2NC43OSw3NS43OS0yOS44NCw0OS42My00OC40NCw2My45NS02OC42MSw2My45NVoiLz4KPC9zdmc+'},
 app:{name:'רכישה בודדת',en:'App license',logo:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2ZXJzaW9uPSIxLjEiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2aWV3Qm94PSIwIDAgNTEwLjcyIDUxMC43MiI+CiAgPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDMwLjEuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDIuMS4xIEJ1aWxkIDEzNikgIC0tPgogIDxkZWZzPgogICAgPHN0eWxlPgogICAgICAuc3QwIHsKICAgICAgICBmaWxsOiB1cmwoI2xpbmVhci1ncmFkaWVudDEpOwogICAgICB9CgogICAgICAuc3QxIHsKICAgICAgICBmaWxsOiAjZmZmOwogICAgICAgIHN0cm9rZTogdXJsKCNsaW5lYXItZ3JhZGllbnQpOwogICAgICAgIHN0cm9rZS13aWR0aDogOXB4OwogICAgICB9CiAgICA8L3N0eWxlPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJsaW5lYXItZ3JhZGllbnQiIHgxPSIzODMuMDYiIHkxPSI0NzUuNzEiIHgyPSIxMjcuNjYiIHkyPSIzMy4zNCIgZ3JhZGllbnRUcmFuc2Zvcm09InRyYW5zbGF0ZSgwIDUwOS44OSkgc2NhbGUoMSAtMSkiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjZmY5YThiIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2UzMTY2ZiIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0ibGluZWFyLWdyYWRpZW50MSIgeDE9IjM2Mi42OSIgeTE9IjE4OC42OSIgeDI9IjEzNi41MyIgeTI9IjM5OS44MyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNmZjlhOGIiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIuODUiIHN0b3AtY29sb3I9IiNlMzE2NmYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxjaXJjbGUgY2xhc3M9InN0MSIgY3g9IjI1NS4zNiIgY3k9IjI1NS4zNiIgcj0iMjUwLjg2Ii8+CiAgPHBhdGggY2xhc3M9InN0MCIgZD0iTTM0MC44NCwyOTAuODFjMC00NC4xOCw1Ljk4LTEyMC4yMyw4LjA5LTE2MC4xNGwtNDYuMzUtMjEuMzMtMi4zMy0uMDUtNC43Miw5OC43OC0uOTkuMDZjLTIyLjg4LTMxLjk3LTQzLjQ1LTQyLjA3LTc1LjAxLTQyLjA3LTU3LjE5LDAtOTQuNjYsNTEuNjctOTQuNjYsMTE1LjYxczM5LjM1LDEwMy43OSw5MC44NiwxMDMuNzljMzQuODcsMCw1NC40NS0xNS41NSw3Ny44Ny00OS44OSwzLjYyLDE5LjczLDcuMzcsMzUuODQsMTEuMjUsNDcuNDVoNTEuMjhsLjExLTIuMDNjLTEwLjI3LTMwLjA4LTE1LjQtNTkuOC0xNS40LTkwLjE4Wk0yMjMuMjEsMzQzLjMzYy0yOS4zOCwwLTQ4LjQ2LTIyLjM3LTQ4LjQ2LTY2LDAtNDkuNjcsMjguMDgtNzIuNzEsNTIuMjgtNzMuNzQsNTAuMjItMi4xMiw2NC45NCw1OC44Nyw2NC43OSw3NS43OS0yOS44NCw0OS42My00OC40NCw2My45NS02OC42MSw2My45NVoiLz4KPC9zdmc+'}
};
/* domains registered under the SUBSCRIPTION (quota belongs to the plan, not to a font) */
const PLAN={web:{n:3,label:'וובסטופ',desc:'מינוי לאתרים ולדסקטופ'},extra:{n:0,label:'אקסטרה',desc:'מינוי לאתרים לדסקטופ ולאפליקציה'},desk:{n:0,label:'דסקטופ',desc:'מינוי דסקטופ'},acad:{n:0,label:'אקדמיק',desc:'מינוי לסטודנטים'},barter:{n:3,label:'בארטר',desc:'מינוי לאתרים ולדסקטופ'}};
/* older months = history (closed & kept, scrollable back through the years) */
const OLDDOM=[['22.09.2026','סטודיו לוי','studio-levi.co.il','טאלנט'],['20.09.2026','חנות הבד','bad.co.il','אומץ'],['04.08.2026','קמפיין קיץ','summer-sale.co.il','דיסקברי'],['11.07.2026','גן ילדים שקד','shaked-kids.co.il','פריימריז, פורטו'],['02.05.2026','משרד עו״ד כהן','cohen-law.co.il','יזכור פרו'],['18.02.2026','מאפיית הכפר','hakfar.co.il','אומץ, טאלנט'],['09.12.2025','עמותת אור','or-org.org.il','פורטו'],['21.10.2025','סטודיו מור','mor-studio.co.il','דיסקברי, טאלנט'],['05.06.2025','כנס עיצוב 2025','design-conf.co.il','פריימריז'],['14.03.2025','קפה גינה','gina-cafe.co.il','אומץ'],['30.11.2024','חנות הספרים','books-il.co.il','יזכור פרו, פורטו'],['08.07.2024','מגזין אדריכלות','arch-mag.co.il','טאלנט']];
const SUBDOM={web:[['03.10.2026','סטודיו דיין','studio-dayan.co.il','פורטו, טאלנט'],['14.10.2026','מגזין עגלה','agala.co.il','דיסקברי, פורטו'],...OLDDOM.map(r=>r.slice())],extra:[['03.10.2026','סטודיו דיין','studio-dayan.co.il','פורטו, טאלנט'],['14.10.2026','מגזין עגלה','agala.co.il','דיסקברי, פורטו'],['12.10.2026','אדריכלות בע״מ','fontshok.co.il','פורטו'],...OLDDOM.map(r=>r.slice())]};
const MONTHS=['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
let BONUS=0,EXTRA=0;
/* registration cycle: domains registered in the current cycle (1.10–31.10.2026) can still be edited; older ones are locked */
const _n=new Date();const CYCLE={start:new Date(_n.getFullYear(),_n.getMonth(),1),end:new Date(_n.getFullYear(),_n.getMonth()+1,1),label:MONTHS[_n.getMonth()]};
/* next quota renewal, from the registration cycle (Stage 2: quota.resets from the API) */
const nextReset=()=>`${CYCLE.end.getDate()} ב${MONTHS[CYCLE.end.getMonth()]}`;
const parseD=s=>{const [d,m,y]=s.split('.').map(Number);return new Date(y,m-1,d)};
const canEdit=s=>{const d=parseD(s);return d>=CYCLE.start&&d<CYCLE.end};
/* row actions.
   Subscription domains: editable/removable only in the current cycle; after that the domain is closed and kept (lock, no remove).
   Purchased licences ("dom:" keys): always editable and removable. */
function rowActs(key,date,certSpec,delAttr){
 const open=key.startsWith('dom:')||canEdit(date);
 const cert=`<button class="ibtn" aria-label="תעודת רישיון" data-cert="${certSpec}">${ICON.cert}</button>`;
 if(key.startsWith('dom:')){const p=key.split(':');if(licFixed(+p[1],+p[2]))return `<div class="acts"><span class="ibtn locked" title="נרשם בזמן הרכישה: קבוע" aria-label="קבוע">${ICON.lock}</span><button class="ibtn" aria-label="תעודת רישיון" data-cert="${certSpec}">${ICON.cert}</button><span class="ibtn ph" aria-hidden="true"></span></div>`}
 if(!open)return `<div class="acts"><span class="ibtn locked" title="נרשם בחודש קודם: הדומיין סגור ונשמר, לא ניתן לערוך או להסיר" aria-label="נעול">${ICON.lock}</span>${cert}<span class="ibtn ph" aria-hidden="true"></span></div>`;
 const tip=key.startsWith('dom:')?'עריכת הדומיין':`אפשר לערוך עד סוף חודש ${CYCLE.label}`;
 return `<div class="acts"><button class="ibtn" aria-label="עריכת הדומיין" title="${tip}" data-edit="${key}">${ICON.edit}</button>${cert}<button class="ibtn" aria-label="הסרת הדומיין" ${delAttr}>${ICON.trash}</button></div>`;
}
const editCells=(name,host)=>`<td><input class="ed ed-name" value="${name}" aria-label="שם האתר"></td><td><input class="ed ed-host" dir="ltr" value="${host}" aria-label="כתובת האתר"></td>`;
const editHost=(name,host)=>`<input class="ed ed-name" value="${name}" aria-label="שם האתר"><input class="ed ed-host" dir="ltr" value="${host}" aria-label="כתובת האתר">`;
const editBtns=()=>`<div class="acts"><button class="ibtn ok-btn" data-edsave="1" aria-label="שמירה">${ICON.ok}</button><button class="ibtn" data-edcancel="1" aria-label="ביטול">${ICON.close}</button></div>`;
function fontPicker(sel){const on=sel.length>=2;return `<div class="fld fontpick ed-fonts"><button type="button" class="fp-btn" aria-haspopup="true" aria-expanded="false" aria-label="פונטים"><span class="fp-val">${sel.join(', ')||'בחירת פונטים'}</span>${ICON.chev}</button>
 <div class="fp-menu">${DOMF.map(f=>{const c=sel.includes(f);return `<label class="${!c&&on?'off':''}"><input type="checkbox" value="${ea(f)}" ${c?'checked':''} ${!c&&on?'disabled':''}> ${ea(f)}</label>`}).join('')}<p class="fp-hint ${on?'max':''}">אפשר לבחור עד 2 פונטים לכל אתר</p></div></div>`}
const logo=(k,cls='sublogo')=>`<img class="${cls}" src="${SUBS[k].logo}" alt="${SUBS[k].name}">`;
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('show'),1900)}
function meter(u,n){if(!n)return `<span class="chip">ללא הגבלה</span>`;const p=u/n;const c=p>=1?'bad':p>=.66?'warn':'';return `<span class="meter ${c}"><span class="num">${u}/${n}</span><span class="bar"><i style="width:${Math.max(p*100,8)}%"></i></span></span>`}
const ils=n=>'₪'+n.toLocaleString('he-IL',{minimumFractionDigits:n%1?2:0,maximumFractionDigits:2});

/* sample data */
const FAMILY=[['פורטו',8],['טאלנט',6],['יזכור פרו',4],['אומץ',9],['פריימריז',5],['דיסקברי',6]];
/* quota: webstop = 3 domains per month (resets on the 1st); extra = unlimited (n:0) */
/* LICENSES = fonts bought one by one (not through a subscription). A web license covers up to 3 domains. */
const LIC=[
 {f:'פורטו',w:'משפחה',t:'וובפונט',sub:'buy',n:3,web:1,sites:[['08.10.2026','אדריכלות בע״מ','arch-ltd.co.il']]},
 {f:'פורטו',w:'משפחה',t:'דסקטופ',sub:'desk',web:0},
 {f:'דיסקברי',w:'מדיום',t:'דסקטופ',sub:'desk',web:0},
 {f:'תניא',w:'בולד',t:'וובפונט',sub:'buy',n:3,web:1,sites:[['01.06.2026','בנק פועלים','bank.co.il'],['02.06.2026','אתר ב׳','b-site.co.il'],['05.06.2026','אתר ג׳','c-site.co.il']]},
 {f:'אומץ',w:'בולד',t:'דסקטופ',sub:'desk',web:0},
 {f:'שלדון',w:'רגולר',t:'אפליקציה',sub:'app',web:0}
];
LIC.forEach(l=>{if(l.web)l.u=l.sites.length});
const HISTORY=[{f:'דיסקברי',w:'לייט',sub:'web',site:['04.08.2026','קמפיין קיץ','summer-sale.co.il'],removed:'30.09.2026'}];
const CERT_TEXT={
 extra:l=>`רישיון זה מכסה את הדומיין הרשום במסגרת מינוי אקסטרה, הכולל רישום דומיינים ללא הגבלה, אתרים, אפליקציות ודסקטופ. הרישיון בתוקף כל עוד המינוי פעיל.`,
 web:l=>`רישיון זה מכסה את הדומיין הרשום בלבד, במסגרת מכסת ${l.n} דומיינים חודשיים במינוי וובסטופ. השימוש מותר לעיצוב ממשק משתמש (UI) ולהטמעה באתר שכתובתו מצוינת לעיל, כל עוד המינוי פעיל.`,
 desk:l=>`רישיון דסקטופ לפונט הרשום: התקנה במחשבי בעל הרישיון ועיצוב תוצרי דסקטופ, פלט ו־UI. הרישיון אינו כולל הטמעה באתרים או באפליקציות.`,
 acad:l=>`רישיון אקדמיק לשימוש במסגרת הלימודים ותיק העבודות של בעל הרישיון, בהתאם לתנאי המינוי לסטודנטים.`,
 buy:l=>`רישיון וובפונט לפונט שנרכש, למכסה של עד ${l.n||3} דומיינים. השימוש מותר לעיצוב ממשק משתמש (UI) ולהטמעה באתר שכתובתו מצוינת לעיל. הרישיון לצמיתות.`,
 app:l=>`רישיון אפליקציה לפונט הרשום: הטמעה באפליקציה של בעל הרישיון, בהתאם לתנאי הרישיון שנרכש.`,
 barter:l=>`רישיון בארטר הניתן במסגרת שיתוף פעולה לפי הסיכום האישי עם פונטשוק, בכפוף למתן קרדיט בדף היוצרים.`
};
const ORDERS=[
 {id:'11479',d:'20.11.2025',items:[['וובסטופ · חידוש חודשי',319],['דומיין נוסף',79]],st:'הושלם'},
 {id:'11480',d:'20.12.2025',items:[['אקסטרה · חידוש חודשי',700]],st:'הושלם'},
 {id:'11481',d:'03.03.2026',items:[['דיסקברי · דסקטופ',354]],st:'הושלם'},
 {id:'11482',d:'01.04.2026',items:[['אומץ · דסקטופ',354]],st:'בוטל'},
 {id:'11483',d:'01.05.2026',items:[['וובסטופ · חידוש חודשי',319]],st:'הושלם'},
 {id:'11484',d:'15.05.2026',items:[['תניא · וובפונט',295],['אומץ · פרינט',150]],st:'ממתין לתשלום'}
];

/* ---- live data from WordPress (stage 1: read-only) ---- */
const FS=window.FS_DATA||{user:{},links:{}};
const ea=s=>String(s==null?'':s).replace(/[&"<>]/g,c=>({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
FAMILY.length=0;(FS.fonts||[]).forEach(f=>FAMILY.push([f.name,(f.weights||[]).length,f.web,f.desk,f.weights||[]]));
LIC.length=0;(FS.lic||[]).forEach(l=>{l.sites=l.sites||[];l.u=l.sites.length;LIC.push(l)});
ORDERS.length=0;(FS.orders||[]).forEach(o=>ORDERS.push(o));
Object.keys(SUBDOM).forEach(k=>SUBDOM[k]=[]);HISTORY.length=0;
/* the subscription's domains come from the site (the Easy Font Table records): [date, name, address, fonts, id] */
SUBDOM[FS.plan||'web']=(FS.domains||[]).map(r=>r.slice());
const DOMF=(FS.domainFonts&&FS.domainFonts.length)?FS.domainFonts:FAMILY.map(f=>f[0]);
const DOM_PLANS=['web','extra','barter'];
BONUS=FS.bonus||0;EXTRA=FS.extra||0;
/* a site on a purchased licence: [date, name, address, id]; id '' = registered at checkout, fixed */
const licFixed=(i,j)=>{const s=(LIC[i]&&LIC[i].sites[j])||[];return s.length>3&&!s[3]};
function postApi(action,d){const b=new URLSearchParams(Object.assign({action,nonce:FS.domNonce||''},d));
 return fetch(FS.domAjax,{method:'POST',credentials:'same-origin',body:b}).then(r=>r.json()).catch(()=>null).then(j=>{if(!j||!j.success)throw new Error((j&&j.data&&j.data.message)||'הפעולה נכשלה. נסו שוב.');return j.data})}
function licApi(i,op,d){const l=LIC[i];return postApi('fsa_v2_lic',Object.assign({op,key:l.key},d)).then(r=>{l.sites=r.sites;l.u=r.sites.length;l.n=r.n;return r})}
function domApi(op,d){const b=new URLSearchParams(Object.assign({action:'fsa_v2_dom',nonce:FS.domNonce||'',op},d));
 return fetch(FS.domAjax,{method:'POST',credentials:'same-origin',body:b}).then(r=>r.json()).catch(()=>null).then(j=>{
  if(!j||!j.success)throw new Error((j&&j.data&&j.data.message)||'השמירה נכשלה. נסו שוב.');
  SUBDOM[state.plan]=(j.data.domains||[]).map(r=>r.slice());return j})}
const soon=()=>toast('הפעולה הזו תחובר בשלב הבא');
/* views */
const V={};
V.subs=(tab)=>`
 <div class="plan plan-${state.plan} ${state.planOpen?'open':''}">
   ${logo(state.plan,'')}
   <div class="plan-id">
     <div class="name">${PLAN[state.plan].label} <span class="chip ok">פעיל</span></div>
     <div class="plan-desc">${PLAN[state.plan].desc}</div>
   </div>
   <div class="dates">
     <button class="plan-tg" data-plantg="1" aria-expanded="${!!state.planOpen}" aria-controls="planMore">פרטים ${ICON.chev}</button>
   </div>
   <div class="plan-more" id="planMore"><div><div class="plan-more-in">
     <div><b>תשלום הבא</b><span class="num">${ea(FS.nextPay||"—")}</span></div>
     <div><b>תחילת המינוי</b><span class="num">${ea(FS.planStart||"—")}</span></div>
     <div><b>אמצעי תשלום</b><span class="num">${ea(FS.card||"—")}</span></div>
   </div></div></div>
 </div>
 ${DOM_PLANS.includes(state.plan)?`<div class="tabs" role="tablist">
   <button role="tab" aria-selected="${tab==='dl'}" data-subtab="dl">פונטים להורדה</button>
   <button role="tab" aria-selected="${tab==='reg'}" data-subtab="reg">רישום דומיינים</button>
 </div>
 ${tab==='dl'?subsDownloads()+fontNote():subsDomains()}`:`<h2 class="h2-sec dl-only-h">פונטים להורדה</h2>${subsDownloads()+fontNote()}`}`;

/* no subscription yet: the plans on offer, as on the pricing page (academic is offered only after a request form, so it is not listed).
   Prices: as shown on the site, VAT included. Desktop ₪179 (owner, 22.10.2026); its button leads to the pricing page until there is a purchase link (links.deskSub) */
const OFFER=[
 {k:'web',name:'וובסטופ',line:'תכנית מורחבת לאתרים ולדסקטופ',uses:['דסקטופ','פלט ותנועה','UI/UX','אתרים · 3 דומיינים בחודש'],price:'₪320',cta:'להצטרפות',href:()=>FS.links&&FS.links.web,top:'תוכנית מומלצת'},
 {k:'extra',name:'אקסטרה',line:'תכנית חופשית ללא הגבלה',uses:['דסקטופ','פלט ותנועה','UI/UX','אתרים חופשי','אפליקציות חופשי','תשדיר'],price:'₪680',cta:'להצטרפות',href:()=>FS.links&&FS.links.extra},
 {k:'desk',name:'דסקטופ',line:'מינוי לעבודה בתוכנות במחשב',uses:['דסקטופ','פלט ותנועה','UI/UX'],price:'₪179',cta:'להצטרפות',href:()=>FS.links&&FS.links.deskSub}
];
const PRICING='https://fontshok.co.il/מחירון-רישיונות-ומנויים/';
/* comparison, from the pricing page ("השוואת המינוי שלנו"); columns desktop · Webstop · Extra (Webstop in the middle, highlighted) */
const CMP_COLS=['desk','web','extra'];
const CMP=[
 ['grp','עיצוב גרפי, סושיאל ווידאו'],
 ['עיצוב תוצרי דסקטופ','אדובי, אופיס, פיגמה',1,1,1],
 ['עיצוב תוצרי פלט','מצגות, פוסטים, עיצובים לדיגיטל',1,1,1],
 ['עיצוב תוצרי תשדיר','וידאו, כתוביות, שידור טלוויזיוני',0,0,1],
 ['grp','תנועה וחוויית משתמש'],
 ['עיצוב תוצרי תנועה','סרטונים, אנימציות, לוגו חי',1,1,1],
 ['עיצוב תוצרי UI/UX','פיגמה (Figma), אקס־די (Xd) לתכנון ממשק',1,1,1],
 ['grp','מערכות ומוצרים דיגיטליים'],
 ['עיצוב תוצרי אינטרנט','הגבלת דומיינים וכניסות חודשיות',0,'שלושה דומיינים בחודש','דומיינים ללא הגבלה'],
 ['עיצוב תוצרי אפליקציה','הגבלת אפליקציות, הורדות, משתמשים',0,0,'אפליקציות ללא הגבלה']
];
const SYM={extra:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgZGF0YS1uYW1lPSJMYXllciAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzNzIuMTEgMjYyLjEiPgogIDxwYXRoIGQ9Ik0yNDcuMDcsMjExLjU0bC0uMDcsMS4wOGMtMTcuOCwxNi4zOC0zNS44OSwyOC41LTU0LjI5LDM2LjM2LTIwLjQ3LDguNzQtMzcuMDEsMTMuMTItNjIsMTMuMTItMzQuMDYsMC02Ni40Ni0xNC4xMy05MC4xMS0zNi42NEMxMy4xOSwxOTkuMzYuODQsMTY2LjQ5LjAyLDEyMS4xMi0uNjYsODMuMjIsMTQuOTEsNTMuMiwzOS40LDMwLjk0LDU5Ljg4LDEyLjMzLDgzLjksMi4xMiwxMTEuNDkuMzFjMzAuMzgtMi4wMSw1Ni44LDUuNzcsNzkuMjYsMjMuMzIsMTguNDUsMTQuNDEsMzEuODMsMzMuMDIsNDAuMTgsNTUuOGwtMS4yMSwxLjY0TDQ5Ljc2LDE4Mi4xMWwtMTUuNS0zNy4wNSwxMzUuNzktNzYuNThjLTQuMjctOC41LTEwLjk5LTE1LjI4LTIwLjE2LTIwLjM1LTEwLjEyLTUuNTktMjEuNDYtNy45Ni0zNC4wNC03LjEzLTE3LjAzLDEuMTQtMzIsNy41NS00NC45MSwxOS4yNS0xNS4zOCwxMy45My0yMy4yMywzMi4zMS0yMy41Niw1NS4xMi0uMzcsMjYuNDYsNS42MSw0OC44NywxNy45Myw2Ny4yMSwxNC40OSwyMS41NSwzOC41MSwzMy41OCw2NS45NCwzNC41OSwxNi42My42MiwyOS43NS0zLjUsNDUuNDYtMTAuODUsMTEuOTMtNS41OCwyNS43OS0xNC43MSw0MS41OC0yNy40MWgxLjA5bDI3LjY4LDMyLjYyWiIvPgogIDxwYXRoIGQ9Ik0zNzIuMTEsMjU5LjM4bC0uMTUsMi4xOGgtNjMuMDdsLTEyMS4wOC0xMzguOTcuMTYtMi4zMywzOS44Mi0yMS42NCwzNS44MiwzOS45YzI2LjEyLTI4LjQ2LDQ4Ljk4LTYwLjkzLDY0LjMyLTg5LjMxbDQyLjIzLDEwLjk3LjQsMi4xN3MtMjguNTcsNDguNzktNTguNDEsODQuMTNjLTUuMzEsNi4yOS0xMy4wMSwxNC44Ni0yMC42NiwyMy4wOWw4MC42Miw4OS44MVoiLz4KPC9zdmc+',web:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgZGF0YS1uYW1lPSJMYXllciAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMzYuMTIgMjY4LjgiPgogIDxkZWZzPgogICAgPHN0eWxlPgogICAgICAuY2xzLTEgewogICAgICAgIGZpbGw6ICMwMTAxMDE7CiAgICAgIH0KICAgIDwvc3R5bGU+CiAgPC9kZWZzPgogIDxwYXRoIGNsYXNzPSJjbHMtMSIgZD0iTTMzNi4xMiwxMjMuOTRsLTE3LjY2LDM2LjMyLTEuMDIuNTEtMjUuMDktMjMuNTUtLjUxLjUxYy0uMDMsNi43NS0uNzUsMTIuMTktMS4yNiwxNi0xMi43MSw5NC4xMS01OC40LDExNS4wNy0xMDIuMTcsMTE1LjA3LTIwLjQ4LDAtMzQuODEtMTIuMjktNDcuNjEtNDMuNTJoLS41MmMtMTguNDMsMzEuMjMtNDEuNDcsNDMuMDEtNjguNiw0My4wMS00Ni42LDAtNTMuNzYtNDAuMzctNTMuNzYtNjkuMDQsMC00My4wOCw3LjM4LTc0Ljc2LDI1LjE0LTE0My4wOSwwLTYuNjYtMy4wNy0xMC43NS05LjczLTEwLjc1LTYuMTQsMC0xMy4zMSwzLjA3LTE4LjQzLDYuMTRsLTIuNTYtMS41NEwwLDEzLjMxbDEuNTMtMi41NkMxNy40LDUuMTIsMzMuMjgsMCw1MC42OCwwYzE4Ljk1LDAsMzkuNDMsOC4xOSwzOS40MywzNi44NywwLDIzLjA0LTI0LjMsODkuNjMtMjQuNDIsMTQ2LjE3LS4wNSwyNS42LDEzLDM2LjUzLDMwLjA1LDMzLjAzLDM3LjM4LTcuNjgsNDEuNDctNjYuNjQsNDEuNjItOTQuOC4xLTE5LjExLS4wNy0yNy40Ny0uNjYtMzEuNzRsMS41NC0xLjU0LDQ1LjA1LTQuMDIsMS41NCwyLjA1Yy41MSw1LjEyLDEuMDIsMTIuMjksMS4wMiwyMC40OCwwLDQyLjQ5LTQuNjEsNjcuMDctNC42MSw4Ny4wNCwwLDE0Ljg1LDYuMjUsMjQuMiwyNC4wNywyMi41MywzMC44Mi0yLjksNDUuNzItNjEuMDMsNDMuMTYtMTQyLjQ3LDAtMjIuNDQtMi43OC01OC40LTMuNzQtNjcuMDRsMi41Ni0yLjA1TDI5MS4zMi40N2wyLjU2LDMuMDdjNC4xLDY3LjU4LDE1LjEsOTUuODMsNDEuNzMsMTE4LjM1bC41MSwyLjA1WiIvPgo8L3N2Zz4=',desk:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjEzMiAxMTggMjQ2IDI3MCI+CiAgPGcgZmlsbD0iIzAxMDEwMSI+CiAgICA8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xMzYgMzAwYTg2IDgyIDAgMSAwIDE3MiAwYTg2IDgyIDAgMSAwLTE3MiAwWk0xOTAgMzAwYTM2IDQ2IDAgMSAwIDcyIDBhMzYgNDYgMCAxIDAtNzIgMFoiLz4KICAgIDxwYXRoIGQ9Ik0yNzAgMTQ2bDU2LTI0djE5NmMwIDI2IDEyIDM2IDM4IDMybDEwIDM0Yy01MiAxNi0xMDQgMi0xMDQtNThaIi8+CiAgPC9nPgo8L3N2Zz4=',acad:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgZGF0YS1uYW1lPSJMYXllciAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyODQuMjMgMjY1LjcxIj4KICA8ZGVmcz4KICAgIDxzdHlsZT4KICAgICAgLmNscy0xIHsKICAgICAgICBmaWxsOiAjMDEwMTAxOwogICAgICB9CiAgICA8L3N0eWxlPgogIDwvZGVmcz4KICA8cGF0aCBjbGFzcz0iY2xzLTEiIGQ9Ik0yODQuMjMsMTI3Ljk4YzAsMTExLjExLTcyLjcsMTM3LjczLTEyMy45LDEzNy43My0yMi42MSwwLTQ3LjY3LTUuNDItNjguNDMtMjAuNjItLjY4LS41LTEuNjItLjQzLTIuMjIuMTYtNy42Myw3LjU1LTE0Ljg0LDEzLjgtMjIuMDQsMTkuNTctLjMuMjQtLjY4LjM4LTEuMDcuMzhIMS43MWMtLjk0LDAtMS43MS0uNzYtMS43MS0xLjcxaDBjMC0uNTQuMjYtMS4wNC42OC0xLjM3LDY5LjIxLTUxLjk5LDEwOS4yMy05NS4xNSwxMDkuMjMtMTM2Ljk5LDAtMjQuMDUtMTEuNjItMzQuMDgtMjUuNDQtMzQuMDgtMjEuMzEsMC0yOS4zNCwxNS4xMi0yOS4zNCwzMi4zMiwwLDE0LjQxLDUuODgsMjkuNTIsMjEuMjksNDkuMjEuMjMuMy4zNy42Ny4zNywxLjA1di44M2MwLC40MS0uMTUuOC0uNDEsMS4xMWwtMjMuNiwyNy40MmMtLjI3LjMxLS42NC41MS0xLjA0LjU3bC0uODIuMTJjLS41MS4wOC0xLjA0LS4wOC0xLjQyLS40My0yMS4wMS0xOS4zMS0zNi45My00NC40NS0zNi45My03OC45LDAtNDguNzksMzYuMS03My4yNyw3MS45MS03My4yNyw0OS42NiwwLDczLjE0LDMwLjc4LDczLjE0LDc2LjAzLDAsMjguMTYtMTcuMTIsNTcuNjQtMzYuNjUsODEuNDgtLjYxLjc0LS40OCwxLjgzLjI3LDIuNDMsMTAuMDUsNy45NCwyNy45NiwxMS42Nyw0Mi4xNiwxMS42Nyw1Ny4zNCwwLDcxLjE3LTU0Ljc4LDcxLjE3LTk0LjcyLDAtNTcuOC0zMi4zNS04MS4xLTY4Ljk0LTg0LjUzLTQuOTgtLjQ3LTkuOTktLjQ1LTE0Ljk4LS4xMmwtOS4wNC42MWMtLjQ5LjAzLS45Ny0uMTUtMS4zMi0uNWwtMS0xYy0uMzItLjMyLS41LS43NS0uNS0xLjIxVjMuNzRjMC0uNDUuMTgtLjg5LjUtMS4yMWwxLjExLTEuMTFjLjI5LS4yOS42Ni0uNDYsMS4wNi0uNDlsMi44MS0uMjRjNy4wOC0uNiwyMi43OS0xLjAzLDI5Ljg1LS4zMiw4NC4zNyw4LjQzLDExMC4xMSw3OS41LDExMC4xMSwxMjcuNjFaIi8+Cjwvc3ZnPg=='};
const cmpCell=v=>v===1?`<span class="yes" aria-label="כלול"><svg viewBox="0 0 24 24"><path d="M7.5 12.5l3 3 6-6.5"/></svg></span>`:v===0?`<span class="no" aria-label="לא כלול"><svg viewBox="0 0 24 24"><path d="M8.5 8.5l7 7m0-7l-7 7"/></svg></span>`:`<span class="cpill">${v}</span>`;
const noPlan=()=>`<div class="head-row"><div><h1 class="h1">המינוי שלי</h1><p class="sub">עוד אין לך מינוי. במינוי מקבלים את כל הפונטים להורדה, עם רישיון שימוש לפי סוג המינוי.</p></div></div>
 <div class="offers">${OFFER.map(o=>`<div class="offer offer-${o.k}">
  <div class="of-id">${logo(o.k,'')}<div><div class="of-name">${o.name}${o.top?` <span class="of-top">${o.top}</span>`:''}</div><div class="of-line">${o.line}</div><div class="of-uses">${o.uses.map((u,i)=>`${i===3?'<i class="of-br"></i>':''}<span>${u}</span>`).join('')}</div></div></div>
  <div class="of-price">${o.price?`<b class="num">${o.price}</b><small>לחודש, כולל מע״מ</small>`:'<small>המחיר בעמוד המינויים</small>'}</div>
  <a class="btn ${o.price?'btn-grad':'btn-line'} of-cta" href="${ea(o.href()||PRICING)}">${o.cta}</a>
 </div>`).join('')}</div>
 <section class="cmp" id="cmp"><h2>השוואת המינויים</h2><div class="tbl-wrap cmp-in"><i class="web-col" aria-hidden="true"></i><table>
  <thead><tr><th></th>${CMP_COLS.map(k=>`<th>${PLAN[k].label} <img class="cmp-sym" src="${SYM[k]}" alt=""></th>`).join('')}</tr></thead>
  <tbody>${CMP.map(r=>r[0]==='grp'?`<tr class="grp"><td>${r[1]}</td><td></td><td></td><td></td></tr>`:`<tr><td><b>${r[0]}</b> - ${r[1]}</td>${[2,3,4].map(i=>`<td>${cmpCell(r[i])}</td>`).join('')}</tr>`).join('')}<tr class="cmp-end"><td></td><td></td><td></td><td></td></tr></tbody>
 </table></div></section>
 <a class="of-more" href="${PRICING}">כל הפרטים על המינויים והרישיונות</a>`;
const _subs=V.subs;V.subs=tab=>FS.plan?_subs(tab):noPlan();
/* font-update note: sits under the download table ("כל הפונטים לאתרים / לדסקטופ") */
const fontNote=()=>state.noteHidden?'':`<div class="note x-new" data-new="חדש: עדכון פונט">
   <span class="note-ic">${ICON.spark}</span>
   <span class="note-txt"><b>דיסקברי רב לשוני</b>, <span class="nowrap">בגרסה חדשה <span dir="ltr">V.2</span></span></span>
   <button class="ibtn note-dl" aria-label="הורדת דיסקברי רב לשוני V.2" title="הורדה" data-t="מוריד את דיסקברי רב לשוני V.2">${ICON.dl}</button>
   <button class="ibtn note-x" data-hidenote="1" aria-label="הסתרת ההודעה">${ICON.close}</button>
 </div>`;

function subsDomains(){
 if(!DOM_PLANS.includes(state.plan))return `<p class="empty">המינוי שלך לא כולל רישום דומיינים לאתרים.</p>`;
 const p=PLAN[state.plan],list=SUBDOM[state.plan]||[],lim=p.n?p.n+EXTRA+BONUS:0,used=list.filter(s=>canEdit(s[0])).length,full=lim&&used>=lim;
 const demo=``;const _demoOff=`<div class="demo x-new" data-new="לתצוגה בלבד"><span>תצוגה לפי מינוי:</span>${['web','extra'].map(k=>`<button class="${state.plan===k?'on':''}" data-plan="${k}">${PLAN[k].label}</button>`).join('')}</div>`;
 return `${demo}
 <div class="dom-head">
   <div><b style="font-size:18px">דומיינים במינוי ${p.label}</b>
   <div class="hint" style="margin:2px 0 0">${lim?`ניתן לרשום ${p.n+EXTRA} דומיינים בכל חודש${BONUS?` + ${BONUS} נוספים שנרכשו`:''}. מתחדש ב־${nextReset()}.`:'רישום דומיינים ללא הגבלה, כל עוד המינוי פעיל.'}</div></div>
   ${lim?`<div class="usage"><span class="num"><b>${used}</b> מתוך ${lim} החודש</span><span class="track"><i style="width:${Math.min(100,used/lim*100)}%;background:${full?'var(--bad)':used/lim>=.66?'var(--warn)':'var(--ok)'}"></i></span></div>`:'<span class="chip">ללא הגבלה</span>'}
 </div>
 <div class="box dom-box sub-reg ${state.regOpen?'reg-on reg-done':''}">
   ${full?quotaFullPlan():`<button class="btn btn-grad reg-open" data-regopen="1" aria-expanded="${!!state.regOpen}" aria-controls="regFold">${ICON.plus} רישום דומיין חדש</button>
   <div class="reg-fold" id="regFold"><div><div class="reg-head"><b>רישום דומיין חדש</b><button type="button" class="ibtn reg-close" data-regclose="1" aria-label="סגירה וקיפול הטופס">${ICON.close}</button></div><form class="form-row reg-row" data-subadd="1" novalidate>
     <div class="fld reg-host">${ICON.globe}<input id="sd2" placeholder="הזן דומיין חדש (למשל: example.co.il)" aria-label="כתובת הדומיין" inputmode="url" autocomplete="off" required></div>
     <div class="fld fontpick"><span id="fpl" class="sr">פונטים, עד 2</span>
       <button type="button" class="fp-btn" aria-haspopup="true" aria-expanded="false" aria-labelledby="fpl"><span class="fp-val">בחירת פונטים (עד 2)</span>${ICON.chev}</button>
       <div class="fp-menu">${DOMF.map(f=>`<label><input type="checkbox" value="${ea(f)}"> ${ea(f)}</label>`).join('')}<p class="fp-hint">אפשר לבחור עד 2 פונטים לכל אתר</p></div>
     </div>
     <button class="btn btn-grad reg-add">${ICON.plus}הוסף דומיין</button>
   </form><p class="form-err" id="sdErr" hidden></p></div></div>`}
 </div>
 <div class="tbl-wrap"><table class="tbl dom-tbl reg-tbl">${DOM_THEAD}<tbody>
 ${list.map(subRow).filter(r=>canEdit(r.s[0])).sort((a,b)=>parseD(b.s[0])-parseD(a.s[0])).map(domRow).join('')||`<tr><td colspan="5" class="hint" style="padding:18px 0">עוד לא נרשמו דומיינים החודש</td></tr>`}
 </tbody></table></div>
 <p class="hint lock-note lock-end">${ICON.lock} אפשר לערוך או להסיר עד סוף ${CYCLE.label}.</p>`;
}
function quotaFullPlan(){
 return `<div class="quota-line">
  <div class="msg"><b>ניצלת את ${PLAN[state.plan].n+EXTRA+BONUS} הדומיינים של החודש</b><span>מתחדש ב־${nextReset()}.${FS.addon?' צריך עוד עכשיו?':''}</span></div>
  ${FS.addon?'<button class="btn btn-grad" data-planaddon="1">דומיין נוסף · ₪79</button>':''}
  <a class="linkbtn" href="https://fontshok.co.il/מחירון-רישיונות-ומנויים/">או שדרוג לאקסטרה</a>
 </div>`;
}

/* weight names for a family (sample data: spread over the usual scale) */
const WEIGHTS=['Thin','ExtraLight','Light','Regular','Medium','Demibold','Bold','ExtraBold','Black'];
const weightsOf=n=>n>=WEIGHTS.length?WEIGHTS.slice():[...new Set(Array.from({length:n},(_,i)=>WEIGHTS[Math.round(i*(WEIGHTS.length-1)/Math.max(1,n-1))]))];
function weightPick(f,n,ws){
 /* one row per weight from the store, with its own site / desktop download */
 const a=(u,k,l)=>u?`<a role="menuitem" class="wdl" href="${ea(u)}" aria-label="הורדת ${ea(f)} ${ea(k)} ${l}">${ICON.dl}<span>${l}</span></a>`:'';
 return `<div class="pop wsel-pop"><button class="wsel" data-pop="1" aria-haspopup="true" aria-expanded="false" aria-label="בחירת משקל להורדה מ${ea(f)}"><span class="wsel-l">בחירת משקל</span><span class="wsel-s">משקל</span> ${ICON.chev}</button>
  <div class="pop-menu wsel-menu" role="menu">${(ws||[]).map(w=>`<div class="wrow" role="none"><span class="wn">${ea(w.n)}</span><span class="wl">${a(w.web,w.n,'אתרים')}${a(w.desk,w.n,'דסקטופ')}</span></div>`).join('')}</div></div>`;
}
function subsDownloads(){
const dlA=(u,f,k,lbl)=>u?`<a class="dl" href="${ea(u)}" aria-label="הורדת ${ea(f)} ${k}" download>${ICON.dl}<span class="dl-k">${lbl}</span></a>`:'<span class="hint" style="margin:0">—</span>';
 if(!FAMILY.length)return `<p class="empty">אין כרגע פונטים להורדה במינוי.</p>`;
 const hasW=FAMILY.some(x=>x[1]>0),web=FAMILY.some(x=>x[2]||(x[4]||[]).some(w=>w.web)); /* desktop-only plan: no web column */
 return `<div class="tbl-wrap lic-wrap"><table class="tbl dl-tbl${hasW?'':' no-w'}${web?'':' no-web'}"><thead><tr><th>שם הפונט</th><th>${hasW?'משקלים':''}</th>${web?'<th>פורמט לאתרים</th>':''}<th>פורמט לדסקטופ</th>${hasW?'<th>הורדה לפי משקל</th>':''}</tr></thead><tbody>
 ${FAMILY.map(([f,n,w,d,ws])=>`<tr><td>${ea(f)}</td><td class="num wcount">${n?n+' משקלים':''}</td>
 ${web?`<td>${dlA(w,f,'לאתרים','אתרים')}</td>`:''}
 <td>${dlA(d,f,'לדסקטופ','דסקטופ')}</td>
 ${hasW?`<td class="wsel-td">${n?weightPick(f,n,ws):''}</td>`:''}</tr>`).join('')}
 </tbody></table></div>`;
}

/* פונטים שלי: one list, one row per purchased license. Download + certificate on every row;
   web licenses also show their own domain counter and open a drawer to register. No tabs. */
V.lic=(tab,open)=>`
 <div class="head-row"><div><h1 class="h1">פונטים שלי</h1><p class="sub">פונטים שקנית בנפרד, מחוץ למינוי.</p></div>${LIC.length?licFilterBar():''}</div>
 ${LIC.length?licTable(open):licEmpty()}`;

/* no purchased fonts yet: a specimen card with an outlined aleph (anchor points, a pen handle) and the way to the shop */
function licEmpty(){
 const sp=(x,y,r,c)=>`<path class="le-sp" style="animation-delay:${(x%7)/10}s" fill="${c}" d="M${x} ${y-r}C${x+r*.18} ${y-r*.18} ${x+r*.18} ${y-r*.18} ${x+r} ${y}C${x+r*.18} ${y+r*.18} ${x+r*.18} ${y+r*.18} ${x} ${y+r}C${x-r*.18} ${y+r*.18} ${x-r*.18} ${y+r*.18} ${x-r} ${y}C${x-r*.18} ${y-r*.18} ${x-r*.18} ${y-r*.18} ${x} ${y-r}Z"/>`;
 const an=(x,y)=>`<rect x="${x-3}" y="${y-3}" width="6" height="6" fill="#fff" stroke="#5B3FFF" stroke-width="1.4"/>`;
 return `<div class="lic-empty">
 <svg class="le-art" viewBox="0 0 260 200" aria-hidden="true" focusable="false">
  <defs>
   <linearGradient id="leBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#EFE8FF"/><stop offset="1" stop-color="#FDE7F6"/></linearGradient>
   <linearGradient id="leG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5B3FFF"/><stop offset=".55" stop-color="#A55BFF"/><stop offset="1" stop-color="#F28AD6"/></linearGradient>
  </defs>
  <path fill="url(#leBg)" d="M40 70C46 30 98 10 150 16S240 52 236 104 196 190 132 188 30 164 26 124 34 92 40 70Z"/>
  <rect x="62" y="34" width="140" height="140" rx="18" fill="#E7DCFB"/>
  <rect x="56" y="28" width="140" height="140" rx="18" fill="#fff" stroke="#ECE3F8"/>
  <g stroke="#E3D3FA" stroke-dasharray="3 4" stroke-width="1"><path d="M68 56H184M68 142H184"/></g>
  <g transform="translate(62.5 34.5) scale(1.075)">
   <path fill="url(#leG)" d="M20 20H44L100 100H76Z"/>
   <path fill="url(#leG)" d="M78 20H100V34Q100 54 70 60L62 46Q78 42 78 32Z"/>
   <path fill="url(#leG)" d="M22 100H44V82Q44 68 58 64L50 50Q22 58 22 80Z"/>
   <path fill="none" stroke="#2A1F4F" stroke-width=".9" d="M20 20H44L100 100H76Z"/>
   <path stroke="#9C59CF" stroke-width="1" d="M56 70L86 50"/>
   <circle cx="56" cy="70" r="2.6" fill="#fff" stroke="#9C59CF" stroke-width="1.2"/><circle cx="86" cy="50" r="2.6" fill="#fff" stroke="#9C59CF" stroke-width="1.2"/>
   ${an(20,20)}${an(44,20)}${an(100,100)}${an(76,100)}${an(70,60)}
  </g>
  <g transform="translate(222 168) rotate(-35)"><path fill="#2A1F4F" d="M0 0L-9 -24H9Z"/><path fill="#B075FF" d="M-9 -24H9V-32H-9Z"/><circle cx="0" cy="-10" r="2.2" fill="#fff"/><path stroke="#fff" stroke-width="1.2" d="M0 -8V-1"/></g>
  ${sp(34,46,9,'#F28AD6')}${sp(226,58,7,'#B075FF')}${sp(40,156,6,'#B075FF')}${sp(150,190,5,'#F28AD6')}
 </svg>
 <div class="le-txt">
  <h2 class="le-t">האותיות כבר מחכות לך</h2>
  <p class="le-p">עוד לא רכשת פונטים בנפרד. פונט שתקנה בחנות יופיע כאן, עם הקבצים, תעודת הרישיון והאתרים שלו.</p>
  <div class="le-acts"><a class="btn btn-grad le-cta" href="${ea(FS.links&&FS.links.desk||'https://fontshok.co.il/')}">לחנות הפונטים</a><a class="le-link" href="https://fontshok.co.il/מחירון-רישיונות-ומנויים/">למחירון הרישיונות</a></div>
 </div>
</div>`}

/* one row per font + weight. Every purchased licence stays its own record (own certificate, own files);
   the row only groups them: all licence names as tags, certificate/download offer a choice when there is more than one */
/* one row per font: every licence and weight bought for it sits on the same row */
function licGroups(){const g=new Map();LIC.forEach((l,i)=>{const k=l.f;if(!g.has(k))g.set(k,[]);g.get(k).push(i)});return [...g.values()]}
const FMT={'וובפונט':'לאתרים (WOFF2)','דסקטופ':'לדסקטופ (OTF)','אפליקציה':'לאפליקציה'};
/* names an item in a row's menus, in Hebrew: "אזכור במשקל קל"; the licence type or order is added only when it is needed to tell two apart */
const licTag=(i,ids)=>{const L=LIC[i];let s=L.w?`${ea(L.f)} במשקל ${ea(L.w)}`:ea(L.f);
 const same=ids.filter(j=>(LIC[j].w||'')===(L.w||''));
 if(same.length>1){if(!same.every(j=>LIC[j].t===L.t))s+=` · ${ea(L.t)}`;else s+=L.oid?` · הזמנה #${ea(L.oid)}`:` · ${same.indexOf(i)+1}`}
 return s};
/* all of a row's weights on one line, cut with "…" when they don't fit; the full list floats on hover / tap */
const wcell=ws=>ws.length?`<span class="wcell" tabindex="0"><span class="wlist">${ws.map(ea).join(', ')}</span><span class="wtip" role="tooltip">${ws.map(ea).join('<br>')}</span></span>`:'';
function choice(icon,label,cls,items){
 if(items.length===1)return items[0].replace('%B',`class="${cls}" aria-label="${label}" title="${label}"`).replace('%I',icon);
 return `<div class="pop"><button class="${cls}" data-pop="1" aria-haspopup="true" aria-expanded="false" aria-label="${label}" title="${label}">${icon}</button><div class="pop-menu" role="menu">${items.map(x=>x.replace('%B','role="menuitem"').replace('%I','')).join('')}</div></div>`;
}
/* filter by licence type (row shows when any of its licences has that type) */
const LIC_TYPES=['וובפונט','דסקטופ','אפליקציה'];
/* only the licence types this customer owns; no bar when there is just one */
const ownedTypes=()=>LIC_TYPES.filter(t=>LIC.some(l=>l.t.split(' + ').includes(t)));
const licFilterBar=()=>{const ts=ownedTypes();if(!ts.includes(state.licFilter))state.licFilter='';if(ts.length<2)return '';return `<div class="seg-f" role="group" aria-label="סינון לפי רישיון">${['',...ts].map(t=>`<button data-licf="${t||'all'}" aria-pressed="${(state.licFilter||'')===t}">${t||'הכל'}</button>`).join('')}</div>`};
function licTable(open){
 /* the weight column shows only when the store gives weight names */
 const hasSites=LIC.some(l=>l.web),hasW=LIC.some(l=>l.w),cols=(hasSites?5:4)-(hasW?0:1);
 return `<div class="tbl-wrap lic-wrap"><table class="tbl"><thead><tr><th>שם הפונט</th>${hasW?'<th>משקל</th>':''}<th>רישיון</th>${hasSites?'<th>ניצול אתרים</th>':''}<th></th></tr></thead><tbody>
 ${licGroups().filter(ids=>!state.licFilter||ids.some(i=>LIC[i].t.split(' + ').includes(state.licFilter))).map(ids=>{const L=ids.map(i=>LIC[i]),l=L[0],wi=ids.find(i=>LIC[i].web),w=wi===undefined?null:LIC[wi],isOpen=w&&open===wi,full=w&&w.u>=w.n;
 const types=[...new Set(L.flatMap(x=>x.t.split(' + ')))];
 /* one certificate per font, listing every weight bought for it */
 const certs=[`<button %B data-cert="lic:${ids.join(',')}">%I</button>`];
 const dls=ids.filter(i=>LIC[i].dl).map(i=>`<a %B href="${ea(LIC[i].dl)}" download>%I${ids.filter(j=>LIC[j].dl).length>1?`הורדת ${licTag(i,ids)}`:''}</a>`);
 return `<tr class="${isOpen?'is-open':''}">
 <td><span class="fname">${w?`<button class="ibtn exp" data-open="${wi}" aria-expanded="${isOpen}" aria-label="${isOpen?'סגירת':'פתיחת'} רישום האתרים של ${l.f}" title="${isOpen?'סגירה':'רישום אתרים'}">${ICON.globe}</button>`:'<span class="exp-ph"></span>'}${l.f}</span></td>
 ${hasW?`<td class="wcol">${wcell([...new Set(L.map(x=>x.w).filter(Boolean))])}</td>`:''}<td>${types.map(x=>`<span class="ltag">${x}</span>`).join(' ')}</td>
 ${hasSites?`<td>${w?meter(w.u,w.n):''}</td>`:''}
 <td><div class="acts">
   ${choice(ICON.cert,'תעודת רישיון','ibtn',certs)}
   ${dls.length?choice(ICON.dl,`הורדת ${ea(l.f)}`,'btn dl-sm',dls):''}</div></td></tr>
 ${isOpen?licDrawer(wi,cols,full):''}`}).join('')}
 ${state.licFilter&&!licGroups().some(ids=>ids.some(i=>LIC[i].t.split(' + ').includes(state.licFilter)))?`<tr><td colspan="${cols}" class="hint" style="padding:22px 16px">אין פונטים עם רישיון ${state.licFilter}</td></tr>`:''}
 </tbody></table></div>`;
}
function licDrawer(i,cols,full){const l=LIC[i];
 return `<tr class="drawer"><td colspan="${cols}"><div class="lic-drawer"><div class="box dom-box">
   ${full?quotaFull(l):`
   <form class="form-row lic-form" data-add="${i}">
     <div class="fld"><label for="su${i}">כתובת האתר *</label><input id="su${i}" data-namefor="sn${i}" placeholder="fontshok.co.il" dir="ltr" inputmode="url" autocomplete="off" required></div>
     <div class="fld"><label for="sn${i}">שם האתר <span style="color:var(--muted)">(רשות)</span></label><input id="sn${i}" class="sitename" placeholder="יתמלא אוטומטית מהכתובת"></div>
     <button class="btn btn-grad" style="height:40px">רישום אתר</button>
   </form>`}
   </div>
   <table class="mini lined"><thead><tr><th>תאריך</th><th>שם האתר</th><th>כתובת אתר</th><th></th></tr></thead><tbody>
   ${l.sites.map((s,j)=>state.editKey===`dom:${i}:${j}`
     ?`<tr class="editing" data-key="dom:${i}:${j}"><td class="num">${s[0]}</td>${editCells(s[1],s[2])}<td>${editBtns()}</td></tr>`
     :`<tr><td class="num">${s[0]}</td><td>${s[1]}</td><td><bdi dir="ltr">${s[2]}</bdi></td>
   <td>${rowActs(`dom:${i}:${j}`,s[0],`dom:${i}:${j}`,`data-del="${i}:${j}"`)}</td></tr>`).join('')}
   </tbody></table></div></td></tr>`;
}
function quotaFull(l){
 return `<div class="quota-line">
  <div class="msg"><b>כל ${l.n} האתרים של הרישיון רשומים</b>${FS.addon?'<span>צריך עוד אתר? אפשר להוסיף אחד בתשלום חד־פעמי.</span>':'<span>אפשר להסיר אתר כדי לפנות מקום.</span>'}</div>
  ${FS.addon?`<button class="btn btn-grad" data-addon="${LIC.indexOf(l)}">הוספת אתר · ₪79</button>`:''}
  <a class="linkbtn" href="https://fontshok.co.il/מחירון-רישיונות-ומנויים/">או מינוי וובסטופ</a>
 </div>`;
}

/* one domain row, shared by "דומיינים" and "המינוי שלי → רישום דומיינים" so both look the same */
const DOM_THEAD=`<thead><tr><th>דומיין</th><th>פונטים</th><th>מינוי</th><th>תאריך רישום</th><th></th></tr></thead>`;
const subRow=(s,j)=>({s,src:`<span class="src sub">${logo(state.plan)}${PLAN[state.plan].label}</span>`,font:s[3],cert:`sd:${j}`,del:`data-sddel="${j}"`});
function domRow(r){return state.editKey===r.cert
   ?`<tr class="editing" data-key="${r.cert}"><td><div class="ed-pair stacked">${editHost(r.s[1],r.s[2])}</div></td><td>${r.cert.startsWith('sd:')?fontPicker(r.font.split(', ').filter(Boolean)):r.font}</td><td>${r.src}</td><td class="num">${r.s[0]}</td><td>${editBtns()}</td></tr>`
   :`<tr><td><span class="site-n">${r.s[1]}</span><bdi dir="ltr" class="sm">${r.s[2]}</bdi></td><td>${r.font}</td><td>${r.src}</td><td class="num">${r.s[0]}</td>
 <td>${rowActs(r.cert,r.s[0],r.cert,r.del)}</td></tr>`}

/* דומיינים: read-only overview of every site, whatever it came through. Registering happens in "המינוי שלי" or "פונטים שלי". */
V.dom=()=>{
 const p=PLAN[state.plan];
 const fromSub=SUBDOM[state.plan].map(subRow);
 const fromLic=LIC.map((l,i)=>l.web?l.sites.map((s,j)=>({s,src:`<span class="src buy">רכישה</span>`,font:`${l.f} ${l.w}`,cert:`dom:${i}:${j}`,del:`data-del="${i}:${j}"`})):[]).flat();
 const all=[...fromSub,...fromLic].sort((a,b)=>parseD(b.s[0])-parseD(a.s[0]));
 const now=all.filter(r=>canEdit(r.s[0])),past=all.filter(r=>!canEdit(r.s[0]));
 const row=domRow;
 /* history grouped by month, newest first */
 let last='';const hist=past.map(r=>{const d=parseD(r.s[0]),k=`${MONTHS[d.getMonth()]} ${d.getFullYear()}`;const h=k!==last?`<tr class="mgroup"><td colspan="5">${k}</td></tr>`:'';last=k;return h+row(r)}).join('');
 const thead=DOM_THEAD;
 return `
 <div class="head-row"><div><h1 class="h1">דומיינים</h1><p class="sub">כל האתרים שלך במקום אחד. רישום אתר חדש נעשה במינוי או בפונט שרכשת.</p></div>
  <div class="head-act"><button class="btn btn-grad" data-go2="subs" aria-label="רישום אתר במינוי" title="רישום אתר במינוי">${ICON.plus}<span class="ha-l">רישום אתר במינוי</span></button></div></div>
 <h2 class="h2-sec sec-row">החודש · ${CYCLE.label} ${_n.getFullYear()}<span class="sec-note">${ICON.lock} אפשר לערוך או להסיר עד סוף ${CYCLE.label}.</span><button class="sec-add" data-go2="subs" aria-label="רישום אתר במינוי" title="רישום אתר במינוי">${ICON.plus}</button></h2>
 <div class="tbl-wrap"><table class="tbl dom-tbl">${thead}<tbody>
 ${now.map(row).join('')||`<tr><td colspan="5" class="hint">עוד לא נרשמו דומיינים החודש</td></tr>`}
 </tbody></table></div>
 <button class="hist-toggle" data-hist="1" aria-expanded="${!!state.histOpen}" aria-controls="histBody">${ICON.chev}<span class="h2-sec" style="margin:0">היסטוריית דומיינים <span class="hint" style="margin:0;font-weight:400">${past.length} דומיינים</span></span></button>
 <div class="hist-body ${state.histOpen?'open':''}" id="histBody"><div><div class="tbl-wrap hist-scroll"><table class="tbl dom-tbl">${thead}<tbody>${hist}</tbody></table></div></div></div>`;
};

V.orders=(open)=>`
 <div class="head-row"><div><h1 class="h1">הזמנות</h1><p class="sub">כאן מופיעות ההזמנות (רכישות) שביצעת</p></div>
  <div class="fld"><input placeholder="חיפוש לפי מספר הזמנה" style="width:240px;max-width:100%" aria-label="חיפוש הזמנה" id="oq" inputmode="numeric"></div></div>
 <div class="tbl-wrap"><table class="tbl otbl"><thead><tr><th>מספר הזמנה</th><th>תאריך</th><th>פירוט</th><th>סטטוס</th><th>סה״כ</th><th></th></tr></thead><tbody id="otb">${ORDERS.length?"":`<tr><td colspan="6" class="empty">עוד אין הזמנות.</td></tr>`}
 ${ORDERS.map((o,i)=>{const sum=o.total!=null?o.total:o.items.reduce((a,b)=>a+b[1],0);const tot=sum;const paid=!!o.inv;return `<tr data-oid="${o.id}" class="orow"><td class="num"><span class="oid"><button class="ibtn eye${open===i?' on':''}" aria-label="פירוט ההזמנה" data-oopen="${i}" aria-expanded="${open===i}">${ICON.eye}</button>#${o.id}</span></td><td class="num">${o.d.slice(0,6)+o.d.slice(8)}</td><td class="odet" title="${o.items.map(x=>x[0]).join(' + ')}"><span>${o.items[0][0]}</span>${o.items.length>1?`<span class="more">+${o.items.length-1}</span>`:''}</td>
 <td><span class="chip ${o.st==='הושלם'?'ok':o.st==='בוטל'?'bad':'wait'}">${o.st}</span></td><td class="num">${ils(tot)}</td>
 <td><div class="acts">${o.pay?`<a class="btn btn-grad" href="${ea(o.pay)}">לתשלום</a>`:o.inv?`<a class="ibtn" href="${ea(o.inv)}" target="_blank" rel="noopener" aria-label="הורדת חשבונית">${ICON.doc}</a>`:''}</div></td></tr>
 ${open===i?`<tr class="drawer"><td colspan="6"><div class="box">
   <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px"><b>${o.invNum?"חשבונית מס/קבלה "+ea(o.invNum):"הזמנה #"+o.id}</b><span class="chip ${o.st==='הושלם'?'ok':o.st==='בוטל'?'bad':'wait'}">${paid?'שולם':ea(o.st)}</span></div>
   <table class="mini"><tbody>${o.items.map(it=>`<tr><td>${it[0]}</td><td class="num" style="text-align:left">${ils(it[1])}</td></tr>`).join('')}
   <tr><td style="color:var(--muted)">לפני מע״מ</td><td class="num" style="text-align:left">${ils(+(sum/1.18).toFixed(2))}</td></tr>
   <tr><td style="color:var(--muted)">מע״מ 18%</td><td class="num" style="text-align:left">${ils(+(sum-sum/1.18).toFixed(2))}</td></tr>
   <tr><td><b>סה״כ</b></td><td class="num" style="text-align:left"><b>${ils(sum)}</b></td></tr></tbody></table>
   ${o.inv?`<div style="display:flex;justify-content:flex-end;margin-top:12px"><a class="btn btn-grad" href="${ea(o.inv)}" target="_blank" rel="noopener">${ICON.dl} הורדת חשבונית</a></div>`:o.pay?`<div style="display:flex;justify-content:flex-end;margin-top:12px"><a class="btn btn-grad" href="${ea(o.pay)}">לתשלום</a></div>`:''}
 </div></td></tr>`:''}`}).join('')}
 </tbody></table></div>`;

V.profile=(tab)=>`
 <div class="head-row"><div><h1 class="h1">פרופיל</h1><p class="sub">כאן ניתן לעדכן את הפרטים האישיים שלך</p></div></div>
 <div class="tabs" role="tablist">
  <button role="tab" aria-selected="${tab==='me'}" data-subtab="me">פרטים אישיים</button>
  <button role="tab" aria-selected="${tab==='biz'}" data-subtab="biz">פרטי חשבונית</button>
  <button role="tab" aria-selected="${tab==='pwd'}" data-subtab="pwd">עדכון סיסמה</button>
  <button role="tab" aria-selected="${tab==='prefs'}" data-subtab="prefs" class="x-new" data-new="ממתין לנתונים מהאתר">העדפות</button>
 </div>
 <form class="pf" id="pform">
 ${tab==='me'?`<div class="grid3">
   <div><label for="p1">שם פרטי*</label><input id="p1" value="${ea(FS.user.first)}" autocomplete="given-name" required></div>
   <div><label for="p2">שם משפחה*</label><input id="p2" value="${ea(FS.user.last)}" autocomplete="family-name" required></div>
   <div><label for="p4">כתובת אימייל*</label><input id="p4" type="email" value="${ea(FS.user.email)}" autocomplete="email" required></div>
   <div><label for="p3">שם עסקי</label><input id="p3" value="${ea(FS.user.company)}" autocomplete="organization"><div class="hint">יופיע בתעודות הרישיון</div></div>
   <div><label for="p5">טלפון</label><input id="p5" class="num" value="${ea(FS.user.phone)}" autocomplete="tel" inputmode="tel"></div>
 </div>`:tab==='biz'?`<div class="grid3">
   <div><label for="b1">שם לחשבונית</label><input id="b1" value="${ea(FS.user.company)}"></div>
   <div><label for="b2">ח.פ / ע.מ</label><input id="b2" class="num" value="${ea(FS.user.vat)}" inputmode="numeric"></div>
   <div><label for="b4">כתובת</label><input id="b4" value="${ea(FS.user.address)}" autocomplete="street-address"></div>
 </div><p class="hint" style="margin-top:14px">הפרטים יופיעו בחשבוניות הבאות.</p>`:tab==='pwd'?`<div class="grid3">
   <div><label for="w1">סיסמה נוכחית</label><input id="w1" type="password" autocomplete="current-password"></div>
   <div><label for="w2">סיסמה חדשה</label><input id="w2" type="password" autocomplete="new-password"><div class="hint">לפחות 8 תווים, כולל אותיות ומספרים</div></div>
 </div>`:`<div class="prefs">
   ${[['עדכוני פונטים','כשפונט שרכשת או שכלול במינוי מקבל גרסה חדשה.',1],['ניוזלטר פונטשוק','פונטים חדשים, השראה ומבצעים. בערך פעמיים בחודש.',1],['תזכורת לפני חידוש','מייל 7 ימים לפני החיוב הבא.',1],['מכסת דומיינים','מייל כשניצלת את כל הדומיינים של החודש.',0],['פונטים חדשים במינוי','כשמשפחה חדשה נוספת לחבילה שלך.',0]].map(([h,d,on],i)=>`<label class="pref" for="pr${i}"><div><b>${h}</b><span>${d}</span></div><input type="checkbox" class="sw" id="pr${i}" ${on?'checked':''}></label>`).join('')}
 </div>`}
 <div class="form-actions"><button class="btn btn-grad">${tab==='pwd'?'עדכון סיסמה':'שמירת שינויים'}</button></div>
 </form>`;

/* certificate — same layout as the current PDF, plus the subscription logo */
function cert(l,site){
 const s=SUBS[l.sub];
 return `<div class="cert">
  <div class="cert-head"><h2>${site?'רישיון פונט לדומיין':'רישיון שימוש בפונט'}</h2>${l.sub==='buy'?'':`<img src="${s.logo}" alt="מינוי ${s.name}">`}</div>
  <div class="cert-body">
   <div class="cert-row"><div class="who"><span style="color:var(--muted)">רושם הרישיון</span><b>${ea((FS.user.first||"")+" "+(FS.user.last||""))}</b>${ea(FS.user.email)}</div><div style="text-align:left">מונפק על ידי פונטשוק בע״מ<br>מספר תעודה <span class="num" dir="ltr">${ea(l.certNo||'—')}</span></div></div>
   <p style="margin:0">בהתאם להסכם הרישוי ותנאי השימוש של פונטשוק בע״מ, מאושר בזאת כי הפונט הרשום להלן מותר לשימוש ${site?'בתחומי עיצוב ממשק והטמעה באתר הרשום בלבד, תחת הדומיין שלהלן:':`בתחומים הכלולים ברישיון ${l.t}:`}</p>
   <dl>${site?`<dt>שם האתר:</dt><dd>${site[1]}</dd><dt>כתובת הדומיין:</dt><dd><bdi dir="ltr">${site[2]}</bdi></dd>`:''}<dt>רישיון לפונט:</dt><dd>${ea(l.f)}${l.w?(String(l.w).includes(',')?` · משקלים: ${ea(l.w)}`:` ${ea(l.w)}`):''}</dd><dt>תאריך רישום:</dt><dd class="num">${site?site[0]:ea(l.d||'—')}</dd><dt>מינוי:</dt><dd>${s.name} (${s.en})</dd><dt>סוג רישיון:</dt><dd>${l.t}</dd></dl>
   <p style="margin:0">${CERT_TEXT[l.sub](l)}</p>
   ${l.removed?`<p style="margin:0;color:var(--bad)">הדומיין הוסר מהחשבון ב־${l.removed}. הרישיון היה בתוקף בתקופה ${site[0]}–${l.removed}.</p>`:''}
   <div class="cert-foot"><div>בברכה,<br>צוות פונטשוק<br>support@fontshok.co.il</div><img class="seal" src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMzUuNjYgMzM1LjY2Ij4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iZnNQdXJwbGUiIHgxPSI2MCIgeTE9IjMwIiB4Mj0iMjgwIiB5Mj0iMzEwIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iIzhhNGZmZiIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNjMDZhZmYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxjaXJjbGUgY3g9IjE2Ny44MyIgY3k9IjE2Ny44MyIgcj0iMTY3LjgzIiBmaWxsPSJ1cmwoI2ZzUHVycGxlKSIvPgogIDxnIGZpbGw9IiNmZmYiPgogICAgPHBhdGggZD0ibTEwNS40OSwyNTguMTZ2LTcuMTRjMC03LjM2LDIuNzgtMTUuNDkwLDguMzYtMjQuMzlsNi4wNi0xMC41MWMxLjYyLTIuOTcsMi40My01LjcsMi40My04LjIyLDAtMS42Mi0uMzYtMy4xNS0xLjA4LTQuNTgtMS44LTMuNS00Ljk0LTUuMjUtOS40My01LjI1aC00MS4yM3YtMTcuMjVoNDEuMzZjMTIuMDQsMCwyMC4zOSw0LjgxLDI1LjA3LDE0LjQyLDEuOTcsNC4xMywyLjk2LDguMzEsMi45NiwxMi41MywwLDUuNDgtMS44LDExLTUuMzksMTYuNTdsLTYuMiwxMC43OGMtMi45Nyw0Ljg1LTQuNDUsMTAuMjktNC40NSwxNi4zMXY2Ljc0aC0xOC40NlptLTMwLjcyLDE3LjY1di02NS43NWgxOC44N3Y2NS43NWgtMTguODdaIi8+CiAgICA8cGF0aCBkPSJtMTQ4Ljg4LDE5OC42di0xNy43OWgyNC45M3YxNy43OWgtMjQuOTNabTI0LjkzLDguNzZ2NTAuOGgtMTguOTl2LTUwLjhoMTguOTlaIi8+CiAgICA8cGF0aCBkPSJtMjQ2LjAzLDI0MC43OGM4LjA4LDAsMTIuMTItNC44NSwxMi4xMi0xNC41NXYtNDUuNDFoMTguODd2NDVjLS4wOSw5LjUyLTMuMSwxNy4zLTkuMDQsMjMuMzEtNS45Miw2LjAyLTEzLjM4LDkuMDMtMjIuMzYsOS4wMzBoLTU3Ljk0di03Ny4zNGgxOC45OXY1OS45NmgzOS4zNVptMS4zNC00Mi43MWgtMy42M2MtNC41OCwwLTcuNjksMS4zOS05LjMsNC4xOC0uNTQuOTktLjgxLDIuMDctLjgxLDMuMjMwLDAsMS45OC44Niw0LjE4LDIuNTcsNi42MWw3LjQsOS43LTEzLjA3LDkuOTctOC4zNC0xMC4xMWMtMy42OC00Ljc2LTUuNTMtOS44OC01LjUzLTE1LjM2LDAtMy41Ljc2LTcuMTksMi4yOS0xMS4wNSw0Ljc2LTkuNjEsMTMuMTYtMTQuNDIsMjUuMTktMTQuNDJoMy4xbC4xMywxNy4yNVoiLz4KICAgIDxwYXRoIGQ9Im01MS43NSwxNjMuMTd2LTc3LjM0aDE4Ljg2djU5Ljk2aDIzLjE4YzkuMTYsMCwxMy43NC00Ljg1LDEzLjc0LTE0LjU1di0yNy4wOGgtMS4yMmwtMTAuNSwxNC41NS0uMTMtLjEzaC0xOC42bC4xMy0xLjg5LDI0LjEyLTMwLjg2aDI0LjY2djQ1YzAsOS41Mi0yLjY4LDE3LjMtOC4wMywyMy4zMS01LjM0LDYuMDItMTIuNTYsOS4wMy0yMS42Miw5LjAzaC00NC42WiIvPgogICAgPHBhdGggZD0ibTE2My40NSw4NS44M3YxMS4wNWMwLDMuNi42Nyw2Ljc4LDIuMDIsOS41N2w2LjM0LDEyLjY2YzMuMzEsNi4yLDQuOTgsMTEuOSw0Ljk4LDE3LjExLDAsMy45Ni0uOTksOC0yLjk2LDEyLjEzLTQuNjcsOS42Mi0xMi45LDE0LjU1LTI0LjY2LDE0LjgzaC0xNy4xMXYtMTcuMzloMTYuNTdjNC40LDAsNy42My0xLjYyLDkuNy00Ljg1LDIuMDYtMy4yMywxLjUyLTcuNjQtMS42Mi0xMy4yMWwtOC4zNi0xNi40NGMtMi43OS01LjY2LTQuMTgtMTEuMjctNC4xOC0xNi44NHYtOC42MmgxOS4yOFoiLz4KICAgIDxwYXRoIGQ9Im0xODEuNzYsMTAzLjYxdi0xNy43OWgyNC45MnYxNy43OWgtMjQuOTJabTI0LjkyLDguNzZ2NTAuOGgtMTguOTl2LTUwLjhoMTguOTlaIi8+CiAgICA8cGF0aCBkPSJtMjMyLjI5LDEzNi43NmwtNy42OS0xMC4xMWMtNi4xMS03LjktNy4xOC0xNi43MS0zLjIyLTI2LjQsNC43Ni05LjYxLDEzLjE2LTE0LjQyLDI1LjE5LTE0LjQyaDM2Ljkydjc3LjM0aC02Mi4zOHYtMTcuMzloNDMuMzl2LTQyLjcxaC0xOC4zMmMtNC41OCwwLTcuNjYsMS4zNy05LjIzLDQuMTEtMS41ODAsMi43NC0xLjAxLDYuMDQsMS42OCw5LjkxbDguNjMsMTEuOTktMTQuOTYsNy42OFoiLz4KICA8L2c+Cjwvc3ZnPgo=" alt="פונטשוק"></div>
  </div></div>`;
}

/* state & router */
let state={view:'subs',plan:'web',sub:{subs:'dl',lic:'list',profile:'me'},open:{lic:-1,orders:-1}};
try{const s=JSON.parse(localStorage.getItem('fsa-v2')||'null');if(s&&V[s.view])state=Object.assign(state,s)}catch(e){}
state.open={lic:-1,orders:-1};
{const hv=location.hash.slice(1);if(V[hv])state.view=hv;if(hv==='subdom'){state.view='subs';state.sub.subs='reg'}}state.plan=FS.plan||'web';state.noteHidden=1;
/* back from paying for an add-on on the live site (WooCommerce return URL): reopen the matching registration form */
{const q=new URLSearchParams(location.search);if(q.get('fs_addon')==='paid'){const lic=q.get('kind')==='lic';
 if(lic){const li=LIC.findIndex(x=>String(x.key)===q.get('licence'));state.view='lic';state.open.lic=li<0?0:li}else{state.view='subs';state.sub.subs='reg'}
 history.replaceState(null,'',location.pathname+location.hash);
 setTimeout(()=>backTo(lic?'#su'+state.open.lic:'#sd2','התשלום התקבל. אפשר לרשום את '+(lic?'האתר':'הדומיין')+' הנוסף'),300)}}
function save(){try{localStorage.setItem('fsa-v2',JSON.stringify(state))}catch(e){}}
/* "https://www.studio-dayan.co.il/about" -> host "studio-dayan.co.il" -> name "Studio Dayan".
   On the live site the server can also fetch the page <title> for a nicer name. */
const cleanHost=v=>v.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split(/[\/?#]/)[0];
const siteName=h=>{const parts=h.split('.');const sld=['co','org','net','ac','gov','muni'];let i=parts.length-2;if(i>0&&sld.includes(parts[i]))i--;return (parts[Math.max(i,0)]||h).split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ')};
const today=()=>{const d=new Date();return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`};
/* render({page}) fades the whole page in only when the page changes; {opening} lets a just-opened drawer unfold; {fresh} highlights a just-added row */
function render(o={}){
 document.querySelectorAll('.side button[data-view]').forEach(b=>b.setAttribute('aria-current',b.dataset.view===state.view?'page':'false'));
 const v=state.view,el=$('#view');
 /* phones: keep the active tab visible in the scrolling tab bar */
 const cur=document.querySelector(`.side button[data-view="${v}"]`),bar=cur&&cur.parentElement;
 if(cur&&bar.scrollWidth>bar.clientWidth)bar.scrollTo({left:cur.offsetLeft-(bar.clientWidth-cur.offsetWidth)/2,behavior:o.page?'auto':'smooth'});
 el.innerHTML=v==='lic'?V.lic(state.sub.lic,state.open.lic):v==='orders'?V.orders(state.open.orders):v==='subs'?V.subs(state.sub.subs):v==='profile'?V.profile(state.sub.profile):V[v]();
 el.classList.remove('enter');if(o.page){void el.offsetWidth;el.classList.add('enter')}
 if(o.opening)el.querySelectorAll('.drawer').forEach(d=>d.classList.add('opening'));
 if(o.fresh){const td=[...el.querySelectorAll('.mini td, .tbl td, .tbl bdi')].find(c=>c.textContent.trim()===o.fresh);td&&td.closest('tr').classList.add('fresh')}
 fitPh();wfit();
 save();
}
/* the domain field's hint: the full sentence where it fits, shorter on narrow fields */
const PH=['הזן דומיין חדש (למשל: example.co.il)','הזן דומיין (למשל: example.co.il)','למשל: example.co.il'];
function fitPh(){const i=$('#sd2');if(!i||!i.clientWidth)return;const cs=getComputedStyle(i),c=fitPh.c||(fitPh.c=document.createElement('canvas').getContext('2d'));c.font=cs.font;
 const room=i.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);i.placeholder=PH.find(t=>c.measureText(t).width<=room)||PH[PH.length-1]}
addEventListener('resize',fitPh);
function wfit(){document.querySelectorAll('#fsa .wlist').forEach(x=>x.parentElement.classList.toggle('trunc',x.scrollWidth>x.clientWidth+1))}
addEventListener('resize',wfit);document.fonts&&document.fonts.ready.then(fitPh);
state.editKey=null;
const goPage=v=>{state.view=v;state.editKey=null;render({page:true});scrollTo({top:0,behavior:'smooth'})};
/* close the open drawer with a short fold, then re-render */
function toggleDrawer(key,i){
 const open=state.open[key]===i;const d=$('#view .drawer');
 if(open&&d){d.classList.add('closing');setTimeout(()=>{state.open[key]=-1;render()},260);return}
 state.open[key]=i;render({opening:true});
}
/* ₪79 add-on cart: pay -> processing -> paid -> "חזרה לרישום הדומיין".
   The slot is granted only when payment succeeds; closing before paying changes nothing.
   On the live site the pay step is the WooCommerce order-pay page (POST /fs/v1/account/addon), which returns here when paid. */
const cart=$('#cart');let cartItem=null;
function cartStep(it,step){
 if(step==='pay')return `<div class="cart-item"><span class="cart-ic">${ICON.globe}</span><div><b>${it.name}</b><span>${it.desc}</span></div><b class="num">${ils(it.price)}</b></div>
  <dl class="cart-sum"><dt class="tot">סה״כ לתשלום</dt><dd class="tot num">${ils(it.price)}</dd><dt class="vat">מתוכם מע״מ 18%</dt><dd class="vat num">${ils(+(it.price-it.price/1.18).toFixed(2))}</dd></dl>
  <button class="btn btn-grad cart-go" id="cartPay">למעבר לתשלום מאובטח</button>
  <p class="hint cart-note">התשלום מתבצע בעמוד התשלום של האתר. מיד אחריו חוזרים לכאן, והחשבונית תופיע ב״הזמנות״.</p>`;
 if(step==='wait')return `<div class="cart-wait" role="status"><span class="spin" aria-hidden="true"></span>מעבירים לעמוד התשלום…</div>`;
 return `<div class="cart-ok" role="status"><span class="ok-ic">${ICON.check}</span><b>התשלום התקבל</b><span>${it.okText}</span><button class="btn btn-grad cart-go" id="cartBack">${it.backText}</button></div>`;
}
function openCart(it){cartItem=Object.assign({paid:false},it);$('#cartBody').innerHTML=cartStep(cartItem,'pay');cart.hidden=false;void cart.offsetWidth;cart.classList.add('show');$('#cartPay').focus()}
function closeCart(){if(cart.hidden||!cartItem||cartItem.busy)return;const it=cartItem;cart.classList.remove('show');setTimeout(()=>{cart.hidden=true},320);if(it.paid)it.back()}
/* the add-on is a real order: create it, then go to the site's secure payment page; payment returns here (?fs_addon=paid) */
function payCart(){const it=cartItem;it.busy=true;$('#cartBody').innerHTML=cartStep(it,'wait');
 postApi('fsa_v2_addon',{kind:it.kind,key:it.key||''}).then(r=>{location.href=r.url}).catch(x=>{it.busy=false;$('#cartBody').innerHTML=cartStep(it,'pay');toast(x.message)})}
cart.addEventListener('click',e=>{if(e.target===cart)closeCart()});
/* back in the registration form, ready to type the new domain */
function backTo(sel,msg){setTimeout(()=>{const f=$(sel);if(f){f.scrollIntoView({behavior:'smooth',block:'center'});f.focus({preventScroll:true})}toast(msg)},60)}
const modal=$('#certModal');
function showModal(){modal.hidden=false;void modal.offsetWidth;setTimeout(()=>modal.classList.add('show'),16);$('#certClose').focus()}
function hideModal(){if(modal.hidden)return;modal.classList.remove('show');setTimeout(()=>{modal.hidden=true},350)}
/* several licences of one font as one: all weights, all licence types, the first purchase date */
function licMerge(ids){const L=ids.map(i=>LIC[i]),u=a=>[...new Set(a.filter(Boolean))];
 return Object.assign({},L[0],{w:u(L.map(x=>x.w)).join(', '),t:u(L.flatMap(x=>x.t.split(' + '))).join(' + '),d:u(L.map(x=>x.d)).sort((a,b)=>{const k=s=>s.split('.').reverse().join('');return k(a)<k(b)?-1:1})[0]||''})}
/* "הורדת PDF": the browser's print dialog with only the certificate on the page ("Save as PDF" there) */
function printCert(){document.documentElement.classList.add('fsa-print');const done=()=>{document.documentElement.classList.remove('fsa-print');removeEventListener('afterprint',done)};addEventListener('afterprint',done);setTimeout(()=>{print();setTimeout(done,1500)},50)}
/* certificate number, taken from the registration record so it is fixed:
   D = subscription domain (its record id), S = site on a purchased licence, L = a font's purchased licence */
function certNo(spec){const p=spec.split(':'),pad=(v,n)=>String(v).padStart(n,'0');
 if(p[0]==='sd'){const s=SUBDOM[state.plan][+p[1]]||[];const y=(s[0]||'').split('.')[2]||'';return s[4]?`FS-D-${y}-${pad(s[4],5)}`:''}
 if(p[0]==='dom'){const l=LIC[+p[1]]||{},s=(l.sites||[])[+p[2]]||[];return l.key?`FS-S-${l.key}-${String(s[3]||'P').toUpperCase()}`:''}
 if(p[0]==='lic'){const ks=String(p[1]).split(',').map(i=>+(LIC[+i]||{}).key||0).filter(Boolean);return ks.length?`FS-L-${Math.min(...ks)}`:''}
 return ''}
function openCert(spec){
 const p=spec.split(':');let l,site=null;
 if(p[0]==='sd'){const s=SUBDOM[state.plan][+p[1]];l={f:s[3],w:'',t:'וובפונט',sub:state.plan,n:PLAN[state.plan].n};site=s}
 else if(p[0]==='hist'){const h=HISTORY[+p[1]];const base=LIC.find(x=>x.f===h.f&&x.w===h.w)||{};l=Object.assign({},base,{sub:h.sub,removed:h.removed});site=h.site}
 else{const ids=String(p[1]).split(',').map(Number);l=ids.length>1?licMerge(ids):LIC[ids[0]];if(p[0]==='dom')site=l.sites[+p[2]]}
 l=Object.assign({},l,{certNo:certNo(spec)});
 $('#certBody').innerHTML=cert(l,site);showModal();
}
$('#certClose').onclick=hideModal;
modal.addEventListener('click',e=>{if(e.target.id==='certModal')hideModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){hideModal();closeMenus();closeCart()}});
document.addEventListener('click',e=>{
 const t=e.target.closest('button,a');if(!t||!t.closest('#fsa,#fsa-layer'))return;
 if((t.dataset.addon||t.dataset.planaddon)&&!FS.addon){e.preventDefault();soon();return}
 if(t.id==='certPdf'){printCert();return}
 if(t.dataset.view){goPage(t.dataset.view);return}
 if(t.dataset.plantg){state.planOpen=!state.planOpen;t.closest('.plan').classList.toggle('open',state.planOpen);t.setAttribute('aria-expanded',state.planOpen);save();return}
 if(t.dataset.licf){state.licFilter=t.dataset.licf==='all'?'':t.dataset.licf;state.open.lic=-1;render();return}
 if(t.dataset.regclose){state.regOpen=false;const box=t.closest('.sub-reg');box.classList.remove('reg-done');box.classList.remove('reg-on');const ob=box.querySelector('.reg-open');ob.setAttribute('aria-expanded','false');ob.focus({preventScroll:true});save();return}
 if(t.dataset.regopen){state.regOpen=true;t.setAttribute('aria-expanded','true');const rb=t.closest('.sub-reg');rb.classList.add('reg-on');setTimeout(()=>{rb.classList.contains('reg-on')&&rb.classList.add('reg-done');fitPh()},460);fitPh();setTimeout(()=>$('#sd2')&&$('#sd2').focus({preventScroll:true}),420);save();return}
 if(t.dataset.hist){state.histOpen=!state.histOpen;t.setAttribute('aria-expanded',state.histOpen);$('#histBody').classList.toggle('open',state.histOpen);return}
 if(t.dataset.go){e.preventDefault();if(t.dataset.go==='dom')state.histOpen=true;goPage(t.dataset.go);return}
 if(t.dataset.subtab){state.sub[state.view]=t.dataset.subtab;render({page:true});return}
 if(t.dataset.open!==undefined){toggleDrawer('lic',+t.dataset.open);return}
 if(t.dataset.oopen!==undefined){toggleDrawer('orders',+t.dataset.oopen);return}
 if(t.dataset.cert){openCert(t.dataset.cert);return}
 if(t.dataset.del){const[i,j]=t.dataset.del.split(':').map(Number);const s=LIC[i].sites[j];if(!s)return;if(licFixed(i,j)){toast('האתר שנרשם ברכישה קבוע ולא ניתן להסיר אותו');return}
  if(!confirm(`להסיר את ${s[2]}?`))return;t.disabled=true;licApi(i,'del',{id:s[3]}).then(()=>{render();toast(`${s[2]} הוסר והמקום ברישיון התפנה`)}).catch(x=>{t.disabled=false;toast(x.message)});return}
 if(t.id==='cartPay'){payCart();return}
 if(t.id==='cartBack'||t.id==='cartClose'){closeCart();return}
 if(t.dataset.addon){const i=+t.dataset.addon,l=LIC[i];openCart({kind:'lic',key:l.key,name:`אתר נוסף · ${l.f} ${l.w}`,desc:'מקום נוסף ברישיון הוובפונט, לצמיתות',price:79,
   okText:`ברישיון של ${l.f} יש עכשיו ${l.n+1} אתרים.`,backText:'חזרה לרישום האתר',
   grant:()=>{l.n+=1},back:()=>{state.view='lic';state.open.lic=i;render({opening:true});backTo('#su'+i,'אפשר לרשום את האתר הנוסף')}});return}
 if(t.dataset.hidenote){const n=$('.note');n.style.transition='opacity .3s var(--ease),transform .3s var(--ease)';n.style.opacity=0;n.style.transform='translateY(-4px)';setTimeout(()=>{state.noteHidden=1;render()},300);return}
 if(t.dataset.edit){{const p=t.dataset.edit.split(':');if(p[0]==='dom'&&licFixed(+p[1],+p[2])){toast('האתר שנרשם ברכישה קבוע ולא ניתן לערוך אותו');return}}state.editKey=t.dataset.edit;render();const r=$(`tr.editing`);r&&r.querySelector('.ed-host').focus();return}
 if(t.dataset.edcancel){state.editKey=null;render();return}
 if(t.dataset.edsave){saveEdit(t.closest('tr'));return}
 if(t.dataset.plan){state.plan=t.dataset.plan;render({page:true});return}
 if(t.dataset.planaddon){openCart({kind:'sub',name:`דומיין נוסף · מינוי ${PLAN[state.plan].label}`,desc:`רישום אחד נוסף לחודש ${CYCLE.label}`,price:79,
   okText:`נוסף רישום אחד למכסת ${CYCLE.label}.`,backText:'חזרה לרישום הדומיין',
   grant:()=>{BONUS+=1},back:()=>{state.view='subs';state.sub.subs='reg';render();backTo('#sd2','אפשר לרשום את הדומיין הנוסף')}});return}
 if(t.dataset.sddel){const s=SUBDOM[state.plan][+t.dataset.sddel];if(!s||!confirm(`להסיר את ${s[2]}?`))return;t.disabled=true;
  domApi('del',{id:s[4]}).then(()=>{render();toast(`${s[2]} הוסר והמקום במכסה התפנה`)}).catch(x=>{t.disabled=false;toast(x.message)});return}
 if(t.dataset.go2){state.sub.subs='reg';goPage(t.dataset.go2);return}
 if(t.id==='logout'){location.href=FS.links.logout;return}
 if(t.dataset.t){e.preventDefault();soon()}
});
document.addEventListener('submit',e=>{
 const f=e.target;if(!f.closest('#fsa,#fsa-layer'))return;e.preventDefault();if(f.id==='pform'){soon();return}
 if(f.dataset.subadd){
  const host=cleanHost($('#sd2').value),picked=[...f.querySelectorAll('.fp-menu input:checked')].map(i=>i.value),err=$('#sdErr');
  const msg=!host||!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)?'צריך להזין כתובת אתר תקינה, למשל studio.co.il':!picked.length?'צריך לבחור לפחות פונט אחד':'';
  if(msg){err.textContent=msg;err.hidden=false;(msg.includes('כתובת')?$('#sd2'):f.querySelector('.fp-btn')).focus();return}
  const btn=f.querySelector('.reg-add');if(btn)btn.disabled=true;
  domApi('add',{host,name:siteName(host),fonts:picked.join(', ')}).then(()=>{state.regOpen=false;render({fresh:host});toast('האתר נרשם במינוי. התעודה מוכנה להורדה')}).catch(x=>{if(btn)btn.disabled=false;err.textContent=x.message;err.hidden=false});return}
 if(f.dataset.add!==undefined){const i=+f.dataset.add;const host=cleanHost(f.querySelector('[data-namefor]').value);if(!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)){toast('צריך להזין כתובת אתר תקינה');return}
  const btn=f.querySelector('button');if(btn)btn.disabled=true;
  licApi(i,'add',{host,name:f.querySelector('.sitename').value.trim()||siteName(host)}).then(()=>{render({fresh:host});toast('האתר נרשם. התעודה מוכנה להורדה')}).catch(x=>{if(btn)btn.disabled=false;toast(x.message)});return}
 toast('השינויים נשמרו');
});
document.addEventListener('change',e=>{
 if(e.target.closest('.fp-menu')){const m=e.target.closest('.fp-menu'),boxes=[...m.querySelectorAll('input')],on=boxes.filter(b=>b.checked);
  boxes.forEach(b=>{b.disabled=!b.checked&&on.length>=2;b.parentElement.classList.toggle('off',b.disabled)});
  m.querySelector('.fp-hint').classList.toggle('max',on.length>=2);
  m.parentElement.querySelector('.fp-val').textContent=on.length?on.map(b=>b.value).join(', '):'בחירת פונטים';$('#sdErr')&&($('#sdErr').hidden=true)}
});
/* save an inline-edited domain row (only rows of the current cycle get here) */
function saveEdit(tr){
 const key=tr.dataset.key,host=cleanHost(tr.querySelector('.ed-host').value),name=tr.querySelector('.ed-name').value.trim()||siteName(host);
 if(!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)){toast('צריך להזין כתובת אתר תקינה');tr.querySelector('.ed-host').focus();return}
 const fonts=[...tr.querySelectorAll('.fp-menu input:checked')].map(i=>i.value);
 if(tr.querySelector('.fp-menu')&&!fonts.length){toast('צריך לבחור לפחות פונט אחד');return}
 const p=key.split(':');
 if(p[0]==='sd'){const s=SUBDOM[state.plan][+p[1]];tr.querySelectorAll('button').forEach(b=>b.disabled=true);
  domApi('edit',{id:s[4],host,name,fonts:fonts.join(', ')}).then(()=>{state.editKey=null;render({fresh:host});toast('הדומיין עודכן, וגם התעודה שלו')}).catch(x=>{tr.querySelectorAll('button').forEach(b=>b.disabled=false);toast(x.message)});return}
 {const i=+p[1],j=+p[2],st=LIC[i].sites[j];tr.querySelectorAll('button').forEach(b=>b.disabled=true);
  licApi(i,'edit',{id:st[3],host,name}).then(()=>{state.editKey=null;render({fresh:host});toast('האתר עודכן, וגם התעודה שלו')}).catch(x=>{tr.querySelectorAll('button').forEach(b=>b.disabled=false);toast(x.message)})}
}
document.addEventListener('keydown',e=>{const tr=e.target.closest&&e.target.closest('tr.editing');if(!tr)return;if(e.key==='Enter'){e.preventDefault();saveEdit(tr)}if(e.key==='Escape'){state.editKey=null;render()}});
function closeMenus(){document.querySelectorAll('.fp-menu.open').forEach(m=>{m.classList.remove('open');m.parentElement.querySelector('.fp-btn').setAttribute('aria-expanded','false')})}
/* a menu that would run past the bottom of the white panel opens upwards instead */
function popFit(p){const m=p.querySelector('.pop-menu'),box=p.closest('.shell')||document.body;if(!m)return;const r=m.getBoundingClientRect(),lim=Math.min(box.getBoundingClientRect().bottom,innerHeight);if(r.bottom>lim-8&&p.getBoundingClientRect().top-r.height>box.getBoundingClientRect().top)p.classList.add('up')}
function closePops(except){document.querySelectorAll('.pop.open').forEach(p=>{if(p!==except){p.classList.remove('open');p.querySelector('[data-pop]').setAttribute('aria-expanded','false')}})}
document.addEventListener('click',e=>{const pb=e.target.closest('[data-pop]');
 if(pb){const p=pb.parentElement;closePops(p);p.classList.remove('up');const o=p.classList.toggle('open');pb.setAttribute('aria-expanded',o);if(o)popFit(p);e.stopImmediatePropagation();return}
 closePops()},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closePops()});
document.addEventListener('click',e=>{const fb=e.target.closest('.fp-btn');
 if(fb){const m=fb.parentElement.querySelector('.fp-menu');const open=m.classList.toggle('open');fb.setAttribute('aria-expanded',open);return}
 if(!e.target.closest('.fp-menu'))closeMenus()});
document.addEventListener('input',e=>{if(e.target.dataset.namefor){const n=document.getElementById(e.target.dataset.namefor);const h=cleanHost(e.target.value);if(n&&!n.dataset.touched)n.value=h.includes('.')?siteName(h):''}if(e.target.classList.contains('sitename'))e.target.dataset.touched=e.target.value?'1':''});
document.addEventListener('input',e=>{if(e.target.id==='sd2')$('#sdErr').hidden=true});
document.addEventListener('input',e=>{if(e.target.id==='oq'){const q=e.target.value.trim().replace('#','');document.querySelectorAll('#otb tr[data-oid]').forEach(r=>r.hidden=q&&!r.dataset.oid.includes(q))}});
$('#fsaName').textContent=FS.user.first||'';
if(FS.mode==='live'){const n=$('#fsaNote');if(n)n.innerHTML=`<a href="${ea(FS.oldUrl)}">למעבר לאזור האישי הקודם</a>`}
const h=new Date().getHours();$('#greet').textContent=h<5?'לילה טוב':h<12?'בוקר טוב':h<17?'צהריים טובים':h<21?'ערב טוב':'לילה טוב';
document.querySelectorAll('i[data-ic]').forEach(e=>{const w=document.createElement('span');w.className='ic-wrap '+(e.className||'');if(e.title)w.title=e.title;w.innerHTML=ICON[e.dataset.ic];e.replaceWith(w)});
render({page:true});
/* smiley says hello once on load, and again on tap (phones have no hover) */
const smiley=$('.smiley');const smile=()=>{smiley.classList.remove('play');void smiley.offsetWidth;smiley.classList.add('play');clearTimeout(smiley._t);smiley._t=setTimeout(()=>smiley.classList.remove('play'),1500)};
setTimeout(smile,700);$('.hello').addEventListener('click',smile);

})();
FSAJS;
	return '<style id="fsa-v2-css">' . $css . '</style>' . $html . '<script id="fsa-v2-js">window.FS_DATA=' . $data . ";\n" . $js . '</script>';
} );
