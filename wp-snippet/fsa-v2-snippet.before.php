/**
 * FS · אזור אישי v2 — תצוגה מקדימה (שלב 1)
 * Renders the new personal area on the private page /my-account-new/ (shortcode [fs_account_v2]).
 * Admins only; everyone else is sent to the existing /my-account/. Read-only: domains, certificates
 * and the add-on domain are NOT connected yet (stage 2). Deactivating this snippet removes everything.
 */
if ( ! defined( 'ABSPATH' ) ) exit;

define( 'FSA_V2_SLUG', 'my-account-new' );

// 1. access: admins only, not indexed
add_action( 'template_redirect', function () {
	if ( ! is_page( FSA_V2_SLUG ) ) return;
	if ( ! is_user_logged_in() ) { auth_redirect(); }
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_safe_redirect( function_exists( 'wc_get_page_permalink' ) ? wc_get_page_permalink( 'myaccount' ) : home_url( '/' ) );
		exit;
	}
} );
add_filter( 'wp_robots', function ( $r ) {
	if ( is_page( FSA_V2_SLUG ) ) { $r['noindex'] = true; $r['nofollow'] = true; }
	return $r;
} );
add_filter( 'body_class', function ( $c ) {
	if ( is_page( FSA_V2_SLUG ) ) $c[] = 'fsa-v2';
	return $c;
} );

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

	$start = '';
	$raw = get_user_meta( $uid, 'membership-date', true ); // d/m/Y (snippet #8)
	if ( $raw ) {
		$d = DateTime::createFromFormat( 'd/m/Y', $raw );
		$start = $d ? fsa_v2_he_date( $d->getTimestamp() ) : $raw;
	}

	// subscription fonts (ACF option repeater, same rules as snippet #7)
	$fonts = array();
	if ( $plan && function_exists( 'get_field' ) ) {
		$desktop_only = in_array( 'member-desktop', $roles, true ) && ! in_array( 'member-webstop', $roles, true ) && ! in_array( 'member-extra', $roles, true );
		foreach ( (array) get_field( 'fonts-repeater', 'option' ) as $row ) {
			if ( empty( $row['font-name'] ) ) continue;
			$fonts[] = array(
				'name' => wp_strip_all_tags( $row['font-name'] ),
				'web'  => ( ! $desktop_only && ! empty( $row['font-file-web']['url'] ) ) ? $row['font-file-web']['url'] : '',
				'desk' => ! empty( $row['font-file']['url'] ) ? $row['font-file']['url'] : '',
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
			if ( $order ) {
				foreach ( $order->get_items() as $item ) {
					if ( (int) $item->get_product_id() !== $pid ) continue;
					$var = $item->get_variation_id() ? wc_get_product( $item->get_variation_id() ) : null;
					$t = $var ? $var->get_attribute( 'pa_license' ) : '';
					if ( $t ) $types[] = $t;
				}
				$domain = $order->get_meta( '_fs_domain' );
				if ( $domain ) {
					$dt = $order->get_date_created();
					$sites[] = array( $dt ? $dt->date( 'd.m.Y' ) : '', '', $domain );
				}
			}
			$t = $types ? implode( ' + ', array_unique( $types ) ) : 'רישיון';
			$web = ( stripos( $t, 'webstop' ) !== false || strpos( $t, 'וובפונט' ) !== false || $sites ) ? 1 : 0;
			$by[ $pid ] = array(
				'f' => wp_strip_all_tags( $dl['product_name'] ), 'w' => '', 't' => $t,
				'sub' => 'buy', 'n' => 3, 'web' => $web, 'sites' => $sites, 'dl' => $dl['download_url'],
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

// 3. the shortcode
add_shortcode( 'fs_account_v2', function () {
	if ( ! current_user_can( 'manage_options' ) ) return '';
	$data = wp_json_encode( fsa_v2_data(), JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP );
	$css  = <<<'FSACSS'
#fsa{direction:rtl;text-align:right;width:100vw;margin-inline:calc(50% - 50vw);position:relative;padding-block:1px}
#fsa button,#fsa input,#fsa select,#fsa textarea{font:inherit;color:inherit;background:none;border:0;border-radius:0;box-shadow:none;text-transform:none;letter-spacing:inherit;margin:0;min-height:0}
#fsa button:hover,#fsa button:focus{background:none;color:inherit}
#fsa a,#fsa a:hover{color:inherit;text-decoration:none}
#fsa table{margin:0;border:0;font-size:inherit;border-collapse:collapse}
#fsa table td,#fsa table th{border:0;background:none;padding:0;vertical-align:middle;line-height:inherit}
#fsa table tbody>tr:nth-child(odd)>td,#fsa table tbody>tr:nth-child(odd)>th,#fsa table tbody tr:hover>td{background:none}
#fsa h1,#fsa h2,#fsa h3,#fsa p,#fsa dl,#fsa dd{margin:0;font-family:inherit;color:inherit;letter-spacing:normal}
#fsa img{max-width:none;height:auto;border:0}
#fsa{
  color-scheme: light;
  --bg:#F4F4F4; --card:#FFFFFF; --ink:#151515; --muted:#6E6E6E; --faint:#A8A8A8; --line:#E8E8E8; --soft:#F2F2F2; --softer:#F8F7FB;
  --violet:#5B3FFF; --violet-text:#9B4DFF;
  --grad:linear-gradient(90deg,#A29BFE 0%,#E1B6FF 100%);
  --ok:#43D61B; --ok-track:#E2FBD6; --warn:#FFC700; --warn-track:#FFF3C4; --bad:#FF1E1E; --bad-track:#FFD6D6;
  --new:#FF6A3D;
  
  --c-desk:linear-gradient(135deg,#FF9A8B,#E3166F);
  --c-web:linear-gradient(158deg,#6FCFA1,#2C67FF);
  --c-extra:linear-gradient(108deg,#BE68FF 12%,#382CFF 94%);
  --c-barter:linear-gradient(135deg,#C3CAD6,#20232B);
  --font:"Discovery_Fs","Heebo",Arial,sans-serif;
  --r-card:24px; --r-ctl:6px;
}
#fsa,#fsa *{box-sizing:border-box}
#fsa,#fsa{background:var(--bg)}
#fsa{font-family:var(--font);color:var(--ink);font-size:15px;line-height:1.5;direction:rtl;-webkit-font-smoothing:antialiased}
#fsa button,#fsa input,#fsa select{font:inherit;color:inherit}
#fsa button{cursor:pointer}
#fsa a{color:inherit}
#fsa :focus-visible{outline:2px solid var(--violet);outline-offset:2px}
#fsa .num{font-variant-numeric:proportional-nums;letter-spacing:-.01em}
#fsa .icon{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex:none}
#fsa .site-head{background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:env(safe-area-inset-top,0px);z-index:10}
#fsa .site-head .in{max-width:1440px;margin:0 auto;padding:0 52px;height:88px;display:flex;align-items:center;gap:40px}
#fsa .logo{font-weight:800;font-size:30px;letter-spacing:-.5px;line-height:1}
#fsa .mainnav{display:flex;gap:24px;color:var(--muted);font-size:16px;flex-wrap:wrap}
#fsa .mainnav a{text-decoration:none}
#fsa .mainnav a.on{color:var(--violet-text);font-weight:700}
#fsa .head-tools{margin-inline-start:auto;display:flex;align-items:center;gap:22px}
#fsa .me{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:99px;padding:4px 4px 4px 14px;font-size:14px;font-weight:500;background:var(--card)}
#fsa .avatar{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:14px;color:#fff;background:var(--c-extra)}
#fsa .page{max-width:1140px;margin:0 auto;padding-block:56px 120px;padding-inline:16px}
#fsa .hello{font-size:15px;color:var(--muted);margin:0 4px 14px;display:inline-block}
#fsa .hello b{color:var(--ink);font-weight:500}
#fsa .shell{display:grid;grid-template-columns:190px minmax(0,1fr);background:var(--card);border-radius:var(--r-card);min-height:780px;overflow:hidden}
#fsa .side{border-inline-end:1px solid var(--line);padding-top:58px;display:flex;flex-direction:column}
#fsa .side button{all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;height:54px;padding-inline:52px 20px;margin-bottom:40px;font-weight:700;font-size:18px;position:relative;transition:color .15s}
#fsa .side button:hover{color:var(--violet-text)}
#fsa .side button[aria-current="page"]{background:var(--soft);color:var(--violet-text)}
#fsa .side button[aria-current="page"]::after{content:"";position:absolute;inset-inline-end:0;top:0;bottom:0;width:3px;background:var(--violet)}
#fsa .side .sep{flex:1}
#fsa .side .logout{font-weight:500;font-size:15px;color:var(--muted);margin-bottom:28px;display:flex;align-items:center;gap:8px}
#fsa .side .logout .icon{width:20px;height:20px;flex:none}
#fsa .side .logout:hover{color:var(--ink)}
#fsa .main{padding:68px 64px 64px;min-width:0}
#fsa{--ease:cubic-bezier(.22,.61,.36,1)}
#fsa .main.enter{animation:viewIn .45s var(--ease)}
@keyframes viewIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes drawerIn{from{opacity:0;transform:translateY(-8px);clip-path:inset(0 0 100% 0 round 10px)}to{opacity:1;transform:none;clip-path:inset(0 0 0 0 round 10px)}}
@keyframes drawerOut{from{opacity:1;clip-path:inset(0 0 0 0 round 10px)}to{opacity:0;transform:translateY(-6px);clip-path:inset(0 0 100% 0 round 10px)}}
@keyframes rowIn{from{background:#EEE9FF}to{background:transparent}}
#fsa .drawer.opening .box{animation:drawerIn .5s var(--ease) both}
#fsa .drawer.closing .box{animation:drawerOut .28s ease forwards}
#fsa .fresh td{animation:rowIn 1.8s ease}
#fsa .btn,#fsa .ibtn,#fsa .dl,#fsa .side button,#fsa .tabs button,#fsa .chip{transition:background-color .25s var(--ease),color .25s var(--ease),filter .25s var(--ease),transform .15s var(--ease),box-shadow .25s var(--ease)}
#fsa .tabs button::after{transition:opacity .3s var(--ease)}
#fsa .pk{transition:transform .35s var(--ease),box-shadow .35s var(--ease)}
#fsa .pk:hover{transform:translateY(-3px);box-shadow:0 14px 30px rgba(60,40,120,.10)}
#fsa .h1{font-size:26px;font-weight:800;margin:0;line-height:1.2}
#fsa .sub{font-size:14px;margin:4px 0 0;color:var(--muted)}
#fsa .head-row{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:40px}
#fsa .tabs{display:flex;border-bottom:1.5px solid #BDBDBD;margin-bottom:26px;overflow-x:auto;scrollbar-width:none}
#fsa .tabs::-webkit-scrollbar{display:none}
#fsa .fontpick{position:relative}
#fsa .fp-btn{all:unset;box-sizing:border-box;cursor:pointer;width:100%;height:40px;background:var(--card);border-radius:var(--r-ctl);padding:0 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:14px}
#fsa .fp-btn:focus-visible{outline:2px solid var(--violet)}
#fsa .fp-val{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fsa .fp-menu{position:absolute;top:100%;inset-inline:0;margin-top:4px;background:var(--card);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.14);padding:8px;z-index:6;min-width:200px;opacity:0;visibility:hidden;transform:translateY(-6px) scale(.98);transform-origin:top center;transition:opacity .25s var(--ease),transform .3s var(--ease),visibility 0s linear .3s}
#fsa .fp-menu.open{opacity:1;visibility:visible;transform:none;transition-delay:0s}
#fsa .fp-btn svg{transition:transform .3s var(--ease)}
#fsa .fp-btn[aria-expanded="true"] svg{transform:rotate(180deg)}
#fsa .fp-menu label{display:flex!important;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;font-size:14px!important;margin:0!important;cursor:pointer}
#fsa .fp-menu label:hover{background:var(--soft)}
#fsa .fp-menu label.off{opacity:.4;cursor:not-allowed}
#fsa .fp-menu input{accent-color:var(--violet);width:16px;height:16px}
#fsa .fp-hint{margin:6px 10px 2px;font-size:11px;color:var(--muted)}
#fsa .fp-hint.max{color:var(--violet);font-weight:700}
#fsa .form-err{color:#B00000;font-size:13px;margin:-14px 0 16px}
#fsa .orow td{white-space:nowrap}
#fsa .oid{display:inline-flex;align-items:center;gap:6px;margin-inline-start:-38px}
#fsa .eye-ph{width:32px;display:inline-block}
#fsa .ibtn.eye{color:var(--muted)}
#fsa .ibtn.eye:hover,#fsa .ibtn.eye.on{color:var(--violet);background:#EEE9FF}
#fsa .odet{font-size:14px}
#fsa .odet span:first-child{display:inline-block;max-width:136px;vertical-align:bottom;overflow:hidden;text-overflow:ellipsis}
#fsa .orow td,#fsa .otbl thead th{padding-inline:10px}
#fsa .otbl thead th:first-child{padding-inline-start:40px}
#fsa .orow .btn{height:34px;padding:0 12px;font-size:14px}
#fsa .orow td:first-child{padding-inline-start:40px}
#fsa .odet .more{margin-inline-start:6px;font-size:11px;font-weight:700;background:var(--soft);border-radius:99px;padding:1px 7px;color:var(--muted)}
@media (max-width:760px){#fsa .oid{margin:0}
#fsa .orow td{white-space:normal}
}
#fsa .demo{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--muted);background:var(--soft);border-radius:99px;padding:3px;margin-bottom:18px}
#fsa .demo span{padding:0 8px}
#fsa .demo button{all:unset;cursor:pointer;padding:3px 12px;border-radius:99px;font-weight:700;color:var(--ink)}
#fsa .demo button.on{background:var(--card);box-shadow:0 1px 3px rgba(0,0,0,.12)}
#fsa .dom-head{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:16px}
#fsa .usage{display:flex;flex-direction:column;gap:6px;min-width:200px;font-size:13px}
#fsa .usage .track{height:6px;border-radius:9px;background:var(--soft);overflow:hidden;display:block}
#fsa .usage .track i{display:block;height:100%;border-radius:9px;margin-inline-start:auto}
#fsa .ltag{display:inline-block;font-size:12px;border:1px solid var(--line);border-radius:6px;padding:1px 8px;white-space:nowrap}
#fsa .pk-top>div{min-width:0}
#fsa .src{display:inline-flex;align-items:center;gap:6px;font-size:13px;white-space:nowrap}
#fsa .src.buy{border:1px solid var(--line);border-radius:6px;padding:1px 8px}
#fsa .tabs button{all:unset;cursor:pointer;padding:10px 22px 12px;font-weight:700;font-size:15px;position:relative;white-space:nowrap}
#fsa .tabs button[aria-selected="true"]::after{content:"";position:absolute;inset-inline:0;bottom:-1.5px;height:2px;background:linear-gradient(90deg,var(--violet),#B06BFF)}
#fsa .tbl{width:100%;border-collapse:separate;border-spacing:0}
#fsa .tbl thead th{background:var(--soft);font-weight:700;font-size:15px;text-align:start;padding:12px 16px;height:44px;white-space:nowrap}
#fsa .tbl thead th:first-child{border-start-start-radius:8px;border-end-start-radius:8px;padding-inline-start:40px}
#fsa .tbl thead th:last-child{border-start-end-radius:8px;border-end-end-radius:8px}
#fsa .tbl tbody td{padding:14px 16px;font-size:15px;vertical-align:middle}
#fsa .tbl tbody td:first-child{padding-inline-start:40px;font-weight:700}
#fsa .tbl tbody tr:first-child td{padding-top:30px}
#fsa .tbl tbody tr:not(.drawer):hover td{background:#FBFAFE}
#fsa .tbl .sm{display:block;font-size:12px;color:var(--muted);font-weight:400}
#fsa .tbl-wrap{overflow-x:auto}
#fsa .acts{display:flex;gap:14px;justify-content:flex-end;align-items:center}
#fsa .ibtn{all:unset;cursor:pointer;display:inline-grid;place-items:center;width:32px;height:32px;border-radius:8px}
#fsa .ibtn:hover{background:var(--soft)}
#fsa .sublogo{width:22px;height:22px;vertical-align:-6px;margin-inline-start:6px}
#fsa .btn{border:0;border-radius:var(--r-ctl);height:38px;padding:0 20px;font-weight:700;font-size:15px;display:inline-flex;align-items:center;justify-content:center;gap:10px;white-space:nowrap;transition:filter .15s,transform .1s}
#fsa .btn:active{transform:scale(.98)}
#fsa .btn-grad{background:var(--grad);color:var(--ink)}
#fsa .btn-grad:hover{filter:saturate(1.3)}
#fsa .btn-ghost{background:var(--card);border:1px solid var(--ink)}
#fsa .btn-soft{background:var(--soft)}
#fsa .dl{all:unset;cursor:pointer;display:grid;place-items:center;width:187px;max-width:100%;height:37px;background:var(--soft);border-radius:var(--r-ctl);color:var(--violet-text)}
#fsa .dl:hover{background:#ECE8F7}
#fsa .plan{display:flex;align-items:center;gap:20px;background:var(--softer);border-radius:10px;padding:18px 28px;position:relative;margin-bottom:36px;flex-wrap:wrap}
#fsa .plan::after{content:"";position:absolute;inset-inline-end:0;top:0;bottom:0;width:14px;border-start-end-radius:10px;border-end-end-radius:10px;background:var(--c-extra)}
#fsa .plan img{width:52px;height:52px}
#fsa .plan .name{font-weight:700;font-size:17px;display:flex;gap:8px;align-items:center}
#fsa .plan .dates{margin-inline-start:auto;display:flex;gap:32px;font-size:13px;padding-inline-end:22px;white-space:nowrap}
@media (min-width:1001px){#fsa .plan{flex-wrap:nowrap}
}
@media (max-width:1000px){#fsa .plan .dates{flex-wrap:wrap;white-space:normal;margin-inline-start:0}
}
#fsa .plan .dates b{display:block;font-size:13px}
#fsa .chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;border-radius:99px;padding:2px 10px;background:#E9E3FF;color:var(--violet);white-space:nowrap}
#fsa .chip.ok{background:var(--ok-track);color:#1E7A00}
#fsa .chip.wait{background:var(--soft);color:var(--muted)}
#fsa .chip.bad{background:var(--bad-track);color:#B00000}
#fsa .chip::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
#fsa .meter{display:flex;align-items:center;gap:8px;font-size:11px}
#fsa .meter .bar{width:64px;height:5px;border-radius:9px;position:relative;background:var(--ok-track)}
#fsa .meter .bar i{position:absolute;inset-block:0;inset-inline-end:0;border-radius:9px;background:var(--ok)}
#fsa .meter.warn .bar{background:var(--warn-track)}
#fsa .meter.warn .bar i{background:var(--warn)}
#fsa .meter.bad .bar{background:var(--bad-track)}
#fsa .meter.bad .bar i{background:var(--bad)}
#fsa .drawer>td{padding:0 0 18px!important}
#fsa .drawer .box{background:var(--bg);border-radius:10px;padding:24px 26px}
#fsa .form-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;gap:8px;align-items:end;margin-bottom:26px}
#fsa .fld label{display:block;font-size:11px;margin-bottom:4px}
#fsa .fld input,#fsa .fld select{width:100%;height:40px;border:0;border-radius:var(--r-ctl);background:var(--card);padding:0 14px;font-size:14px}
#fsa .fld input::placeholder{color:var(--faint)}
#fsa .mini{width:100%;border-collapse:collapse;font-size:14px}
#fsa .mini th{font-weight:500;text-align:start;padding:8px 14px;border-bottom:1px solid #8C8C8C}
#fsa .mini td{padding:11px 14px}
#fsa .quota{text-align:center;margin-bottom:22px}
#fsa .quota b{display:block;font-size:16px;margin-bottom:12px}
#fsa .qopts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;text-align:start}
#fsa .qopt{background:var(--card);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;border:1px solid transparent}
#fsa .qopt.rec{border-color:var(--violet)}
#fsa .qopt h4{margin:0;font-size:15px}
#fsa .qopt p{margin:0;font-size:13px;color:var(--muted)}
#fsa .qopt .btn{margin-top:auto;height:34px}
#fsa .grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px 28px}
#fsa .pf label{display:block;font-size:15px;margin-bottom:4px}
#fsa .pf input{width:100%;height:40px;border:0;border-radius:var(--r-ctl);background:var(--soft);padding:0 14px;font-size:15px}
#fsa .hint{font-size:12px;margin-top:4px;color:var(--muted)}
#fsa .prefs{display:grid;gap:4px;max-width:640px}
#fsa .pref{display:flex;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid var(--line)}
#fsa .pref div{flex:1}
#fsa .pref b{display:block;font-weight:700}
#fsa .pref span{font-size:13px;color:var(--muted)}
#fsa .pf .pref{display:flex;margin:0;cursor:pointer}
#fsa .pf input.sw{appearance:none;-webkit-appearance:none;width:42px;height:24px;min-width:42px;padding:0;border:0;margin:0;border-radius:99px;background:#D6D6D6;position:relative;cursor:pointer;transition:background .2s;flex:none}
#fsa .pf input.sw::after{content:"";position:absolute;top:3px;right:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:right .2s}
#fsa .pf input.sw:checked{background:var(--violet)}
#fsa .pf input.sw:checked::after{right:21px}
#fsa .pk-tabs{display:flex;gap:0;border-bottom:1px solid #BDBDBD;margin-bottom:34px;overflow-x:auto}
#fsa .pk-tabs span{padding:14px 28px;font-weight:700;font-size:20px;display:flex;gap:10px;align-items:center;white-space:nowrap}
#fsa .pk-tabs span.on{background:var(--soft)}
#fsa .pk-tabs img{width:26px;height:26px}
#fsa .pkgs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;align-items:start;margin-top:46px}
#fsa .main.is-plans{background:#F4F4F4;border-start-end-radius:24px;border-end-end-radius:24px}
#fsa .main.is-plans .head-row{border-bottom:1px solid var(--ink);padding-bottom:18px;margin-bottom:0}
#fsa .main.is-plans .head-row .h1{font-size:32px}
#fsa .pk{background:var(--card);border-radius:26px;padding:8px;position:relative}
#fsa .pk.rec{background:var(--c-web);padding:38px 8px 8px;margin-top:-30px}
#fsa .pk.rec .flag{position:absolute;top:8px;inset-inline:0;text-align:center;color:#fff;font-weight:700;font-size:14px}
#fsa .pk-in{background:var(--card);border-radius:20px;padding:22px 16px 18px}
#fsa .pk-top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px;min-height:56px}
#fsa .pk-top>div{min-width:0}
#fsa .pk h3{margin:0;font-size:24px;font-weight:800;line-height:1.1}
#fsa .pk .tag{font-size:12.5px;color:var(--ink);margin-top:4px;white-space:nowrap}
#fsa .pk-top img{width:58px;height:58px;flex:none}
#fsa .price{background:var(--soft);border-radius:22px;padding:20px 18px 18px}
#fsa .was{font-size:15px;color:var(--muted);text-decoration:line-through;text-decoration-thickness:1.5px}
#fsa .now{display:flex;flex-wrap:nowrap;align-items:baseline;gap:10px;margin:6px 0 18px}
#fsa .now small{white-space:nowrap}
#fsa .now b{font-size:34px;font-weight:800;line-height:1}
#fsa .now small{font-size:12px;color:var(--muted)}
#fsa .save{font-size:13px;font-weight:400;color:var(--muted);white-space:nowrap;line-height:1}
#fsa .price .was{line-height:1}
#fsa .pk-top img.pk-sym{width:auto;height:32px;max-width:46px;object-fit:contain;flex:none}
#fsa .price .what{font-size:14px;font-weight:700}
#fsa .price .what span{display:block;font-weight:400;color:var(--ink)}
#fsa .pk .cta{display:flex;align-items:center;width:100%;height:46px;margin-top:26px;border-radius:99px;border:1px solid var(--ink);background:transparent;font-size:17px;font-weight:400;justify-content:center}
#fsa .pk .cta:hover{background:var(--card)}
#fsa .pk.rec .cta{border:0;background:linear-gradient(90deg,#2C67FF,#6FCFA1);color:#fff}
#fsa .pk.rec .cta:hover{filter:brightness(1.05)}
#fsa .pk .more{display:flex;justify-content:center;align-items:center;gap:6px;font-size:13px;color:var(--ink);margin-top:14px;text-decoration:none}
#fsa .pk .more:hover{color:var(--violet-text)}
#fsa .fs-arrow{width:24px;height:10px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round;flex:none}
#fsa .price .btn.cta{width:100%}
#fsa .cmp{margin-top:72px}
#fsa .cmp h2{font-size:26px;font-weight:800;margin:0;padding-bottom:18px;border-bottom:1px solid var(--ink)}
#fsa .cmp table{width:100%;border-collapse:collapse;font-size:14px}
#fsa .cmp th{font-size:20px;font-weight:700;padding:34px 10px 26px;text-align:center;white-space:nowrap;width:20%}
#fsa .cmp th:first-child{width:auto}
#fsa .cmp th img{width:auto;height:20px;vertical-align:-4px;margin-inline-start:6px}
#fsa .cmp th:first-child,#fsa .cmp td:first-child{text-align:start}
#fsa .cmp td{padding:16px 10px;text-align:center;font-size:14px;color:var(--ink)}
#fsa .cmp td:first-child b{font-weight:700}
#fsa .cmp tr.grp td{font-weight:700;font-size:16px;padding:40px 10px 14px}
#fsa .cmp tr.grp td:first-child{padding-inline-start:0}
#fsa .cmp tbody tr.grp:not(:first-child) td{border-top:1px solid #555}
#fsa .cmp tbody tr:not(.grp) td:first-child{padding-inline-start:0}
#fsa .cmp tr.grp + tr td{padding-top:20px}
#fsa .cmp tr:has(+ tr.grp) td{padding-bottom:30px}
#fsa .cmp-in{position:relative;overflow:visible}
#fsa .cmp table{position:relative;z-index:1;table-layout:fixed}
#fsa .web-col{position:absolute;top:0;bottom:0;left:20%;width:20%;background:#FAFAFA;border-radius:0 0 999px 999px;z-index:0}
#fsa .cmp tr.cmp-end td{height:34px;padding:0}
#fsa .yes,#fsa .no{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:50%;vertical-align:middle}
#fsa .yes{background:#EBDDF9;color:var(--ink)}
#fsa .no{background:#D9D1D1;color:#fff}
#fsa .yes svg,#fsa .no svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
#fsa .cpill{display:inline-block;background:#F3E3F8;border-radius:99px;padding:4px 11px;font-size:13px;font-weight:500;white-space:nowrap}
#fsa .modal{position:fixed;inset:0;background:rgba(20,20,30,.45);display:grid;place-items:center;padding:16px;z-index:30;opacity:0;transition:opacity .35s var(--ease)}
#fsa .modal.show{opacity:1}
#fsa .modal .sheet{transform:translateY(16px) scale(.985);transition:transform .45s var(--ease)}
#fsa .modal.show .sheet{transform:none}
#fsa .modal[hidden]{display:none!important}
#fsa .sheet{background:var(--card);border-radius:14px;max-width:560px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)}
#fsa .sheet-bar{display:flex;gap:10px;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--card)}
#fsa .cert{margin:18px;border:1.5px solid var(--ink);aspect-ratio:210/297;display:flex;flex-direction:column;font-size:13px}
#fsa .cert-head{background:#F6F1FF;border-bottom:1.5px solid var(--ink);display:flex;align-items:center;justify-content:center;gap:16px;padding:22px 18px}
#fsa .cert-head h2{margin:0;font-size:26px;font-weight:800}
#fsa .cert-head img{width:54px;height:54px}
#fsa .cert-body{padding:22px 30px;display:flex;flex-direction:column;gap:16px;flex:1}
#fsa .cert-row{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
#fsa .cert-row .who b{display:block;font-size:20px}
#fsa .cert dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:6px 10px}
#fsa .cert dt{font-weight:700}
#fsa .cert dd{margin:0}
#fsa .cert-foot{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:10px}
#fsa .seal{width:84px;height:84px;display:block}
#fsa .toast{position:fixed;bottom:calc(24px + env(safe-area-inset-bottom,0px));left:50%;transform:translate(-50%,10px);background:var(--ink);color:#fff;border-radius:8px;padding:10px 18px;font-size:14px;opacity:0;pointer-events:none;transition:opacity .35s var(--ease),transform .4s var(--ease);z-index:40}
#fsa .toast.show{opacity:1;transform:translate(-50%,0)}
#fsa .x-new{position:relative}
#fsa.show-new .x-new{outline:2px dashed var(--new);outline-offset:4px;border-radius:6px}
#fsa.show-new .x-new::before{content:attr(data-new);position:absolute;top:-22px;inset-inline-start:0;background:var(--new);color:#fff;font-size:11px;font-weight:700;padding:1px 8px;border-radius:4px;white-space:nowrap;z-index:2}
#fsa .legend{position:fixed;bottom:calc(20px + env(safe-area-inset-bottom,0px));right:20px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px;display:flex;align-items:center;gap:10px;font-size:13px;box-shadow:0 6px 24px rgba(0,0,0,.08);z-index:20}
#fsa .legend input{accent-color:var(--new)}
#fsa .legend .swatch{width:14px;height:14px;border:2px dashed var(--new);border-radius:3px}
#fsa .foot{max-width:1140px;margin:0 auto;padding:0 16px 48px;display:flex;gap:16px;justify-content:space-between;align-items:center;color:var(--muted);font-size:12px;flex-wrap:wrap}
#fsa .h1{font-size:28px;font-weight:800;letter-spacing:-.2px}
#fsa .sub{font-size:14px;color:var(--muted);font-weight:400}
#fsa .side button{font-weight:500;font-size:17px;color:#3a3a3a}
#fsa .side button[aria-current="page"]{font-weight:700}
#fsa .tabs button{font-weight:500;color:var(--muted)}
#fsa .tabs button[aria-selected="true"]{color:var(--ink);font-weight:700}
#fsa .tbl thead th{font-size:13px;font-weight:500;color:var(--muted);background:#F6F6F6;height:40px}
#fsa .tbl>tbody>tr>td{font-weight:400;color:#2a2a2a}
#fsa .tbl>tbody>tr:not(.drawer)>td:first-child{font-weight:600;color:var(--ink)}
#fsa .tbl>tbody>tr.drawer>td{font-weight:400}
@media (min-width:761px){#fsa .tbl>tbody>tr:not(.drawer)>td{border-bottom:1px solid #F0F0F0}
}
#fsa .mini th{font-size:12px;font-weight:500;color:var(--muted);border-bottom:1px solid var(--line)}
#fsa .mini td,#fsa .tbl .mini tbody td:first-child{font-weight:400;color:#2a2a2a;padding-inline-start:14px;padding-top:11px}
#fsa .btn{font-weight:600}
#fsa .chip{font-weight:600}
#fsa .plan .name{font-weight:700}
#fsa .plan .dates b{font-weight:500;color:var(--muted);font-size:12px}
#fsa .plan .dates span{font-size:14px}
#fsa .dom-head b{font-weight:700}
#fsa .fld label{font-size:12px;color:var(--muted);font-weight:500}
#fsa .hint{color:var(--muted)}
#fsa .note{display:flex;align-items:center;gap:10px;padding:4px 4px;margin-top:18px;font-size:14px;color:var(--muted)}
#fsa .btn.icon-only{width:44px;height:38px;padding:0}
#fsa .btn.icon-only .icon{width:20px;height:20px}
#fsa .ic-wrap{display:inline-grid;place-items:center;line-height:0}
#fsa .hello{cursor:default}
#fsa .smiley{position:relative;display:inline-block;width:20px;height:20px;vertical-align:-4px;margin-inline-start:2px;color:var(--violet-text)}
#fsa .smiley svg{width:100%;height:100%;overflow:visible;display:block}
#fsa .sm-face{transform-origin:12px 22px;transform-box:view-box}
#fsa .sm-ring{fill:#F3ECFF;stroke:currentColor;stroke-width:1.5}
#fsa .sm-eye{fill:currentColor;transform-box:fill-box;transform-origin:center}
#fsa .sm-mouth{fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;transition:opacity .2s}
#fsa .sm-grin{fill:currentColor;opacity:0;transform-box:fill-box;transform-origin:center top;transform:scaleY(.2);transition:opacity .2s,transform .35s cubic-bezier(.34,1.56,.64,1)}
#fsa .sm-cheek{fill:#FF8FB1;opacity:0;transition:opacity .3s}
#fsa .sm-spark{position:absolute;top:50%;left:50%;width:4px;height:4px;border-radius:50%;background:var(--violet-text);opacity:0;pointer-events:none}
#fsa .hello:hover .sm-face,#fsa .smiley.play .sm-face{animation:smHop .9s cubic-bezier(.3,.7,.4,1)}
#fsa .hello:hover .sm-eye-r,#fsa .smiley.play .sm-eye-r{animation:smWink .9s ease}
#fsa .hello:hover .sm-mouth,#fsa .smiley.play .sm-mouth{opacity:0}
#fsa .hello:hover .sm-grin,#fsa .smiley.play .sm-grin{opacity:1;transform:none}
#fsa .hello:hover .sm-cheek,#fsa .smiley.play .sm-cheek{opacity:.8}
#fsa .hello:hover .sm-spark,#fsa .smiley.play .sm-spark{animation:smSpark .8s ease-out .15s}
#fsa .sm-spark.s1{--x:-14px;--y:-12px}
#fsa .sm-spark.s2{--x:2px;--y:-17px;background:#FF8FB1}
#fsa .sm-spark.s3{--x:15px;--y:-10px;background:#6FCFA1}
@keyframes smHop{0%{transform:none}18%{transform:scale(1.12,.86)}40%{transform:translateY(-7px) rotate(-12deg) scale(.95,1.08)}58%{transform:translateY(0) rotate(8deg) scale(1.08,.92)}74%{transform:rotate(-4deg)}100%{transform:none}}
@keyframes smWink{0%,30%{transform:none}42%,60%{transform:scaleY(.12)}72%,100%{transform:none}}
@keyframes smSpark{0%{opacity:0;transform:translate(-50%,-50%) scale(.3)}30%{opacity:1}100%{opacity:0;transform:translate(calc(-50% + var(--x)),calc(-50% + var(--y))) scale(1)}}
#fsa .fp-btn .icon{width:16px;height:16px}
#fsa .note-ic{color:var(--violet-text);display:inline-grid}
#fsa .note-ic .icon{width:20px;height:20px}
#fsa .note-txt{flex:1;min-width:0}
#fsa .note-txt b{color:var(--ink);font-weight:600}
#fsa .note .linkbtn{font-size:13px}
#fsa .note-x{width:28px;height:28px;color:var(--faint)}
#fsa .note-x .icon{width:18px;height:18px}
#fsa .price .cur{font-weight:200;margin-inline-end:2px}
#fsa .now .cur{font-size:.82em}
#fsa .pf{display:flex;flex-direction:column;min-height:360px}
#fsa .form-actions{margin-top:auto;padding-top:32px;display:flex;justify-content:flex-start}
#fsa .form-actions .btn{width:171px}
#fsa .ibtn.locked{color:#C9C9C9;cursor:default}
#fsa .ibtn.locked:hover{background:none}
#fsa .ibtn.ph{visibility:hidden}
#fsa .ibtn.ok-btn{color:var(--violet)}
#fsa tr.editing td{background:#F8F6FF!important;vertical-align:middle}
#fsa .ed-pair{display:flex;gap:8px}
#fsa .ed-pair.stacked{flex-direction:column;gap:6px}
#fsa .ed{height:36px;border:1px solid #DCD6F7;border-radius:6px;background:var(--card);padding:0 10px;font-size:14px;min-width:0;flex:1;transition:border-color .2s var(--ease),box-shadow .2s var(--ease)}
#fsa .ed:focus{outline:none;border-color:var(--violet);box-shadow:0 0 0 3px rgba(91,63,255,.12)}
#fsa .ed-fonts .fp-btn{height:36px;border:1px solid #DCD6F7}
#fsa .lock-note{display:flex;align-items:center;gap:6px;font-size:12px;margin-top:12px}
#fsa .lock-note .linkbtn{font-size:12px}
#fsa .h2-sec{font-size:17px;font-weight:700;margin:8px 0 12px;display:flex;align-items:baseline;gap:10px}
#fsa .hist-toggle{all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;margin-top:40px;padding:14px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
#fsa .hist-toggle .icon{width:20px;height:20px;color:var(--muted);transition:transform .6s var(--ease),color .3s var(--ease)}
#fsa .hist-toggle:hover .icon{color:var(--violet)}
#fsa .hist-toggle[aria-expanded="true"] .icon{transform:rotate(180deg);color:var(--violet)}
#fsa .hist-toggle:focus-visible{outline:2px solid var(--violet);outline-offset:4px}
#fsa .hist-body{display:grid;grid-template-rows:0fr;transition:grid-template-rows .6s var(--ease)}
#fsa .hist-body>div{overflow:hidden;min-height:0;opacity:0;transform:translateY(-6px);transition:opacity .35s ease,transform .5s var(--ease),padding-top .6s var(--ease)}
#fsa .hist-body.open{grid-template-rows:1fr}
#fsa .hist-body.open>div{padding-top:12px;opacity:1;transform:none;transition:opacity .5s ease .12s,transform .6s var(--ease) .08s,padding-top .6s var(--ease)}
#fsa .hist-scroll{max-height:440px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
#fsa .hist-scroll thead th{position:sticky;top:0;z-index:2}
#fsa .tbl tr.mgroup td{position:sticky;top:44px;z-index:1;background:#fff;font-size:12px;font-weight:600!important;color:var(--violet);padding:14px 16px 6px;border-bottom:1px solid var(--line)}
#fsa .lock-note .icon{width:14px;height:14px;color:var(--faint)}
#fsa .lic-form{grid-template-columns:repeat(2,minmax(0,1fr)) auto}
#fsa .fname{display:inline-flex;align-items:center;gap:6px;margin-inline-start:-38px}
#fsa .ibtn.exp{color:var(--muted)}
#fsa .ibtn.exp:hover,#fsa tr.is-open .ibtn.exp{color:var(--violet);background:#EEE9FF}
#fsa .exp-ph{display:inline-block;width:32px}
#fsa .sites{display:flex;flex-direction:column;gap:4px}
#fsa .sites-lbl{font-size:11px;color:var(--muted)}
@media (max-width:760px){#fsa .fname{margin:0}
}
#fsa .tbl .mini.lined thead th,#fsa .tbl .mini.lined thead th:first-child,#fsa .tbl .mini.lined thead th:last-child{background:none;height:auto;border-radius:0;padding:10px 14px;font-size:12px;font-weight:500;color:var(--muted);border-bottom:1px solid var(--line)}
#fsa .tbl .mini.lined tbody td,#fsa .tbl .mini.lined tbody tr:first-child td,#fsa .tbl .mini.lined tbody td:first-child{padding:13px 14px;font-weight:400;color:#2a2a2a;border-bottom:1px solid #F0F0F0;font-size:14px}
#fsa .tbl .mini.lined tbody tr:last-child td{border-bottom:0}
#fsa .lic-drawer{padding:4px 0 18px;animation:none}
#fsa .drawer.opening .lic-drawer{animation:drawerIn .5s var(--ease) both}
#fsa .drawer.closing .lic-drawer{animation:drawerOut .28s ease forwards}
#fsa .drawer .lic-drawer .box{animation:none}
#fsa .dom-box .form-row{margin-bottom:0}
#fsa .dom-box .form-err{margin:10px 0 0}
#fsa .dom-box .quota-line{padding:0}
#fsa .mini.lined{margin-top:22px}
#fsa .mini.lined th{padding:10px 14px;border-bottom:1px solid var(--line)}
#fsa .mini.lined td{padding:13px 14px;border-bottom:1px solid #F0F0F0}
#fsa .mini.lined tr:last-child td{border-bottom:0}
#fsa .mini.lined tbody tr{transition:background-color .2s var(--ease)}
#fsa .mini.lined tbody tr:hover td{background:#FBFAFE}
#fsa .quota-line{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:4px 0 22px}
#fsa .quota-line .msg{flex:1;min-width:220px}
#fsa .quota-line .msg b{display:block;font-size:15px;font-weight:700}
#fsa .quota-line .msg span{font-size:13px;color:var(--muted)}
#fsa .linkbtn{all:unset;cursor:pointer;font-size:14px;font-weight:500;color:var(--violet);text-decoration:underline;text-underline-offset:3px}
@media (max-width:1000px){#fsa .main{padding:40px 24px}
#fsa .pkgs{grid-template-columns:1fr;max-width:440px;margin-inline:auto}
#fsa .pk.rec{margin-top:0}
#fsa .qopts{grid-template-columns:1fr}
}
@media (max-width:760px){#fsa .site-head .in{padding:0 16px;height:64px;gap:12px}
#fsa .mainnav{display:none}
#fsa .logo{font-size:24px}
#fsa .me span{display:none}
#fsa .me{padding:3px}
#fsa .page{padding-block:18px 90px}
#fsa .shell{grid-template-columns:minmax(0,1fr);grid-template-rows:auto 1fr;min-height:0;overflow:clip}
#fsa .main.is-plans{border-radius:0 0 var(--r-card) var(--r-card)}
#fsa .main.is-plans .head-row .h1{font-size:24px}
#fsa .cmp table,#fsa .cmp thead,#fsa .cmp tbody{display:block}
#fsa .cmp tr{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
#fsa .cmp th:first-child{display:none}
#fsa .cmp th{width:auto;font-size:15px;padding:18px 4px 12px;white-space:normal}
#fsa .cmp th img{height:15px}
#fsa .cmp td{padding:8px 4px}
#fsa .cmp td:first-child{grid-column:1/-1;padding:16px 0 6px!important;font-size:14px}
#fsa .cmp tr.grp td:not(:first-child){display:none}
#fsa .cmp tr.grp td:first-child{padding-top:26px!important}
#fsa .cmp tr:has(+ tr.grp) td:not(:first-child){padding-bottom:22px}
#fsa .cmp .cpill{font-size:12px;padding:3px 8px;white-space:normal;line-height:1.3}
#fsa .cmp tr.cmp-end td:not(:first-child){display:none}
#fsa .cmp tr.cmp-end td{height:30px}
#fsa .cmp table{table-layout:auto}
#fsa .web-col{left:33.333%;width:33.334%}
#fsa .mini thead{display:none}
#fsa .mini,#fsa .mini tbody,#fsa .mini tr,#fsa .mini td{display:block}
#fsa .mini tbody tr{display:flex;flex-wrap:wrap;align-items:center;gap:2px 12px;padding:12px 0;border-bottom:1px solid var(--line)}
#fsa .mini tbody td{padding:0!important;border:0!important}
#fsa .mini tbody td:last-child{margin-inline-start:auto}
#fsa .tbl tr.mgroup td{top:0;flex-basis:100%;padding:12px 0 4px!important}
#fsa .side .logout{margin:0;padding-inline:16px;height:50px;flex:none}
#fsa .tbl thead{display:none}
#fsa .tbl,#fsa .tbl tbody,#fsa .tbl tr,#fsa .tbl td{display:block}
#fsa .tbl tbody tr:not(.drawer){display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;padding:14px 0;border-bottom:1px solid var(--line)}
#fsa .tbl tbody td,#fsa .tbl tbody tr:first-child td{padding:0!important;font-size:14px}
#fsa .tbl tbody td:first-child{flex-basis:100%;font-size:16px}
#fsa .tbl tbody td:last-child{margin-inline-start:auto}
#fsa .tbl tbody tr:not(.drawer):hover td{background:none}
#fsa .drawer .box{padding:16px}
#fsa .dl{width:auto;padding:0 14px}
#fsa .h1{font-size:22px}
#fsa .side{flex-direction:row;align-self:start;overflow-x:auto;padding:0;border-inline-end:0;border-bottom:1px solid var(--line);position:sticky;top:calc(64px + env(safe-area-inset-top,0px));background:var(--card);z-index:5;scrollbar-width:none}
#fsa .side button{margin:0;padding-inline:16px;height:50px;font-size:15px;flex:none}
#fsa .side button[aria-current="page"]::after{inset-inline:0;top:auto;bottom:0;width:auto;height:3px}
#fsa .side .sep{display:none}
#fsa .main{padding:26px 16px}
#fsa .grid3,#fsa .form-row{grid-template-columns:1fr}
#fsa .plan .dates{margin-inline-start:0;gap:20px}
#fsa .tbl thead th:first-child,#fsa .tbl tbody td:first-child{padding-inline-start:14px}
#fsa .legend{left:16px;right:16px;justify-content:center}
#fsa .cert-body{padding:16px}
#fsa .tbl tbody tr:not(.drawer):has(> td > .acts){row-gap:6px}
#fsa .tbl tbody tr:not(.drawer):has(> td > .acts)>td:first-child{flex:1 1 0;min-width:0}
#fsa .tbl tbody tr:not(.drawer):has(> td > .acts)>td:not(:first-child){order:2}
#fsa .tbl tbody tr:not(.drawer):has(> td > .acts)>td:last-child{order:1}
#fsa .tbl tbody tr:not(.drawer):has(> td > .acts)::after{content:"";order:1;flex-basis:100%;height:0}
#fsa .orow>td:nth-child(5){order:1!important;margin-inline-start:auto;font-weight:600;color:var(--ink)}
#fsa .orow>td:last-child{margin-inline-start:0}
#fsa .tbl .mini tbody td:first-child{flex-basis:auto;font-size:14px}
#fsa .mini tbody tr:not(:has(.acts))>td:first-child{flex:1 1 0;min-width:0}
#fsa .mini tbody tr:has(> td > .acts)>td:not(:last-child){order:2}
#fsa .mini tbody tr:has(> td > .acts)>td:last-child{order:1}
#fsa .mini tbody tr:has(> td > .acts)::after{content:"";order:1;flex-basis:100%;height:0}
#fsa .mini tbody tr:has(> td > .acts)>td:first-child{order:0;flex:1 1 0;min-width:0}
}
@media (prefers-reduced-motion:reduce){#fsa,#fsa *{animation:none!important;transition:none!important}
}
#fsa .modal{z-index:100000}
#fsa .toast{z-index:100001}
#fsa .live-note{margin:0 4px 10px;font-size:12px;color:var(--muted)}
#fsa .empty{padding:30px 0;color:var(--muted)}
@media (max-width:760px){#fsa .side{top:0}}
.fsa-v2 .page-header,.fsa-v2 .entry-title{display:none}
html body.fsa-v2{overflow-x:clip}
FSACSS;
	$html = <<<'FSAHTML'
<div id="fsa"><main class="page">
<p class="hello x-new" data-new="ברכה עדינה"><span id="greet">ערב טוב</span>, <b id="fsaName"></b> <span class="smiley" aria-hidden="true"><svg viewBox="0 0 24 24"><g class="sm-face"><circle class="sm-ring" cx="12" cy="12" r="10"/><ellipse class="sm-cheek" cx="7.2" cy="14" rx="1.6" ry="1"/><ellipse class="sm-cheek" cx="16.8" cy="14" rx="1.6" ry="1"/><ellipse class="sm-eye sm-eye-l" cx="9" cy="10.2" rx=".75" ry="1.2"/><ellipse class="sm-eye sm-eye-r" cx="15" cy="10.2" rx=".75" ry="1.2"/><path class="sm-mouth" d="M9 15.4c.85.63 1.88 1 3 1s2.15-.37 3-1"/><path class="sm-grin" d="M8 14h8c0 2.4-1.8 4-4 4s-4-1.6-4-4Z"/></g></svg><i class="sm-spark s1"></i><i class="sm-spark s2"></i><i class="sm-spark s3"></i></span></p>
<p class="live-note">תצוגה מקדימה של האזור האישי החדש · גלוי רק למנהלים · דומיינים ותעודות יחוברו בשלב הבא</p>
<div class="shell">
    <nav class="side" aria-label="אזור אישי">
      <button data-view="subs">המינוי שלי</button>
      <button data-view="lic">פונטים שרכשתי</button>
      <button data-view="dom">דומיינים</button>
      <button data-view="orders">הזמנות</button>
      <button data-view="profile">פרופיל</button>
      <button data-view="plans" class="x-new" data-new="חדש">חבילות</button>
      <span class="sep"></span>
      <button class="logout" id="logout"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M9 7c.01-2.18.11-3.35.88-4.12C10.76 2 12.17 2 15 2h1c2.83 0 4.24 0 5.12.88C22 3.76 22 5.17 22 8v8c0 2.83 0 4.24-.88 5.12C20.24 22 18.83 22 16 22h-1c-2.83 0-4.24 0-5.12-.88C9.11 20.35 9.01 19.18 9 17" opacity=".5"/><path stroke-linejoin="round" d="M15 12H2m3.5 3L2 12l3.5-3"/></g></svg>התנתק/י</button>
    </nav>
    <section class="main" id="view"></section>
  </div>
</main>
<div class="modal" id="certModal" hidden role="dialog" aria-modal="true" aria-label="תעודת רישיון">
  <div class="sheet">
    <div class="sheet-bar"><b>תעודת רישיון</b><div style="display:flex;gap:8px"><button class="btn btn-grad" style="height:34px" data-t="התעודה הורדה כ־PDF">הורדת PDF</button><button class="ibtn" id="certClose" aria-label="סגירה"><i data-ic="close"></i></button></div></div>
    <div id="certBody"></div>
  </div>
</div>
<div class="toast" id="toast" role="status"></div></div>
FSAHTML;
	$js   = <<<'FSAJS'
(function(){

const $=s=>document.querySelector(s);
const ICON={
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
  close:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><circle cx="12" cy="12" r="10" opacity=".5"/><path d="M14.5 9.50002L9.5 14.5M9.49998 9.5L14.5 14.5"/></g></svg>',
  globe:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M2 12H22M16 12C16 13.3132 15.8965 14.6136 15.6955 15.8268C15.4945 17.0401 15.1999 18.1425 14.8284 19.0711C14.457 19.9997 14.016 20.7362 13.5307 21.2388C13.0454 21.7413 12.5253 22 12 22C11.4747 22 10.9546 21.7413 10.4693 21.2388C9.98396 20.7362 9.54301 19.9997 9.17157 19.0711C8.80014 18.1425 8.5055 17.0401 8.30448 15.8268C8.10346 14.6136 8 13.3132 8 12C8 10.6868 8.10346 9.38642 8.30448 8.17316C8.5055 6.95991 8.80014 5.85752 9.17157 4.92893C9.54301 4.00035 9.98396 3.26375 10.4693 2.7612C10.9546 2.25866 11.4747 2 12 2C12.5253 2 13.0454 2.25866 13.5307 2.76121C14.016 3.26375 14.457 4.00035 14.8284 4.92893C15.1999 5.85752 15.4945 6.95991 15.6955 8.17317C15.8965 9.38642 16 10.6868 16 12Z" opacity=".5"/><path d="M22 12C22 13.3132 21.7413 14.6136 21.2388 15.8268C20.7362 17.0401 19.9997 18.1425 19.0711 19.0711C18.1425 19.9997 17.0401 20.7362 15.8268 21.2388C14.6136 21.7413 13.3132 22 12 22C10.6868 22 9.38642 21.7413 8.17317 21.2388C6.95991 20.7362 5.85752 19.9997 4.92893 19.0711C4.00035 18.1425 3.26375 17.0401 2.7612 15.8268C2.25866 14.6136 2 13.3132 2 12C2 10.6868 2.25866 9.38642 2.76121 8.17316C3.26375 6.95991 4.00035 5.85752 4.92893 4.92893C5.85752 4.00035 6.95991 3.26375 8.17317 2.7612C9.38642 2.25866 10.6868 2 12 2C13.3132 2 14.6136 2.25866 15.8268 2.76121C17.0401 3.26375 18.1425 4.00035 19.0711 4.92893C19.9997 5.85752 20.7362 6.95991 21.2388 8.17317C21.7413 9.38642 22 10.6868 22 12L22 12Z"/></g></svg>',
  user:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><circle cx="12" cy="6" r="4"/><ellipse cx="12" cy="17" opacity=".5" rx="7" ry="4"/></g></svg>',
  card:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M2 12C2 8.22876 2 6.34315 3.17157 5.17157C4.34315 4 6.22876 4 10 4H14C17.7712 4 19.6569 4 20.8284 5.17157C22 6.34315 22 8.22876 22 12C22 15.7712 22 17.6569 20.8284 18.8284C19.6569 20 17.7712 20 14 20H10C6.22876 20 4.34315 20 3.17157 18.8284C2 17.6569 2 15.7712 2 12Z"/><path d="M10 16H6" opacity=".5"/><path d="M14 16H12.5" opacity=".5"/><path d="M2 10L22 10" opacity=".5"/></g></svg>',
  crown:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M5 17.5H19" opacity=".5"/><path d="M19.9823 10.4999L20 10.5C20.8284 10.5 21.5 9.82843 21.5 9C21.5 8.17157 20.8284 7.5 20 7.5C19.1716 7.5 18.5 8.17157 18.5 9C18.5 9.37466 18.6374 9.71724 18.8645 9.98013C19.1359 10.2944 19.5357 10.4947 19.9823 10.4999Z"/><path d="M19.9823 10.5C20.033 10.8784 19.9684 11.479 19.8706 12.3885L19.6872 14.0932C19.3851 16.902 19.234 19.3064 18.2879 20.1533C17.3418 21.0001 15.9239 21.0001 13.0879 21.0001H10.9121C8.07613 21.0001 6.65817 21.0001 5.71208 20.1533C4.76598 19.3064 4.61492 16.902 4.3128 14.0932L4.12945 12.3885C4.03162 11.479 3.96702 10.8784 4.01771 10.5"/><path d="M4 10.5L4.01771 10.4999C4.46434 10.4947 4.86406 10.2944 5.13553 9.98012C5.36264 9.71724 5.5 9.37466 5.5 9C5.5 8.17157 4.82843 7.5 4 7.5C3.17157 7.5 2.5 8.17157 2.5 9C2.5 9.82843 3.17157 10.5 4 10.5Z"/><path d="M11.0925 6.78271C10.9345 7.03566 10.7592 7.34991 10.5498 7.72547L8.76027 10.934C8.42077 11.5427 8.25102 11.8471 7.99642 11.9592C7.85535 12.0213 7.69969 12.0431 7.54691 12.0219C7.27118 11.9838 7.02403 11.7376 6.52971 11.2452C5.88806 10.6061 5.46178 10.1814 5.13574 9.98019"/><path d="M11.0923 6.78265C11.3647 6.92163 11.6732 7 12 7C12.3268 7 12.6353 6.92163 12.9077 6.78265C13.556 6.45187 14 5.77778 14 5C14 3.89543 13.1046 3 12 3C10.8954 3 10 3.89543 10 5C10 5.77778 10.444 6.45187 11.0923 6.78265Z"/><path d="M12.9077 6.78271C13.0658 7.03565 13.241 7.34991 13.4505 7.72546L15.24 10.934C15.5795 11.5427 15.7492 11.8471 16.0038 11.9592C16.1449 12.0213 16.3006 12.0431 16.4533 12.0219C16.7291 11.9838 16.9762 11.7376 17.4705 11.2452C18.1122 10.6061 18.5385 10.1814 18.8645 9.98019"/></g></svg>',
  font:'<svg class="icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path stroke-linejoin="round" d="M12 7H10C9.05719 7 8.58579 7 8.29289 7.32544C8 7.65087 8 8.17466 8 9.22222V9.75M12 7H14C14.9428 7 15.4142 7 15.7071 7.32544C16 7.65087 16 8.17466 16 9.22222V9.75M12 7V17M9.5 17H15"/><path d="M2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12Z" opacity=".5"/></g></svg>'
};
const SUBS={
 extra:{name:'אקסטרה',en:'Extra Brand',logo:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgZGF0YS1uYW1lPSJMYXllciAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2aWV3Qm94PSIwIDAgNTEwLjcyIDUxMC43MiI+CiAgPGRlZnM+CiAgICA8c3R5bGU+CiAgICAgIC5jbHMtMSB7CiAgICAgICAgZmlsbDogdXJsKCNsaW5lYXItZ3JhZGllbnQtMik7CiAgICAgIH0KCiAgICAgIC5jbHMtMiB7CiAgICAgICAgZmlsbDogI2ZmZjsKICAgICAgICBzdHJva2U6IHVybCgjTmV3X0dyYWRpZW50X1N3YXRjaF80KTsKICAgICAgICBzdHJva2UtbWl0ZXJsaW1pdDogMTA7CiAgICAgICAgc3Ryb2tlLXdpZHRoOiA5cHg7CiAgICAgIH0KCiAgICAgIC5jbHMtMyB7CiAgICAgICAgZmlsbDogdXJsKCNsaW5lYXItZ3JhZGllbnQpOwogICAgICB9CiAgICA8L3N0eWxlPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJOZXdfR3JhZGllbnRfU3dhdGNoXzQiIGRhdGEtbmFtZT0iTmV3IEdyYWRpZW50IFN3YXRjaCA0IiB4MT0iMzgzLjA2IiB5MT0iMzQuMTgiIHgyPSIxMjcuNjYiIHkyPSI0NzYuNTUiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjYjA3YmU5Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iLjE0IiBzdG9wLWNvbG9yPSIjYWE3NmU3Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iLjMxIiBzdG9wLWNvbG9yPSIjOWI2YWU0Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iLjUiIHN0b3AtY29sb3I9IiM4MTU2ZGUiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIuNzEiIHN0b3AtY29sb3I9IiM1ZDNhZDYiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIuOTIiIHN0b3AtY29sb3I9IiMzMDE2Y2MiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMWUwOGM5Ii8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJsaW5lYXItZ3JhZGllbnQiIHgxPSIzNjMuNzciIHkxPSI5OS43NCIgeDI9IjEyNC4wMiIgeTI9IjMyMi42MyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNiMDhmZTkiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIuMTQiIHN0b3AtY29sb3I9IiNhYTg5ZTciLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIuMzEiIHN0b3AtY29sb3I9IiM5YjdiZTQiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIuNSIgc3RvcC1jb2xvcj0iIzgxNjNkZSIvPgogICAgICA8c3RvcCBvZmZzZXQ9Ii43MSIgc3RvcC1jb2xvcj0iIzVkNDJkNiIvPgogICAgICA8c3RvcCBvZmZzZXQ9Ii45MiIgc3RvcC1jb2xvcj0iIzMwMThjYyIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMxZTA4YzkiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImxpbmVhci1ncmFkaWVudC0yIiB4MT0iNDYxLjY1IiB5MT0iMjA1LjAyIiB4Mj0iMjIxLjkxIiB5Mj0iNDI3LjkxIiB4bGluazpocmVmPSIjbGluZWFyLWdyYWRpZW50Ii8+CiAgPC9kZWZzPgogIDxjaXJjbGUgY2xhc3M9ImNscy0yIiBjeD0iMjU1LjM2IiBjeT0iMjU1LjM2IiByPSIyNTAuODYiLz4KICA8cGF0aCBjbGFzcz0iY2xzLTMiIGQ9Ik0zMTIuMzgsMzMzLjg1bC0uMDcsMS4wOGMtMTcuOCwxNi4zOC0zNS44OSwyOC41LTU0LjI5LDM2LjM2LTIwLjQ3LDguNzQtMzcuMDEsMTMuMTItNjIsMTMuMTItMzQuMDYsMC02Ni40Ni0xNC4xMy05MC4xMS0zNi42NC0yNy40MS0yNi4xLTM5Ljc2LTU4Ljk3LTQwLjU4LTEwNC4zNC0uNjgtMzcuOSwxNC44OS02Ny45MiwzOS4zOC05MC4xOCwyMC40OC0xOC42MSw0NC41LTI4LjgyLDcyLjA5LTMwLjYzLDMwLjM4LTIuMDEsNTYuOCw1Ljc3LDc5LjI2LDIzLjMyLDE4LjQ1LDE0LjQxLDMxLjgzLDMzLjAyLDQwLjE4LDU1LjhsLTEuMjEsMS42NC0xNzkuOTYsMTAxLjA0LTE1LjUtMzcuMDUsMTM1Ljc5LTc2LjU4Yy00LjI3LTguNS0xMC45OS0xNS4yOC0yMC4xNi0yMC4zNS0xMC4xMi01LjU5LTIxLjQ2LTcuOTYtMzQuMDQtNy4xMy0xNy4wMywxLjE0LTMyLDcuNTUtNDQuOTEsMTkuMjUtMTUuMzgsMTMuOTMtMjMuMjMsMzIuMzEtMjMuNTYsNTUuMTItLjM3LDI2LjQ2LDUuNjEsNDguODcsMTcuOTMsNjcuMjEsMTQuNDksMjEuNTUsMzguNTEsMzMuNTgsNjUuOTQsMzQuNTksMTYuNjMuNjIsMjkuNzUtMy41LDQ1LjQ2LTEwLjg1LDExLjkzLTUuNTgsMjUuNzktMTQuNzEsNDEuNTgtMjcuNDFoMS4wOWwyNy42OCwzMi42MmguMDFaIi8+CiAgPHBhdGggY2xhc3M9ImNscy0xIiBkPSJNNDM3LjQyLDM4MS42OWwtLjE1LDIuMThoLTYzLjA3bC0xMjEuMDgtMTM4Ljk3LjE2LTIuMzMsMzkuODItMjEuNjQsMzUuODIsMzkuOWMyNi4xMi0yOC40Niw0OC45OC02MC45Myw2NC4zMi04OS4zMWw0Mi4yMywxMC45Ny40LDIuMTdzLTI4LjU3LDQ4Ljc5LTU4LjQxLDg0LjEzYy01LjMxLDYuMjktMTMuMDEsMTQuODYtMjAuNjYsMjMuMDlsODAuNjIsODkuODFoMFoiLz4KPC9zdmc+'},
 web:{name:'וובסטופ',en:'Webstop',logo:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2ZXJzaW9uPSIxLjEiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2aWV3Qm94PSIwIDAgNTEwLjcyIDUxMC43MiI+CiAgPCEtLSBHZW5lcmF0b3I6IEFkb2JlIElsbHVzdHJhdG9yIDMwLjEuMCwgU1ZHIEV4cG9ydCBQbHVnLUluIC4gU1ZHIFZlcnNpb246IDIuMS4xIEJ1aWxkIDEzNikgIC0tPgogIDxkZWZzPgogICAgPHN0eWxlPgogICAgICAuc3QwIHsKICAgICAgICBmaWxsOiBub25lOwogICAgICAgIHN0cm9rZTogdXJsKCNsaW5lYXItZ3JhZGllbnQxKTsKICAgICAgICBzdHJva2UtbWl0ZXJsaW1pdDogMTA7CiAgICAgICAgc3Ryb2tlLXdpZHRoOiA5cHg7CiAgICAgIH0KCiAgICAgIC5zdDEgewogICAgICAgIGZpbGw6IHVybCgjbGluZWFyLWdyYWRpZW50KTsKICAgICAgfQogICAgPC9zdHlsZT4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0ibGluZWFyLWdyYWRpZW50IiB4MT0iMzUwLjgyIiB5MT0iODUuMjciIHgyPSIxNDIuNzgiIHkyPSIzNzkuNDYiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjNWFjM2I0Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzJiMzE4YiIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0ibGluZWFyLWdyYWRpZW50MSIgeDE9IjM4My4wNiIgeTE9IjM0LjE4IiB4Mj0iMTI3LjY2IiB5Mj0iNDc2LjU1IiB4bGluazpocmVmPSIjbGluZWFyLWdyYWRpZW50Ii8+CiAgPC9kZWZzPgogIDxwYXRoIGNsYXNzPSJzdDEiIGQ9Ik00MzUuNjQsMjQzLjczbC0xNy40MSw0NS4wNi0xLjAyLjUxLTI1LjA5LTIzLjU1LS41MS41MWMuNjEsNS4yOC0uNTEsMTIuMjMtMS4yNiwxNi0xNy4wNSw5My42Mi01OC40LDExNS4wNy0xMDIuMTcsMTE1LjA3LTIwLjQ4LDAtMzQuODEtMTIuMjktNDcuNjEtNDMuNTJoLS41MmMtMTguNDMsMzEuMjMtNDEuNDcsNDMuMDEtNjguNiw0My4wMS00Ni42LDAtNTMuMjUtNDMuNTItNTMuMjUtNzIuMTksMC00My4wOCw1Ljc5LTY3LjM1LDIzLjU1LTEzNS42OCwwLTYuNjYtMy4wNy0xMC43NS05LjczLTEwLjc1LTYuMTQsMC0xMy4zMSwzLjA3LTE4LjQzLDYuMTRsLTIuNTYtMS41NC0xMS4yNi00MC45NiwxLjUzLTIuNTZjMTUuODctNS42MywzMS43NS0xMC43NSw0OS4xNS0xMC43NSwxOC45NSwwLDM5LjQzLDguMTksMzkuNDMsMzYuODcsMCwyMy4wNC0yMi4wMiwxMTUuMi0yMi4wMiwxNDMuODcsMCwyNS42LDEwLjYsMzguODMsMjcuNjUsMzUuMzMsMzcuMzgtNy42OCw0MS40Ny02OS42NCw0MS42Mi05Ny44LjEtMTkuMTEtLjA3LTI3LjQ3LS42Ni0zMS43NGwxLjU0LTEuNTQsNDUuMDUtMS4wMiwxLjU0LDIuMDVjLjUxLDUuMTIsMS4wMiwxMi4yOSwxLjAyLDIwLjQ4LDAsNDIuNDktNC42MSw2Ny4wNy00LjYxLDg3LjA0LDAsMTQuODUsNi4yNSwyNC4yLDI0LjA3LDIyLjUzLDMwLjgyLTIuOSw0NS43Mi02MS4wMyw0My4xNi0xNDIuNDcsMC0yMi40NC0yLjc4LTYyLjQtMy43NC03MS4wNGwyLjU2LTIuMDUsNDQuMDMtMi4wNCwyLjU2LDMuMDdjNC4xLDY3LjU4LDE0Ljg1LDg5LjA5LDQxLjQ4LDExMS42MWwuNTEsMi4wNWgwWiIvPgogIDxjaXJjbGUgY2xhc3M9InN0MCIgY3g9IjI1NS4zNiIgY3k9IjI1NS4zNiIgcj0iMjUwLjg2Ii8+Cjwvc3ZnPg=='},
 desk:{name:'דסקטופ',en:'Desktop',logo:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTAuNzIgNTEwLjcyIj4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0icmluZyIgeDE9IjM4My4wNiIgeTE9IjM0LjE4IiB4Mj0iMTI3LjY2IiB5Mj0iNDc2LjU1IiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iI2ZmOWE4YiIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNlMzE2NmYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImdseXBoIiB4MT0iMzY1IiB5MT0iMTE1IiB4Mj0iMTUwIiB5Mj0iNDAwIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iI2ZmOWE4YiIvPgogICAgICA8c3RvcCBvZmZzZXQ9Ii44NSIgc3RvcC1jb2xvcj0iI2UzMTY2ZiIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICA8L2RlZnM+CiAgPGNpcmNsZSBjeD0iMjU1LjM2IiBjeT0iMjU1LjM2IiByPSIyNTAuODYiIGZpbGw9IiNmZmYiIHN0cm9rZT0idXJsKCNyaW5nKSIgc3Ryb2tlLXdpZHRoPSI5Ii8+CiAgPGcgZmlsbD0idXJsKCNnbHlwaCkiPgogICAgPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNMTM2IDMwMGE4NiA4MiAwIDEgMCAxNzIgMGE4NiA4MiAwIDEgMC0xNzIgMFpNMTkwIDMwMGEzNiA0NiAwIDEgMCA3MiAwYTM2IDQ2IDAgMSAwLTcyIDBaIi8+CiAgICA8cGF0aCBkPSJNMjcwIDE0Nmw1Ni0yNHYxOTZjMCAyNiAxMiAzNiAzOCAzMmwxMCAzNGMtNTIgMTYtMTA0IDItMTA0LTU4WiIvPgogIDwvZz4KPC9zdmc+Cg=='},
 barter:{name:'בארטר',en:'Barter',logo:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTAuNzIgNTEwLjcyIj4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0icmluZyIgeDE9IjM4My4wNiIgeTE9IjM0LjE4IiB4Mj0iMTI3LjY2IiB5Mj0iNDc2LjU1IiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iI2MzY2FkNiIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyMDIzMmIiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImdseXBoIiB4MT0iMzY1IiB5MT0iMTE1IiB4Mj0iMTUwIiB5Mj0iNDAwIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iI2E3YjBiZiIvPgogICAgICA8c3RvcCBvZmZzZXQ9Ii44NSIgc3RvcC1jb2xvcj0iIzIwMjMyYiIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICA8L2RlZnM+CiAgPGNpcmNsZSBjeD0iMjU1LjM2IiBjeT0iMjU1LjM2IiByPSIyNTAuODYiIGZpbGw9IiNmZmYiIHN0cm9rZT0idXJsKCNyaW5nKSIgc3Ryb2tlLXdpZHRoPSI5Ii8+CiAgPGcgZmlsbD0idXJsKCNnbHlwaCkiPgogICAgPHBhdGggZD0iTTE0MCAxNDZsNTYtMjR2MjYyaC01NloiLz4KICAgIDxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTE3OCAzMDBhODYgODIgMCAxIDAgMTcyIDBhODYgODIgMCAxIDAtMTcyIDBaTTIyOCAzMDBhMzYgNDYgMCAxIDAgNzIgMGEzNiA0NiAwIDEgMC03MiAwWiIvPgogIDwvZz4KPC9zdmc+Cg=='},
 acad:{name:'אקדמיק',en:'Academic',logo:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgZGF0YS1uYW1lPSJMYXllciAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB2aWV3Qm94PSIwIDAgNTEwLjcyIDUxMC43MiI+CiAgPGRlZnM+CiAgICA8c3R5bGU+CiAgICAgIC5jbHMtMSB7CiAgICAgICAgZmlsbDogI2ZmZjsKICAgICAgICBzdHJva2U6IHVybCgjbGluZWFyLWdyYWRpZW50KTsKICAgICAgICBzdHJva2UtbWl0ZXJsaW1pdDogMTA7CiAgICAgICAgc3Ryb2tlLXdpZHRoOiA5cHg7CiAgICAgIH0KCiAgICAgIC5jbHMtMiB7CiAgICAgICAgZmlsbDogdXJsKCNOZXdfR3JhZGllbnRfU3dhdGNoXzMpOwogICAgICB9CiAgICA8L3N0eWxlPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJsaW5lYXItZ3JhZGllbnQiIHgxPSIzODMuMDYiIHkxPSIzNC4xOCIgeDI9IjEyNy42NiIgeTI9IjQ3Ni41NSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNlMWYwN2QiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIuODUiIHN0b3AtY29sb3I9IiNmZmFkMDUiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9Ik5ld19HcmFkaWVudF9Td2F0Y2hfMyIgZGF0YS1uYW1lPSJOZXcgR3JhZGllbnQgU3dhdGNoIDMiIHgxPSIxNjIuOTgiIHkxPSI0NDguMzkiIHgyPSIzNDEuNDUiIHkyPSIxMTIuMTMiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIuMTUiIHN0b3AtY29sb3I9IiNmZmFkMDUiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjZTFmMDdkIi8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8Y2lyY2xlIGNsYXNzPSJjbHMtMSIgY3g9IjI1NS4zNiIgY3k9IjI1NS4zNiIgcj0iMjUwLjg2Ii8+CiAgPHBhdGggY2xhc3M9ImNscy0yIiBkPSJNNDA1LjA1LDI1MC4yM2MwLDExNy4wMy03Ni41NywxNDUuMDctMTMwLjUsMTQ1LjA3LTIzLjgxLDAtNTAuMjEtNS43MS03Mi4wOC0yMS43Mi0uNzItLjUzLTEuNzEtLjQ1LTIuMzQuMTctOC4wNCw3Ljk1LTE1LjYzLDE0LjU0LTIzLjIxLDIwLjYxLS4zMi4yNS0uNzIuNC0xLjEzLjRoLTY4LjMyYy0uOTksMC0xLjgtLjgtMS44LTEuOGgwYzAtLjU3LjI3LTEuMS43Mi0xLjQ0LDcyLjktNTQuNzYsMTE1LjA1LTEwMC4yMiwxMTUuMDUtMTQ0LjI5LDAtMjUuMzMtMTIuMjQtMzUuOS0yNi44LTM1LjktMjIuNDUsMC0zMC45LDE1LjkzLTMwLjksMzQuMDQsMCwxNS4xOCw2LjE5LDMxLjA5LDIyLjQyLDUxLjgzLjI0LjMyLjM5LjcxLjM5LDEuMTF2Ljg3YzAsLjQzLS4xNi44NC0uNDMsMS4xN2wtMjQuODYsMjguODhjLS4yOC4zMy0uNjcuNTQtMS4xLjZsLS44Ni4xM2MtLjU0LjA4LTEuMS0uMDgtMS41LS40NS0yMi4xMy0yMC4zNC0zOC45LTQ2LjgyLTM4LjktODMuMSwwLTUxLjM5LDM4LjAyLTc3LjE3LDc1Ljc0LTc3LjE3LDUyLjMxLDAsNzcuMDQsMzIuNDIsNzcuMDQsODAuMDgsMCwyOS42Ni0xOC4wMyw2MC43MS0zOC42LDg1LjgyLS42NC43OC0uNTEsMS45My4yOCwyLjU2LDEwLjU5LDguMzYsMjkuNDUsMTIuMjksNDQuNDEsMTIuMjksNjAuMzksMCw3NC45Ni01Ny43LDc0Ljk2LTk5Ljc3LDAtNjAuODgtMzQuMDctODUuNDItNzIuNjEtODkuMDMtNS4yNS0uNS0xMC41Mi0uNDctMTUuNzgtLjEzbC05LjUyLjY0Yy0uNTIuMDMtMS4wMi0uMTYtMS4zOS0uNTNsLTEuMDUtMS4wNWMtLjM0LS4zNC0uNTMtLjc5LS41My0xLjI3di0zOS40OGMwLS40Ny4xOS0uOTQuNTMtMS4yN2wxLjE3LTEuMTdjLjMxLS4zMS43LS40OCwxLjEyLS41MmwyLjk2LS4yNWM3LjQ2LS42MywyNC0xLjA4LDMxLjQ0LS4zNCw4OC44Niw4Ljg4LDExNS45OCw4My43NCwxMTUuOTgsMTM0LjQxaDBaIi8+Cjwvc3ZnPg=='},
 buy:{name:'רכישה בודדת',en:'Single license',logo:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTAuNzIgNTEwLjcyIj4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0icmluZyIgeDE9IjM4My4wNiIgeTE9IjM0LjE4IiB4Mj0iMTI3LjY2IiB5Mj0iNDc2LjU1IiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iI2ZmOWE4YiIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNlMzE2NmYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImdseXBoIiB4MT0iMzY1IiB5MT0iMTE1IiB4Mj0iMTUwIiB5Mj0iNDAwIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iI2ZmOWE4YiIvPgogICAgICA8c3RvcCBvZmZzZXQ9Ii44NSIgc3RvcC1jb2xvcj0iI2UzMTY2ZiIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICA8L2RlZnM+CiAgPGNpcmNsZSBjeD0iMjU1LjM2IiBjeT0iMjU1LjM2IiByPSIyNTAuODYiIGZpbGw9IiNmZmYiIHN0cm9rZT0idXJsKCNyaW5nKSIgc3Ryb2tlLXdpZHRoPSI5Ii8+CiAgPGcgZmlsbD0idXJsKCNnbHlwaCkiPgogICAgPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNMTM2IDMwMGE4NiA4MiAwIDEgMCAxNzIgMGE4NiA4MiAwIDEgMC0xNzIgMFpNMTkwIDMwMGEzNiA0NiAwIDEgMCA3MiAwYTM2IDQ2IDAgMSAwLTcyIDBaIi8+CiAgICA8cGF0aCBkPSJNMjcwIDE0Nmw1Ni0yNHYxOTZjMCAyNiAxMiAzNiAzOCAzMmwxMCAzNGMtNTIgMTYtMTA0IDItMTA0LTU4WiIvPgogIDwvZz4KPC9zdmc+Cg=='}
};
/* domains registered under the SUBSCRIPTION (quota belongs to the plan, not to a font) */
const PLAN={web:{n:3,label:'וובסטופ',desc:'מינוי אתרים + דסקטופ'},extra:{n:0,label:'אקסטרה',desc:'מינוי אתרים + דסקטופ + אפליקציה'},desk:{n:0,label:'דסקטופ',desc:'מינוי דסקטופ'},acad:{n:0,label:'אקדמיק',desc:'מינוי לסטודנטים'}};
/* older months = history (closed & kept, scrollable back through the years) */
const OLDDOM=[['22.09.2026','סטודיו לוי','studio-levi.co.il','טאלנט'],['20.09.2026','חנות הבד','bad.co.il','אומץ'],['04.08.2026','קמפיין קיץ','summer-sale.co.il','דיסקברי'],['11.07.2026','גן ילדים שקד','shaked-kids.co.il','פריימריז, פורטו'],['02.05.2026','משרד עו״ד כהן','cohen-law.co.il','יזכור פרו'],['18.02.2026','מאפיית הכפר','hakfar.co.il','אומץ, טאלנט'],['09.12.2025','עמותת אור','or-org.org.il','פורטו'],['21.10.2025','סטודיו מור','mor-studio.co.il','דיסקברי, טאלנט'],['05.06.2025','כנס עיצוב 2025','design-conf.co.il','פריימריז'],['14.03.2025','קפה גינה','gina-cafe.co.il','אומץ'],['30.11.2024','חנות הספרים','books-il.co.il','יזכור פרו, פורטו'],['08.07.2024','מגזין אדריכלות','arch-mag.co.il','טאלנט']];
const SUBDOM={web:[['03.10.2026','סטודיו דיין','studio-dayan.co.il','פורטו, טאלנט'],['14.10.2026','מגזין עגלה','agala.co.il','דיסקברי, פורטו'],...OLDDOM.map(r=>r.slice())],extra:[['03.10.2026','סטודיו דיין','studio-dayan.co.il','פורטו, טאלנט'],['14.10.2026','מגזין עגלה','agala.co.il','דיסקברי, פורטו'],['12.10.2026','אדריכלות בע״מ','fontshok.co.il','פורטו'],...OLDDOM.map(r=>r.slice())]};
const MONTHS=['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
let BONUS=0;
/* registration cycle: domains registered in the current cycle (1.10–31.10.2026) can still be edited; older ones are locked */
const _n=new Date();const CYCLE={start:new Date(_n.getFullYear(),_n.getMonth(),1),end:new Date(_n.getFullYear(),_n.getMonth()+1,1),label:MONTHS[_n.getMonth()]};const NEXTM='ב־1 ב'+MONTHS[(_n.getMonth()+1)%12];
const parseD=s=>{const [d,m,y]=s.split('.').map(Number);return new Date(y,m-1,d)};
const canEdit=s=>{const d=parseD(s);return d>=CYCLE.start&&d<CYCLE.end};
/* row actions.
   Subscription domains: editable/removable only in the current cycle; after that the domain is closed and kept (lock, no remove).
   Purchased licences ("dom:" keys): always editable and removable. */
function rowActs(key,date,certSpec,delAttr){
 const open=key.startsWith('dom:')||canEdit(date);
 const cert=`<button class="ibtn" aria-label="תעודת רישיון" data-cert="${certSpec}">${ICON.cert}</button>`;
 if(!open)return `<div class="acts"><span class="ibtn locked" title="נרשם בחודש קודם: הדומיין סגור ונשמר, לא ניתן לערוך או להסיר" aria-label="נעול">${ICON.lock}</span>${cert}<span class="ibtn ph" aria-hidden="true"></span></div>`;
 const tip=key.startsWith('dom:')?'עריכת הדומיין':`אפשר לערוך עד סוף חודש ${CYCLE.label}`;
 return `<div class="acts"><button class="ibtn" aria-label="עריכת הדומיין" title="${tip}" data-edit="${key}">${ICON.edit}</button>${cert}<button class="ibtn" aria-label="הסרת הדומיין" ${delAttr}>${ICON.trash}</button></div>`;
}
const editHost=(name,host)=>`<input class="ed ed-host" dir="ltr" value="${host}" aria-label="כתובת האתר"><input class="ed ed-name" value="${name}" aria-label="שם האתר">`;
const editBtns=()=>`<div class="acts"><button class="ibtn ok-btn" data-edsave="1" aria-label="שמירה">${ICON.ok}</button><button class="ibtn" data-edcancel="1" aria-label="ביטול">${ICON.close}</button></div>`;
function fontPicker(sel){const on=sel.length>=2;return `<div class="fld fontpick ed-fonts"><button type="button" class="fp-btn" aria-haspopup="true" aria-expanded="false" aria-label="פונטים"><span class="fp-val">${sel.join(', ')||'בחירת פונטים'}</span>${ICON.chev}</button>
 <div class="fp-menu">${FAMILY.map(f=>{const c=sel.includes(f[0]);return `<label class="${!c&&on?'off':''}"><input type="checkbox" value="${f[0]}" ${c?'checked':''} ${!c&&on?'disabled':''}> ${f[0]}</label>`}).join('')}<p class="fp-hint ${on?'max':''}">אפשר לבחור עד 2 פונטים לכל אתר</p></div></div>`}
const logo=(k,cls='sublogo')=>`<img class="${cls}" src="${SUBS[k].logo}" alt="${SUBS[k].name}">`;
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('show'),1900)}
function meter(u,n){if(!n)return `<span class="chip">ללא הגבלה</span>`;const p=u/n;const c=p>=1?'bad':p>=.66?'warn':'';return `<span class="meter ${c}"><span class="num">${u}/${n}</span><span class="bar"><i style="width:${Math.max(p*100,8)}%"></i></span></span>`}
/* price with a thin ₪ sign (plans cards) */
const ilsT=n=>`<span class="cur">₪</span>${n.toLocaleString('he-IL',{maximumFractionDigits:2})}`;
const ils=n=>'₪'+n.toLocaleString('he-IL',{minimumFractionDigits:n%1?2:0,maximumFractionDigits:2});

/* sample data */
const FAMILY=[['פורטו',8],['טאלנט',6],['יזכור פרו',4],['אומץ',9],['פריימריז',5],['דיסקברי',6]];
/* quota: webstop = 3 domains per month (resets on the 1st); extra = unlimited (n:0) */
/* LICENSES = fonts bought one by one (not through a subscription). A web license covers up to 3 domains. */
const LIC=[
 {f:'פורטו',w:'משפחה',t:'וובפונט + דסקטופ',sub:'buy',n:3,web:1,sites:[['08.10.2026','אדריכלות בע״מ','arch-ltd.co.il']]},
 {f:'דיסקברי',w:'מדיום',t:'דסקטופ',sub:'desk',web:0},
 {f:'תניא',w:'בולד',t:'וובפונט',sub:'buy',n:3,web:1,sites:[['01.06.2026','בנק פועלים','bank.co.il'],['02.06.2026','אתר ב׳','b-site.co.il'],['05.06.2026','אתר ג׳','c-site.co.il']]},
 {f:'אומץ',w:'בולד',t:'דסקטופ',sub:'desk',web:0}
];
LIC.forEach(l=>{if(l.web)l.u=l.sites.length});
const HISTORY=[{f:'דיסקברי',w:'לייט',sub:'web',site:['04.08.2026','קמפיין קיץ','summer-sale.co.il'],removed:'30.09.2026'}];
const CERT_TEXT={
 extra:l=>`רישיון זה מכסה את הדומיין הרשום במסגרת מינוי אקסטרה, הכולל רישום דומיינים ללא הגבלה, אתרים, אפליקציות ודסקטופ. הרישיון בתוקף כל עוד המינוי פעיל.`,
 web:l=>`רישיון זה מכסה את הדומיין הרשום בלבד, במסגרת מכסת ${l.n} דומיינים חודשיים במינוי וובסטופ. השימוש מותר לעיצוב ממשק משתמש (UI) ולהטמעה באתר שכתובתו מצוינת לעיל, כל עוד המינוי פעיל.`,
 desk:l=>`רישיון דסקטופ לפונט הרשום: התקנה במחשבי בעל הרישיון ועיצוב תוצרי דסקטופ, פלט ו־UI. הרישיון אינו כולל הטמעה באתרים או באפליקציות.`,
 acad:l=>`רישיון אקדמיק לשימוש במסגרת הלימודים ותיק העבודות של בעל הרישיון, בהתאם לתנאי המינוי לסטודנטים.`,
 buy:l=>`רישיון וובפונט לפונט שנרכש, למכסה של עד ${l.n||3} דומיינים. השימוש מותר לעיצוב ממשק משתמש (UI) ולהטמעה באתר שכתובתו מצוינת לעיל. הרישיון לצמיתות.`,
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
FAMILY.length=0;(FS.fonts||[]).forEach(f=>FAMILY.push([f.name,0,f.web,f.desk]));
LIC.length=0;(FS.lic||[]).forEach(l=>{l.sites=l.sites||[];l.u=l.sites.length;LIC.push(l)});
ORDERS.length=0;(FS.orders||[]).forEach(o=>ORDERS.push(o));
Object.keys(SUBDOM).forEach(k=>SUBDOM[k]=[]);HISTORY.length=0;
const soon=()=>toast('הפעולה הזו תחובר בשלב הבא');
/* views */
const V={};
V.subs=(tab)=>`
 <div class="plan">
   ${logo(state.plan,'')}
   <div>
     <div class="name">${PLAN[state.plan].label} <span class="chip ok">פעיל</span></div>
     <div style="font-size:14px">${PLAN[state.plan].desc}</div>
   </div>
   <div class="dates">
     <div><b>תחילת המינוי</b><span class="num">${ea(FS.planStart||"—")}</span></div>
     <div><b>תשלום הבא</b><span class="num">${ea(FS.nextPay||"—")}</span></div>
     <div><b>אמצעי תשלום</b><span class="num">${ea(FS.card||"—")}</span></div>
   </div>
 </div>
 <div class="tabs" role="tablist">
   <button role="tab" aria-selected="${tab==='dl'}" data-subtab="dl">פונטים להורדה</button>
   <button role="tab" aria-selected="${tab==='reg'}" data-subtab="reg">רישום דומיינים</button>
 </div>
 ${tab==='dl'?subsDownloads()+fontNote():subsDomains()}`;

const _subs=V.subs;V.subs=tab=>FS.plan?_subs(tab):`<div class="head-row"><div><h1 class="h1">המינוי שלי</h1><p class="sub">אין לך כרגע מינוי פעיל.</p></div></div><button class="btn btn-grad" data-go="plans">לתוכניות המינוי</button>`;
/* font-update note: sits under the download table ("כל הפונטים לאתרים / לדסקטופ") */
const fontNote=()=>state.noteHidden?'':`<div class="note x-new" data-new="חדש: עדכון פונט">
   <span class="note-ic">${ICON.spark}</span>
   <span class="note-txt"><b>דיסקברי 2.0</b> זמינה להורדה · 3 משקלים חדשים וניקוד מלא</span>
   <button class="linkbtn" data-t="מוריד את דיסקברי 2.0">להורדה</button>
   <button class="ibtn note-x" data-hidenote="1" aria-label="הסתרת ההודעה">${ICON.close}</button>
 </div>`;

function subsDomains(){
 const p=PLAN[state.plan],list=SUBDOM[state.plan],lim=p.n?p.n+BONUS:0,used=list.filter(s=>canEdit(s[0])).length,full=lim&&used>=lim;
 const demo=``;const _demoOff=`<div class="demo x-new" data-new="לתצוגה בלבד"><span>תצוגה לפי מינוי:</span>${['web','extra'].map(k=>`<button class="${state.plan===k?'on':''}" data-plan="${k}">${PLAN[k].label}</button>`).join('')}</div>`;
 return `${demo}
 <div class="dom-head">
   <div><b style="font-size:17px">דומיינים במינוי ${p.label}</b>
   <div class="hint" style="margin:2px 0 0">${lim?`ניתן לרשום ${p.n} דומיינים בכל חודש${BONUS?` + ${BONUS} נוספים שנרכשו`:''}. המכסה מתחדשת ${NEXTM}.`:'רישום דומיינים ללא הגבלה, כל עוד המינוי פעיל.'}</div></div>
   ${lim?`<div class="usage"><span class="num"><b>${used}</b> מתוך ${lim} החודש</span><span class="track"><i style="width:${Math.min(100,used/lim*100)}%;background:${full?'var(--bad)':used/lim>=.66?'var(--warn)':'var(--ok)'}"></i></span></div>`:'<span class="chip">ללא הגבלה</span>'}
 </div>
 <div class="box dom-box" style="background:var(--bg);border-radius:10px;padding:22px 24px">
   ${full?quotaFullPlan():`<form class="form-row" data-subadd="1" novalidate>
     <div class="fld"><label for="sd2">כתובת האתר *</label><input id="sd2" placeholder="fontshok.co.il" dir="ltr" inputmode="url" autocomplete="off" required></div>
     <div class="fld"><label for="sd1">שם האתר <span style="color:var(--muted)">(רשות)</span></label><input id="sd1" placeholder="יתמלא אוטומטית מהכתובת"></div>
     <div class="fld fontpick"><label id="fpl">פונטים <span style="color:var(--muted)">(עד 2)</span></label>
       <button type="button" class="fp-btn" aria-haspopup="true" aria-expanded="false" aria-labelledby="fpl"><span class="fp-val">בחירת פונטים</span>${ICON.chev}</button>
       <div class="fp-menu">${FAMILY.map(f=>`<label><input type="checkbox" value="${f[0]}"> ${f[0]}</label>`).join('')}<p class="fp-hint">אפשר לבחור עד 2 פונטים לכל אתר</p></div>
     </div>
     <button class="btn btn-grad" style="height:40px">רישום דומיין</button>
   </form><p class="form-err" id="sdErr" hidden></p>`}
 </div>
 <table class="mini lined"><thead><tr><th>תאריך</th><th>שם האתר</th><th>כתובת אתר</th><th>פונטים</th><th></th></tr></thead><tbody>
 ${list.map((s,j)=>!canEdit(s[0])?'':state.editKey===`sd:${j}`
   ?`<tr class="editing" data-key="sd:${j}"><td class="num">${s[0]}</td><td colspan="2"><div class="ed-pair">${editHost(s[1],s[2])}</div></td><td>${fontPicker(s[3].split(', ').filter(Boolean))}</td><td>${editBtns()}</td></tr>`
   :`<tr><td class="num">${s[0]}</td><td>${s[1]}</td><td><bdi dir="ltr">${s[2]}</bdi></td><td>${s[3]}</td>
 <td>${rowActs(`sd:${j}`,s[0],`sd:${j}`,`data-sddel="${j}"`)}</td></tr>`).join('')||`<tr><td colspan="5" class="hint" style="padding:18px 0">עוד לא נרשמו דומיינים החודש</td></tr>`}
 </tbody></table>
 <p class="hint lock-note">${ICON.lock} אפשר לערוך או להסיר עד סוף ${CYCLE.label}. אחרי זה הדומיינים נסגרים ועוברים <button class="linkbtn" data-go="dom">להיסטוריית הדומיינים</button></p>`;
}
function quotaFullPlan(){
 return `<div class="quota-line">
  <div class="msg"><b>ניצלת את ${PLAN[state.plan].n+BONUS} הדומיינים של החודש</b><span>המכסה מתחדשת ${NEXTM}. צריך עוד עכשיו?</span></div>
  <button class="btn btn-grad" data-planaddon="1">דומיין נוסף · ₪79</button>
  <button class="linkbtn" data-go="plans">או שדרוג לאקסטרה</button>
 </div>`;
}

function subsDownloads(){
 const dl=(u,f,k)=>u?`<a class="dl" href="${ea(u)}" aria-label="הורדת ${ea(f)} ${k}" download>${ICON.dl}</a>`:'<span class="hint" style="margin:0">—</span>';
 if(!FAMILY.length)return `<p class="empty">אין כרגע פונטים להורדה במינוי.</p>`;
 return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>שם הפונט</th><th>פורמט לאתרים</th><th>פורמט לדסקטופ</th></tr></thead><tbody>
 ${FAMILY.map(([f,n,w,d])=>`<tr><td>${ea(f)}</td><td>${dl(w,f,'לאתרים')}</td><td>${dl(d,f,'לדסקטופ')}</td></tr>`).join('')}
 </tbody></table></div>`;
}
/* פונטים שרכשתי: one list, one row per purchased license. Download + certificate on every row;
   web licenses also show their own domain counter and open a drawer to register. No tabs. */
V.lic=(tab,open)=>`
 <div class="head-row"><div><h1 class="h1">פונטים שרכשתי</h1><p class="sub">פונטים שקנית בנפרד, מחוץ למינוי. רישיון וובפונט מכסה עד 3 אתרים.</p></div></div>
 ${LIC.length?licTable(open):`<p class="empty">עוד לא רכשת פונטים בנפרד.</p>`}`;

function licTable(open){
 return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>שם הפונט</th><th>משקל</th><th>סוג רישיון</th><th>אתרים</th><th></th></tr></thead><tbody>
 ${LIC.map((l,i)=>{const full=l.web&&l.u>=l.n;const isOpen=open===i;return `<tr class="${isOpen?'is-open':''}">
 <td><span class="fname">${l.web?`<button class="ibtn exp" data-open="${i}" aria-expanded="${isOpen}" aria-label="${isOpen?'סגירת':'פתיחת'} רישום האתרים של ${l.f}" title="${isOpen?'סגירה':'רישום אתרים'}">${ICON.globe}</button>`:'<span class="exp-ph"></span>'}${l.f}</span></td>
 <td>${l.w}</td><td>${l.t.split(' + ').map(x=>`<span class="ltag">${x}</span>`).join(' ')}</td>
 <td>${l.web?`<div class="sites"><span class="sites-lbl">אתרים בשימוש</span>${meter(l.u,l.n)}</div>`:'<span class="hint" style="margin:0">לא כולל אתרים</span>'}</td>
 <td><div class="acts">
   <button class="ibtn" aria-label="תעודת רישיון" data-cert="lic:${i}">${ICON.cert}</button>
   ${l.dl?`<a class="btn btn-grad icon-only" href="${ea(l.dl)}" aria-label="הורדת ${ea(l.f)}" title="הורדה">${ICON.dl}</a>`:""}</div></td></tr>
 ${open===i&&l.web?`<tr class="drawer"><td colspan="5"><div class="lic-drawer"><div class="box dom-box">
   ${full?quotaFull(l):`
   <form class="form-row lic-form" data-add="${i}">
     <div class="fld"><label for="su${i}">כתובת האתר *</label><input id="su${i}" data-namefor="sn${i}" placeholder="fontshok.co.il" dir="ltr" inputmode="url" autocomplete="off" required></div>
     <div class="fld"><label for="sn${i}">שם האתר <span style="color:var(--muted)">(רשות)</span></label><input id="sn${i}" class="sitename" placeholder="יתמלא אוטומטית מהכתובת"></div>
     <button class="btn btn-grad" style="height:40px">רישום אתר</button>
   </form>`}
   </div>
   <table class="mini lined"><thead><tr><th>תאריך</th><th>שם האתר</th><th>כתובת אתר</th><th></th></tr></thead><tbody>
   ${l.sites.map((s,j)=>state.editKey===`dom:${i}:${j}`
     ?`<tr class="editing" data-key="dom:${i}:${j}"><td class="num">${s[0]}</td><td colspan="2"><div class="ed-pair">${editHost(s[1],s[2])}</div></td><td>${editBtns()}</td></tr>`
     :`<tr><td class="num">${s[0]}</td><td>${s[1]}</td><td><bdi dir="ltr">${s[2]}</bdi></td>
   <td>${rowActs(`dom:${i}:${j}`,s[0],`dom:${i}:${j}`,`data-del="${i}:${j}"`)}</td></tr>`).join('')}
   </tbody></table></div></td></tr>`:''}`}).join('')}
 </tbody></table></div>`;
}
function quotaFull(l){
 return `<div class="quota-line">
  <div class="msg"><b>כל ${l.n} האתרים של הרישיון רשומים</b><span>צריך עוד אתר? אפשר להוסיף אחד בתשלום חד־פעמי.</span></div>
  <button class="btn btn-grad" data-addon="${LIC.indexOf(l)}">הוספת אתר · ₪79</button>
  <button class="linkbtn" data-go="plans">או מינוי וובסטופ</button>
 </div>`;
}

/* דומיינים: read-only overview of every site, whatever it came through. Registering happens in "המינוי שלי" or "פונטים שרכשתי". */
V.dom=()=>{
 const p=PLAN[state.plan];
 const fromSub=SUBDOM[state.plan].map((s,j)=>({s,src:`<span class="src sub">${logo(state.plan)}מינוי ${p.label}</span>`,font:s[3],cert:`sd:${j}`,del:`data-sddel="${j}"`}));
 const fromLic=LIC.map((l,i)=>l.web?l.sites.map((s,j)=>({s,src:`<span class="src buy">רכישה</span>`,font:`${l.f} ${l.w}`,cert:`dom:${i}:${j}`,del:`data-del="${i}:${j}"`})):[]).flat();
 const all=[...fromSub,...fromLic].sort((a,b)=>parseD(b.s[0])-parseD(a.s[0]));
 const now=all.filter(r=>canEdit(r.s[0])),past=all.filter(r=>!canEdit(r.s[0]));
 const row=r=>state.editKey===r.cert
   ?`<tr class="editing" data-key="${r.cert}"><td><div class="ed-pair stacked">${editHost(r.s[1],r.s[2])}</div></td><td>${r.cert.startsWith('sd:')?fontPicker(r.font.split(', ').filter(Boolean)):r.font}</td><td>${r.src}</td><td class="num">${r.s[0]}</td><td>${editBtns()}</td></tr>`
   :`<tr><td><bdi dir="ltr">${r.s[2]}</bdi><span class="sm">${r.s[1]}</span></td><td>${r.font}</td><td>${r.src}</td><td class="num">${r.s[0]}</td>
 <td>${rowActs(r.cert,r.s[0],r.cert,r.del)}</td></tr>`;
 /* history grouped by month, newest first */
 let last='';const hist=past.map(r=>{const d=parseD(r.s[0]),k=`${MONTHS[d.getMonth()]} ${d.getFullYear()}`;const h=k!==last?`<tr class="mgroup"><td colspan="5">${k}</td></tr>`:'';last=k;return h+row(r)}).join('');
 const thead=`<thead><tr><th>דומיין</th><th>פונטים</th><th>דרך</th><th>תאריך רישום</th><th></th></tr></thead>`;
 return `
 <div class="head-row"><div><h1 class="h1">דומיינים</h1><p class="sub">כל האתרים שלך במקום אחד. רישום אתר חדש נעשה במינוי או בפונט שרכשת.</p></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-grad" data-go2="subs">רישום אתר במינוי</button></div></div>
 <h2 class="h2-sec">החודש · ${CYCLE.label} ${_n.getFullYear()}</h2>
 <div class="tbl-wrap"><table class="tbl">${thead}<tbody>
 ${now.map(row).join('')||`<tr><td colspan="5" class="hint">עוד לא נרשמו דומיינים החודש</td></tr>`}
 </tbody></table></div>
 <p class="hint lock-note">${ICON.lock} אפשר לערוך או להסיר עד סוף ${CYCLE.label}. דומיין שהוסר או שונה לא נשמר בהיסטוריה.</p>
 <button class="hist-toggle" data-hist="1" aria-expanded="${!!state.histOpen}" aria-controls="histBody">${ICON.chev}<span class="h2-sec" style="margin:0">היסטוריית דומיינים <span class="hint" style="margin:0;font-weight:400">${past.length} דומיינים</span></span></button>
 <div class="hist-body ${state.histOpen?'open':''}" id="histBody"><div><div class="tbl-wrap hist-scroll"><table class="tbl">${thead}<tbody>${hist}</tbody></table></div></div></div>`;
};

V.orders=(open)=>`
 <div class="head-row"><div><h1 class="h1">הזמנות</h1><p class="sub">כאן מופיעות ההזמנות (רכישות) שביצעת</p></div>
  <div class="fld"><input placeholder="חיפוש לפי מספר הזמנה" style="background:var(--soft);width:220px;max-width:100%" aria-label="חיפוש הזמנה" id="oq" inputmode="numeric"></div></div>
 <div class="tbl-wrap"><table class="tbl otbl"><thead><tr><th>מספר הזמנה</th><th>תאריך</th><th>פירוט</th><th>סטטוס</th><th>סה״כ</th><th></th></tr></thead><tbody id="otb">${ORDERS.length?"":`<tr><td colspan="6" class="empty">עוד אין הזמנות.</td></tr>`}
 ${ORDERS.map((o,i)=>{const sum=o.total!=null?o.total:o.items.reduce((a,b)=>a+b[1],0);const tot=sum;const paid=!!o.inv;return `<tr data-oid="${o.id}" class="orow"><td class="num"><span class="oid">${paid?`<button class="ibtn eye${open===i?' on':''}" aria-label="פירוט החשבונית" data-oopen="${i}" aria-expanded="${open===i}">${ICON.eye}</button>`:'<span class="eye-ph"></span>'}#${o.id}</span></td><td class="num">${o.d.slice(0,6)+o.d.slice(8)}</td><td class="odet" title="${o.items.map(x=>x[0]).join(' + ')}"><span>${o.items[0][0]}</span>${o.items.length>1?`<span class="more">+${o.items.length-1}</span>`:''}</td>
 <td><span class="chip ${o.st==='הושלם'?'ok':o.st==='בוטל'?'bad':'wait'}">${o.st}</span></td><td class="num">${ils(tot)}</td>
 <td><div class="acts">${o.pay?`<a class="btn btn-grad" href="${ea(o.pay)}">לתשלום</a>`:o.inv?`<a class="ibtn" href="${ea(o.inv)}" target="_blank" rel="noopener" aria-label="הורדת חשבונית">${ICON.doc}</a>`:`<a class="ibtn" href="${ea(o.view)}" aria-label="פרטי ההזמנה">${ICON.eye}</a>`}</div></td></tr>
 ${open===i?`<tr class="drawer"><td colspan="6"><div class="box">
   <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px"><b>${o.invNum?"חשבונית מס/קבלה "+ea(o.invNum):"הזמנה #"+o.id}</b><span class="chip ok">שולם</span></div>
   <table class="mini"><tbody>${o.items.map(it=>`<tr><td>${it[0]}</td><td class="num" style="text-align:left">${ils(it[1])}</td></tr>`).join('')}
   <tr><td style="color:var(--muted)">לפני מע״מ</td><td class="num" style="text-align:left">${ils(+(sum/1.18).toFixed(2))}</td></tr>
   <tr><td style="color:var(--muted)">מע״מ 18%</td><td class="num" style="text-align:left">${ils(+(sum-sum/1.18).toFixed(2))}</td></tr>
   <tr><td><b>סה״כ</b></td><td class="num" style="text-align:left"><b>${ils(sum)}</b></td></tr></tbody></table>
   <div style="display:flex;justify-content:flex-end;margin-top:12px"><a class="btn btn-grad" href="${ea(o.inv)}" target="_blank" rel="noopener">${ICON.dl} הורדת חשבונית</a></div>
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

/* plans — based on the live pricing page; desktop replaces academic */
/* prices = WooCommerce store on fontshok.co.il (incl. VAT). Desktop has no subscription product: per-font desktop license from ₪354 */
const PK=[
 {k:'desk',name:'דסקטופ',tag:'כלים לעבודה מקצועית',was:249,now:179,unit:'לפונט',what:'רישיון דסקטופ לפונט נבחר',det:'אדובי, אופיס, פיגמה / תשלום חד־פעמי',cta:'בחירת פונט לדסקטופ ←'},
 {k:'web',name:'וובסטופ',tag:'להיות מקצוענים גם בדיגיטל',was:378,now:319,unit:'לחודש',what:'תכנית מורחבת לאתרים ולדסקטופ',det:'כל הפונטים והפורמטים, 3 דומיינים בחודש / תשלום חודשי',cta:'אני רוצה להצטרף ←',rec:1},
 {k:'extra',name:'אקסטרה',tag:'פתרון מלא לעבודה מקצועית',was:802,now:700,unit:'לחודש',what:'תכנית חופשית ללא הגבלה',det:'אתרים, אפליקציות ודסקטופ / תשלום חודשי',cta:'גישה בלתי מוגבלת ←',cur:1}
];
const CMP=[
 ['grp','עיצוב גרפי, סושיאל ווידאו'],
 ['עיצוב תוצרי דסקטופ','אדובי, אופיס, פיגמה',1,1,1],
 ['עיצוב תוצרי פלט','מצגות, פוסטים, עיצובים לדיגיטל',1,1,1],
 ['עיצוב תוצרי תשדיר','וידאו, כתוביות, שידור טלוויזיוני',0,1,1],
 ['grp','תנועה וחוויית משתמש'],
 ['עיצוב תוצרי תנועה','סרטונים, אנימציות, לוגו חי',0,1,1],
 ['עיצוב תוצרי UI/UX','פיגמה (Figma), אקס־די (Xd) לתכנון ממשק',1,1,1],
 ['grp','מערכות ומוצרים דיגיטליים'],
 ['עיצוב תוצרי אינטרנט','הגבלת דומיינים וכניסות חודשיות',0,'שלושה דומיינים בחודש','דומיינים ללא הגבלה'],
 ['עיצוב תוצרי אפליקציה','הגבלת אפליקציות, הורדות, משתמשים',0,0,'אפליקציות ללא הגבלה']
];
const SYM={extra:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgZGF0YS1uYW1lPSJMYXllciAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzNzIuMTEgMjYyLjEiPgogIDxwYXRoIGQ9Ik0yNDcuMDcsMjExLjU0bC0uMDcsMS4wOGMtMTcuOCwxNi4zOC0zNS44OSwyOC41LTU0LjI5LDM2LjM2LTIwLjQ3LDguNzQtMzcuMDEsMTMuMTItNjIsMTMuMTItMzQuMDYsMC02Ni40Ni0xNC4xMy05MC4xMS0zNi42NEMxMy4xOSwxOTkuMzYuODQsMTY2LjQ5LjAyLDEyMS4xMi0uNjYsODMuMjIsMTQuOTEsNTMuMiwzOS40LDMwLjk0LDU5Ljg4LDEyLjMzLDgzLjksMi4xMiwxMTEuNDkuMzFjMzAuMzgtMi4wMSw1Ni44LDUuNzcsNzkuMjYsMjMuMzIsMTguNDUsMTQuNDEsMzEuODMsMzMuMDIsNDAuMTgsNTUuOGwtMS4yMSwxLjY0TDQ5Ljc2LDE4Mi4xMWwtMTUuNS0zNy4wNSwxMzUuNzktNzYuNThjLTQuMjctOC41LTEwLjk5LTE1LjI4LTIwLjE2LTIwLjM1LTEwLjEyLTUuNTktMjEuNDYtNy45Ni0zNC4wNC03LjEzLTE3LjAzLDEuMTQtMzIsNy41NS00NC45MSwxOS4yNS0xNS4zOCwxMy45My0yMy4yMywzMi4zMS0yMy41Niw1NS4xMi0uMzcsMjYuNDYsNS42MSw0OC44NywxNy45Myw2Ny4yMSwxNC40OSwyMS41NSwzOC41MSwzMy41OCw2NS45NCwzNC41OSwxNi42My42MiwyOS43NS0zLjUsNDUuNDYtMTAuODUsMTEuOTMtNS41OCwyNS43OS0xNC43MSw0MS41OC0yNy40MWgxLjA5bDI3LjY4LDMyLjYyWiIvPgogIDxwYXRoIGQ9Ik0zNzIuMTEsMjU5LjM4bC0uMTUsMi4xOGgtNjMuMDdsLTEyMS4wOC0xMzguOTcuMTYtMi4zMywzOS44Mi0yMS42NCwzNS44MiwzOS45YzI2LjEyLTI4LjQ2LDQ4Ljk4LTYwLjkzLDY0LjMyLTg5LjMxbDQyLjIzLDEwLjk3LjQsMi4xN3MtMjguNTcsNDguNzktNTguNDEsODQuMTNjLTUuMzEsNi4yOS0xMy4wMSwxNC44Ni0yMC42NiwyMy4wOWw4MC42Miw4OS44MVoiLz4KPC9zdmc+',web:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgZGF0YS1uYW1lPSJMYXllciAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMzYuMTIgMjY4LjgiPgogIDxkZWZzPgogICAgPHN0eWxlPgogICAgICAuY2xzLTEgewogICAgICAgIGZpbGw6ICMwMTAxMDE7CiAgICAgIH0KICAgIDwvc3R5bGU+CiAgPC9kZWZzPgogIDxwYXRoIGNsYXNzPSJjbHMtMSIgZD0iTTMzNi4xMiwxMjMuOTRsLTE3LjY2LDM2LjMyLTEuMDIuNTEtMjUuMDktMjMuNTUtLjUxLjUxYy0uMDMsNi43NS0uNzUsMTIuMTktMS4yNiwxNi0xMi43MSw5NC4xMS01OC40LDExNS4wNy0xMDIuMTcsMTE1LjA3LTIwLjQ4LDAtMzQuODEtMTIuMjktNDcuNjEtNDMuNTJoLS41MmMtMTguNDMsMzEuMjMtNDEuNDcsNDMuMDEtNjguNiw0My4wMS00Ni42LDAtNTMuNzYtNDAuMzctNTMuNzYtNjkuMDQsMC00My4wOCw3LjM4LTc0Ljc2LDI1LjE0LTE0My4wOSwwLTYuNjYtMy4wNy0xMC43NS05LjczLTEwLjc1LTYuMTQsMC0xMy4zMSwzLjA3LTE4LjQzLDYuMTRsLTIuNTYtMS41NEwwLDEzLjMxbDEuNTMtMi41NkMxNy40LDUuMTIsMzMuMjgsMCw1MC42OCwwYzE4Ljk1LDAsMzkuNDMsOC4xOSwzOS40MywzNi44NywwLDIzLjA0LTI0LjMsODkuNjMtMjQuNDIsMTQ2LjE3LS4wNSwyNS42LDEzLDM2LjUzLDMwLjA1LDMzLjAzLDM3LjM4LTcuNjgsNDEuNDctNjYuNjQsNDEuNjItOTQuOC4xLTE5LjExLS4wNy0yNy40Ny0uNjYtMzEuNzRsMS41NC0xLjU0LDQ1LjA1LTQuMDIsMS41NCwyLjA1Yy41MSw1LjEyLDEuMDIsMTIuMjksMS4wMiwyMC40OCwwLDQyLjQ5LTQuNjEsNjcuMDctNC42MSw4Ny4wNCwwLDE0Ljg1LDYuMjUsMjQuMiwyNC4wNywyMi41MywzMC44Mi0yLjksNDUuNzItNjEuMDMsNDMuMTYtMTQyLjQ3LDAtMjIuNDQtMi43OC01OC40LTMuNzQtNjcuMDRsMi41Ni0yLjA1TDI5MS4zMi40N2wyLjU2LDMuMDdjNC4xLDY3LjU4LDE1LjEsOTUuODMsNDEuNzMsMTE4LjM1bC41MSwyLjA1WiIvPgo8L3N2Zz4=',desk:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjEzMiAxMTggMjQ2IDI3MCI+CiAgPGcgZmlsbD0iIzAxMDEwMSI+CiAgICA8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xMzYgMzAwYTg2IDgyIDAgMSAwIDE3MiAwYTg2IDgyIDAgMSAwLTE3MiAwWk0xOTAgMzAwYTM2IDQ2IDAgMSAwIDcyIDBhMzYgNDYgMCAxIDAtNzIgMFoiLz4KICAgIDxwYXRoIGQ9Ik0yNzAgMTQ2bDU2LTI0djE5NmMwIDI2IDEyIDM2IDM4IDMybDEwIDM0Yy01MiAxNi0xMDQgMi0xMDQtNThaIi8+CiAgPC9nPgo8L3N2Zz4=',acad:'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyBpZD0iTGF5ZXJfMSIgZGF0YS1uYW1lPSJMYXllciAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyODQuMjMgMjY1LjcxIj4KICA8ZGVmcz4KICAgIDxzdHlsZT4KICAgICAgLmNscy0xIHsKICAgICAgICBmaWxsOiAjMDEwMTAxOwogICAgICB9CiAgICA8L3N0eWxlPgogIDwvZGVmcz4KICA8cGF0aCBjbGFzcz0iY2xzLTEiIGQ9Ik0yODQuMjMsMTI3Ljk4YzAsMTExLjExLTcyLjcsMTM3LjczLTEyMy45LDEzNy43My0yMi42MSwwLTQ3LjY3LTUuNDItNjguNDMtMjAuNjItLjY4LS41LTEuNjItLjQzLTIuMjIuMTYtNy42Myw3LjU1LTE0Ljg0LDEzLjgtMjIuMDQsMTkuNTctLjMuMjQtLjY4LjM4LTEuMDcuMzhIMS43MWMtLjk0LDAtMS43MS0uNzYtMS43MS0xLjcxaDBjMC0uNTQuMjYtMS4wNC42OC0xLjM3LDY5LjIxLTUxLjk5LDEwOS4yMy05NS4xNSwxMDkuMjMtMTM2Ljk5LDAtMjQuMDUtMTEuNjItMzQuMDgtMjUuNDQtMzQuMDgtMjEuMzEsMC0yOS4zNCwxNS4xMi0yOS4zNCwzMi4zMiwwLDE0LjQxLDUuODgsMjkuNTIsMjEuMjksNDkuMjEuMjMuMy4zNy42Ny4zNywxLjA1di44M2MwLC40MS0uMTUuOC0uNDEsMS4xMWwtMjMuNiwyNy40MmMtLjI3LjMxLS42NC41MS0xLjA0LjU3bC0uODIuMTJjLS41MS4wOC0xLjA0LS4wOC0xLjQyLS40My0yMS4wMS0xOS4zMS0zNi45My00NC40NS0zNi45My03OC45LDAtNDguNzksMzYuMS03My4yNyw3MS45MS03My4yNyw0OS42NiwwLDczLjE0LDMwLjc4LDczLjE0LDc2LjAzLDAsMjguMTYtMTcuMTIsNTcuNjQtMzYuNjUsODEuNDgtLjYxLjc0LS40OCwxLjgzLjI3LDIuNDMsMTAuMDUsNy45NCwyNy45NiwxMS42Nyw0Mi4xNiwxMS42Nyw1Ny4zNCwwLDcxLjE3LTU0Ljc4LDcxLjE3LTk0LjcyLDAtNTcuOC0zMi4zNS04MS4xLTY4Ljk0LTg0LjUzLTQuOTgtLjQ3LTkuOTktLjQ1LTE0Ljk4LS4xMmwtOS4wNC42MWMtLjQ5LjAzLS45Ny0uMTUtMS4zMi0uNWwtMS0xYy0uMzItLjMyLS41LS43NS0uNS0xLjIxVjMuNzRjMC0uNDUuMTgtLjg5LjUtMS4yMWwxLjExLTEuMTFjLjI5LS4yOS42Ni0uNDYsMS4wNi0uNDlsMi44MS0uMjRjNy4wOC0uNiwyMi43OS0xLjAzLDI5Ljg1LS4zMiw4NC4zNyw4LjQzLDExMC4xMSw3OS41LDExMC4xMSwxMjcuNjFaIi8+Cjwvc3ZnPg=='};
/* comparison marks, as on the live site: lilac tick, grey cross, lilac text pill */
const cell=v=>v===1?`<span class="yes" aria-label="כלול"><svg viewBox="0 0 24 24"><path d="M7.5 12.5l3 3 6-6.5"/></svg></span>`:v===0?`<span class="no" aria-label="לא כלול"><svg viewBox="0 0 24 24"><path d="M8.5 8.5l7 7m0-7l-7 7"/></svg></span>`:`<span class="cpill">${v}</span>`;
V.plans=()=>`
 <div class="head-row"><div><h1 class="h1">תוכניות המינוי שלנו</h1><p class="sub">כל המחירים כוללים מע״מ. אפשר לעבור בין מסלולים בכל עת, ומה ששילמת מקוזז.</p></div></div>
 <div class="pkgs">
 ${PK.map(p=>`<article class="pk pk-${p.k} ${p.rec?'rec':''} ${p.cur?'cur':''}">
  ${p.rec?'<div class="flag">תוכנית מומלצת</div>':''}
  <div class="pk-in">
   <div class="pk-top"><div><h3>${p.name}</h3><div class="tag">${p.tag}</div></div><img class="pk-sym" src="${SYM[p.k]}" alt="${p.name}"></div>
   <div class="price">
     <div style="display:flex;align-items:center;gap:8px;min-height:22px">${p.was?`<span class="was num">${ilsT(p.was)}</span><span class="save">חיסכון ${Math.round((1-p.now/p.was)*100)}%</span>`:p.from?'<span style="font-size:13px;color:var(--muted)">החל מ־</span>':''}</div>
     <div class="now"><b class="num">${ilsT(p.now)}</b><small style="white-space:nowrap">${p.unit} · כולל מע״מ</small></div>
     <div class="what">${p.what}<span>${p.det}</span></div>
     <a class="btn cta" href="${ea((FS.links||{})[p.k]||"#")}">${p.cta}</a>
     <a class="more" href="#cmp">פרטים אודות המנוי <svg class="fs-arrow" viewBox="0 0 26 10" aria-hidden="true"><path d="M25 5H1.5M5.5 1L1.5 5l4 4"/></svg></a>
   </div>
  </div></article>`).join('')}
 </div>
 <p class="hint" style="text-align:center;margin-top:14px">המחירים כוללים מע״מ, כפי שהם מופיעים בחנות באתר.</p>
 <section class="cmp" id="cmp"><h2>השוואת המינויים שלנו</h2><div class="tbl-wrap cmp-in"><i class="web-col" aria-hidden="true"></i><table>
  <thead><tr><th></th>${PK.map(p=>`<th class="${p.rec?'col-web':''}">${p.name} <img class="cmp-sym" src="${SYM[p.k]}" alt=""></th>`).join('')}</tr></thead>
  <tbody>${CMP.map(r=>r[0]==='grp'?`<tr class="grp"><td>${r[1]}</td><td></td><td class="col-web"></td><td></td></tr>`:`<tr><td><b>${r[0]}</b> - ${r[1]}</td>${[2,3,4].map(i=>`<td class="${i===3?'col-web':''}">${cell(r[i])}</td>`).join('')}</tr>`).join('')}<tr class="cmp-end"><td></td><td></td><td class="col-web"></td><td></td></tr></tbody>
 </table></div></section>`;

/* certificate — same layout as the current PDF, plus the subscription logo */
function cert(l,site){
 const s=SUBS[l.sub];
 return `<div class="cert">
  <div class="cert-head"><h2>${site?'רישיון פונט לדומיין':'רישיון שימוש בפונט'}</h2><img src="${s.logo}" alt="מינוי ${s.name}"></div>
  <div class="cert-body">
   <div class="cert-row"><div class="who"><span style="color:var(--muted)">רושם הרישיון</span><b>${ea((FS.user.first||"")+" "+(FS.user.last||""))}</b>${ea(FS.user.email)}</div><div style="text-align:left">מונפק על ידי פונטשוק בע״מ<br><span class="num" style="color:var(--bad)">תצוגה מקדימה · לא בתוקף</span></div></div>
   <p style="margin:0">בהתאם להסכם הרישוי ותנאי השימוש של פונטשוק בע״מ, מאושר בזאת כי הפונט הרשום להלן מותר לשימוש ${site?'בתחומי עיצוב ממשק והטמעה באתר הרשום בלבד, תחת הדומיין שלהלן:':`בתחומים הכלולים ברישיון ${l.t}:`}</p>
   <dl>${site?`<dt>שם האתר:</dt><dd>${site[1]}</dd><dt>כתובת הדומיין:</dt><dd><bdi dir="ltr">${site[2]}</bdi></dd>`:''}<dt>רישיון לפונט:</dt><dd>${l.f} ${l.w}</dd><dt>תאריך רישום:</dt><dd class="num">${site?site[0]:'26.01.2023'}</dd><dt>מינוי:</dt><dd>${s.name} (${s.en})</dd><dt>סוג רישיון:</dt><dd>${l.t}</dd></dl>
   <p style="margin:0">${CERT_TEXT[l.sub](l)}</p>
   ${l.removed?`<p style="margin:0;color:var(--bad)">הדומיין הוסר מהחשבון ב־${l.removed}. הרישיון היה בתוקף בתקופה ${site[0]}–${l.removed}.</p>`:''}
   <div class="cert-foot"><div>בברכה,<br>צוות פונטשוק<br>support@fontshok.co.il</div><img class="seal" src="data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMzUuNjYgMzM1LjY2Ij4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iZnNQdXJwbGUiIHgxPSI2MCIgeTE9IjMwIiB4Mj0iMjgwIiB5Mj0iMzEwIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iIzhhNGZmZiIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNjMDZhZmYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgPC9kZWZzPgogIDxjaXJjbGUgY3g9IjE2Ny44MyIgY3k9IjE2Ny44MyIgcj0iMTY3LjgzIiBmaWxsPSJ1cmwoI2ZzUHVycGxlKSIvPgogIDxnIGZpbGw9IiNmZmYiPgogICAgPHBhdGggZD0ibTEwNS40OSwyNTguMTZ2LTcuMTRjMC03LjM2LDIuNzgtMTUuNDkwLDguMzYtMjQuMzlsNi4wNi0xMC41MWMxLjYyLTIuOTcsMi40My01LjcsMi40My04LjIyLDAtMS42Mi0uMzYtMy4xNS0xLjA4LTQuNTgtMS44LTMuNS00Ljk0LTUuMjUtOS40My01LjI1aC00MS4yM3YtMTcuMjVoNDEuMzZjMTIuMDQsMCwyMC4zOSw0LjgxLDI1LjA3LDE0LjQyLDEuOTcsNC4xMywyLjk2LDguMzEsMi45NiwxMi41MywwLDUuNDgtMS44LDExLTUuMzksMTYuNTdsLTYuMiwxMC43OGMtMi45Nyw0Ljg1LTQuNDUsMTAuMjktNC40NSwxNi4zMXY2Ljc0aC0xOC40NlptLTMwLjcyLDE3LjY1di02NS43NWgxOC44N3Y2NS43NWgtMTguODdaIi8+CiAgICA8cGF0aCBkPSJtMTQ4Ljg4LDE5OC42di0xNy43OWgyNC45M3YxNy43OWgtMjQuOTNabTI0LjkzLDguNzZ2NTAuOGgtMTguOTl2LTUwLjhoMTguOTlaIi8+CiAgICA8cGF0aCBkPSJtMjQ2LjAzLDI0MC43OGM4LjA4LDAsMTIuMTItNC44NSwxMi4xMi0xNC41NXYtNDUuNDFoMTguODd2NDVjLS4wOSw5LjUyLTMuMSwxNy4zLTkuMDQsMjMuMzEtNS45Miw2LjAyLTEzLjM4LDkuMDMtMjIuMzYsOS4wMzBoLTU3Ljk0di03Ny4zNGgxOC45OXY1OS45NmgzOS4zNVptMS4zNC00Mi43MWgtMy42M2MtNC41OCwwLTcuNjksMS4zOS05LjMsNC4xOC0uNTQuOTktLjgxLDIuMDctLjgxLDMuMjMwLDAsMS45OC44Niw0LjE4LDIuNTcsNi42MWw3LjQsOS43LTEzLjA3LDkuOTctOC4zNC0xMC4xMWMtMy42OC00Ljc2LTUuNTMtOS44OC01LjUzLTE1LjM2LDAtMy41Ljc2LTcuMTksMi4yOS0xMS4wNSw0Ljc2LTkuNjEsMTMuMTYtMTQuNDIsMjUuMTktMTQuNDJoMy4xbC4xMywxNy4yNVoiLz4KICAgIDxwYXRoIGQ9Im01MS43NSwxNjMuMTd2LTc3LjM0aDE4Ljg2djU5Ljk2aDIzLjE4YzkuMTYsMCwxMy43NC00Ljg1LDEzLjc0LTE0LjU1di0yNy4wOGgtMS4yMmwtMTAuNSwxNC41NS0uMTMtLjEzaC0xOC42bC4xMy0xLjg5LDI0LjEyLTMwLjg2aDI0LjY2djQ1YzAsOS41Mi0yLjY4LDE3LjMtOC4wMywyMy4zMS01LjM0LDYuMDItMTIuNTYsOS4wMy0yMS42Miw5LjAzaC00NC42WiIvPgogICAgPHBhdGggZD0ibTE2My40NSw4NS44M3YxMS4wNWMwLDMuNi42Nyw2Ljc4LDIuMDIsOS41N2w2LjM0LDEyLjY2YzMuMzEsNi4yLDQuOTgsMTEuOSw0Ljk4LDE3LjExLDAsMy45Ni0uOTksOC0yLjk2LDEyLjEzLTQuNjcsOS42Mi0xMi45LDE0LjU1LTI0LjY2LDE0LjgzaC0xNy4xMXYtMTcuMzloMTYuNTdjNC40LDAsNy42My0xLjYyLDkuNy00Ljg1LDIuMDYtMy4yMywxLjUyLTcuNjQtMS42Mi0xMy4yMWwtOC4zNi0xNi40NGMtMi43OS01LjY2LTQuMTgtMTEuMjctNC4xOC0xNi44NHYtOC42MmgxOS4yOFoiLz4KICAgIDxwYXRoIGQ9Im0xODEuNzYsMTAzLjYxdi0xNy43OWgyNC45MnYxNy43OWgtMjQuOTJabTI0LjkyLDguNzZ2NTAuOGgtMTguOTl2LTUwLjhoMTguOTlaIi8+CiAgICA8cGF0aCBkPSJtMjMyLjI5LDEzNi43NmwtNy42OS0xMC4xMWMtNi4xMS03LjktNy4xOC0xNi43MS0zLjIyLTI2LjQsNC43Ni05LjYxLDEzLjE2LTE0LjQyLDI1LjE5LTE0LjQyaDM2Ljkydjc3LjM0aC02Mi4zOHYtMTcuMzloNDMuMzl2LTQyLjcxaC0xOC4zMmMtNC41OCwwLTcuNjYsMS4zNy05LjIzLDQuMTEtMS41ODAsMi43NC0xLjAxLDYuMDQsMS42OCw5LjkxbDguNjMsMTEuOTktMTQuOTYsNy42OFoiLz4KICA8L2c+Cjwvc3ZnPgo=" alt="פונטשוק"></div>
  </div></div>`;
}

/* state & router */
let state={view:'subs',plan:'web',sub:{subs:'dl',lic:'list',profile:'me'},open:{lic:-1,orders:-1}};
try{const s=JSON.parse(localStorage.getItem('fsa-v2')||'null');if(s&&V[s.view])state=Object.assign(state,s)}catch(e){}
{const hv=location.hash.slice(1);if(V[hv])state.view=hv}state.plan=FS.plan||'web';state.noteHidden=1;
function save(){try{localStorage.setItem('fsa-v2',JSON.stringify(state))}catch(e){}}
/* "https://www.studio-dayan.co.il/about" -> host "studio-dayan.co.il" -> name "Studio Dayan".
   On the live site the server can also fetch the page <title> for a nicer name. */
const cleanHost=v=>v.trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split(/[\/?#]/)[0];
const siteName=h=>{const parts=h.split('.');const sld=['co','org','net','ac','gov','muni'];let i=parts.length-2;if(i>0&&sld.includes(parts[i]))i--;return (parts[Math.max(i,0)]||h).split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ')};
const today=()=>{const d=new Date();return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`};
/* render({page}) fades the whole page in only when the page changes; {opening} lets a just-opened drawer unfold; {fresh} highlights a just-added row */
function render(o={}){
 document.querySelectorAll('.side button[data-view]').forEach(b=>b.setAttribute('aria-current',b.dataset.view===state.view?'page':'false'));
 const v=state.view,el=$('#view');el.classList.toggle('is-plans',v==='plans');
 /* phones: keep the active tab visible in the scrolling tab bar */
 const cur=document.querySelector(`.side button[data-view="${v}"]`),bar=cur&&cur.parentElement;
 if(cur&&bar.scrollWidth>bar.clientWidth)bar.scrollTo({left:cur.offsetLeft-(bar.clientWidth-cur.offsetWidth)/2,behavior:o.page?'auto':'smooth'});
 el.innerHTML=v==='lic'?V.lic(state.sub.lic,state.open.lic):v==='orders'?V.orders(state.open.orders):v==='subs'?V.subs(state.sub.subs):v==='profile'?V.profile(state.sub.profile):V[v]();
 el.classList.remove('enter');if(o.page){void el.offsetWidth;el.classList.add('enter')}
 if(o.opening)el.querySelectorAll('.drawer').forEach(d=>d.classList.add('opening'));
 if(o.fresh){const td=[...el.querySelectorAll('.mini td, .tbl td')].find(c=>c.textContent.trim()===o.fresh);td&&td.parentElement.classList.add('fresh')}
 save();
}
state.editKey=null;
const goPage=v=>{state.view=v;state.editKey=null;render({page:true});scrollTo({top:0,behavior:'smooth'})};
/* close the open drawer with a short fold, then re-render */
function toggleDrawer(key,i){
 const open=state.open[key]===i;const d=$('#view .drawer');
 if(open&&d){d.classList.add('closing');setTimeout(()=>{state.open[key]=-1;render()},260);return}
 state.open[key]=i;render({opening:true});
}
const modal=$('#certModal');
function showModal(){modal.hidden=false;void modal.offsetWidth;setTimeout(()=>modal.classList.add('show'),16);$('#certClose').focus()}
function hideModal(){if(modal.hidden)return;modal.classList.remove('show');setTimeout(()=>{modal.hidden=true},350)}
function openCert(spec){
 const p=spec.split(':');let l,site=null;
 if(p[0]==='sd'){const s=SUBDOM[state.plan][+p[1]];l={f:s[3],w:'',t:'וובפונט',sub:state.plan,n:PLAN[state.plan].n};site=s}
 else if(p[0]==='hist'){const h=HISTORY[+p[1]];const base=LIC.find(x=>x.f===h.f&&x.w===h.w)||{};l=Object.assign({},base,{sub:h.sub,removed:h.removed});site=h.site}
 else{l=LIC[+p[1]];if(p[0]==='dom')site=l.sites[+p[2]]}
 $('#certBody').innerHTML=cert(l,site);showModal();
}
$('#certClose').onclick=hideModal;
modal.addEventListener('click',e=>{if(e.target.id==='certModal')hideModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){hideModal();closeMenus()}});
document.addEventListener('click',e=>{
 const t=e.target.closest('button,a');if(!t||!t.closest('#fsa'))return;
 if(t.dataset.del||t.dataset.sddel||t.dataset.edit||t.dataset.addon||t.dataset.planaddon||t.dataset.edsave){e.preventDefault();soon();return}
 if(t.dataset.view){goPage(t.dataset.view);return}
 if(t.dataset.hist){state.histOpen=!state.histOpen;t.setAttribute('aria-expanded',state.histOpen);$('#histBody').classList.toggle('open',state.histOpen);return}
 if(t.dataset.go){e.preventDefault();if(t.dataset.go==='dom')state.histOpen=true;goPage(t.dataset.go);return}
 if(t.dataset.subtab){state.sub[state.view]=t.dataset.subtab;render({page:true});return}
 if(t.dataset.open!==undefined){toggleDrawer('lic',+t.dataset.open);return}
 if(t.dataset.oopen!==undefined){toggleDrawer('orders',+t.dataset.oopen);return}
 if(t.dataset.cert){openCert(t.dataset.cert);return}
 if(t.dataset.del){const[i,j]=t.dataset.del.split(':').map(Number);const l=LIC[i];const s=l.sites.splice(j,1)[0];l.u=l.sites.length;render();toast(`${s[2]} הוסר והמקום ברישיון התפנה`);return}
 if(t.dataset.addon){const l=LIC[+t.dataset.addon];l.n+=1;render();toast('נוסף אתר לרישיון. אפשר לרשום עכשיו');return}
 if(t.dataset.hidenote){const n=$('.note');n.style.transition='opacity .3s var(--ease),transform .3s var(--ease)';n.style.opacity=0;n.style.transform='translateY(-4px)';setTimeout(()=>{state.noteHidden=1;render()},300);return}
 if(t.dataset.edit){state.editKey=t.dataset.edit;render();const r=$(`tr.editing`);r&&r.querySelector('.ed-host').focus();return}
 if(t.dataset.edcancel){state.editKey=null;render();return}
 if(t.dataset.edsave){saveEdit(t.closest('tr'));return}
 if(t.dataset.plan){state.plan=t.dataset.plan;render({page:true});return}
 if(t.dataset.planaddon){BONUS+=1;render();toast('נוסף רישום לחודש הזה. אפשר לרשום את האתר');return}
 if(t.dataset.sddel){const s=SUBDOM[state.plan].splice(+t.dataset.sddel,1)[0];render();toast(`${s[2]} הוסר והמקום במכסה התפנה`);return}
 if(t.dataset.go2){state.sub.subs='reg';goPage(t.dataset.go2);return}
 if(t.id==='logout'){location.href=FS.links.logout;return}
 if(t.dataset.t){e.preventDefault();toast(t.dataset.t)}
});
document.addEventListener('submit',e=>{
 const f=e.target;if(!f.closest('#fsa'))return;e.preventDefault();if(f.dataset.subadd||f.dataset.add!==undefined||f.id==='pform'){soon();return}
 if(f.dataset.subadd){
  const host=cleanHost($('#sd2').value),picked=[...f.querySelectorAll('.fp-menu input:checked')].map(i=>i.value),err=$('#sdErr');
  const msg=!host||!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)?'צריך להזין כתובת אתר תקינה, למשל studio.co.il':!picked.length?'צריך לבחור לפחות פונט אחד':'';
  if(msg){err.textContent=msg;err.hidden=false;(msg.includes('כתובת')?$('#sd2'):f.querySelector('.fp-btn')).focus();return}
  SUBDOM[state.plan].unshift([today(),$('#sd1').value.trim()||siteName(host),host,picked.join(', ')]);render({fresh:host});toast('האתר נרשם במינוי. התעודה מוכנה להורדה');return}
 if(f.dataset.add!==undefined){const l=LIC[+f.dataset.add];const host=cleanHost(f.querySelector('[data-namefor]').value);if(!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)){toast('צריך להזין כתובת אתר תקינה');return}l.sites.unshift([today(),f.querySelector('.sitename').value.trim()||siteName(host),host]);l.u=l.sites.length;render({fresh:host});toast('הדומיין נרשם. התעודה מוכנה להורדה');return}
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
 if(p[0]==='sd'){const s=SUBDOM[state.plan][+p[1]];s[1]=name;s[2]=host;s[3]=fonts.join(', ')}
 else{const s=LIC[+p[1]].sites[+p[2]];s[1]=name;s[2]=host}
 state.editKey=null;render({fresh:host});toast('הדומיין עודכן, וגם התעודה שלו');
}
document.addEventListener('keydown',e=>{const tr=e.target.closest&&e.target.closest('tr.editing');if(!tr)return;if(e.key==='Enter'){e.preventDefault();saveEdit(tr)}if(e.key==='Escape'){state.editKey=null;render()}});
function closeMenus(){document.querySelectorAll('.fp-menu.open').forEach(m=>{m.classList.remove('open');m.parentElement.querySelector('.fp-btn').setAttribute('aria-expanded','false')})}
document.addEventListener('click',e=>{const fb=e.target.closest('.fp-btn');
 if(fb){const m=fb.parentElement.querySelector('.fp-menu');const open=m.classList.toggle('open');fb.setAttribute('aria-expanded',open);return}
 if(!e.target.closest('.fp-menu'))closeMenus()});
document.addEventListener('input',e=>{if(e.target.dataset.namefor){const n=document.getElementById(e.target.dataset.namefor);const h=cleanHost(e.target.value);if(n&&!n.dataset.touched)n.value=h.includes('.')?siteName(h):''}if(e.target.classList.contains('sitename'))e.target.dataset.touched=e.target.value?'1':''});
document.addEventListener('input',e=>{if(e.target.id==='sd2'){const n=$('#sd1');const h=cleanHost(e.target.value);if(!n.dataset.touched)n.value=h.includes('.')?siteName(h):'';$('#sdErr').hidden=true}if(e.target.id==='sd1')e.target.dataset.touched=e.target.value?'1':''});
document.addEventListener('input',e=>{if(e.target.id==='oq'){const q=e.target.value.trim().replace('#','');document.querySelectorAll('#otb tr[data-oid]').forEach(r=>r.hidden=q&&!r.dataset.oid.includes(q))}});
$('#fsaName').textContent=FS.user.first||'';
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
