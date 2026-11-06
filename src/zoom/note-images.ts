import { App, Component, Keymap } from 'obsidian';
import { FillZoom } from './fill';

/** Smaller images (icons, emoji) keep Obsidian's own behaviour. */
const MIN_SIDE_PX = 48;

/**
 * Opens images in notes with the gallery's zoom (MUBI's fill, its curve,
 * and scrolling to close) instead of Obsidian's image viewer. Clicks are
 * caught on the way down, before Obsidian's viewer sees them. Nothing is
 * created until the first click.
 */
export class NoteImageZoom extends Component {
	private zoom: FillZoom | null = null;

	constructor(
		private readonly app: App,
		private readonly enabled: () => boolean,
	) {
		super();
	}

	onload(): void {
		const listen = (win: Window): void => {
			this.registerDomEvent(win, 'click', (evt) => this.onClick(evt), { capture: true });
		};
		listen(window);
		this.registerEvent(this.app.workspace.on('window-open', (_workspaceWindow, win) => listen(win)));
	}

	private onClick(evt: MouseEvent): void {
		if (!this.enabled() || evt.button !== 0 || Keymap.isModEvent(evt)) return;
		const img = evt.target;
		if (!(img instanceof Node) || !img.instanceOf(HTMLImageElement)) return;
		// Linked images follow their link; small ones are icons.
		if (img.closest('a') || Math.min(img.width, img.height) < MIN_SIDE_PX || img.naturalWidth === 0) return;
		if (!this.inNote(img)) return;
		evt.preventDefault();
		evt.stopPropagation();
		this.zoom ??= this.addChild(new FillZoom(this.app));
		this.zoom.open(
			img,
			{ kind: 'image', src: img.currentSrc || img.src, width: img.naturalWidth, height: img.naturalHeight },
			{ shown: img, scroller: scrollParent(img) },
		);
	}

	/** Whether the image is in an open note (reading view or the editor). */
	private inNote(img: HTMLImageElement): boolean {
		return this.app.workspace.getLeavesOfType('markdown').some((leaf) => leaf.view.containerEl.contains(img));
	}
}

/** The nearest ancestor that scrolls vertically. */
function scrollParent(el: HTMLElement): HTMLElement | null {
	const win = el.win;
	for (let node = el.parentElement; node; node = node.parentElement) {
		if (node.scrollHeight <= node.clientHeight) continue;
		const overflow = win.getComputedStyle(node).overflowY;
		if (overflow === 'auto' || overflow === 'scroll') return node;
	}
	return null;
}
