import { App, Component, setIcon, setTooltip } from 'obsidian';

/** Pointer rest before a preview starts. */
export const HOVER_DELAY_MS = 500;
const MUTED_KEY = 'bases-gallery-muted';

/**
 * Netflix-style preview on a video tile. One `<video>` element serves every
 * tile, so at most one video decodes at a time. It moves into the tile the
 * pointer rests on, plays from the start, and fades in over the poster only
 * once it is actually playing (Netflix: 300 ms, linear). The mute button
 * fades in with it; its state is remembered across tiles and restarts. On
 * leave, the video fades out, pauses, and its source is dropped so the
 * decoder and buffers are freed.
 */
export class HoverPreview extends Component {
	private readonly layerEl: HTMLElement;
	private readonly videoEl: HTMLVideoElement;
	private readonly muteEl: HTMLElement;
	private hostEl: HTMLElement | null = null;
	private timer = 0;
	private pendingEl: HTMLElement | null = null;
	private muted: boolean;

	constructor(private readonly app: App) {
		super();
		this.muted = this.app.loadLocalStorage(MUTED_KEY) !== 'false';
		this.layerEl = createDiv('bases-gallery-preview');
		this.videoEl = this.layerEl.createEl('video', {
			cls: 'bases-gallery-preview-video',
			attr: { playsinline: '', preload: 'none', disablepictureinpicture: '', 'aria-hidden': 'true' },
		});
		this.videoEl.loop = true;
		this.muteEl = this.layerEl.createEl('button', {
			cls: 'bases-gallery-mute clickable-icon',
			attr: { type: 'button' },
		});
		this.renderMute();
	}

	onload(): void {
		this.registerDomEvent(this.videoEl, 'playing', () => this.layerEl.addClass('is-playing'));
		this.registerDomEvent(this.muteEl, 'click', (evt) => {
			// The tile's own click would open the zoom.
			evt.stopPropagation();
			this.muted = !this.muted;
			this.app.saveLocalStorage(MUTED_KEY, String(this.muted));
			this.renderMute();
		});
	}

	onunload(): void {
		this.stop();
		this.layerEl.detach();
	}

	/** The tile the preview plays in, if any. */
	get host(): HTMLElement | null {
		return this.hostEl;
	}

	/** Starts a preview in `tileEl` after the pointer has rested there. */
	schedule(tileEl: HTMLElement, src: string): void {
		if (this.hostEl === tileEl || this.pendingEl === tileEl) return;
		this.stop();
		this.pendingEl = tileEl;
		this.timer = window.setTimeout(() => {
			this.timer = 0;
			this.pendingEl = null;
			this.start(tileEl, src);
		}, HOVER_DELAY_MS);
	}

	/** Pauses and frees the video, and hides the layer over the poster. */
	stop(): void {
		if (this.timer) window.clearTimeout(this.timer);
		this.timer = 0;
		this.pendingEl = null;
		if (!this.hostEl) return;
		this.hostEl.removeClass('is-previewing');
		this.hostEl = null;
		this.layerEl.removeClass('is-playing');
		this.layerEl.detach();
		this.videoEl.pause();
		this.videoEl.removeAttribute('src');
		this.videoEl.load();
	}

	private start(tileEl: HTMLElement, src: string): void {
		if (!tileEl.isConnected) return;
		this.hostEl = tileEl;
		tileEl.addClass('is-previewing');
		tileEl.appendChild(this.layerEl);
		this.videoEl.muted = this.muted;
		this.videoEl.src = src;
		void this.videoEl.play().catch(() => this.stop());
	}

	private renderMute(): void {
		this.videoEl.muted = this.muted;
		setIcon(this.muteEl, this.muted ? 'volume-x' : 'volume-2');
		setTooltip(this.muteEl, this.muted ? 'Unmute' : 'Mute', { placement: 'top' });
	}
}
