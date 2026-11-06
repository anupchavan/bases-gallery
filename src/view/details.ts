import { App, BasesEntry, BasesViewConfig, NullValue } from 'obsidian';

/**
 * Renders an entry's visible properties (the view's **Properties** list) the
 * way the Cards view does: the first one as the title, the rest as a muted
 * label over the value. Values draw themselves through Bases' own
 * `Value.renderTo`, so links, tags, lists and dates look as they do in
 * cards. Returns false when the view shows no properties.
 */
export function renderDetails(app: App, config: BasesViewConfig, entry: BasesEntry, el: HTMLElement): boolean {
	const order = config.getOrder();
	order.forEach((propertyId, i) => {
		const row = el.createDiv(i === 0 ? 'bases-gallery-detail is-title' : 'bases-gallery-detail');
		if (i > 0) row.createDiv({ cls: 'bases-gallery-detail-label', text: config.getDisplayName(propertyId) });
		const line = row.createDiv('bases-gallery-detail-value');
		const value = entry.getValue(propertyId);
		if (value && !(value instanceof NullValue)) value.renderTo(line, app.renderContext);
	});
	return order.length > 0;
}
