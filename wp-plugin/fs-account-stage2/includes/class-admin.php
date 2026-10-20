<?php
/**
 * Support screen (spec Q7: yes). WooCommerce → "דומיינים של לקוחות".
 * Find a customer by email, see all their domains (locked ones included), edit, remove, or add a one-off quota slot.
 * Every change is written to the fs_log table with before/after values.
 */
defined( 'ABSPATH' ) || exit;

final class FS_Acc2_Admin {
	const CAP  = 'manage_woocommerce';
	const SLUG = 'fs-acc2-domains';

	public static function init(): void {
		add_action( 'admin_menu', function () {
			add_submenu_page( 'woocommerce', 'דומיינים של לקוחות', 'דומיינים של לקוחות', self::CAP, self::SLUG, array( __CLASS__, 'page' ) );
		}, 60 );
		add_action( 'admin_post_fs_acc2_admin', array( __CLASS__, 'handle' ) );
		add_action( 'admin_post_fs_acc2_settings', array( __CLASS__, 'save_settings' ) );
	}

	private static function log( int $user_id, ?int $domain_id, string $action, $before, $after ): void {
		global $wpdb;
		$wpdb->insert( FS_Acc2_Schema::table( 'log' ), array(
			'admin_id'   => get_current_user_id(),
			'user_id'    => $user_id,
			'domain_id'  => $domain_id,
			'action'     => $action,
			'before_val' => $before ? wp_json_encode( $before, JSON_UNESCAPED_UNICODE ) : null,
			'after_val'  => $after ? wp_json_encode( $after, JSON_UNESCAPED_UNICODE ) : null,
			'created_at' => current_time( 'mysql', true ),
		) );
	}

	private static function back( int $uid, string $msg ): void {
		wp_safe_redirect( add_query_arg( array( 'page' => self::SLUG, 'u' => $uid, 'msg' => rawurlencode( $msg ) ), admin_url( 'admin.php' ) ) );
		exit;
	}

	/** One handler for all actions: edit | remove | bonus. */
	public static function handle(): void {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( 'אין הרשאה', 403 );
		}
		check_admin_referer( 'fs_acc2_admin' );
		$uid = absint( $_POST['u'] ?? 0 );
		$op  = sanitize_key( $_POST['op'] ?? '' );
		$did = absint( $_POST['d'] ?? 0 );

		if ( 'bonus' === $op ) {
			global $wpdb;
			$cycle = FS_Acc2_Rules::cycle();
			// manual grant: no order, so order_id stays NULL (UNIQUE allows many NULLs)
			$wpdb->insert( FS_Acc2_Schema::table( 'quota_bonus' ), array( 'user_id' => $uid, 'cycle' => $cycle, 'qty' => 1 ) );
			self::log( $uid, null, 'bonus', null, array( 'cycle' => $cycle, 'qty' => 1, 'reason' => sanitize_text_field( wp_unslash( $_POST['reason'] ?? '' ) ) ) );
			self::back( $uid, 'נוסף דומיין אחד למכסת החודש' );
		}

