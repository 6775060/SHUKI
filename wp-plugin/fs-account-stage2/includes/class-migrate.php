<?php
/**
 * One-off import of existing data into the Stage 2 tables (spec §8).
 *
 *   wp fs-acc2 migrate --dry-run [--csv=/path/report.csv] [--since=2023-01-01]
 *   wp fs-acc2 migrate            (writes; safe to re-run, already-imported rows are skipped)
 *
 * Reads paid WooCommerce orders oldest first, so certificate numbers follow the original order.
 * Each line is classified by FS_Acc2_Rules::classify_item_name() unless the fs_acc2_classify_item filter says otherwise.
 * Domains are read from the order-item and order meta keys listed in option fs_acc2_domain_meta_keys
 * (the keys the checkout stores them under — the same ones the Stage 1 snippet reads). Nothing is guessed:
 * with no keys configured, no domains are imported and the report says so.
 */
defined( 'ABSPATH' ) || exit;

final class FS_Acc2_Migrate {

	/** @return string[] hosts found in the meta of an item or order */
	private static function domains_from( $obj, array $keys ): array {
		$out = array();
		foreach ( $keys as $k ) {
			foreach ( (array) $obj->get_meta( $k, false ) as $m ) {
				$v = is_object( $m ) ? $m->value : $m;
				foreach ( (array) ( is_string( $v ) ? preg_split( '/[\s,;]+/', $v ) : $v ) as $raw ) {
					$h = FS_Acc2_Rules::normalize_host( (string) $raw );
					if ( $h && ! in_array( $h, $out, true ) ) {
						$out[] = $h;
					}
				}
			}
		}
		return $out;
	}

