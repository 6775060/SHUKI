<?php
/** Custom tables (spec §2). Created/upgraded with dbDelta, versioned by option fs_acc2_db_version. */
defined( 'ABSPATH' ) || exit;

final class FS_Acc2_Schema {
	const DB_VERSION = '1';

	public static function table( string $name ): string {
		global $wpdb;
		return $wpdb->prefix . 'fs_' . $name;
	}

	public static function maybe_upgrade(): void {
		if ( get_option( 'fs_acc2_db_version' ) !== self::DB_VERSION ) {
			self::install();
		}
	}

	public static function install(): void {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$c = $wpdb->get_charset_collate();
		$d = self::table( 'domains' );
		$l = self::table( 'licences' );
		$b = self::table( 'quota_bonus' );

		dbDelta( "CREATE TABLE $d (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  user_id bigint(20) unsigned NOT NULL,
  source varchar(3) NOT NULL,
  plan varchar(20) NULL,
  licence_id bigint(20) unsigned NULL,
  host varchar(253) NOT NULL,
  site_name varchar(120) NOT NULL,
  fonts varchar(255) NOT NULL DEFAULT '',
  cycle char(7) NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'active',
  cert_no int(10) unsigned NOT NULL,
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  removed_at datetime NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY cert (cert_no),
  KEY user_cycle (user_id,source,cycle,status),
  KEY licence (licence_id,status)
) $c;" );

		dbDelta( "CREATE TABLE $l (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  user_id bigint(20) unsigned NOT NULL,
  order_item_id bigint(20) unsigned NOT NULL,
  font varchar(80) NOT NULL,
  weight varchar(40) NOT NULL,
  type varchar(40) NOT NULL,
  site_limit tinyint(3) unsigned NOT NULL DEFAULT 3,
  PRIMARY KEY  (id),
  UNIQUE KEY order_item (order_item_id),
  KEY user (user_id)
) $c;" );

		dbDelta( "CREATE TABLE $b (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  user_id bigint(20) unsigned NOT NULL,
  cycle char(7) NOT NULL,
  qty tinyint(3) unsigned NOT NULL DEFAULT 1,
  order_id bigint(20) unsigned NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY order_once (order_id),
  KEY user_cycle (user_id,cycle)
) $c;" );

		// certificate number sequence; set fs_acc2_cert_start above the highest number already issued before activating
		add_option( 'fs_acc2_cert_seq', (string) (int) get_option( 'fs_acc2_cert_start', 640000 ), '', 'no' );
		update_option( 'fs_acc2_db_version', self::DB_VERSION, false );
	}
}
