import { setIcon } from 'obsidian';
import { Box } from '../layout/justify';
import { MediaSource } from '../media/resolve';
import type { Thumb } from '../media/thumbnails';

/**
 * One reusable tile element. Tiles are pooled: scrolling moves a tile to a
 * new item instead of creating DOM.
 */
export class Tile {
	readonly el: HTMLElement;
	/** Index of the item this tile shows. */
	index = -1;
	private imgEl: HTMLImageElement | null = null;
	private iconEl: HTMLElement | null = null;
	private hdrPosterEl: HTMLVideoElement | null = null;
	private durationEl: HTMLElement | null = null;
	private src = '';
	/** Thumbnail key shown (or being fetched); null when showing the original. */
	thumbKey: string | null = null;
	private box: Box | null = null;

	constructor(
		parentEl: HTMLElement,
		private readonly onRatio: (src: string, ratio: number) => void,
	) {
		this.el = parentEl.createDiv('bases-gallery-tile');
	}

	/**
	 * Shows `media` in this tile. Images show the thumbnail `thumbKey` names,
	 * fetched with `thumbnail` (null key: the original). A bigger thumbnail
	 * replaces a smaller one only once it is ready, so the tile never blanks.
	 */
	show(
		media: MediaSource,
		thumbKey: string | null,
		thumbnail: () => Promise<Thumb>,
	): void {
		const changed = media.src !== this.src;
		if (!changed && thumbKey === this.thumbKey) return;
		this.src = media.src;
		this.thumbKey = thumbKey;
		this.el.dataset.kind = media.kind;

		const img = this.ensureImg();
		if (changed) {
			this.el.removeClass('is-broken');
			img.removeClass('is-loaded');
			img.removeAttribute('src');
			this.iconEl?.detach();
			this.dropHdrPoster();
		}
		if (thumbKey === null) {
			// An image shows its original; a video with no poster shows an icon.
			if (media.kind === 'image') img.src = media.src;
			else this.showVideoIcon();
			return;
		}
		void thumbnail().then(({ url, hdr }) => {
			if (this.src !== media.src || this.thumbKey !== thumbKey) return;
			if (url) img.src = url;
			else if (media.kind === 'image') img.src = media.src;
			else if (!hdr) this.showVideoIcon();
			if (hdr && media.kind === 'video') this.showHdrPoster(media.src);
		});
	}

	/**
	 * An HDR video's poster: the video itself, paused on an early frame, so
	 * the display shows it in HDR (a canvas-made image would be SDR). It
	 * fades in over the SDR stand-in once the frame is ready, and is freed
	 * when the tile moves on.
	 */
	private showHdrPoster(src: string): void {
		if (this.hdrPosterEl?.getAttribute('src') === src) return;
		const video =
			this.hdrPosterEl ??
			this.el.createEl('video', {
				cls: 'bases-gallery-media bases-gallery-hdr-poster',
				attr: { playsinline: '', preload: 'auto', 'aria-hidden': 'true' },
			});
		video.muted = true;
		this.hdrPosterEl = video;
		if (!video.parentElement) this.el.appendChild(video);
		video.removeClass('is-loaded');
		video.onloadedmetadata = () => {
			video.currentTime = Math.min(0.5, (video.duration || 1) / 3);
		};
		video.onseeked = () => video.addClass('is-loaded');
		video.src = src;
	}

	private dropHdrPoster(): void {
		const video = this.hdrPosterEl;
		if (!video) return;
		video.removeAttribute('src');
		video.load();
		video.detach();
	}

	private showVideoIcon(): void {
		if (!this.iconEl) {
			this.iconEl = createDiv('bases-gallery-tile-icon');
			setIcon(this.iconEl, 'film');
		}
		this.el.appendChild(this.iconEl);
	}

	/**
	 * Marks a video tile with its length (e.g. 0:12), the way photo apps mark
	 * videos; a play icon would promise a click that the hover already does.
	 */
	setDuration(seconds: number | null): void {
		if (seconds === null || !Number.isFinite(seconds)) {
			this.durationEl?.detach();
			return;
		}
		this.durationEl ??= createDiv('bases-gallery-duration');
		this.durationEl.setText(formatDuration(seconds));
		if (this.durationEl.parentElement !== this.el) this.el.appendChild(this.durationEl);
	}

	place(box: Box): void {
		const prev = this.box;
		if (
			prev &&
			prev.x === box.x &&
			prev.y === box.y &&
			prev.width === box.width &&
			prev.height === box.height
		) {
			return;
		}
		this.box = box;
		this.el.setCssProps({
			'--tile-x': `${box.x}px`,
			'--tile-y': `${box.y}px`,
			'--tile-width': `${box.width}px`,
			'--tile-height': `${box.height}px`,
		});
	}

	/** Frees the image so a pooled tile holds no decoded pixels. */
	release(): void {
		this.src = '';
		this.thumbKey = null;
		this.dropHdrPoster();
		this.durationEl?.detach();
		this.imgEl?.removeAttribute('src');
		this.el.detach();
	}

	/** The loaded image, if this tile shows one. */
	get image(): HTMLImageElement | null {
		return this.imgEl?.parentElement && this.imgEl.hasClass('is-loaded') ? this.imgEl : null;
	}

	private ensureImg(): HTMLImageElement {
		if (this.imgEl) {
			if (!this.imgEl.parentElement) this.el.appendChild(this.imgEl);
			return this.imgEl;
		}
		const img = this.el.createEl('img', {
			cls: 'bases-gallery-media',
			attr: { alt: '', decoding: 'async', draggable: 'false' },
		});
		img.addEventListener('load', () => {
			if (!img.getAttribute('src')) return;
			img.addClass('is-loaded');
			if (img.naturalWidth > 0 && img.naturalHeight > 0) {
				this.onRatio(this.src, img.naturalWidth / img.naturalHeight);
			}
		});
		img.addEventListener('error', () => {
			if (img.getAttribute('src')) this.el.addClass('is-broken');
		});
		this.imgEl = img;
		return img;
	}
}

function formatDuration(total: number): string {
	const seconds = Math.max(0, Math.round(total));
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = String(seconds % 60).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
