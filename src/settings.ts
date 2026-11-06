import { App, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import type MediaManagerPlugin from './main';

export interface GallerySettings {
	/** Show HDR photos and video posters in HDR inside tiles (HDR displays only). */
	hdrTiles: boolean;
	/** Open images in notes with the gallery's zoom instead of Obsidian's viewer. */
	zoomNoteImages: boolean;
}

export const DEFAULT_SETTINGS: GallerySettings = {
	hdrTiles: true,
	zoomNoteImages: true,
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
				desc: 'Show HDR photos and videos in HDR in the grid. Off saves memory. Opened photos and videos are always HDR.',
				control: { type: 'toggle', key: 'hdrTiles' },
			},
			{
				name: 'Zoom images in notes',
				desc: 'Open images in notes with the gallery zoom instead of the built-in viewer.',
				control: { type: 'toggle', key: 'zoomNoteImages' },
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settingsChanged();
	}
}