		$row = FS_Acc2_Repo::get_domain( $uid, $did );
		if ( ! $row ) {
			self::back( $uid, 'הדומיין לא נמצא' );
		}
		if ( 'remove' === $op ) {
			'sub' === $row['source'] ? FS_Acc2_Repo::delete_domain( $did ) : FS_Acc2_Repo::mark_removed( $did );
			self::log( $uid, $did, 'remove', $row, null );
			self::back( $uid, 'הדומיין הוסר' );
		}
		if ( 'edit' === $op ) {
			$host = FS_Acc2_Rules::normalize_host( wp_unslash( (string) ( $_POST['host'] ?? '' ) ) );
			if ( ! $host ) {
				self::back( $uid, 'כתובת לא תקינה' );
			}
			if ( FS_Acc2_Repo::host_taken( $uid, $host, $row['source'], $row['cycle'], $row['licence_id'] ? (int) $row['licence_id'] : null, $did ) ) {
				self::back( $uid, 'הכתובת כבר רשומה אצל הלקוח' );
			}
			$name = mb_substr( sanitize_text_field( wp_unslash( $_POST['site_name'] ?? '' ) ) ?: FS_Acc2_Rules::site_name( $host ), 0, 120 );
			FS_Acc2_Repo::update_domain( $did, array( 'host' => $host, 'site_name' => $name ) );
			self::log( $uid, $did, 'edit', array( 'host' => $row['host'], 'site_name' => $row['site_name'] ), array( 'host' => $host, 'site_name' => $name ) );
			self::back( $uid, 'הדומיין עודכן' );
		}
		self::back( $uid, 'פעולה לא מוכרת' );
	}

	/** Settings form, so setup needs no WP-CLI (Stage 2 README, install steps 2–4 and migration step 1). */
	public static function save_settings(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'אין הרשאה', 403 );
		}
		check_admin_referer( 'fs_acc2_settings' );
		$map = array();
		foreach ( preg_split( '/\R/', wp_unslash( (string) ( $_POST['role_map'] ?? '' ) ) ) as $line ) {
			$kv = array_map( 'trim', explode( '=', $line, 2 ) );
			if ( 2 === count( $kv ) && '' !== $kv[0] && in_array( $kv[1], array( 'web', 'extra' ), true ) ) {
				$map[ sanitize_key( $kv[0] ) ] = $kv[1];
			}
		}
		update_option( 'fs_acc2_role_map', $map, false );
		update_option( 'fs_acc2_enabled', 'all' === ( $_POST['enabled'] ?? '' ) ? 'all' : 'admins', false );
		update_option( 'fs_acc2_addon_product_id', absint( $_POST['addon_product_id'] ?? 0 ), false );
		$keys = array_values( array_filter( array_map( 'sanitize_text_field', array_map( 'trim', explode( ',', wp_unslash( (string) ( $_POST['domain_meta_keys'] ?? '' ) ) ) ) ) ) );
		update_option( 'fs_acc2_domain_meta_keys', $keys, false );
		// the certificate sequence can only be moved while no certificate has been issued yet
		global $wpdb;
		$start = absint( $_POST['cert_start'] ?? 0 );
		if ( $start && ! (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . FS_Acc2_Schema::table( 'domains' ) ) ) {
			update_option( 'fs_acc2_cert_start', $start, false );
			update_option( 'fs_acc2_cert_seq', (string) $start, false );
		}
		wp_safe_redirect( add_query_arg( array( 'page' => self::SLUG, 'tab' => 'settings', 'msg' => rawurlencode( 'ההגדרות נשמרו' ) ), admin_url( 'admin.php' ) ) );
		exit;
	}

	private static function settings_page(): void {
		global $wpdb;
		$map    = (array) get_option( 'fs_acc2_role_map', array() );
		$lines  = implode( "\n", array_map( fn( $r, $p ) => "$r=$p", array_keys( $map ), $map ) );
		$roles  = implode( ', ', array_keys( wp_roles()->get_names() ) );
		$issued = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . FS_Acc2_Schema::table( 'domains' ) );
		$pid    = (int) get_option( 'fs_acc2_addon_product_id' );
		$prod   = $pid && function_exists( 'wc_get_product' ) ? wc_get_product( $pid ) : null;
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '"><input type="hidden" name="action" value="fs_acc2_settings">' . wp_nonce_field( 'fs_acc2_settings', '_wpnonce', true, false );
		echo '<table class="form-table" role="presentation">';
		echo '<tr><th>מי רואה את שלב 2</th><td><select name="enabled"><option value="admins">מנהלים בלבד</option><option value="all"' . selected( get_option( 'fs_acc2_enabled', 'admins' ), 'all', false ) . '>כל הלקוחות</option></select></td></tr>';
		echo '<tr><th>תפקידי מינוי</th><td><textarea name="role_map" rows="4" dir="ltr" style="width:320px" placeholder="role_slug=web">' . esc_textarea( $lines ) . '</textarea><p class="description">שורה לכל תפקיד: <code>role=web</code> (וובסטופ) או <code>role=extra</code> (אקסטרה). תפקידים באתר: <code dir="ltr">' . esc_html( $roles ) . '</code></p></td></tr>';
		echo '<tr><th>מוצר ״דומיין נוסף״ (₪79)</th><td><input type="number" name="addon_product_id" value="' . esc_attr( $pid ?: '' ) . '"> ' . ( $prod ? esc_html( $prod->get_name() . ' · ₪' . $prod->get_price() ) : ( $pid ? '<b style="color:#b00">מוצר לא נמצא</b>' : '' ) ) . '</td></tr>';
		echo '<tr><th>שדות הדומיין בקופה</th><td><input name="domain_meta_keys" dir="ltr" style="width:320px" value="' . esc_attr( implode( ', ', (array) get_option( 'fs_acc2_domain_meta_keys', array() ) ) ) . '"><p class="description">מפתחות ה־meta שבהם נשמרים הדומיינים בהזמנה (מופרדים בפסיק). נדרש להעברת הנתונים.</p></td></tr>';
		echo '<tr><th>מספר תעודה ראשון</th><td>' . ( $issued ? 'כבר הונפקו תעודות; המספור הבא: ' . (int) get_option( 'fs_acc2_cert_seq' ) : '<input type="number" name="cert_start" value="' . esc_attr( (string) get_option( 'fs_acc2_cert_start', 640000 ) ) . '"><p class="description">גבוה מהמספר האחרון שהונפק בתעודות הקיימות.</p>' ) . '</td></tr>';
		echo '</table>';
		submit_button( 'שמירת הגדרות' );
		echo '</form>';
	}

	public static function page(): void {
		if ( ! current_user_can( self::CAP ) ) {
			return;
		}
		$q    = sanitize_text_field( wp_unslash( $_GET['q'] ?? '' ) );
		$uid  = absint( $_GET['u'] ?? 0 );
		$user = $uid ? get_userdata( $uid ) : ( $q ? ( get_user_by( 'email', $q ) ?: get_user_by( 'login', $q ) ) : null );
		$msg  = sanitize_text_field( wp_unslash( $_GET['msg'] ?? '' ) );
		$tab = sanitize_key( $_GET['tab'] ?? '' );
		echo '<div class="wrap" dir="rtl"><h1>דומיינים של לקוחות</h1>';
		$link = admin_url( 'admin.php?page=' . self::SLUG );
		echo '<nav class="nav-tab-wrapper"><a class="nav-tab' . ( 'settings' !== $tab ? ' nav-tab-active' : '' ) . '" href="' . esc_url( $link ) . '">לקוחות</a>'
			. ( current_user_can( 'manage_options' ) ? '<a class="nav-tab' . ( 'settings' === $tab ? ' nav-tab-active' : '' ) . '" href="' . esc_url( $link . '&tab=settings' ) . '">הגדרות</a>' : '' ) . '</nav>';
		if ( 'settings' === $tab && current_user_can( 'manage_options' ) ) {
			if ( ! empty( $_GET['msg'] ) ) {
				echo '<div class="notice notice-success"><p>' . esc_html( rawurldecode( sanitize_text_field( wp_unslash( $_GET['msg'] ) ) ) ) . '</p></div>';
			}
			self::settings_page();
			echo '</div>';
			return;
		}
		if ( $msg ) {
			echo '<div class="notice notice-success"><p>' . esc_html( rawurldecode( $msg ) ) . '</p></div>';
		}
		echo '<form method="get"><input type="hidden" name="page" value="' . esc_attr( self::SLUG ) . '"><input type="search" name="q" value="' . esc_attr( $q ) . '" placeholder="אימייל או שם משתמש" style="width:280px"> <button class="button">חיפוש</button></form>';
		if ( ! $user ) {
			echo $q ? '<p>לא נמצא לקוח.</p>' : '';
			echo '</div>';
			return;
		}
		$plan  = FS_Acc2_Rest::user_plan( $user->ID );
		$cycle = FS_Acc2_Rules::cycle();
		$quota = FS_Acc2_Rules::quota( $plan, FS_Acc2_Repo::count_active_sub( $user->ID, $cycle ), FS_Acc2_Repo::bonus( $user->ID, $cycle ) );
		$nonce = wp_nonce_field( 'fs_acc2_admin', '_wpnonce', true, false );
		$post  = esc_url( admin_url( 'admin-post.php' ) );
		$base  = '<input type="hidden" name="action" value="fs_acc2_admin"><input type="hidden" name="u" value="' . (int) $user->ID . '">' . $nonce;

		printf( '<h2>%s · %s</h2><p>מינוי: <b>%s</b> · החודש: %s</p>', esc_html( $user->display_name ), esc_html( $user->user_email ),
			esc_html( $plan ?: 'אין' ), $quota['unlimited'] ? 'ללא הגבלה' : esc_html( $quota['used'] . ' מתוך ' . $quota['limit'] ) );
		if ( 'web' === $plan ) {
			echo '<form method="post" action="' . $post . '" style="margin:8px 0 16px">' . $base . '<input type="hidden" name="op" value="bonus"><input name="reason" placeholder="סיבה (חובה לתיעוד)" required style="width:260px"> <button class="button">הוספת דומיין אחד לחודש הזה (ללא תשלום)</button></form>';
		}
		echo '<table class="widefat striped"><thead><tr><th>דומיין</th><th>שם האתר</th><th>דרך</th><th>חודש</th><th>מצב</th><th>מס׳ תעודה</th><th></th></tr></thead><tbody>';
		$rows = FS_Acc2_Repo::domains( $user->ID );
		foreach ( $rows as $r ) {
			$locked = FS_Acc2_Rules::is_locked( $r['source'], $r['cycle'], $cycle );
			echo '<tr><td colspan="7" style="padding:0"><form method="post" action="' . $post . '" style="display:flex;gap:8px;align-items:center;padding:8px">' . $base
				. '<input type="hidden" name="d" value="' . (int) $r['id'] . '">'
				. '<input name="host" value="' . esc_attr( $r['host'] ) . '" dir="ltr" style="width:200px">'
				. '<input name="site_name" value="' . esc_attr( $r['site_name'] ) . '" style="width:160px">'
				. '<span style="width:70px">' . ( 'sub' === $r['source'] ? 'מינוי' : 'רכישה' ) . '</span>'
				. '<span style="width:70px">' . esc_html( $r['cycle'] ) . '</span>'
				. '<span style="width:60px">' . ( $locked ? '🔒 נעול' : 'פתוח' ) . '</span>'
				. '<span style="width:70px">' . (int) $r['cert_no'] . '</span>'
				. '<button class="button" name="op" value="edit">שמירה</button>'
				. '<button class="button button-link-delete" name="op" value="remove" onclick="return confirm(\'להסיר את ' . esc_js( $r['host'] ) . '?\')">הסרה</button>'
				. '</form></td></tr>';
		}
		echo $rows ? '' : '<tr><td colspan="7">אין דומיינים.</td></tr>';
		echo '</tbody></table>';

		global $wpdb;
		$log = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . FS_Acc2_Schema::table( 'log' ) . ' WHERE user_id=%d ORDER BY id DESC LIMIT 30', $user->ID ), ARRAY_A );
		if ( $log ) {
			echo '<h3>יומן פעולות</h3><table class="widefat"><thead><tr><th>מתי</th><th>מי</th><th>פעולה</th><th>לפני</th><th>אחרי</th></tr></thead><tbody>';
			foreach ( $log as $l ) {
				$who = get_userdata( (int) $l['admin_id'] );
				printf( '<tr><td>%s</td><td>%s</td><td>%s</td><td dir="ltr">%s</td><td dir="ltr">%s</td></tr>', esc_html( get_date_from_gmt( $l['created_at'], 'd.m.Y H:i' ) ),
					esc_html( $who ? $who->display_name : '#' . $l['admin_id'] ), esc_html( $l['action'] ), esc_html( (string) $l['before_val'] ), esc_html( (string) $l['after_val'] ) );
			}
			echo '</tbody></table>';
		}
		echo '</div>';
	}
}
