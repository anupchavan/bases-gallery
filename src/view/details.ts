import { App, BasesEntry, BasesPropertyId, BasesViewConfig, Component, MarkdownRenderer, NullValue } from 'obsidian';
import { parseCoordinates } from '../util/format';

/** Obsidian Maps' zoom for a single place: a neighbourhood. */
const MAP_ZOOM = 13;
/** Height of the map in the panel, in px. Maps reads this from the view. */
const MAP_HEIGHT = 140;

export interface DetailsContent {
	/** Called once, the first time the panel shows. */
	onShown?: () => void;
}

/**
 * Renders an entry's visible properties (the view's **Properties** list) the
 * way the Cards view does: the first one as the title, the rest as a muted
 * label over the value. Values draw themselves through Bases' own
 * `Value.renderTo`, so links, tags, lists and dates look as they do in
 * cards.
 *
 * When the note has a location, a map follows, drawn by the Obsidian Maps
 * plugin through an embedded base. It is created only when the panel first
 * shows and is removed with `owner`. Without Maps, Bases itself shows that
 * the map view is unknown. Returns null when there is nothing to show.
 */
export function renderDetails(
	app: App,
	config: BasesViewConfig,
	entry: BasesEntry,
	locationProperty: BasesPropertyId,
	el: HTMLElement,
	owner: Component,
): DetailsContent | null {
	const order = config.getOrder();
	order.forEach((propertyId, i) => {
		const row = el.createDiv(i === 0 ? 'media-manager-detail is-title' : 'media-manager-detail');
		if (i > 0) row.createDiv({ cls: 'media-manager-detail-label', text: config.getDisplayName(propertyId) });
		const line = row.createDiv('media-manager-detail-value');
		const value = entry.getValue(propertyId);
		if (value && !(value instanceof NullValue)) value.renderTo(line, app.renderContext);
	});

	const location = entry.getValue(locationProperty);
	const place = location && !(location instanceof NullValue) ? parseCoordinates(location.toString()) : null;
	if (!place) return order.length > 0 ? {} : null;

	// The slot has its final height from the start, so the panel doesn't
	// jump while Maps lays out (it first draws at its default height).
	const mapEl = el.createDiv('media-manager-detail-map');
	mapEl.setCssProps({ '--media-manager-map-height': `${MAP_HEIGHT}px` });
	return {
		onShown: () => {
			const source = mapBase(entry.file.path, locationProperty);
			void MarkdownRenderer.render(app, source, mapEl, entry.file.path, owner.addChild(new Component()));
		},
	};
}

/** A base showing just this note on an Obsidian Maps map. */
function mapBase(path: string, locationProperty: BasesPropertyId): string {
	// The filter is a Bases expression inside a YAML string.
	const filter = `file.path == ${JSON.stringify(path)}`;
	return [
		'```base',
		'filters:',
		'  and:',
		`    - ${JSON.stringify(filter)}`,
		'views:',
		'  - type: map',
		'    name: Location',
		// No properties: the marker's popup would repeat the note's name.
		'    order: []',
		`    coordinates: ${locationProperty}`,
		`    defaultZoom: ${MAP_ZOOM}`,
		`    mapHeight: ${MAP_HEIGHT}`,
		'```',
	].join('\n');
}
