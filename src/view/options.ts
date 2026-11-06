import { BasesAllOptions, BasesPropertyId, BasesViewConfig } from 'obsidian';

export const DEFAULT_ROW_HEIGHT = 220;
export const DEFAULT_MAX_CROP = 10;

export interface GalleryConfig {
	mediaProperty: BasesPropertyId | null;
	rowHeight: number;
	/** Share of a tile that may be cropped on each side, 0 to 0.25. */
	maxCropPerSide: number;
}

export function galleryViewOptions(): BasesAllOptions[] {
	return [
		{
			type: 'property',
			key: 'mediaProperty',
			displayName: 'Media property',
			// The same choice Cards offers for its image property.
			filter: (prop) => prop === 'file.file' || !prop.startsWith('file.'),
		},
		{
			type: 'slider',
			key: 'rowHeight',
			displayName: 'Row height',
			min: 80,
			max: 600,
			step: 10,
			default: DEFAULT_ROW_HEIGHT,
		},
		{
			type: 'slider',
			key: 'maxCrop',
			displayName: 'Maximum crop per side (%)',
			min: 0,
			max: 25,
			step: 1,
			default: DEFAULT_MAX_CROP,
		},
	];
}

export function readGalleryConfig(config: BasesViewConfig): GalleryConfig {
	return {
		mediaProperty: config.getAsPropertyId('mediaProperty'),
		rowHeight: readNumber(config.get('rowHeight'), DEFAULT_ROW_HEIGHT),
		maxCropPerSide: readNumber(config.get('maxCrop'), DEFAULT_MAX_CROP) / 100,
	};
}

function readNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0
		? value
		: fallback;
}
