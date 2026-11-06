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
	/** Where a note was taken, for a map in the properties panel. */
	locationProperty: BasesPropertyId;
}

/** Obsidian Maps' own examples keep a place in this property. */
const DEFAULT_LOCATION_PROPERTY: BasesPropertyId = 'note.coordinates';

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
		{
			type: 'property',
			key: 'locationProperty',
			displayName: 'Location property',
			default: 'note.coordinates',
			filter: (prop) => !prop.startsWith('file.'),
		},
	];
}

export { parseSizeWeight } from '../util/format';

export function readGalleryConfig(config: BasesViewConfig): GalleryConfig {
	return {
		layout: config.get('layout') === 'rows' ? 'rows' : 'mosaic',
		mediaProperty: config.getAsPropertyId('mediaProperty'),
		sizeBy: readSizeSource(config.get('sizeBy')),
		sizeProperty: config.getAsPropertyId('sizeProperty'),
		minTileSize: readNumber(config.get('minTileSize'), DEFAULT_MIN_TILE_SIZE),
		locationProperty: config.getAsPropertyId('locationProperty') ?? DEFAULT_LOCATION_PROPERTY,
	};
}

function readSizeSource(value: unknown): SizeSource {
	return value === 'property' || value === 'none' ? value : 'related';
}

function readNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0
		? value
		: fallback;
}
