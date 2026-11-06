import { App, Component, setIcon, setTooltip } from 'obsidian';
import { MUTED_KEY } from './player';

/** Pointer rest before a preview starts. */
export const HOVER_DELAY_MS = 500;
/** Must match --bases-gallery-preview-fade-out. */
const FADE_OUT_MS = 200;

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
	private videoEl: HTMLVideoElement;
	private readonly muteEl: HTMLElement;
	private hostEl: HTMLElement | null = null;
	private timer = 0;
	private pendingEl: HTMLElement | null = null;
	private fadingEl: HTMLElement | null = null;
	private releaseTimer = 0;
	private muted: boolean;

	constructor(private readonly app: App) {
		super();
		this.muted = this.app.loadLocalStorage(MUTED_KEY) !== 'false';
		this.layerEl = createDiv('bases-gallery-preview');
		this.videoEl = this.makeVideo();
		this.muteEl = this.layerEl.createEl('button', {
			cls: 'bases-gallery-mute',
			attr: { type: 'button' },
		});
		this.renderMute();
	}

	onload(): void {
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
		if (this.fadingEl) this.release(this.fadingEl);
		this.layerEl.detach();
	}

	/** The tile the preview plays in, if any. */
	get host(): HTMLElement | null {
		return this.hostEl;
	}

	/**
	 * Gives the preview's video to the zoomed player when it shows `tileEl`,
	 * so playback carries on with no reload or seek. The preview gets a fresh
	 * element. Returns null (and stops) when nothing is playing there.
	 */
	handOff(tileEl: HTMLElement): HTMLVideoElement | null {
		const showing = this.hostEl === tileEl || this.fadingEl === tileEl;
		if (!showing || this.videoEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
			this.stop();
			return null;
		}
		window.clearTimeout(this.releaseTimer);
		this.releaseTimer = 0;
		this.hostEl = null;
		this.fadingEl = null;
		tileEl.removeClass('is-playing', 'is-previewing');
		const video = this.videoEl;
		video.removeClass('bases-gallery-preview-video');
		this.videoEl = this.makeVideo();
		this.layerEl.detach();
		return video;
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

	/**
	 * Fades the preview out, then pauses and frees the video. Hovering the
	 * same tile again before the fade ends just fades it back in.
	 */
	stop(): void {
		if (this.timer) window.clearTimeout(this.timer);
		this.timer = 0;
		this.pendingEl = null;
		const host = this.hostEl;
		if (!host) return;
		this.hostEl = null;
		host.removeClass('is-playing');
		this.fadingEl = host;
		this.releaseTimer = window.setTimeout(() => this.release(host), FADE_OUT_MS);
	}

	private release(host: HTMLElement): void {
		this.releaseTimer = 0;
		if (this.fadingEl !== host) return;
		this.fadingEl = null;
		host.removeClass('is-previewing');
		this.layerEl.detach();
		this.videoEl.pause();
		this.videoEl.removeAttribute('src');
		this.videoEl.load();
	}

	private start(tileEl: HTMLElement, src: string): void {
		if (!tileEl.isConnected) return;
		if (this.fadingEl === tileEl && this.videoEl.getAttribute('src') === src) {
			// Came back during the fade-out: keep playing where it was.
			window.clearTimeout(this.releaseTimer);
			this.fadingEl = null;
			this.hostEl = tileEl;
			tileEl.addClass('is-playing');
			return;
		}
		if (this.fadingEl) this.release(this.fadingEl);
		// The zoomed player may have changed it.
		const muted = this.app.loadLocalStorage(MUTED_KEY) !== 'false';
		if (muted !== this.muted) {
			this.muted = muted;
			this.renderMute();
		}
		this.hostEl = tileEl;
		tileEl.addClass('is-previewing');
		tileEl.appendChild(this.layerEl);
		this.videoEl.muted = this.muted;
		this.videoEl.currentTime = 0;
		this.videoEl.src = src;
		void this.videoEl.play().catch(() => this.stop());
	}

	private makeVideo(): HTMLVideoElement {
		const video = createEl('video', {
			cls: 'bases-gallery-preview-video',
			attr: { playsinline: '', preload: 'none', disablepictureinpicture: '', 'aria-hidden': 'true' },
		});
		video.loop = true;
		// The tile's class drives every fade, so the poster, video, badge and
		// mute button change together, on the frame the video starts.
		video.addEventListener('playing', () => {
			if (this.videoEl === video) this.hostEl?.addClass('is-playing');
		});
		this.layerEl.prepend(video);
		return video;
	}

	private renderMute(): void {
		this.videoEl.muted = this.muted;
		setIcon(this.muteEl, this.muted ? 'volume-x' : 'volume-2');
		setTooltip(this.muteEl, this.muted ? 'Unmute' : 'Mute', { placement: 'top' });
	}
}
