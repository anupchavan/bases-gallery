import { Events, MarkdownView, Plugin } from 'obsidian';
import { releasePdfWorker } from './media/pdf';
import { DEFAULT_SETTINGS, GallerySettingTab, GallerySettings } from './settings';
import { GALLERY_VIEW_TYPE, GalleryView } from './view/gallery-view';

/** What the previous / next commands act on: the zoom that is open now. */
export interface Stepper {
	stepTarget(delta: number): number;
	step(delta: number): void;
}
import { galleryViewOptions } from './view/options';
import { NoteImageZoom } from './zoom/note-images';
import { MediaNoteEmbeds } from './embeds/media-notes';
import { MediaNoteFilter } from './embeds/media-note-filter';

export default class MediaManagerPlugin extends Plugin {
	settings: GallerySettings = { ...DEFAULT_SETTINGS };
	/** Galleries listen here for setting changes (no view references kept). */
	readonly events = new Events();
	/** The gallery whose zoom is open, if any; it clears this when the zoom closes. */
	stepper: Stepper | null = null;

	onload(): void {
		this.registerBasesView(GALLERY_VIEW_TYPE, {
			name: 'Gallery',
			icon: 'lucide-layout-grid',
			factory: (controller, containerEl) => new GalleryView(controller, containerEl, this),
			options: galleryViewOptions,
		});
		this.addSettingTab(new GallerySettingTab(this.app, this));
		this.addChild(new NoteImageZoom(this.app, () => this.settings.zoomNoteImages));
		this.addChild(
			new MediaNoteEmbeds(
				this.app,
				() => this.settings.mediaNoteProperty.trim(),
				new MediaNoteFilter(
					this.app,
					() => this.settings.mediaNoteFilters,
					() => this.redrawNotes(),
				),
				(processor) => this.registerMarkdownPostProcessor(processor),
				(extension) => this.registerEditorExtension(extension),
			),
		);
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

	/** Moves an open zoom to its previous or next item. */
	private step(delta: number, checking: boolean): boolean {
		const stepper = this.stepper;
		if (!stepper || stepper.stepTarget(delta) < 0) return false;
		if (!checking) stepper.step(delta);
		return true;
	}

	/** Redraws open notes in reading view, so their media notes show. */
	redrawNotes(): void {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (leaf.view instanceof MarkdownView) leaf.view.previewMode.rerender(true);
		}
	}

	/** Lets open galleries pick up a changed setting. */
	settingsChanged(): void {
		this.events.trigger('settings-changed');
	}

	private async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<GallerySettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...saved };
		this.settingsChanged();
	}
}
