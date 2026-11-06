import { BasesView, QueryController } from 'obsidian';
import { Box, justify } from '../layout/justify';
import { mosaic } from '../layout/mosaic';
import { MediaSource, resolveEntryMedia } from '../media/resolve';
import { GalleryConfig, parseSize, readGalleryConfig } from './options';
import { Tile } from './tile';

export const GALLERY_VIEW_TYPE = 'gallery';

/** Ratio used for media whose size isn't known yet, until some are. */
const FALLBACK_RATIO = 3 / 2;
/** Rows kept mounted above and below the visible area, in viewport heights. */
const BUFFER_ABOVE = 1;
const BUFFER_BELOW = 2;

interface Item {
	key: string;
	media: MediaSource;
	/** 0 small, 1 medium, 2 large. */
	size: number;
}

interface PlacedLayout {
	boxes: Box[];
	/** Item indices sorted by top edge, for finding visible tiles. */
	order: number[];
	/** Tallest tile, so a search can start early enough. */
	maxHeight: number;
	height: number;
}

export class GalleryView extends BasesView {
	readonly type = GALLERY_VIEW_TYPE;

	private readonly rootEl: HTMLElement;
	private readonly sizerEl: HTMLElement;
	private readonly emptyEl: HTMLElement;

	private items: Item[] = [];
	private settings: GalleryConfig | null = null;
	private layout: PlacedLayout | null = null;
	private layoutWidth = 0;
	private gap = 0;

	/** Known aspect ratios by media URL. */
	private readonly ratios = new Map<string, number>();
	/** Mounted tiles by item key. */
	private readonly mounted = new Map<string, Tile>();
	private readonly pool: Tile[] = [];
	private scrollers: HTMLElement[] = [];

	private frame = 0;
	private needsLayout = false;
	private unbindScroll: (() => void) | null = null;

	constructor(controller: QueryController, scrollEl: HTMLElement) {
		super(controller);
		this.rootEl = scrollEl.createDiv('bases-gallery');
		this.sizerEl = this.rootEl.createDiv('bases-gallery-sizer');
		this.emptyEl = this.rootEl.createDiv('bases-gallery-empty');
		this.emptyEl.hide();
	}

	onload(): void {
		const resizeObserver = new ResizeObserver(() => {
			if (this.sizerEl.clientWidth !== this.layoutWidth) {
				this.requestUpdate(true);
			}
		});
		resizeObserver.observe(this.sizerEl);
		this.register(() => resizeObserver.disconnect());

		this.registerEvent(
			this.app.workspace.on('css-change', () => this.requestUpdate(true)),
		);

		this.bindScroll();
		this.register(this.rootEl.onWindowMigrated(() => this.bindScroll()));
		this.register(this.rootEl.onNodeInserted(() => this.bindScroll()));
	}

	onunload(): void {
		this.unbindScroll?.();
		this.unbindScroll = null;
		if (this.frame) this.rootEl.win.cancelAnimationFrame(this.frame);
		for (const tile of this.mounted.values()) tile.release();
		this.mounted.clear();
		this.pool.length = 0;
	}

	onDataUpdated(): void {
		const settings = readGalleryConfig(this.config);
		const items: Item[] = [];
		for (const entry of this.data.data) {
			const media = resolveEntryMedia(this.app, entry, settings.mediaProperty);
			if (!media) continue;
			let size = 1;
			if (settings.sizeProperty) {
				const value = entry.getValue(settings.sizeProperty);
				if (value?.isTruthy()) size = parseSize(value.toString());
			}
			items.push({ key: `${entry.file.path}\n${media.src}`, media, size });
		}
		this.settings = settings;
		this.items = items;
		this.updateEmptyState(settings);
		this.requestUpdate(true);
	}

	private updateEmptyState(settings: GalleryConfig): void {
		if (this.items.length > 0) {
			this.emptyEl.hide();
			return;
		}
		this.emptyEl.setText(
			settings.mediaProperty
				? 'No images or videos found in this property.'
				: 'Choose a media property in the view options, or filter this base to image and video files.',
		);
		this.emptyEl.show();
	}

	/** Coalesces all work into one animation frame. */
	private requestUpdate(relayout: boolean): void {
		if (relayout) this.needsLayout = true;
		if (this.frame) return;
		this.frame = this.rootEl.win.requestAnimationFrame(() => {
			this.frame = 0;
			if (this.needsLayout) {
				this.needsLayout = false;
				this.relayout();
			}
			this.renderVisible();
		});
	}

	private relayout(): void {
		const { settings } = this;
		if (!settings) return;
		const anchor = this.captureAnchor();

		this.layoutWidth = this.sizerEl.clientWidth;
		this.gap = parseFloat(getComputedStyle(this.sizerEl).rowGap) || 0;
		const fallback = this.typicalRatio();
		const ratios = this.items.map(
			(item) => this.ratios.get(item.media.src) ?? fallback,
		);
		const boxes =
			settings.layout === 'rows'
				? justify(ratios, {
						width: this.layoutWidth,
						targetHeight: settings.tileSize,
						gap: this.gap,
						maxCropPerSide: settings.maxCropPerSide,
					}).boxes
				: mosaic(
						this.items.map((item, i) => ({
							ratio: ratios[i] ?? fallback,
							size: item.size,
						})),
						{
							width: this.layoutWidth,
							tileSize: settings.tileSize,
							gap: this.gap,
							maxCropPerSide: settings.maxCropPerSide,
						},
					).boxes;
		this.layout = placed(boxes);
		this.sizerEl.setCssProps({
			'--bases-gallery-height': `${this.layout.height}px`,
		});
		this.restoreAnchor(anchor);
	}

