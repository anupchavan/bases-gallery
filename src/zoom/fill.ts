import { App, Component, Scope } from 'obsidian';

/** medium-zoom's numbers, as measured on MUBI. */
const DURATION_MS = 300;
/** Wheel distance that closes the zoom, and the pause before it does. */
const SCROLL_CLOSE_PX = 40;
const SCROLL_CLOSE_DELAY_MS = 150;

/**
 * Fills the window with an image, the way MUBI's notebook (medium-zoom)
 * does: a clone starts exactly over the tile and animates with a single
 * transform to fill the viewport, never past the image's natural size,
 * while an overlay in the page background fades in. Closing runs the same
 * animation in reverse. Only transform and opacity change, so the
 * compositor does the work.
 */
export class FillZoom extends Component {
	private overlayEl: HTMLElement | null = null;
	private cloneEl: HTMLImageElement | null = null;
	private sourceEl: HTMLImageElement | null = null;
	private scope: Scope | null = null;
	private closing = false;
	private wheelTotal = 0;
	private wheelTimer = 0;
	/** Owns this zoom's listeners; removed when the zoom closes. */
	private session: Component | null = null;

	constructor(private readonly app: App) {
		super();
	}

	get isOpen(): boolean {
		return this.cloneEl !== null;
	}

	onunload(): void {
		this.cleanUp();
	}

	open(source: HTMLImageElement): void {
		if (this.isOpen || !source.isConnected || source.naturalWidth === 0) return;
		const doc = source.doc;
		const win = source.win;
		const rect = source.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;

		const overlay = doc.body.createDiv('bases-gallery-zoom-overlay');
		const clone = doc.body.createEl('img', {
			cls: 'bases-gallery-zoom-image',
			attr: { src: source.currentSrc || source.src, alt: source.alt, draggable: 'false' },
		});
		clone.setCssProps({
			'--zoom-left': `${rect.left}px`,
			'--zoom-top': `${rect.top}px`,
			'--zoom-width': `${rect.width}px`,
			'--zoom-height': `${rect.height}px`,
		});
		source.addClass('is-zoom-source');
		this.overlayEl = overlay;
		this.cloneEl = clone;
		this.sourceEl = source;
		this.closing = false;

		// Same transform maths as medium-zoom (margin 0, no larger than natural size).
		const viewW = doc.documentElement.clientWidth;
		const viewH = doc.documentElement.clientHeight;
		const scaleX = Math.min(Math.max(rect.width, source.naturalWidth), viewW) / rect.width;
		const scaleY = Math.min(Math.max(rect.height, source.naturalHeight), viewH) / rect.height;
		const scale = Math.min(scaleX, scaleY);
		const dx = ((viewW - rect.width) / 2 - rect.left) / scale;
		const dy = ((viewH - rect.height) / 2 - rect.top) / scale;
		clone.setCssProps({ '--zoom-transform': `scale(${scale}) translate3d(${dx}px, ${dy}px, 0)` });

		// Let the start position paint, then switch on the open state so the
		// transition runs.
		win.requestAnimationFrame(() => {
			if (this.cloneEl !== clone || this.closing) return;
			overlay.addClass('is-open');
			clone.addClass('is-open');
		});

		const session = this.addChild(new Component());
		this.session = session;
		const close = (): void => this.close();
		session.registerDomEvent(overlay, 'click', close);
		session.registerDomEvent(clone, 'click', close);
		session.registerDomEvent(win, 'resize', close);
		session.registerDomEvent(overlay, 'wheel', (evt) => this.onWheel(evt), { passive: true });
		session.registerDomEvent(clone, 'wheel', (evt) => this.onWheel(evt), { passive: true });

		this.scope = new Scope(this.app.scope);
		this.scope.register([], 'Escape', () => {
			this.close();
			return false;
		});
		this.app.keymap.pushScope(this.scope);
	}

	close(): void {
		const clone = this.cloneEl;
		const overlay = this.overlayEl;
		if (!clone || !overlay || this.closing) return;
		this.closing = true;
		overlay.removeClass('is-open');
		clone.removeClass('is-open');
		let finished = false;
		const finish = (): void => {
			if (finished) return;
			finished = true;
			this.cleanUp();
		};
		this.session?.registerDomEvent(clone, 'transitionend', (evt) => {
			if (evt.propertyName === 'transform') finish();
		});
		// Fallback when no transition runs (reduced motion, hidden window).
		window.setTimeout(finish, DURATION_MS + 50);
	}

	private onWheel(evt: WheelEvent): void {
		this.wheelTotal += Math.abs(evt.deltaY);
		if (this.wheelTotal > SCROLL_CLOSE_PX && !this.wheelTimer) {
			this.wheelTimer = window.setTimeout(() => this.close(), SCROLL_CLOSE_DELAY_MS);
		}
	}

	private cleanUp(): void {
		if (this.wheelTimer) window.clearTimeout(this.wheelTimer);
		this.wheelTimer = 0;
		this.wheelTotal = 0;
		if (this.scope) this.app.keymap.popScope(this.scope);
		this.scope = null;
		this.sourceEl?.removeClass('is-zoom-source');
		this.overlayEl?.detach();
		this.cloneEl?.detach();
		this.overlayEl = null;
		this.cloneEl = null;
		this.sourceEl = null;
		this.closing = false;
		if (this.session) this.removeChild(this.session);
		this.session = null;
	}
}
