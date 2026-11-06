import { BasesView, QueryController, TFile, debounce, getAllTags } from 'obsidian';
import type { Size } from '../media/dimensions';
import { NoteSignals, areaWeights, incomingLinkCounts, relatednessScores } from '../media/importance';
import { probeSize } from '../media/probe';
import { loadSizes, saveSizes } from '../media/size-cache';
import { Box, justify } from '../layout/justify';
import { mosaic } from '../layout/mosaic';
import { MediaSource, resolveEntryMedia } from '../media/resolve';
import { GalleryConfig, parseSizeWeight, readGalleryConfig } from './options';
import { Tile } from './tile';

export const GALLERY_VIEW_TYPE = 'gallery';

/** Ratio used for media whose size isn't known yet, until some are. */
const FALLBACK_RATIO = 3 / 2;
/** Rows kept mounted above and below the visible area, in viewport heights. */
const BUFFER_ABOVE = 1;
const BUFFER_BELOW = 2;
/** Media sizes read at the same time. */
const PROBE_CONCURRENCY = 6;
/** On a first visit, wait this long for the first screenful of sizes before drawing. */
const FIRST_PAINT_WAIT_MS = 250;
const FIRST_PAINT_ITEMS = 40;
/** A medium mosaic tile's edge, and a Rows row's height, per px of minimum tile size. */
const MEDIUM_TILE_PER_MIN = 2.2;
const ROW_HEIGHT_PER_MIN = 1.6;
/** Rows may crop up to this share per side to fill a row; the mosaic never crops. */
const ROWS_MAX_CROP = 0.1;
const MIN_TILE_PX = 60;
/** Tiles laid out per page; the next page loads as the user nears the end. */
const PAGE_SIZE = 120;
/** How close to the end (in viewport heights) the next page starts loading. */
const LOAD_AHEAD = 1.5;
/** Longest wait for a page's sizes before laying it out with estimates. */
const PAGE_WAIT_MS = 400;
/** A layout slower than this waits for window resizes to settle. */
const SLOW_LAYOUT_MS = 8;
const RESIZE_SETTLE_MS = 150;

interface Item {
	key: string;
	media: MediaSource;
	/** Area this tile aims for, as a multiple of a medium tile. */
	weight: number;
	file: TFile;
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
	private layoutPaneHeight = 0;
	private resizeObserver: ResizeObserver | null = null;
	private gap = 0;

	/** Known aspect ratios by media URL. */
	private readonly ratios = new Map<string, number>();
	/** Mounted tiles by item key. */
	private readonly mounted = new Map<string, Tile>();
	private readonly pool: Tile[] = [];
	private scrollers: HTMLElement[] = [];

	private cacheLoaded: Promise<void> | null = null;
	private readonly probing = new Set<string>();
	private probeQueue: Item[] = [];
	private activeProbes = 0;
	private pendingSaves: [string, Size][] = [];
	private readonly flushSaves = debounce(
		() => {
			const entries = this.pendingSaves;
			this.pendingSaves = [];
			void saveSizes(entries);
		},
		1000,
		false,
	);
	/** False until the first screenful of sizes is known (or the wait ran out). */
	private ready = false;
	private readyTimer = 0;

	private lastLayoutMs = 0;
	/** Items laid out so far (whole pages). */
	private loaded = 0;
	private loadingMore = false;
	private pageTimer = 0;
	private readonly loaderEl: HTMLElement;
	private readonly settleResize = debounce(() => this.requestUpdate(true), RESIZE_SETTLE_MS, true);

	private frame = 0;
	private needsLayout = false;
	private unbindScroll: (() => void) | null = null;

	constructor(controller: QueryController, scrollEl: HTMLElement) {
		super(controller);
		this.rootEl = scrollEl.createDiv('bases-gallery');
		this.sizerEl = this.rootEl.createDiv('bases-gallery-sizer');
		this.loaderEl = this.rootEl.createDiv({
			cls: 'bases-gallery-loader',
			attr: { role: 'status', 'aria-label': 'Loading more' },
		});
		this.loaderEl.hide();
		this.emptyEl = this.rootEl.createDiv('bases-gallery-empty');
		this.emptyEl.hide();
	}

