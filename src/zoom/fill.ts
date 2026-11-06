import { App, Component, Scope } from 'obsidian';
import { MUTED_KEY, VideoControls } from '../video/player';

/** medium-zoom's numbers, as measured on MUBI. */
const DURATION_MS = 300;
/** Wheel distance that closes the zoom, and the pause before it does. */
const SCROLL_CLOSE_PX = 40;
const SCROLL_CLOSE_DELAY_MS = 150;
/**
 * Transitions stay off this long after a resize. macOS animates a window
 * into fullscreen over several resizes, and each one snaps.
 */
const REFIT_SETTLE_MS = 400;
/** Must match --bases-gallery-dark-fade: the fade to black before fullscreen. */
const DARKEN_MS = 150;

export interface ZoomMedia {
	kind: 'image' | 'video';
	/** The original file. */
	src: string;
	/** Natural size, or 0 when not known yet. */
	width: number;
	height: number;
}

export interface ZoomOptions {
	/** The tile's loaded thumbnail or poster, shown until the original is ready. */
	shown: HTMLImageElement | null;
	/** The pane the gallery scrolls in. */
	scroller: HTMLElement | null;
	/** A video already playing this file (the hover preview), to carry on with. */
	video?: HTMLVideoElement | null;
}

interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * Fills the window with a tile's image or video, the way MUBI's notebook
 * (medium-zoom) does: a copy starts exactly over the tile and grows to fill
 * the viewport (medium-zoom's sizes and timing), while an overlay in the
 * page background fades in. The copy is a rounded box showing the media at
 * `object-fit: cover`, so as the box takes the media's own shape a cropped
 * tile opens onto the whole picture. Images never grow past their natural
 * size; videos fill the window and get playback controls. Closing runs the
 * same animation in reverse.
 */
export class FillZoom extends Component {
	private overlayEl: HTMLElement | null = null;
	private stageEl: HTMLElement | null = null;
	/** The rounded box that grows from the tile; holds the media and controls. */
	private boxEl: HTMLElement | null = null;
	private cloneEl: HTMLImageElement | HTMLVideoElement | null = null;
	private sourceEl: HTMLElement | null = null;
	/** The tile's box, in window coordinates when the zoom opened. */
	private base: Rect | null = null;
	private natural = { width: 0, height: 0 };
	private scope: Scope | null = null;
	private closing = false;
	private wheelTimer = 0;
	private refitTimer = 0;
	private darkTimer = 0;
	/** Owns this zoom's listeners; removed when the zoom closes. */
	private session: Component | null = null;

	constructor(
		private readonly app: App,
		/** Called after the zoom has fully closed. */
		private readonly onClosed: () => void = () => {},
	) {
		super();
	}

	get isOpen(): boolean {
		return this.cloneEl !== null;
	}

	onunload(): void {
		this.cleanUp();
	}

	/**
	 * Opens the zoom over `tileEl`. Wheel input keeps scrolling `scroller`
	 * underneath, and the media moves with the page until the zoom closes,
	 * as on MUBI.
	 */
	open(tileEl: HTMLElement, media: ZoomMedia, options: ZoomOptions): void {
		if (this.isOpen || !tileEl.isConnected) return;
		const doc = tileEl.doc;
		const rect = tileEl.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;

		const { shown, scroller } = options;
		const video = media.kind === 'video' ? (options.video ?? null) : null;
		const natural = {
			width: media.width || video?.videoWidth || shown?.naturalWidth || rect.width,
			height: media.height || video?.videoHeight || shown?.naturalHeight || rect.height,
		};
		const base: Rect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };

		const overlay = doc.body.createDiv('bases-gallery-zoom-overlay');
		const stage = doc.body.createDiv('bases-gallery-zoom-stage');
		const box = stage.createDiv('bases-gallery-zoom-box');
		const clone = media.kind === 'video' ? this.videoClone(box, media, shown, video) : this.imageClone(box, media, shown);
		clone.addClass('bases-gallery-zoom-media');
		box.setCssProps({
			'--zoom-left': `${base.left}px`,
			'--zoom-top': `${base.top}px`,
			'--zoom-width': `${base.width}px`,
			'--zoom-height': `${base.height}px`,
		});
		tileEl.addClass('is-zoom-source');
		this.overlayEl = overlay;
		this.stageEl = stage;
		this.boxEl = box;
		this.cloneEl = clone;
		this.sourceEl = tileEl;
		this.base = base;
		this.natural = natural;
		this.closing = false;

		const session = this.addChild(new Component());
		this.session = session;
		this.scope = new Scope(this.app.scope);
		this.scope.register([], 'Escape', () => {
			if (this.isFullscreen()) void doc.exitFullscreen();
			else this.close();
			return false;
		});

		if (clone instanceof HTMLVideoElement) {
			const controls = session.addChild(
				new VideoControls(
					box,
					clone,
					{ app: this.app, toggleFullscreen: () => this.toggleFullscreen(), isFullscreen: () => this.isFullscreen() },
					stage,
				),
			);
			controls.registerKeys(this.scope);
			session.registerDomEvent(clone, 'click', () => controls.togglePlay());
			session.registerDomEvent(clone, 'dblclick', () => this.toggleFullscreen());
			// Window size changes (fullscreen included) refit the video.
			session.registerDomEvent(box.win, 'resize', () => this.refit());
			session.registerDomEvent(doc, 'fullscreenchange', () => this.refit());
		} else {
			session.registerDomEvent(clone, 'click', () => this.close());
			session.registerDomEvent(box.win, 'resize', () => this.close());
		}
		session.registerDomEvent(overlay, 'click', () => this.close());
		// In fullscreen the stage is all there is; a click beside the video closes.
		session.registerDomEvent(stage, 'click', (evt) => {
			if (evt.target === stage) this.close();
		});
		// Controls show once the box has arrived.
		session.registerDomEvent(box, 'transitionend', (evt) => {
			if (evt.target === box && evt.propertyName === 'width' && !this.closing) stage.addClass('is-ready');
		});

		this.fit();
		// Let the start position paint, then switch on the open state so the
		// transition runs.
		box.win.requestAnimationFrame(() => {
			if (this.boxEl !== box || this.closing) return;
			overlay.addClass('is-open');
			box.addClass('is-open');
		});

		// Wheel input scrolls the pane underneath; the media rides along with
		// the page, then the zoom closes after 40 px, back onto the tile
		// wherever it now is. The ride is a transform, so it isn't animated.
		if (scroller) {
			const startScroll = scroller.scrollTop;
			// Only the user's own scrolling closes the zoom; layout updates that
			// move the page just move the media with it.
			let scrolled = 0;
			const forward = (evt: WheelEvent): void => {
				if (this.isFullscreen()) return;
				evt.preventDefault();
				scroller.scrollTop += evt.deltaY;
				scrolled += Math.abs(evt.deltaY);
				if (scrolled > SCROLL_CLOSE_PX && !this.wheelTimer) {
					this.wheelTimer = window.setTimeout(() => this.close(), SCROLL_CLOSE_DELAY_MS);
				}
			};
			session.registerDomEvent(overlay, 'wheel', forward, { passive: false });
			session.registerDomEvent(stage, 'wheel', forward, { passive: false });
			session.registerDomEvent(scroller, 'scroll', () => {
				if (this.isFullscreen()) return;
				box.setCssProps({ '--zoom-ride': `${startScroll - scroller.scrollTop}px` });
			});
		}

		this.app.keymap.pushScope(this.scope);
	}

	close(): void {
		const { cloneEl: clone, boxEl: box, overlayEl: overlay } = this;
		if (!clone || !box || !overlay || this.closing) return;
		this.closing = true;
		if (this.isFullscreen()) void box.doc.exitFullscreen();
		if (clone instanceof HTMLVideoElement) clone.pause();
		this.stageEl?.removeClass('is-ready');
		overlay.removeClass('is-open');
		box.removeClass('is-open');
		let finished = false;
		const finish = (): void => {
			if (finished) return;
			finished = true;
			this.cleanUp();
		};
		this.session?.registerDomEvent(box, 'transitionend', (evt) => {
			if (evt.target === box && evt.propertyName === 'width') finish();
		});
		// Fallback when no transition runs (reduced motion, hidden window).
		window.setTimeout(finish, DURATION_MS + 50);
	}

	private imageClone(box: HTMLElement, media: ZoomMedia, shown: HTMLImageElement | null): HTMLImageElement {
		const current = shown ? shown.currentSrc || shown.src : media.src;
		const clone = box.createEl('img', { attr: { src: current, alt: '', draggable: 'false' } });
		// The tile shows a thumbnail: load the original behind the clone and
		// swap it in once decoded, as medium-zoom does with data-zoom-src.
		if (current !== media.src) {
			const full = new Image();
			full.decoding = 'async';
			full.src = media.src;
			void full
				.decode()
				.then(() => {
					if (this.cloneEl === clone) clone.src = media.src;
				})
				.catch(() => {});
		}
		return clone;
	}

	private videoClone(
		box: HTMLElement,
		media: ZoomMedia,
		shown: HTMLImageElement | null,
		playing: HTMLVideoElement | null,
	): HTMLVideoElement {
		if (playing) {
			// Moved within one task, so it keeps playing without a gap.
			box.appendChild(playing);
			playing.loop = false;
			playing.removeAttribute('aria-hidden');
			return playing;
		}
		const video = box.createEl('video', { attr: { playsinline: '', preload: 'auto', disablepictureinpicture: '' } });
		if (shown) video.poster = shown.currentSrc || shown.src;
		video.muted = this.app.loadLocalStorage(MUTED_KEY) !== 'false';
		video.src = media.src;
		void video.play().catch(() => {});
		return video;
	}

	/**
	 * medium-zoom's sizing: the media's own shape, as large as fits the
	 * window (less a margin above and below), never past an image's natural
	 * size. Runs again when the window or fullscreen state changes.
	 */
	private fit(): void {
		const { boxEl: box, stageEl: stage, overlayEl: overlay, base, natural } = this;
		if (!box || !stage || !overlay || !base) return;
		const full = this.isFullscreen();
		const margin = full
			? 0
			: parseFloat(box.win.getComputedStyle(overlay).getPropertyValue('--bases-gallery-zoom-margin')) || 0;
		const viewW = stage.clientWidth;
		const viewH = stage.clientHeight;
		const roomH = Math.max(1, viewH - 2 * margin);
		// The media's shape at the tile's size, covering the tile.
		const ratio = natural.width / natural.height;
		const startW = Math.max(base.width, base.height * ratio);
		const startH = startW / ratio;
		const upscale = this.cloneEl instanceof HTMLVideoElement;
		const capW = upscale ? viewW : Math.min(Math.max(startW, natural.width), viewW);
		const capH = upscale ? roomH : Math.min(Math.max(startH, natural.height), roomH);
		const scale = Math.min(capW / startW, capH / startH);
		const width = startW * scale;
		const height = startH * scale;
		box.setCssProps({
			'--frame-left': `${(viewW - width) / 2}px`,
			'--frame-top': `${(viewH - height) / 2}px`,
			'--frame-width': `${width}px`,
			'--frame-height': `${height}px`,
			'--zoom-start-scale': `${startW / width}`,
		});
	}

	/** Fits again at once, with the size transitions off until it has painted. */
	private refit(): void {
		const stage = this.stageEl;
		if (!stage || this.closing) return;
		stage.addClass('is-refitting');
		this.fit();
		window.clearTimeout(this.refitTimer);
		window.clearTimeout(this.darkTimer);
		this.darkTimer = 0;
		this.refitTimer = window.setTimeout(() => {
			if (this.stageEl !== stage) return;
			stage.removeClass('is-refitting');
			// Back from fullscreen and the window has settled: fade the page
			// in again. Fading while macOS still animates the window shows grey.
			if (!this.isFullscreen() && !this.darkTimer) this.setDark(false);
		}, REFIT_SETTLE_MS);
	}

	private isFullscreen(): boolean {
		return this.stageEl !== null && this.stageEl.doc.fullscreenElement === this.stageEl;
	}

	/**
	 * macOS cross-fades the window into and out of fullscreen. Going dark
	 * first (black page, square corners) makes that fade black to black, so
	 * the light page doesn't flash through it.
	 */
	private toggleFullscreen(): void {
		const stage = this.stageEl;
		if (!stage || this.closing || this.darkTimer) return;
		if (this.isFullscreen()) {
			void stage.doc.exitFullscreen();
			return;
		}
		this.setDark(true);
		this.darkTimer = window.setTimeout(() => {
			this.darkTimer = 0;
			if (this.stageEl !== stage || this.closing) return;
			stage.requestFullscreen().catch(() => this.setDark(false));
		}, DARKEN_MS);
	}

	private setDark(dark: boolean): void {
		this.stageEl?.toggleClass('is-dark', dark);
		this.overlayEl?.toggleClass('is-dark', dark);
	}

	private cleanUp(): void {
		if (this.wheelTimer) window.clearTimeout(this.wheelTimer);
		this.wheelTimer = 0;
		window.clearTimeout(this.refitTimer);
		if (this.scope) this.app.keymap.popScope(this.scope);
		this.scope = null;
		if (this.session) this.removeChild(this.session);
		this.session = null;
		const clone = this.cloneEl;
		if (clone instanceof HTMLVideoElement) {
			// Free the decoder and its buffers.
			clone.pause();
			clone.removeAttribute('src');
			clone.load();
		}
		this.sourceEl?.removeClass('is-zoom-source');
		this.overlayEl?.detach();
		this.stageEl?.detach();
		this.overlayEl = null;
		this.stageEl = null;
		this.cloneEl = null;
		this.boxEl = null;
		this.sourceEl = null;
		this.base = null;
		this.closing = false;
		this.onClosed();
	}
}
