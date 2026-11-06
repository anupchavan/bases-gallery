import { setIcon } from 'obsidian';
import { Box } from '../layout/justify';
import { MediaSource } from '../media/resolve';

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
		thumbnail: () => Promise<string | null>,
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
		}
		if (thumbKey === null) {
			// An image shows its original; a video with no poster shows an icon.
			if (media.kind === 'image') img.src = media.src;
			else this.showVideoIcon();
			return;
		}
		void thumbnail().then((url) => {
			if (this.src !== media.src || this.thumbKey !== thumbKey) return;
			if (url) img.src = url;
			else if (media.kind === 'image') img.src = media.src;
			else this.showVideoIcon();
		});
	}

	private showVideoIcon(): void {
		if (!this.iconEl) {
			this.iconEl = createDiv('bases-gallery-tile-icon');
			setIcon(this.iconEl, 'film');
		}
		this.el.appendChild(this.iconEl);
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