	/**
	 * @param array $args ['dry_run'=>bool,'since'=>?string,'csv'=>?string]
	 * @return array{rows:array,counts:array}
	 */
	public static function run( array $args ): array {
		global $wpdb;
		$dry    = ! empty( $args['dry_run'] );
		$keys   = array_filter( (array) get_option( 'fs_acc2_domain_meta_keys', array() ) );
		$rows   = array();
		$counts = array( 'orders' => 0, 'licences' => 0, 'sub_domains' => 0, 'lic_sites' => 0, 'skipped' => 0, 'unclassified' => 0 );
		$page   = 1;
		do {
			$orders = wc_get_orders( array(
				'status'       => array( 'completed', 'processing' ),
				'orderby'      => 'date',
				'order'        => 'ASC',
				'limit'        => 100,
				'page'         => $page++,
				'date_created' => empty( $args['since'] ) ? '' : '>=' . $args['since'],
			) );
			foreach ( $orders as $order ) {
				$uid = (int) $order->get_customer_id();
				if ( ! $uid ) {
					continue;
				}
				$counts['orders']++;
				$paid   = $order->get_date_paid() ?: $order->get_date_created();
				$gmt    = gmdate( 'Y-m-d H:i:s', $paid->getTimestamp() );
				$cycle  = FS_Acc2_Rules::cycle( $paid );
				$odoms  = $keys ? self::domains_from( $order, $keys ) : array();
				foreach ( $order->get_items() as $item_id => $item ) {
					$c = apply_filters( 'fs_acc2_classify_item', FS_Acc2_Rules::classify_item_name( $item->get_name() ), $item, $order );
					$doms = $keys ? self::domains_from( $item, $keys ) : array();
					$base = array( 'order' => $order->get_id(), 'item' => $item_id, 'user' => $uid, 'date' => $gmt, 'name' => $item->get_name(), 'kind' => (string) $c['kind'] );

					if ( 'licence' === $c['kind'] ) {
						$weight = (string) ( $item->get_meta( 'pa_weight' ) ?: $item->get_meta( 'משקל' ) );
						$exists = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . FS_Acc2_Schema::table( 'licences' ) . ' WHERE order_item_id=%d', $item_id ) );
						$existed = (bool) $exists;
						if ( ! $dry && ! $exists ) {
							$wpdb->insert( FS_Acc2_Schema::table( 'licences' ), array(
								'user_id' => $uid, 'order_item_id' => $item_id, 'font' => mb_substr( $c['font'], 0, 80 ),
								'weight' => mb_substr( $weight, 0, 40 ), 'type' => $c['type'], 'site_limit' => FS_Acc2_Rules::LICENCE_SITE_LIMIT,
							) );
							$exists = (int) $wpdb->insert_id;
						}
						$rows[] = $base + array( 'action' => $existed ? 'licence (already imported)' : 'licence', 'host' => '' );
						$counts['licences']++;
						if ( false === mb_strpos( $c['type'], 'וובפונט' ) ) {
							continue;
						}
						foreach ( array_slice( $doms ?: $odoms, 0, FS_Acc2_Rules::LICENCE_SITE_LIMIT ) as $h ) {
							if ( $exists && FS_Acc2_Repo::host_taken( $uid, $h, 'lic', $cycle, $exists ) ) {
								$rows[] = $base + array( 'action' => 'skip (already imported)', 'host' => $h );
								$counts['skipped']++;
								continue;
							}
							if ( ! $dry ) {
								FS_Acc2_Repo::insert_domain( array(
									'user_id' => $uid, 'source' => 'lic', 'licence_id' => $exists, 'host' => $h, 'site_name' => FS_Acc2_Rules::site_name( $h ),
									'fonts' => array( trim( $c['font'] . ' ' . $weight ) ), 'cycle' => $cycle, 'created_at' => $gmt,
								) );
							}
							$rows[] = $base + array( 'action' => 'licence site', 'host' => $h );
							$counts['lic_sites']++;
						}
					} elseif ( 'subscription' === $c['kind'] ) {
						$rows[] = $base + array( 'action' => 'subscription (' . $c['plan'] . ')', 'host' => '' );
						foreach ( $doms ?: $odoms as $h ) {
							if ( FS_Acc2_Repo::host_taken( $uid, $h, 'sub', $cycle, null ) ) {
								$rows[] = $base + array( 'action' => 'skip (already imported)', 'host' => $h );
								$counts['skipped']++;
								continue;
							}
							if ( ! $dry ) {
								FS_Acc2_Repo::insert_domain( array(
									'user_id' => $uid, 'source' => 'sub', 'plan' => $c['plan'], 'host' => $h, 'site_name' => FS_Acc2_Rules::site_name( $h ),
									'fonts' => array(), 'cycle' => $cycle, 'created_at' => $gmt,
								) );
							}
							$rows[] = $base + array( 'action' => 'subscription domain', 'host' => $h );
							$counts['sub_domains']++;
						}
					} elseif ( 'addon' !== $c['kind'] ) {
						$rows[] = $base + array( 'action' => 'unclassified', 'host' => '' );
						$counts['unclassified']++;
					}
				}
			}
		} while ( count( $orders ) === 100 );

		if ( ! empty( $args['csv'] ) ) {
			$fh = fopen( $args['csv'], 'w' );
			fwrite( $fh, "\xEF\xBB\xBF" ); // BOM so Excel shows Hebrew
			fputcsv( $fh, array( 'order', 'item', 'user', 'date', 'name', 'kind', 'action', 'host' ) );
			foreach ( $rows as $r ) {
				fputcsv( $fh, array( $r['order'], $r['item'], $r['user'], $r['date'], $r['name'], $r['kind'], $r['action'], $r['host'] ) );
			}
			fclose( $fh );
		}
		if ( ! $keys ) {
			$counts['warning'] = 'fs_acc2_domain_meta_keys is empty: no domains were read';
		}
		return array( 'rows' => $rows, 'counts' => $counts );
	}
}

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	WP_CLI::add_command( 'fs-acc2 migrate', function ( $pos, $assoc ) {
		$res = FS_Acc2_Migrate::run( array(
			'dry_run' => isset( $assoc['dry-run'] ),
			'since'   => $assoc['since'] ?? null,
			'csv'     => $assoc['csv'] ?? null,
		) );
		foreach ( $res['counts'] as $k => $v ) {
			WP_CLI::log( "$k: $v" );
		}
		WP_CLI::success( isset( $assoc['dry-run'] ) ? 'Dry run — nothing written.' : 'Migration done.' );
	} );
}