	onload(): void {
		const resizeObserver = new ResizeObserver(() => {
			const paneHeight = this.scrollers[0]?.clientHeight ?? 0;
			if (this.sizerEl.clientWidth === this.layoutWidth && paneHeight === this.layoutPaneHeight) return;
			// Like Google Photos: when a full layout is expensive, wait for the
			// resize to settle instead of relaying out every frame.
			if (this.lastLayoutMs > SLOW_LAYOUT_MS) this.settleResize();
			else this.requestUpdate(true);
		});
		resizeObserver.observe(this.sizerEl);
		this.resizeObserver = resizeObserver;
		this.register(() => resizeObserver.disconnect());

		this.registerEvent(
			this.app.workspace.on('css-change', () => this.requestUpdate(true)),
		);
		// Links change as notes are edited; sizes follow, at most once a second.
		this.registerEvent(
			this.app.metadataCache.on('resolved', () => {
				if (this.settings?.sizeBy === 'related') this.refreshWeights();
			}),
		);

		this.bindScroll();
		this.register(this.rootEl.onWindowMigrated(() => this.bindScroll()));
		this.register(this.rootEl.onNodeInserted(() => this.bindScroll()));
	}

	onunload(): void {
		this.unbindScroll?.();
		this.unbindScroll = null;
		if (this.frame) this.rootEl.win.cancelAnimationFrame(this.frame);
		if (this.readyTimer) window.clearTimeout(this.readyTimer);
		if (this.pageTimer) window.clearTimeout(this.pageTimer);
		this.probeQueue = [];
		this.flushSaves.run();
		this.settleResize.cancel();
		this.refreshWeights.cancel();
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
			let weight = 1;
			if (settings.sizeBy === 'property' && settings.sizeProperty) {
				const value = entry.getValue(settings.sizeProperty);
				if (value?.isTruthy()) weight = parseSizeWeight(value.toString());
			}
			items.push({
				key: `${entry.file.path}\n${media.src}`,
				media,
				weight,
				file: entry.file,
			});
		}
		this.settings = settings;
		this.items = items;
		this.loaded = Math.min(items.length, Math.max(PAGE_SIZE, this.loaded));
		if (settings.sizeBy === 'related') this.applyRelatedWeights();
		this.updateEmptyState(settings);
		void this.ensureSizes();
	}

	private readonly refreshWeights = debounce(
		() => {
			if (this.applyRelatedWeights()) this.requestUpdate(true);
		},
		1000,
		true,
	);

	/**
	 * Weights tiles by how related their note is to the rest of the gallery,
	 * from Obsidian's link index and tag cache. One pass over links and tags.
	 * Returns true if any weight changed.
	 */
	private applyRelatedWeights(): boolean {
		const { metadataCache } = this.app;
		const resolved = metadataCache.resolvedLinks;
		const incoming = incomingLinkCounts(resolved);
		const signals: NoteSignals[] = this.items.map((item) => {
			const path = item.file.path;
			const targets = resolved[path] ?? {};
			const mediaPath = item.media.file?.path ?? null;
			const cache = metadataCache.getFileCache(item.file);
			const tags = cache ? [...new Set((getAllTags(cache) ?? []).map((t) => t.toLowerCase()))] : [];
			let backlinks = incoming.get(path) ?? 0;
			if (mediaPath && mediaPath !== path) {
				backlinks += Math.max(0, (incoming.get(mediaPath) ?? 0) - (targets[mediaPath] ? 1 : 0));
			}
			// The note's own media isn't a sign of relatedness.
			const links = Object.keys(targets).filter((t) => t !== mediaPath);
			return { path, links, tags, backlinks };
		});
		const weights = areaWeights(relatednessScores(signals));
		let changed = false;
		this.items.forEach((item, i) => {
			const weight = weights[i] ?? 1;
			if (item.weight !== weight) {
				item.weight = weight;
				changed = true;
			}
		});
		return changed;
	}

	/** Loads cached sizes once, then reads the sizes still missing, in display order. */
	private async ensureSizes(): Promise<void> {
		this.cacheLoaded ??= loadSizes().then((cached) => {
			for (const [src, size] of cached) {
				if (!this.ratios.has(src)) this.ratios.set(src, size.width / size.height);
			}
		});
		await this.cacheLoaded;

		this.queueProbes();
		if (!this.ready && this.firstScreenKnown()) this.ready = true;
		if (!this.ready && !this.readyTimer) {
			this.readyTimer = window.setTimeout(() => {
				this.readyTimer = 0;
				this.ready = true;
				this.requestUpdate(true);
			}, FIRST_PAINT_WAIT_MS);
		}
		this.pumpProbes();
		this.requestUpdate(true);
	}

	/** Reads sizes for laid-out tiles and the next page only, in display order. */
	private queueProbes(): void {
		const limit = Math.min(this.items.length, this.loaded + PAGE_SIZE);
		this.probeQueue = this.items
			.slice(0, limit)
			.filter((item) => !this.ratios.has(item.media.src) && !this.probing.has(item.media.src));
	}

	private pageKnown(from: number, to: number): boolean {
		for (let i = from; i < to; i++) {
			const item = this.items[i];
			if (item && !this.ratios.has(item.media.src)) return false;
		}
		return true;
	}

	/** Lays out the next page once its sizes are known (or the wait runs out). */
	private loadMore(): void {
		if (this.loadingMore || this.loaded >= this.items.length) return;
		this.loadingMore = true;
		const from = this.loaded;
		const to = Math.min(this.items.length, from + PAGE_SIZE);
		const finish = (): void => {
			if (this.pageTimer) window.clearTimeout(this.pageTimer);
			this.pageTimer = 0;
			this.pendingPage = null;
			this.loadingMore = false;
			this.loaderEl.hide();
			this.loaded = to;
			this.queueProbes();
			this.pumpProbes();
			this.requestUpdate(true);
		};
		if (this.pageKnown(from, to)) {
			finish();
			return;
		}
		this.loaderEl.show();
		this.pendingPage = { to, finish };
		this.pageTimer = window.setTimeout(finish, PAGE_WAIT_MS);
	}

	private pendingPage: { to: number; finish: () => void } | null = null;

	private firstScreenKnown(): boolean {
		const first = this.items.slice(0, FIRST_PAINT_ITEMS);
		return first.every((item) => this.ratios.has(item.media.src));
	}

	private pumpProbes(): void {
		while (this.activeProbes < PROBE_CONCURRENCY && this.probeQueue.length > 0) {
			const item = this.probeQueue.shift();
			if (!item || this.ratios.has(item.media.src) || this.probing.has(item.media.src)) continue;
			this.activeProbes++;
			this.probing.add(item.media.src);
			void probeSize(this.app, item.media).then((size) => {
				this.activeProbes--;
				this.probing.delete(item.media.src);
				if (size) {
					this.pendingSaves.push([item.media.src, size]);
					this.flushSaves();
					this.onRatio(item.media.src, size.width / size.height);
				}
				const page = this.pendingPage;
				if (page && this.pageKnown(this.loaded, page.to)) {
					this.pendingPage = null;
					page.finish();
				}
				if (!this.ready && this.firstScreenKnown()) {
					this.ready = true;
					if (this.readyTimer) window.clearTimeout(this.readyTimer);
		if (this.pageTimer) window.clearTimeout(this.pageTimer);
					this.readyTimer = 0;
					this.requestUpdate(true);
				}
				this.pumpProbes();
			});
		}
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
		if (!this.ready) return;
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
		const started = performance.now();

		this.layoutWidth = this.sizerEl.clientWidth;
		this.layoutPaneHeight = this.scrollers[0]?.clientHeight ?? 0;
		this.gap = parseFloat(getComputedStyle(this.sizerEl).rowGap) || 0;
		const fallback = this.typicalRatio();
		const loaded = Math.min(this.loaded, this.items.length);
		const boxes: Box[] = [];
		let y = 0;
		// Pages are laid out one after another; a middle page ends flush, so
		// pages join without a seam that looks different from any other.
		for (let from = 0; from < loaded; from += PAGE_SIZE) {
			const to = Math.min(loaded, from + PAGE_SIZE);
			const page = this.items.slice(from, to);
			const ratios = page.map((item) => this.ratios.get(item.media.src) ?? fallback);
			const final = to >= this.items.length;
			const pageBoxes =
				settings.layout === 'rows'
					? justify(ratios, {
							width: this.layoutWidth,
							targetHeight: settings.minTileSize * ROW_HEIGHT_PER_MIN,
							maxHeight: this.maxTileHeight(),
							gap: this.gap,
							maxCropPerSide: ROWS_MAX_CROP,
							final,
						}).boxes
					: mosaic(
							page.map((item, i) => ({ ratio: ratios[i] ?? fallback, weight: item.weight })),
							{
								width: this.layoutWidth,
								tileSize: settings.minTileSize * MEDIUM_TILE_PER_MIN,
								minTileSize: settings.minTileSize,
								maxTileHeight: this.maxTileHeight(),
								gap: this.gap,
								final,
							},
						).boxes;
			let pageHeight = 0;
			for (const box of pageBoxes) {
				if (!box) continue;
				boxes.push({ ...box, y: box.y + y });
				pageHeight = Math.max(pageHeight, box.y + box.height);
			}
			y += pageHeight + this.gap;
		}
		this.layout = placed(boxes);
		this.lastLayoutMs = performance.now() - started;
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
		if (view.bottom + span * LOAD_AHEAD >= layout.height) this.loadMore();
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

	/** The tallest a tile may be: the visible height of the pane it scrolls in. */
	private maxTileHeight(): number {
		const scroller = this.scrollers[0];
		const visible = scroller ? scroller.clientHeight : this.rootEl.win.innerHeight;
		const style = getComputedStyle(this.rootEl);
		const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
		return Math.max(MIN_TILE_PX, visible - padding);
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
		const pane = this.scrollers[0];
		if (pane) this.resizeObserver?.observe(pane);
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
