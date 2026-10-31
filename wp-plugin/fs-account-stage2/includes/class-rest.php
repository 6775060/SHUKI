<?php
/** REST API /wp-json/fs/v1/account/* (spec §4). Cookie auth + wp_rest nonce; every route acts on the current user only. */
defined( 'ABSPATH' ) || exit;

final class FS_Acc2_Rest {
	const NS = 'fs/v1';

	public static function init(): void {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	public static function routes(): void {
		$auth = array( __CLASS__, 'can_use' );
		register_rest_route( self::NS, '/account/domains', array(
			array( 'methods' => 'GET', 'callback' => array( __CLASS__, 'list' ), 'permission_callback' => $auth ),
			array( 'methods' => 'POST', 'callback' => array( __CLASS__, 'create' ), 'permission_callback' => $auth ),
		) );
		register_rest_route( self::NS, '/account/domains/(?P<id>\d+)', array(
			array( 'methods' => 'PATCH', 'callback' => array( __CLASS__, 'update' ), 'permission_callback' => $auth ),
			array( 'methods' => 'DELETE', 'callback' => array( __CLASS__, 'remove' ), 'permission_callback' => $auth ),
		) );
		register_rest_route( self::NS, '/account/domains/(?P<id>\d+)/certificate', array(
			'methods' => 'GET', 'callback' => array( __CLASS__, 'certificate' ), 'permission_callback' => $auth,
		) );
		register_rest_route( self::NS, '/account/addon', array(
			'methods' => 'POST', 'callback' => array( __CLASS__, 'addon' ), 'permission_callback' => $auth,
		) );
	}

	/** Logged-in, and while the feature flag is off (default), admins only — same audience as the Stage 1 preview page. */
	public static function can_use(): bool {
		if ( ! is_user_logged_in() ) {
			return false;
		}
		return 'all' === get_option( 'fs_acc2_enabled', 'admins' ) || current_user_can( 'manage_options' );
	}

	/**
	 * 'web' | 'extra' | null. Stage 1 derives the plan from the user's role; map roles in option fs_acc2_role_map
	 * (e.g. ['webstop_member' => 'web', 'extra_member' => 'extra']) or hook the filter.
	 */
	public static function user_plan( int $user_id ): ?string {
		$map  = (array) get_option( 'fs_acc2_role_map', array() );
		$user = get_userdata( $user_id );
		$plan = null;
		foreach ( $user ? (array) $user->roles : array() as $role ) {
			if ( isset( $map[ $role ] ) ) {
				$plan = 'extra' === $map[ $role ] ? 'extra' : ( $plan ?? $map[ $role ] ); // extra wins if both
			}
		}
		$plan = apply_filters( 'fs_acc2_user_plan', $plan, $user_id );
		return in_array( $plan, array( 'web', 'extra' ), true ) ? $plan : null;
	}

	private static function err( string $code, int $status, array $extra = array() ): WP_Error {
		return new WP_Error( $code, $code, array_merge( array( 'status' => $status ), $extra ) );
	}

	/** At most 20 writes per user per 10 minutes. */
	private static function rate_limited( int $uid ): bool {
		$k = 'fs_acc2_rl_' . $uid;
		$n = (int) get_transient( $k );
		if ( $n >= 20 ) {
			return true;
		}
		set_transient( $k, $n + 1, 10 * MINUTE_IN_SECONDS );
		return false;
	}

	private static function quota_for( int $uid ): array {
		$cycle = FS_Acc2_Rules::cycle();
		$q     = FS_Acc2_Rules::quota( self::user_plan( $uid ), FS_Acc2_Repo::count_active_sub( $uid, $cycle ), FS_Acc2_Repo::bonus( $uid, $cycle ) );
		$q['cycle']  = $cycle;
		$q['resets'] = FS_Acc2_Rules::next_cycle_start( $cycle )->format( 'Y-m-d' );
		if ( PHP_INT_MAX === $q['left'] ) {
			$q['left'] = null; // JSON: unlimited
		}
		return $q;
	}

	private static function shape( array $r, string $cycle ): array {
		return array(
			'id'         => (int) $r['id'],
			'source'     => $r['source'],
			'plan'       => $r['plan'],
			'licence_id' => $r['licence_id'] ? (int) $r['licence_id'] : null,
			'host'       => $r['host'],
			'site_name'  => $r['site_name'],
			'fonts'      => json_decode( $r['fonts'] ?: '[]', true ) ?: array(),
			'cycle'      => $r['cycle'],
			'date'       => get_date_from_gmt( $r['created_at'], 'd.m.Y' ),
			'locked'     => FS_Acc2_Rules::is_locked( $r['source'], $r['cycle'], $cycle ),
			'cert_no'    => (int) $r['cert_no'],
		);
	}

	public static function list( WP_REST_Request $req ) {
		$uid     = get_current_user_id();
		$cycle   = FS_Acc2_Rules::cycle();
		$current = $history = array();
		foreach ( FS_Acc2_Repo::domains( $uid ) as $r ) {
			$d = self::shape( $r, $cycle );
			if ( 'sub' === $d['source'] && $d['locked'] ) {
				$history[ $d['cycle'] ][] = $d;
			} else {
				$current[] = $d;
			}
		}
		$licences = array_map( function ( $l ) {
			return array(
				'id'         => (int) $l['id'],
				'font'       => $l['font'],
				'weight'     => $l['weight'],
				'type'       => $l['type'],
				'site_limit' => (int) $l['site_limit'],
				'used'       => FS_Acc2_Repo::count_active_lic( (int) $l['id'] ),
			);
		}, FS_Acc2_Repo::licences( $uid ) );
		return rest_ensure_response( array(
			'plan'     => self::user_plan( $uid ),
			'quota'    => self::quota_for( $uid ),
			'current'  => $current,
			'history'  => $history,
			'licences' => $licences,
		) );
	}

	public static function create( WP_REST_Request $req ) {
		$uid = get_current_user_id();
		if ( self::rate_limited( $uid ) ) {
			return self::err( 'rate_limited', 429 );
		}
		$source = 'lic' === $req['source'] ? 'lic' : 'sub';
		$host   = FS_Acc2_Rules::normalize_host( (string) $req['host'] );
		if ( ! $host ) {
			return self::err( 'invalid_host', 400 );
		}
		$name  = sanitize_text_field( (string) $req['site_name'] ) ?: FS_Acc2_Rules::site_name( $host );
		$name  = mb_substr( $name, 0, 120 );
		$cycle = FS_Acc2_Rules::cycle();

		if ( ! FS_Acc2_Repo::lock( $uid ) ) {
			return self::err( 'busy', 503 );
		}
		try {
			if ( 'sub' === $source ) {
				$plan = self::user_plan( $uid );
				if ( ! $plan ) {
					return self::err( 'no_plan', 403 );
				}
				list( $fonts, $ferr ) = FS_Acc2_Rules::clean_fonts( $req['fonts'] );
				if ( $ferr ) {
					return self::err( $ferr, 422 );
				}
				$q = self::quota_for( $uid );
				if ( ! $q['unlimited'] && $q['left'] <= 0 ) {
					return self::err( 'quota_full', 403, array( 'quota' => $q, 'addon_price' => FS_Acc2_Rules::ADDON_PRICE ) );
				}
				if ( FS_Acc2_Repo::host_taken( $uid, $host, 'sub', $cycle, null ) ) {
					return self::err( 'duplicate_host', 409 );
				}
				$id = FS_Acc2_Repo::insert_domain( compact( 'host', 'cycle', 'fonts', 'plan' ) + array( 'user_id' => $uid, 'source' => 'sub', 'site_name' => $name ) );
			} else {
				$lic = FS_Acc2_Repo::get_licence( $uid, (int) $req['licence_id'] );
				if ( ! $lic || false === strpos( $lic['type'], 'web' ) ) {
					return self::err( 'licence_not_found', 404 );
				}
				if ( FS_Acc2_Repo::count_active_lic( (int) $lic['id'] ) >= (int) $lic['site_limit'] ) {
					return self::err( 'quota_full', 403, array( 'licence_id' => (int) $lic['id'], 'addon_price' => FS_Acc2_Rules::ADDON_PRICE ) );
				}
				if ( FS_Acc2_Repo::host_taken( $uid, $host, 'lic', $cycle, (int) $lic['id'] ) ) {
					return self::err( 'duplicate_host', 409 );
				}
				$id = FS_Acc2_Repo::insert_domain( array(
					'user_id' => $uid, 'source' => 'lic', 'licence_id' => (int) $lic['id'], 'host' => $host, 'site_name' => $name,
					'fonts' => array( trim( $lic['font'] . ' ' . $lic['weight'] ) ), 'cycle' => $cycle,
				) );
			}
		} finally {
			FS_Acc2_Repo::unlock( $uid );
		}
		$res = rest_ensure_response( self::shape( FS_Acc2_Repo::get_domain( $uid, $id ), $cycle ) );
		$res->set_status( 201 );
		return $res;
	}

	public static function update( WP_REST_Request $req ) {
		$uid = get_current_user_id();
		if ( self::rate_limited( $uid ) ) {
			return self::err( 'rate_limited', 429 );
		}
		$row   = FS_Acc2_Repo::get_domain( $uid, (int) $req['id'] );
		$cycle = FS_Acc2_Rules::cycle();
		if ( ! $row || 'active' !== $row['status'] ) {
			return self::err( 'not_found', 404 );
		}
		if ( FS_Acc2_Rules::is_locked( $row['source'], $row['cycle'], $cycle ) ) {
			return self::err( 'locked', 403 );
		}
		$f = array();
		if ( null !== $req['host'] ) {
			$host = FS_Acc2_Rules::normalize_host( (string) $req['host'] );
			if ( ! $host ) {
				return self::err( 'invalid_host', 400 );
			}
			if ( FS_Acc2_Repo::host_taken( $uid, $host, $row['source'], $row['cycle'], $row['licence_id'] ? (int) $row['licence_id'] : null, (int) $row['id'] ) ) {
				return self::err( 'duplicate_host', 409 );
			}
			$f['host'] = $host;
		}
		if ( null !== $req['site_name'] ) {
			$f['site_name'] = mb_substr( sanitize_text_field( (string) $req['site_name'] ) ?: FS_Acc2_Rules::site_name( $f['host'] ?? $row['host'] ), 0, 120 );
		}
		if ( null !== $req['fonts'] && 'sub' === $row['source'] ) {
			list( $fonts, $ferr ) = FS_Acc2_Rules::clean_fonts( $req['fonts'] );
			if ( $ferr ) {
				return self::err( $ferr, 422 );
			}
			$f['fonts'] = $fonts;
		}
		if ( $f ) {
			FS_Acc2_Repo::update_domain( (int) $row['id'], $f ); // certificate is rendered on demand, so it reflects the edit; cert_no unchanged
		}
		return rest_ensure_response( self::shape( FS_Acc2_Repo::get_domain( $uid, (int) $row['id'] ), $cycle ) );
	}

	public static function remove( WP_REST_Request $req ) {
		$uid = get_current_user_id();
		if ( self::rate_limited( $uid ) ) {
			return self::err( 'rate_limited', 429 );
		}
		$row = FS_Acc2_Repo::get_domain( $uid, (int) $req['id'] );
		if ( ! $row || 'active' !== $row['status'] ) {
			return self::err( 'not_found', 404 );
		}
		if ( FS_Acc2_Rules::is_locked( $row['source'], $row['cycle'], FS_Acc2_Rules::cycle() ) ) {
			return self::err( 'locked', 403 );
		}
		'sub' === $row['source'] ? FS_Acc2_Repo::delete_domain( (int) $row['id'] ) : FS_Acc2_Repo::mark_removed( (int) $row['id'] );
		return rest_ensure_response( array( 'removed' => true, 'quota' => self::quota_for( $uid ) ) );
	}

	public static function certificate( WP_REST_Request $req ) {
		$uid = get_current_user_id();
		$row = FS_Acc2_Repo::get_domain( $uid, (int) $req['id'] );
		if ( ! $row ) {
			return self::err( 'not_found', 404 );
		}
		$lic   = $row['licence_id'] ? FS_Acc2_Repo::get_licence( $uid, (int) $row['licence_id'] ) : null;
		$valid = 'lic' === $row['source'] || null !== self::user_plan( $uid );
		FS_Acc2_Certificates::send( $row, $lic, wp_get_current_user(), $valid, 'html' === $req['format'] ? 'html' : 'pdf' );
		exit;
	}

	public static function addon( WP_REST_Request $req ) {
		$uid  = get_current_user_id();
		$kind = 'lic' === $req['kind'] ? 'lic' : 'sub';
		if ( 'sub' === $kind && 'web' !== self::user_plan( $uid ) ) {
			return self::err( 'no_plan', 403 );
		}
		$lid = 0;
		if ( 'lic' === $kind ) {
			$lic = FS_Acc2_Repo::get_licence( $uid, (int) $req['licence_id'] );
			if ( ! $lic || false === strpos( $lic['type'], 'web' ) ) {
				return self::err( 'licence_not_found', 404 );
			}
			$lid = (int) $lic['id'];
		}
		$url = FS_Acc2_Addon::checkout_url( $uid, $kind, $lid );
		return is_wp_error( $url ) ? $url : rest_ensure_response( array( 'checkout_url' => $url ) );
	}
}
