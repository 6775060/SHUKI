<?php
/** Database access for domains, licences, quota bonus and certificate numbers. Every query is scoped by user_id. */
defined( 'ABSPATH' ) || exit;

final class FS_Acc2_Repo {

	/** Serialise writes per user (prevents two parallel registrations exceeding the quota, spec §3). */
	public static function lock( int $user_id ): bool {
		global $wpdb;
		return '1' === (string) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 5)', 'fs_acc2_u' . $user_id ) );
	}

	public static function unlock( int $user_id ): void {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', 'fs_acc2_u' . $user_id ) );
	}

	public static function count_active_sub( int $user_id, string $cycle ): int {
		global $wpdb;
		$t = FS_Acc2_Schema::table( 'domains' );
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE user_id=%d AND source='sub' AND cycle=%s AND status='active'", $user_id, $cycle ) );
	}

	public static function count_active_lic( int $licence_id ): int {
		global $wpdb;
		$t = FS_Acc2_Schema::table( 'domains' );
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE licence_id=%d AND source='lic' AND status='active'", $licence_id ) );
	}

	public static function bonus( int $user_id, string $cycle ): int {
		global $wpdb;
		$t = FS_Acc2_Schema::table( 'quota_bonus' );
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COALESCE(SUM(qty),0) FROM $t WHERE user_id=%d AND cycle=%s", $user_id, $cycle ) );
	}

	/** Is $host already active for this user in the same scope (sub: same cycle; lic: same licence)? */
	public static function host_taken( int $user_id, string $host, string $source, string $cycle, ?int $licence_id, int $except_id = 0 ): bool {
		global $wpdb;
		$t = FS_Acc2_Schema::table( 'domains' );
		if ( 'sub' === $source ) {
			$sql = $wpdb->prepare( "SELECT id FROM $t WHERE user_id=%d AND source='sub' AND cycle=%s AND host=%s AND status='active' AND id<>%d LIMIT 1", $user_id, $cycle, $host, $except_id );
		} else {
			$sql = $wpdb->prepare( "SELECT id FROM $t WHERE user_id=%d AND source='lic' AND licence_id=%d AND host=%s AND status='active' AND id<>%d LIMIT 1", $user_id, (int) $licence_id, $host, $except_id );
		}
		return (bool) $wpdb->get_var( $sql );
	}

	public static function get_domain( int $user_id, int $id ): ?array {
		global $wpdb;
		$t   = FS_Acc2_Schema::table( 'domains' );
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id=%d AND user_id=%d", $id, $user_id ), ARRAY_A );
		return $row ?: null;
	}

	public static function domains( int $user_id ): array {
		global $wpdb;
		$t = FS_Acc2_Schema::table( 'domains' );
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id=%d AND status='active' ORDER BY created_at DESC, id DESC", $user_id ), ARRAY_A ) ?: array();
	}

	public static function get_licence( int $user_id, int $id ): ?array {
		global $wpdb;
		$t   = FS_Acc2_Schema::table( 'licences' );
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE id=%d AND user_id=%d", $id, $user_id ), ARRAY_A );
		return $row ?: null;
	}

	public static function licences( int $user_id ): array {
		global $wpdb;
		$t = FS_Acc2_Schema::table( 'licences' );
		return $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE user_id=%d ORDER BY id", $user_id ), ARRAY_A ) ?: array();
	}

	/** Atomically take the next certificate number (never reused). */
	public static function next_cert_no(): int {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->options} SET option_value = LAST_INSERT_ID(option_value + 1) WHERE option_name = %s", 'fs_acc2_cert_seq' ) );
		$n = (int) $wpdb->get_var( 'SELECT LAST_INSERT_ID()' );
		wp_cache_delete( 'fs_acc2_cert_seq', 'options' );
		if ( $n <= 0 ) {
			throw new RuntimeException( 'fs_acc2_cert_seq option missing' );
		}
		return $n;
	}

	public static function insert_domain( array $d ): int {
		global $wpdb;
		$now = current_time( 'mysql', true );
		$wpdb->insert(
			FS_Acc2_Schema::table( 'domains' ),
			array(
				'user_id'    => $d['user_id'],
				'source'     => $d['source'],
				'plan'       => $d['plan'] ?? null,
				'licence_id' => $d['licence_id'] ?? null,
				'host'       => $d['host'],
				'site_name'  => $d['site_name'],
				'fonts'      => wp_json_encode( $d['fonts'] ?? array(), JSON_UNESCAPED_UNICODE ),
				'cycle'      => $d['cycle'],
				'status'     => 'active',
				'cert_no'    => self::next_cert_no(),
				'created_at' => $now,
				'updated_at' => $now,
			)
		);
		return (int) $wpdb->insert_id;
	}

	public static function update_domain( int $id, array $fields ): void {
		global $wpdb;
		if ( isset( $fields['fonts'] ) ) {
			$fields['fonts'] = wp_json_encode( $fields['fonts'], JSON_UNESCAPED_UNICODE );
		}
		$fields['updated_at'] = current_time( 'mysql', true );
		$wpdb->update( FS_Acc2_Schema::table( 'domains' ), $fields, array( 'id' => $id ) );
	}

	/** Subscription domain removed inside its cycle: gone, not kept in history (spec §1.1). */
	public static function delete_domain( int $id ): void {
		global $wpdb;
		$wpdb->delete( FS_Acc2_Schema::table( 'domains' ), array( 'id' => $id ) );
	}

	/** Purchased-licence site removed: kept with removed_at so its certificate can state the valid period. */
	public static function mark_removed( int $id ): void {
		self::update_domain( $id, array( 'status' => 'removed', 'removed_at' => current_time( 'mysql', true ) ) );
	}
}
