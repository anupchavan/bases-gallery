import { Plugin } from 'obsidian';
import { releasePdfWorker } from './media/pdf';
import { DEFAULT_SETTINGS, GallerySettingTab, GallerySettings } from './settings';
import { GALLERY_VIEW_TYPE, GalleryView } from './view/gallery-view';
import { galleryViewOptions } from './view/options';

export default class BasesGalleryPlugin extends Plugin {
	settings: GallerySettings = { ...DEFAULT_SETTINGS };
	private readonly views = new Set<GalleryView>();

	onload(): void {
		this.registerBasesView(GALLERY_VIEW_TYPE, {
			name: 'Gallery',
			icon: 'lucide-layout-grid',
			factory: (controller, containerEl) => new GalleryView(controller, containerEl, this),
			options: galleryViewOptions,
		});
		this.addSettingTab(new GallerySettingTab(this.app, this));
		// Shown only while a photo or video is zoomed. Mod+←/→ (and ←/→ on
		// photos) already work in the zoom; these let people bind their own
		// keys in Settings → Hotkeys.
		this.addCommand({
			id: 'show-previous',
			name: 'Show previous item',
			checkCallback: (checking) => this.step(-1, checking),
		});
		this.addCommand({
			id: 'show-next',
			name: 'Show next item',
			checkCallback: (checking) => this.step(1, checking),
		});
		this.register(releasePdfWorker);
		// Not awaited: startup stays a few registrations; views use the
		// defaults until the saved settings arrive a moment later.
		void this.loadSettings();
	}

	async onExternalSettingsChange(): Promise<void> {
		await this.loadSettings();
	}

	trackView(view: GalleryView): () => void {
		this.views.add(view);
		return () => this.views.delete(view);
	}

	/** Moves an open zoom to its previous or next item. */
	private step(delta: number, checking: boolean): boolean {
		for (const view of this.views) {
			if (view.stepTarget(delta) < 0) continue;
			if (!checking) view.step(delta);
			return true;
		}
		return false;
	}

	/** Lets open galleries pick up a changed setting. */
	settingsChanged(): void {
		for (const view of this.views) view.settingsChanged();
	}

	private async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<GallerySettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...saved };
		this.settingsChanged();
	}
}
