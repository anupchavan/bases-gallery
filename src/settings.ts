import { App, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import type MediaManagerPlugin from './main';
import type { BasesFilter } from './embeds/bases-filters';
import { mountFilterEditor } from './embeds/media-note-filter';

export interface GallerySettings {
	/** Show HDR photos and video posters in HDR inside tiles (HDR displays only). */
	hdrTiles: boolean;
	/** Open images in notes with the gallery's zoom instead of Obsidian's viewer. */
	zoomNoteImages: boolean;
	/** The property that makes a note a media note: it links to the note's photo, video or PDF. */
	mediaNoteProperty: string;
	/** Which notes are media notes, as Bases filters. Null: every note. */
	mediaNoteFilters: BasesFilter | null;
}

export const DEFAULT_SETTINGS: GallerySettings = {
	hdrTiles: true,
	zoomNoteImages: true,
	mediaNoteProperty: 'url',
	mediaNoteFilters: null,
};

/** Declarative settings (Obsidian 1.13): Obsidian renders, indexes and saves them. */
export class GallerySettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: MediaManagerPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'HDR tiles',
				desc: 'Show HDR photos and videos in HDR in the grid. Off uses less memory.',
				control: { type: 'toggle', key: 'hdrTiles' },
			},
			{
				name: 'Zoom images in notes',
				desc: "Open images in notes with the gallery zoom instead of Obsidian's viewer.",
				control: { type: 'toggle', key: 'zoomNoteImages' },
			},
			{
				name: 'Media note property',
				desc: 'Media notes embed as the photo, video or PDF this property links to. Leave empty to turn off.',
				control: { type: 'text', key: 'mediaNoteProperty', placeholder: 'url' },
			},
			{
				name: 'Media notes',
				desc: 'Notes that match these filters are media notes. No filters: every note with the property.',
				render: (setting) =>
					mountFilterEditor(this.app, setting, this.plugin.settings.mediaNoteFilters, (filters) => {
						void this.setControlValue('mediaNoteFilters', filters);
					}),
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settingsChanged();
		if (key === 'mediaNoteProperty' || key === 'mediaNoteFilters') this.plugin.redrawNotes();
	}
}
