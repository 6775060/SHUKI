// FS · גלריה  (Code Snippets: run everywhere)
// The public gallery of sites built with FontShok fonts, and its item in the site menu. Separate from the personal area:
// it only reads the list the owner approves in Admin → בסטודיו → גלריה, and the site cards, from the snippet "FS · אזור אישי v2".
// Turning this snippet off removes the gallery page content and the menu item; nothing else changes.
define( 'FSG_BUILD', '1' );

// public gallery page: shortcode [fontshok_gallery] on a normal page (גלריה, in the site menu). Shows the approved list (בסטודיו → גלריה),
// newest first, with a filter by font. Light: plain HTML from the server, kept ready (transient) until the list or a picture changes,
// lazy pictures from the site itself, the style only on this page and ~10 lines of script for the filter
function fsa_v2_gallery_html() {
	if ( ! function_exists( 'fsa_v2_showcase_public' ) ) return ''; // needs "FS · אזור אישי v2"
	$html = get_transient( 'fsa_v2_gallery' );
	if ( is_string( $html ) && '' !== $html ) return $html;
	$list = array_reverse( fsa_v2_showcase_public() ); $count = array();
	foreach ( $list as $x ) foreach ( $x['fonts'] as $f ) $count[ $f ] = ( $count[ $f ] ?? 0 ) + 1;
	arsort( $count );
	$html = '<div class="fsa-sites fsa-gal" dir="rtl"><style>' . fsa_v2_sites_css() . '.fsa-gal{padding-top:10px}.fsa-gal .lede{font-size:19px;margin:-8px 0 22px;max-width:640px}.fsa-gal .fl{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 30px}.fsa-gal .fl button{font:inherit;font-size:16px;background:#fff;color:#151515;border:1.5px solid #151515;border-radius:99px;padding:5px 15px;cursor:pointer}.fsa-gal .fl button[aria-pressed=true]{background:#151515;color:#fff}.fsa-gal .fl small{opacity:.6;margin-inline-start:4px}.fsa-gal .sc[hidden]{display:none}.fsa-gal .none{font-size:19px;color:#6E6E6E}</style>'
		. '<span class="eb">הפונטים בפעולה</span><h1>אתרים שנבנו עם פונטשוק</h1>';
	if ( ! $list ) $html .= '<p class="none">הגלריה נבנית עכשיו. אתרים, כמו קרנינג טוב, לוקחים זמן.</p>';
	else {
		$html .= '<p class="lede">עבודות של לקוחות פונטשוק, עם פונטים ברישיון מסודר. בחרו פונט כדי לראות איפה הוא עובד.</p>';
		if ( count( $count ) > 1 ) {
			$html .= '<div class="fl" role="group" aria-label="סינון לפי פונט"><button type="button" aria-pressed="true" data-f="">הכל<small>' . count( $list ) . '</small></button>';
			foreach ( $count as $f => $n ) $html .= '<button type="button" aria-pressed="false" data-f="' . esc_attr( $f ) . '">' . esc_html( $f ) . '<small>' . (int) $n . '</small></button>';
			$html .= '</div>';
		}
		$html .= '<div class="g">';
		foreach ( $list as $x ) $html .= fsa_v2_site_card_html( $x['name'], $x['host'], $x['fonts'], $x['year'], $x['img'], $x['by'] );
		$html .= '</div><script>(function(){var r=document.currentScript.parentNode,b=r.querySelectorAll(".fl button");'
			. 'b.forEach(function(x){x.onclick=function(){var f=x.getAttribute("data-f");b.forEach(function(y){y.setAttribute("aria-pressed",y===x)});'
			. 'r.querySelectorAll(".sc").forEach(function(c){c.hidden=!!f&&("|"+c.getAttribute("data-f")+"|").indexOf("|"+f+"|")<0})}})})();</script>';
	}
	$html .= '</div>';
	set_transient( 'fsa_v2_gallery', $html, 12 * HOUR_IN_SECONDS );
	return $html;
}
add_shortcode( 'fontshok_gallery', 'fsa_v2_gallery_html' );
foreach ( array( 'fsa_v2_showcase', 'fsa_v2_snaps' ) as $o ) foreach ( array( 'add_option_', 'update_option_' ) as $w ) add_action( $w . $o, function () { delete_transient( 'fsa_v2_gallery' ); } );
// header menu: "גלריה" right after "פונט־בלוג" in both mega-menus (desktop and phone) of the header template, added as the header renders; the saved header is not touched, and once the owner adds the item in Elementor this does nothing
define( 'FSA_V2_HEADER', 10689 );
add_filter( 'elementor/frontend/builder_content_data', 'fsa_v2_menu_gallery', 10, 2 );
function fsa_v2_menu_gallery( $data, $post_id ) {
	if ( FSA_V2_HEADER !== (int) $post_id || ! is_array( $data ) ) return $data;
	$walk = function ( &$els ) use ( &$walk ) {
		foreach ( $els as &$e ) {
			if ( ! is_array( $e ) ) continue;
			$items = $e['settings']['menu_items'] ?? null;
			if ( 'mega-menu' === ( $e['widgetType'] ?? '' ) && is_array( $items ) ) {
				$titles = array_map( function ( $m ) { return trim( (string) ( $m['item_title'] ?? '' ) ); }, $items );
				$i = array_search( 'פונט־בלוג', $titles, true );
				if ( false !== $i && ! in_array( 'גלריה', $titles, true ) && isset( $e['elements'][ $i ] ) ) {
					$m = $items[ $i ]; $m['item_title'] = 'גלריה'; $m['_id'] = substr( md5( $e['id'] . 'gal' ), 0, 7 );
					$m['item_link'] = array_merge( is_array( $m['item_link'] ?? null ) ? $m['item_link'] : array(), array( 'url' => home_url( '/gallery/' ), 'is_external' => '', 'nofollow' => '' ) );
					array_splice( $e['settings']['menu_items'], $i + 1, 0, array( $m ) );
					$c = $e['elements'][ $i ]; $c['id'] = substr( md5( $e['id'] . 'galc' ), 0, 7 ); $c['elements'] = array();
					array_splice( $e['elements'], $i + 1, 0, array( $c ) );
				}
			}
			if ( ! empty( $e['elements'] ) && is_array( $e['elements'] ) ) $walk( $e['elements'] );
		}
	};
	$walk( $data );
	return $data;
}
