<?php
/**
 * ₪79 additional domain (spec §5).
 * One hidden WooCommerce product (option fs_acc2_addon_product_id). The grant happens only after payment:
 *  - kind 'sub': +1 Webstop slot for the cycle in which payment completed (expires with that cycle, spec Q3 default)
 *  - kind 'lic': +1 permanent site on the purchased licence
 * Idempotent per order; reversed on refund/cancel.
 */
defined( 'ABSPATH' ) || exit;

final class FS_Acc2_Addon {

	public static function init(): void {
		foreach ( array( 'woocommerce_payment_complete', 'woocommerce_order_status_processing', 'woocommerce_order_status_completed' ) as $h ) {
			add_action( $h, array( __CLASS__, 'grant' ) );
		}
		foreach ( array( 'woocommerce_order_status_refunded', 'woocommerce_order_status_cancelled' ) as $h ) {
			add_action( $h, array( __CLASS__, 'revoke' ) );
		}
	}

	/** Create a pending order for the add-on and return its payment URL. Nothing is granted here. */
	public static function checkout_url( int $uid, string $kind, int $licence_id ) {
		if ( ! function_exists( 'wc_create_order' ) ) {
			return new WP_Error( 'woocommerce_missing', 'woocommerce_missing', array( 'status' => 500 ) );
		}
		$product = wc_get_product( (int) get_option( 'fs_acc2_addon_product_id' ) );
		if ( ! $product ) {
			return new WP_Error( 'addon_product_missing', 'addon_product_missing', array( 'status' => 500 ) );
		}
		$order   = wc_create_order( array( 'customer_id' => $uid ) );
		$item_id = $order->add_product( $product, 1 );
		wc_add_order_item_meta( $item_id, '_fs_acc2_kind', $kind );
		if ( 'lic' === $kind ) {
			wc_add_order_item_meta( $item_id, '_fs_acc2_licence_id', $licence_id );
		}
		$user = get_userdata( $uid );
		$order->set_billing_email( $user->user_email );
		$order->set_billing_first_name( (string) $user->first_name );
		$order->set_billing_last_name( (string) $user->last_name );
		$order->calculate_totals();
		$order->save();
		return $order->get_checkout_payment_url();
	}

	/** @return array<int,array{kind:string,licence_id:int}> add-on lines in the order */
	private static function lines( WC_Order $order ): array {
		$out = array();
		foreach ( $order->get_items() as $item ) {
			$kind = $item->get_meta( '_fs_acc2_kind' );
			if ( $kind ) {
				for ( $i = 0; $i < max( 1, (int) $item->get_quantity() ); $i++ ) {
					$out[] = array( 'kind' => $kind, 'licence_id' => (int) $item->get_meta( '_fs_acc2_licence_id' ) );
				}
			}
		}
		return $out;
	}

	public static function grant( $order_id ): void {
		$order = wc_get_order( $order_id );
		if ( ! $order || ! $order->is_paid() || $order->get_meta( '_fs_acc2_granted' ) ) {
			return;
		}
		$lines = self::lines( $order );
		if ( ! $lines ) {
			return;
		}
		global $wpdb;
		$uid   = (int) $order->get_customer_id();
		$cycle = FS_Acc2_Rules::cycle( $order->get_date_paid() ?: null );
		$subs  = 0;
		foreach ( $lines as $l ) {
			if ( 'sub' === $l['kind'] ) {
				$subs++;
			} elseif ( FS_Acc2_Repo::get_licence( $uid, $l['licence_id'] ) ) {
				$wpdb->query( $wpdb->prepare( 'UPDATE ' . FS_Acc2_Schema::table( 'licences' ) . ' SET site_limit = site_limit + 1 WHERE id=%d AND user_id=%d', $l['licence_id'], $uid ) );
			}
		}
		if ( $subs ) {
			// UNIQUE(order_id) makes a replayed hook a no-op
			$wpdb->query( $wpdb->prepare( 'INSERT IGNORE INTO ' . FS_Acc2_Schema::table( 'quota_bonus' ) . ' (user_id, cycle, qty, order_id) VALUES (%d, %s, %d, %d)', $uid, $cycle, $subs, $order->get_id() ) );
		}
		$order->update_meta_data( '_fs_acc2_granted', $cycle );
		$order->save();
		$order->add_order_note( sprintf( 'FS: הרחבת דומיינים הוענקה (%s)', $cycle ) );
	}

	public static function revoke( $order_id ): void {
		$order = wc_get_order( $order_id );
		if ( ! $order || ! $order->get_meta( '_fs_acc2_granted' ) || $order->get_meta( '_fs_acc2_revoked' ) ) {
			return;
		}
		global $wpdb;
		$uid    = (int) $order->get_customer_id();
		$manual = false;
		$wpdb->delete( FS_Acc2_Schema::table( 'quota_bonus' ), array( 'order_id' => $order->get_id() ) );
		foreach ( self::lines( $order ) as $l ) {
			if ( 'lic' !== $l['kind'] ) {
				continue;
			}
			$lic = FS_Acc2_Repo::get_licence( $uid, $l['licence_id'] );
			if ( ! $lic ) {
				continue;
			}
			$new = (int) $lic['site_limit'] - 1;
			if ( $new < FS_Acc2_Rules::LICENCE_SITE_LIMIT || $new < FS_Acc2_Repo::count_active_lic( (int) $lic['id'] ) ) {
				$manual = true; // never drop below the sites already registered
				continue;
			}
			$wpdb->update( FS_Acc2_Schema::table( 'licences' ), array( 'site_limit' => $new ), array( 'id' => (int) $lic['id'] ) );
		}
		$order->update_meta_data( '_fs_acc2_revoked', 1 );
		$order->save();
		$order->add_order_note( $manual ? 'FS: ביטול הרחבה דורש טיפול ידני – יש באתר יותר אתרים רשומים מהמכסה אחרי הביטול' : 'FS: הרחבת דומיינים בוטלה' );
	}
}
