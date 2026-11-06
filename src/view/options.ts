import { BasesAllOptions, BasesPropertyId, BasesViewConfig } from 'obsidian';

export const DEFAULT_MIN_TILE_SIZE = 140;

export type GalleryLayoutKind = 'mosaic' | 'rows';
export type SizeSource = 'related' | 'property' | 'none';

export interface GalleryConfig {
	layout: GalleryLayoutKind;
	mediaProperty: BasesPropertyId | null;
	sizeBy: SizeSource;
	sizeProperty: BasesPropertyId | null;
	/** No tile is shorter than this, nor smaller in area than its square, in px. */
	minTileSize: number;
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
			key: 'minTileSize',
			displayName: 'Minimum tile size',
			min: 60,
			max: 400,
			step: 10,
			default: DEFAULT_MIN_TILE_SIZE,
		},
	];
}

export function readGalleryConfig(config: BasesViewConfig): GalleryConfig {
	return {
		layout: config.get('layout') === 'rows' ? 'rows' : 'mosaic',
		mediaProperty: config.getAsPropertyId('mediaProperty'),
		sizeBy: readSizeSource(config.get('sizeBy')),
		sizeProperty: config.getAsPropertyId('sizeProperty'),
		minTileSize: readNumber(config.get('minTileSize'), DEFAULT_MIN_TILE_SIZE),
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
