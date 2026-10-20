<?php
/**
 * Pure business rules (no WordPress calls) so they can be unit-tested with plain PHP.
 * Mirrors the prototype: cleanHost(), siteName(), canEdit(), quota of 3/month on Webstop.
 */
defined( 'ABSPATH' ) || defined( 'FS_ACC2_TESTING' ) || exit;

final class FS_Acc2_Rules {
	const TZ                 = 'Asia/Jerusalem';
	const WEB_MONTHLY_QUOTA  = 3;   // Webstop: domains per calendar month (spec §1.1, Q1 default)
	const LICENCE_SITE_LIMIT = 3;   // purchased web licence: sites per licence
	const MAX_FONTS          = 2;   // fonts per subscription domain
	const ADDON_PRICE        = 79;  // ₪, VAT-inclusive (spec Q2 default)

	/** "https://www.Studio-Dayan.co.il:443/about?x" -> "studio-dayan.co.il"; null when invalid. */
	public static function normalize_host( string $raw ): ?string {
		$h = strtolower( trim( $raw ) );
		$h = preg_replace( '#^[a-z][a-z0-9+.-]*://#', '', $h );
		$h = preg_split( '#[/?\#]#', $h )[0];
		$h = preg_replace( '#:\d+$#', '', $h );
		$h = preg_replace( '#^www\.#', '', $h );
		$h = rtrim( $h, '.' );
		if ( '' === $h ) {
			return null;
		}
		if ( preg_match( '/[^\x20-\x7e]/', $h ) ) {
			if ( ! function_exists( 'idn_to_ascii' ) ) {
				return null;
			}
			$h = idn_to_ascii( $h, IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46 );
			if ( false === $h ) {
				return null;
			}
		}
		if ( strlen( $h ) > 253 || ! preg_match( '/^[a-z0-9-]+(\.[a-z0-9-]+)+$/', $h ) ) {
			return null;
		}
		foreach ( explode( '.', $h ) as $label ) {
			if ( strlen( $label ) > 63 || '-' === $label[0] || '-' === substr( $label, -1 ) ) {
				return null;
			}
		}
		return $h;
	}

	/** "studio-dayan.co.il" -> "Studio Dayan" (same as prototype siteName). */
	public static function site_name( string $host ): string {
		$parts = explode( '.', $host );
		$i     = count( $parts ) - 2;
		if ( $i > 0 && in_array( $parts[ $i ], array( 'co', 'org', 'net', 'ac', 'gov', 'muni' ), true ) ) {
			$i--;
		}
		$sld = $parts[ max( $i, 0 ) ] ?? $host;
		return implode( ' ', array_map( 'ucfirst', explode( '-', $sld ) ) );
	}

	/** Registration cycle = calendar month in Israel time, as 'YYYY-MM'. */
	public static function cycle( ?DateTimeInterface $now = null ): string {
		$now = $now ? DateTimeImmutable::createFromInterface( $now ) : new DateTimeImmutable( 'now' );
		return $now->setTimezone( new DateTimeZone( self::TZ ) )->format( 'Y-m' );
	}

	/** First moment of the cycle after $cycle (when the quota resets). */
	public static function next_cycle_start( string $cycle ): DateTimeImmutable {
		return ( new DateTimeImmutable( $cycle . '-01 00:00:00', new DateTimeZone( self::TZ ) ) )->modify( '+1 month' );
	}

	/** Subscription domains lock once their cycle is over; purchased-licence sites never lock. */
	public static function is_locked( string $source, string $row_cycle, string $current_cycle ): bool {
		return 'sub' === $source && strcmp( $row_cycle, $current_cycle ) < 0;
	}

	/**
	 * Quota for a subscription plan.
	 * @return array{allowed:bool,unlimited:bool,limit:int,used:int,left:int}
	 */
	public static function quota( ?string $plan, int $used, int $bonus ): array {
		if ( 'extra' === $plan ) {
			return array( 'allowed' => true, 'unlimited' => true, 'limit' => 0, 'used' => $used, 'left' => PHP_INT_MAX );
		}
		if ( 'web' !== $plan ) {
			return array( 'allowed' => false, 'unlimited' => false, 'limit' => 0, 'used' => $used, 'left' => 0 );
		}
		$limit = self::WEB_MONTHLY_QUOTA + max( 0, $bonus );
		return array( 'allowed' => true, 'unlimited' => false, 'limit' => $limit, 'used' => $used, 'left' => max( 0, $limit - $used ) );
	}

	/**
	 * Default guess for a WooCommerce order line, from its name as shown in "הזמנות"
	 * ("וובסטופ · חידוש חודשי", "תניא · וובפונט", "דיסקברי · דסקטופ", "דומיין נוסף").
	 * Only a starting point for the migration dry-run: override with the fs_acc2_classify_item filter.
	 * @return array{kind:?string,plan:?string,font:string,type:string}
	 */
	public static function classify_item_name( string $name ): array {
		$parts = array_map( 'trim', preg_split( '/\s*[·|–]\s*/u', $name, 2 ) );
		$head  = $parts[0];
		$tail  = $parts[1] ?? '';
		foreach ( array( 'וובסטופ' => 'web', 'webstop' => 'web', 'אקסטרה' => 'extra', 'extra' => 'extra' ) as $needle => $plan ) {
			if ( false !== mb_stripos( $head, $needle ) ) {
				return array( 'kind' => 'subscription', 'plan' => $plan, 'font' => '', 'type' => '' );
			}
		}
		if ( false !== mb_strpos( $name, 'דומיין נוסף' ) ) {
			return array( 'kind' => 'addon', 'plan' => null, 'font' => '', 'type' => '' );
		}
		$web  = false !== mb_strpos( $tail, 'וובפונט' ) || false !== mb_stripos( $tail, 'web' );
		$desk = false !== mb_strpos( $tail, 'דסקטופ' ) || false !== mb_stripos( $tail, 'desktop' );
		if ( $web || $desk ) {
			return array( 'kind' => 'licence', 'plan' => null, 'font' => $head, 'type' => $web && $desk ? 'וובפונט + דסקטופ' : ( $web ? 'וובפונט' : 'דסקטופ' ) );
		}
		return array( 'kind' => null, 'plan' => null, 'font' => '', 'type' => '' );
	}

	/**
	 * Clean a font list for a subscription domain.
	 * @return array{0:?array,1:?string} [fonts, error_code]
	 */
	public static function clean_fonts( $fonts ): array {
		if ( ! is_array( $fonts ) ) {
			return array( null, 'fonts_required' );
		}
		$out = array();
		foreach ( $fonts as $f ) {
			$f = trim( (string) $f );
			if ( '' !== $f && mb_strlen( $f ) <= 80 && ! in_array( $f, $out, true ) ) {
				$out[] = $f;
			}
		}
		if ( ! $out ) {
			return array( null, 'fonts_required' );
		}
		if ( count( $out ) > self::MAX_FONTS ) {
			return array( null, 'fonts_max_2' );
		}
		return array( $out, null );
	}
}
