<?php
/**
 * Plugin Name: FontShok Account – Stage 2
 * Description: Monthly domain quotas, per-domain licence certificates and the ₪79 additional domain for the new personal area ([fs_account_v2]). REST: /wp-json/fs/v1/account/*.
 * Version: 0.1.0
 * Requires PHP: 8.0
 * Requires Plugins: woocommerce
 *
 * Support screen: WooCommerce → דומיינים של לקוחות. Settings (options):
 *   fs_acc2_enabled           'admins' (default) | 'all'
 *   fs_acc2_role_map          array role => 'web' | 'extra'   (must match the roles Stage 1 reads)
 *   fs_acc2_addon_product_id  ID of the hidden ₪79 "דומיין נוסף" product
 *   fs_acc2_cert_start        first certificate number (set above the highest one already issued, before activation)
 *   fs_acc2_domain_meta_keys  order / order-item meta keys holding domains entered at checkout (for `wp fs-acc2 migrate`)
 */
defined( 'ABSPATH' ) || exit;

define( 'FS_ACC2_VERSION', '0.1.0' );

foreach ( array( 'rules', 'schema', 'repo', 'rest', 'addon', 'certificates', 'migrate', 'admin' ) as $f ) {
	require_once __DIR__ . "/includes/class-$f.php";
}

register_activation_hook( __FILE__, array( 'FS_Acc2_Schema', 'install' ) );

add_action( 'plugins_loaded', function () {
	FS_Acc2_Schema::maybe_upgrade();
	FS_Acc2_Rest::init();
	FS_Acc2_Addon::init();
	if ( is_admin() ) {
		FS_Acc2_Admin::init();
	}
} );
