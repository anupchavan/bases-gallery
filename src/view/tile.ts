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
	private box: Box | null = null;

	constructor(
		parentEl: HTMLElement,
		private readonly onRatio: (src: string, ratio: number) => void,
	) {
		this.el = parentEl.createDiv('bases-gallery-tile');
	}

	/** Shows `media` in this tile, reusing the loaded image when it's the same. */
	show(media: MediaSource): void {
		if (media.src === this.src) return;
		this.src = media.src;
		this.el.dataset.kind = media.kind;
		this.el.removeClass('is-broken');

		if (media.kind === 'image') {
			this.iconEl?.detach();
			const img = this.ensureImg();
			img.removeClass('is-loaded');
			img.src = media.src;
		} else {
			// Video posters arrive in a later milestone.
			this.imgEl?.detach();
			this.imgEl?.removeAttribute('src');
			if (!this.iconEl) {
				this.iconEl = createDiv('bases-gallery-tile-icon');
				setIcon(this.iconEl, 'film');
			}
			this.el.appendChild(this.iconEl);
		}
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
