import { App, Component, Scope, setIcon, setTooltip } from 'obsidian';

/** Controls hide after this long without pointer movement while playing. */
const IDLE_HIDE_MS = 2000;
const SEEK_SMALL = 5;
const SEEK_LARGE = 10;
const VOLUME_STEP = 0.1;
/** Local-storage key for the mute state, shared with the hover preview. */
export const MUTED_KEY = 'bases-gallery-muted';

export interface PlayerHost {
	app: App;
	/** Puts the player in or out of fullscreen. */
	toggleFullscreen(): void;
	isFullscreen(): boolean;
}

/**
 * Controls for a zoomed video: play/pause, a scrub bar with the buffered
 * range, elapsed and total time, mute, and fullscreen. They sit over the
 * bottom of the video and hide after two idle seconds while it plays. The
 * scrub bar moves through a transform, updated by one animation-frame loop
 * that runs only while the video plays and the controls show.
 */
export class VideoControls extends Component {
	readonly el: HTMLElement;
	private readonly playEl: HTMLElement;
	private readonly timeEl: HTMLElement;
	private readonly trackEl: HTMLElement;
	private readonly bufferedEl: HTMLElement;
	private readonly playedEl: HTMLElement;
	private readonly muteEl: HTMLElement;
	private readonly fullscreenEl: HTMLElement;
	private idleTimer = 0;
	private frame = 0;
	private scrubbing = false;
	private alive = false;
	/** Whether the pointer is over the video. */
	private hovered = false;
	/** Last drawn button states, so media events don't redraw icons. */
	private drawn = '';

	constructor(
		parentEl: HTMLElement,
		private readonly video: HTMLVideoElement,
		private readonly host: PlayerHost,
		/** Gets `is-idle` while the controls are hidden (hides the cursor too). */
		private readonly idleEl: HTMLElement,
	) {
		super();
		this.el = parentEl.createDiv('bases-gallery-controls');
		this.playEl = this.button('bases-gallery-control-play');
		this.timeEl = this.el.createDiv('bases-gallery-control-time');
		this.trackEl = this.el.createDiv({ cls: 'bases-gallery-control-track', attr: { role: 'slider', tabindex: '0', 'aria-label': 'Seek' } });
		this.bufferedEl = this.trackEl.createDiv('bases-gallery-control-buffered');
		this.playedEl = this.trackEl.createDiv('bases-gallery-control-played');
		this.muteEl = this.button('bases-gallery-control-mute');
		this.fullscreenEl = this.button('bases-gallery-control-fullscreen');
	}

	onload(): void {
		this.alive = true;
		const { video } = this;
		this.registerDomEvent(this.playEl, 'click', () => this.togglePlay());
		this.registerDomEvent(this.muteEl, 'click', () => this.toggleMute());
		this.registerDomEvent(this.fullscreenEl, 'click', () => this.host.toggleFullscreen());
		for (const name of ['play', 'pause', 'volumechange', 'durationchange', 'progress', 'seeked'] as const) {
			this.registerDomEvent(video, name, () => this.render());
		}
		this.registerDomEvent(video, 'play', () => (this.hovered ? this.wake() : this.loop()));
		this.registerDomEvent(video.doc, 'fullscreenchange', () => this.render());
		this.registerDomEvent(this.el, 'click', (evt) => evt.stopPropagation());
		this.registerDomEvent(this.trackEl, 'pointerdown', (evt) => this.startScrub(evt));
		// Controls belong to the video: they show while the pointer is on it.
		const box = this.el.parentElement;
		if (box) {
			this.registerDomEvent(box, 'pointerenter', () => {
				this.hovered = true;
				this.wake();
			});
			this.registerDomEvent(box, 'pointermove', () => this.wake());
			this.registerDomEvent(box, 'pointerleave', () => {
				this.hovered = false;
				if (!this.scrubbing) this.hide();
			});
		}
		this.render();
		this.hide();
	}

	onunload(): void {
		this.alive = false;
		window.clearTimeout(this.idleTimer);
		window.cancelAnimationFrame(this.frame);
	}

	/** Keyboard shortcuts while the zoom is open, as on most video sites. */
	registerKeys(scope: Scope): void {
		const key = (k: string, run: () => void): void => {
			scope.register([], k, () => {
				run();
				this.wake();
				return false;
			});
		};
		key(' ', () => this.togglePlay());
		key('k', () => this.togglePlay());
		key('ArrowLeft', () => this.seekBy(-SEEK_SMALL));
		key('ArrowRight', () => this.seekBy(SEEK_SMALL));
		key('j', () => this.seekBy(-SEEK_LARGE));
		key('l', () => this.seekBy(SEEK_LARGE));
		key('ArrowUp', () => this.volumeBy(VOLUME_STEP));
		key('ArrowDown', () => this.volumeBy(-VOLUME_STEP));
		key('m', () => this.toggleMute());
		key('f', () => this.host.toggleFullscreen());
	}