	/** Mounts tiles for rows near the viewport and recycles the rest. */
	private renderVisible(): void {
		const { layout } = this;
		if (!layout || !this.rootEl.isShown()) return;

		const view = this.visibleRange();
		const span = view.bottom - view.top;
		const top = view.top - span * BUFFER_ABOVE;
		const bottom = view.bottom + span * BUFFER_BELOW;

		const wanted = new Set<string>();
		const { boxes, order } = layout;
		for (
			let k = firstAtOrBelow(layout, top - layout.maxHeight);
			k < order.length;
			k++
		) {
			const i = order[k] ?? 0;
			const box = boxes[i];
			const item = this.items[i];
			if (!box || !item) continue;
			if (box.y > bottom) break;
			if (box.y + box.height < top) continue;
			wanted.add(item.key);
			let tile = this.mounted.get(item.key);
			if (!tile) {
				tile = this.takeTile();
				this.mounted.set(item.key, tile);
			}
			tile.place(box);
			tile.show(item.media);
		}

		for (const [key, tile] of this.mounted) {
			if (wanted.has(key)) continue;
			this.mounted.delete(key);
			tile.release();
			this.pool.push(tile);
		}
	}

	private takeTile(): Tile {
		const tile =
			this.pool.pop() ??
			new Tile(this.sizerEl, (src, ratio) => this.onRatio(src, ratio));
		if (!tile.el.parentElement) this.sizerEl.appendChild(tile.el);
		return tile;
	}

	private onRatio(src: string, ratio: number): void {
		const known = this.ratios.get(src);
		this.ratios.set(src, ratio);
		const used = known ?? this.typicalRatio();
		if (Math.abs(used - ratio) > 0.001) this.requestUpdate(true);
	}

	private typicalRatio(): number {
		if (this.ratios.size === 0) return FALLBACK_RATIO;
		const values = [...this.ratios.values()].sort((a, b) => a - b);
		return values[values.length >> 1] ?? FALLBACK_RATIO;
	}

	/** The part of the sizer inside the viewport and every scrolling ancestor, in sizer px. */
	private visibleRange(): { top: number; bottom: number } {
		const rect = this.sizerEl.getBoundingClientRect();
		let top = 0;
		let bottom = this.rootEl.win.innerHeight;
		for (const scroller of this.scrollers) {
			const r = scroller.getBoundingClientRect();
			top = Math.max(top, r.top);
			bottom = Math.min(bottom, r.bottom);
		}
		return { top: top - rect.top, bottom: bottom - rect.top };
	}

	/** Remembers where the first visible tile sits so a relayout can keep it still. */
	private captureAnchor(): { key: string; offset: number } | null {
		const { layout } = this;
		if (!layout || !this.scrollers[0]) return null;
		const view = this.visibleRange();
		for (let k = firstAtOrBelow(layout, view.top); k < layout.order.length; k++) {
			const i = layout.order[k] ?? 0;
			const box = layout.boxes[i];
			const item = this.items[i];
			if (box && item) return { key: item.key, offset: box.y - view.top };
		}
		return null;
	}

	private restoreAnchor(anchor: { key: string; offset: number } | null): void {
		const { layout } = this;
		const scroller = this.scrollers[0];
		if (!anchor || !layout || !scroller) return;
		const index = this.items.findIndex((item) => item.key === anchor.key);
		const box = layout.boxes[index];
		if (!box) return;
		const view = this.visibleRange();
		const delta = box.y - view.top - anchor.offset;
		if (Math.abs(delta) >= 1) scroller.scrollTop += delta;
	}

	private bindScroll(): void {
		this.unbindScroll?.();
		this.unbindScroll = null;
		if (!this.rootEl.isConnected) return;

		const win = this.rootEl.win;
		this.scrollers = scrollingAncestors(this.rootEl);
		const onScroll = (evt: Event): void => {
			const target = evt.target;
			if (target instanceof Node && target.contains(this.rootEl)) {
				this.requestUpdate(false);
			}
		};
		win.addEventListener('scroll', onScroll, { capture: true, passive: true });
		this.unbindScroll = () =>
			win.removeEventListener('scroll', onScroll, { capture: true });
		this.requestUpdate(true);
	}
}

function placed(boxes: Box[]): PlacedLayout {
	const order = boxes.map((_, i) => i);
	order.sort((a, b) => (boxes[a]?.y ?? 0) - (boxes[b]?.y ?? 0));
	let maxHeight = 0;
	let height = 0;
	for (const box of boxes) {
		if (!box) continue;
		maxHeight = Math.max(maxHeight, box.height);
		height = Math.max(height, box.y + box.height);
	}
	return { boxes, order, maxHeight, height };
}

/** Position in `order` of the first tile whose top edge is at or below `y` (binary search). */
function firstAtOrBelow(layout: PlacedLayout, y: number): number {
	const { order, boxes } = layout;
	let lo = 0;
	let hi = order.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		const top = boxes[order[mid] ?? 0]?.y ?? 0;
		if (top < y) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function scrollingAncestors(el: HTMLElement): HTMLElement[] {
	const out: HTMLElement[] = [];
	for (
		let node = el.parentElement;
		node && node !== el.doc.body;
		node = node.parentElement
	) {
		const { overflowY } = getComputedStyle(node);
		if (overflowY === 'auto' || overflowY === 'scroll') out.push(node);
	}
	return out;
}
