import { BasesAllOptions, BasesPropertyId, BasesViewConfig } from 'obsidian';

export const DEFAULT_TILE_SIZE = 240;
export const DEFAULT_MAX_CROP = 10;

export type GalleryLayoutKind = 'mosaic' | 'rows';

export interface GalleryConfig {
	layout: GalleryLayoutKind;
	mediaProperty: BasesPropertyId | null;
	sizeProperty: BasesPropertyId | null;
	/** Mosaic: edge of a medium tile. Rows: row height. In px. */
	tileSize: number;
	/** Share of a tile that may be cropped on each side, 0 to 0.25. */
	maxCropPerSide: number;
}

export function galleryViewOptions(config: BasesViewConfig): BasesAllOptions[] {
	return [
		{
			type: 'dropdown',
			key: 'layout',
			displayName: 'Layout',
			default: 'mosaic',
			options: { mosaic: 'Mosaic', rows: 'Rows' },
		},
		{
			type: 'property',
			key: 'mediaProperty',
			displayName: 'Media property',
			// The same choice Cards offers for its image property.
			filter: (prop) => prop === 'file.file' || !prop.startsWith('file.'),
		},
		{
			type: 'property',
			key: 'sizeProperty',
			displayName: 'Size property',
			filter: (prop) => !prop.startsWith('file.'),
			shouldHide: () => config.get('layout') === 'rows',
		},
		{
			type: 'slider',
			key: 'tileSize',
			displayName: 'Tile size',
			min: 80,
			max: 600,
			step: 10,
			default: DEFAULT_TILE_SIZE,
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
		layout: config.get('layout') === 'rows' ? 'rows' : 'mosaic',
		mediaProperty: config.getAsPropertyId('mediaProperty'),
		sizeProperty: config.getAsPropertyId('sizeProperty'),
		tileSize: readNumber(config.get('tileSize'), DEFAULT_TILE_SIZE),
		maxCropPerSide: readNumber(config.get('maxCrop'), DEFAULT_MAX_CROP) / 100,
	};
}

/**
 * Reads a size property value: small, medium or large (or s, m, l, or 1 to
 * 3). Anything else is medium.
 */
export function parseSize(text: string): number {
	const value = text.trim().toLowerCase();
	if (value === 'small' || value === 's' || value === '1') return 0;
	if (value === 'large' || value === 'l' || value === '3') return 2;
	return 1;
}

function readNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0
		? value
		: fallback;
}
