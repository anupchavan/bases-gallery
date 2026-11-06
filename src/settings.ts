import { App, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import type MediaManagerPlugin from './main';

export interface GallerySettings {
	/** Show HDR photos and video posters in HDR inside tiles (HDR displays only). */
	hdrTiles: boolean;
	/** Open images in notes with the gallery's zoom instead of Obsidian's viewer. */
	zoomNoteImages: boolean;
	/** The property that makes a note a media note: it links to the note's photo, video or PDF. */
	mediaNoteProperty: string;
}

export const DEFAULT_SETTINGS: GallerySettings = {
	hdrTiles: true,
	zoomNoteImages: true,
	mediaNoteProperty: 'url',
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
				desc: 'Notes whose property links to a photo, video or PDF embed as that file. Leave empty to turn off.',
				control: { type: 'text', key: 'mediaNoteProperty', placeholder: 'url' },
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settingsChanged();
	}
}
