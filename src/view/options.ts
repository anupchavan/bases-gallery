import { BasesAllOptions, BasesPropertyId, BasesViewConfig } from 'obsidian';

export const DEFAULT_TILE_SIZE = 300;
export const DEFAULT_MAX_CROP = 10;

export type GalleryLayoutKind = 'mosaic' | 'rows';
export type SizeSource = 'related' | 'property' | 'none';

export interface GalleryConfig {
	layout: GalleryLayoutKind;
	mediaProperty: BasesPropertyId | null;
	sizeBy: SizeSource;
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
			type: 'dropdown',
			key: 'sizeBy',
			displayName: 'Tile size from',
			default: 'related',
			options: {
				related: 'How related the note is',
				property: 'A property',
				none: 'Nothing (all equal)',
			},
			shouldHide: () => config.get('layout') === 'rows',
		},
		{
			type: 'property',
			key: 'sizeProperty',
			displayName: 'Size property',
			filter: (prop) => !prop.startsWith('file.'),
			shouldHide: () => config.get('layout') === 'rows' || config.get('sizeBy') !== 'property',
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
			// The mosaic keeps every photo's exact shape; only rows crop.
			shouldHide: () => config.get('layout') !== 'rows',
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
		sizeBy: readSizeSource(config.get('sizeBy')),
		sizeProperty: config.getAsPropertyId('sizeProperty'),
		tileSize: readNumber(config.get('tileSize'), DEFAULT_TILE_SIZE),
		maxCropPerSide: readNumber(config.get('maxCrop'), DEFAULT_MAX_CROP) / 100,
	};
}

/**
 * Reads a size property value as an area weight: small (s, 1) 0.6, large
 * (l, 3) 3, anything else 1. A plain number is used as the weight itself.
 */
export function parseSizeWeight(text: string): number {
	const value = text.trim().toLowerCase();
	if (value === 'small' || value === 's' || value === '1') return 0.6;
	if (value === 'large' || value === 'l' || value === '3') return 3;
	const number = Number(value);
	if (value !== '' && Number.isFinite(number) && number > 0) return Math.min(number, 8);
	return 1;
}

function readSizeSource(value: unknown): SizeSource {
	return value === 'property' || value === 'none' ? value : 'related';
}

function readNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0
		? value
		: fallback;
}
