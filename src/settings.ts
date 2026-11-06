import { App, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import type BasesGalleryPlugin from './main';

export interface GallerySettings {
	/** Show HDR photos and video posters in HDR inside tiles (HDR displays only). */
	hdrTiles: boolean;
}

export const DEFAULT_SETTINGS: GallerySettings = {
	hdrTiles: true,
};

/** Declarative settings (Obsidian 1.13): Obsidian renders, indexes and saves them. */
export class GallerySettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: BasesGalleryPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'HDR in tiles',
				desc: 'On HDR displays, show HDR photos and video posters in HDR inside the gallery. Turning this off uses smaller standard thumbnails and less memory. Playing a video or opening a photo is always in HDR when the file is.',
				control: { type: 'toggle', key: 'hdrTiles' },
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settingsChanged();
	}
}