	/**
	 * Shows the controls. They stay while the pointer rests on a paused
	 * video; otherwise they hide after two idle seconds (a key press away
	 * from the video shows them briefly).
	 */
	wake(): void {
		this.idleEl.removeClass('is-idle');
		window.clearTimeout(this.idleTimer);
		this.loop();
		if (this.video.paused && this.hovered) return;
		this.idleTimer = window.setTimeout(() => {
			if ((this.video.paused && this.hovered) || this.scrubbing) return;
			this.hide();
		}, IDLE_HIDE_MS);
	}

	private hide(): void {
		window.clearTimeout(this.idleTimer);
		this.idleEl.addClass('is-idle');
	}

	togglePlay(): void {
		if (this.video.paused) void this.video.play();
		else this.video.pause();
		this.wake();
	}

	private toggleMute(): void {
		this.video.muted = !this.video.muted;
		this.host.app.saveLocalStorage(MUTED_KEY, String(this.video.muted));
	}

	private seekBy(seconds: number): void {
		const { video } = this;
		if (!Number.isFinite(video.duration)) return;
		video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + seconds));
	}

	private volumeBy(step: number): void {
		const { video } = this;
		video.muted = false;
		video.volume = Math.min(1, Math.max(0, video.volume + step));
	}

	private startScrub(evt: PointerEvent): void {
		evt.preventDefault();
		this.scrubbing = true;
		this.trackEl.setPointerCapture(evt.pointerId);
		const seek = (e: PointerEvent): void => {
			const rect = this.trackEl.getBoundingClientRect();
			const share = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
			if (Number.isFinite(this.video.duration)) this.video.currentTime = share * this.video.duration;
			this.renderProgress();
		};
		seek(evt);
		const move = (e: PointerEvent): void => seek(e);
		const up = (): void => {
			this.scrubbing = false;
			if (!this.hovered) this.hide();
			this.trackEl.removeEventListener('pointermove', move);
			this.trackEl.removeEventListener('pointerup', up);
			this.trackEl.removeEventListener('pointercancel', up);
			this.wake();
		};
		this.trackEl.addEventListener('pointermove', move);
		this.trackEl.addEventListener('pointerup', up);
		this.trackEl.addEventListener('pointercancel', up);
	}

	/** One frame loop while playing and visible; it stops itself otherwise. */
	private loop(): void {
		if (this.frame || !this.alive) return;
		const tick = (): void => {
			this.frame = 0;
			this.renderProgress();
			const hidden = this.idleEl.hasClass('is-idle');
			if (!this.video.paused && !hidden && this.alive) this.frame = window.requestAnimationFrame(tick);
		};
		this.frame = window.requestAnimationFrame(tick);
	}

	private render(): void {
		const { video } = this;
		const silent = video.muted || video.volume === 0;
		const full = this.host.isFullscreen();
		const state = `${video.paused}${silent}${full}`;
		if (state !== this.drawn) {
			this.drawn = state;
			setIcon(this.playEl, video.paused ? 'play' : 'pause');
			setTooltip(this.playEl, video.paused ? 'Play (k)' : 'Pause (k)', { placement: 'top' });
			setIcon(this.muteEl, silent ? 'volume-x' : 'volume-2');
			setTooltip(this.muteEl, silent ? 'Unmute (m)' : 'Mute (m)', { placement: 'top' });
			setIcon(this.fullscreenEl, full ? 'minimize' : 'maximize');
			setTooltip(this.fullscreenEl, full ? 'Exit fullscreen (f)' : 'Fullscreen (f)', { placement: 'top' });
		}
		this.renderProgress();
		if (video.paused && this.hovered) this.wake();
	}

	private renderProgress(): void {
		const { video } = this;
		const duration = Number.isFinite(video.duration) ? video.duration : 0;
		const played = duration > 0 ? video.currentTime / duration : 0;
		let buffered = 0;
		for (let i = 0; i < video.buffered.length; i++) {
			if (video.buffered.start(i) <= video.currentTime) buffered = video.buffered.end(i);
		}
		this.playedEl.setCssProps({ '--progress': String(played) });
		this.bufferedEl.setCssProps({ '--progress': String(duration > 0 ? buffered / duration : 0) });
		this.trackEl.setAttr('aria-valuenow', String(Math.round(video.currentTime)));
		this.trackEl.setAttr('aria-valuemax', String(Math.round(duration)));
		const text = `${formatTime(video.currentTime)} / ${formatTime(duration)}`;
		if (this.timeEl.textContent !== text) this.timeEl.setText(text);
	}

	private button(cls: string): HTMLElement {
		return this.el.createEl('button', { cls: `bases-gallery-control ${cls}`, attr: { type: 'button' } });
	}
}

function formatTime(total: number): string {
	const seconds = Math.max(0, Math.floor(total));
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = String(seconds % 60).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
