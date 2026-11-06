import {
	App,
	BasesEntry,
	BasesPropertyId,
	ListValue,
	Platform,
	TFile,
	Value,
	getLinkpath,
} from 'obsidian';
import { MediaKind, extensionOf, mediaKindOf, remoteKindOf } from './kinds';

export type { MediaKind } from './kinds';
export { mediaKindOf } from './kinds';

export interface MediaSource {
	kind: MediaKind;
	/** URL the browser loads: a resource path for vault files, the URL itself for remote media. */
	src: string;
	/** The vault file, when the media lives in the vault. */
	file: TFile | null;
}

/**
 * Finds the first image, video or PDF for an entry. With no property chosen, a
 * media file listed by the base (for example through a `file.ext` filter)
 * is its own media.
 */
export function resolveEntryMedia(
	app: App,
	entry: BasesEntry,
	property: BasesPropertyId | null,
): MediaSource | null {
	if (property === null || property === 'file.file') {
		return fromFile(app, entry.file);
	}
	let value: Value | null;
	try {
		value = entry.getValue(property);
	} catch {
		return null;
	}
	if (!value || !value.isTruthy()) return null;

	if (value instanceof ListValue) {
		for (let i = 0; i < value.length(); i++) {
			const media = resolveMediaText(app, value.get(i).toString(), entry.file);
			if (media) return media;
		}
		return null;
	}
	return resolveMediaText(app, value.toString(), entry.file);
}

function fromFile(app: App, file: TFile | null): MediaSource | null {
	if (!file) return null;
	const kind = mediaKindOf(file.extension);
	if (!kind) return null;
	return { kind, src: app.vault.getResourcePath(file), file };
}

/**
 * Accepts what people put in a media property: a URL (optionally wrapped in
 * quotes or angle brackets), a `file:///` path on desktop, a wiki link, a
 * Markdown link, or a bare link path.
 */
export function parseMediaText(raw: string): {
	url?: string;
	linkpath?: string;
} | null {
	let text = raw.trim();
	text = stripWrapping(text);
	if (!text) return null;

	const markdown = /^!?\[[^\]]*\]\(([^)]+)\)$/.exec(text);
	if (markdown?.[1]) text = stripWrapping(markdown[1].trim());

	if (/^https?:\/\//i.test(text)) return { url: text };
	if (/^file:\/\/\//i.test(text)) return { url: text };

	const wiki = /^!?\[\[([^\]]+)\]\]$/.exec(text);
	if (wiki?.[1]) {
		const target = wiki[1].split('|')[0] ?? '';
		return { linkpath: getLinkpath(target.trim()) };
	}
	return { linkpath: getLinkpath(text) };
}

function stripWrapping(text: string): string {
	let out = text;
	for (;;) {
		const first = out.charAt(0);
		const last = out.charAt(out.length - 1);
		const wrapped =
			(first === '"' && last === '"') ||
			(first === "'" && last === "'") ||
			(first === '<' && last === '>');
		if (!wrapped || out.length < 2) return out;
		out = out.slice(1, -1).trim();
	}
}

/** Resolves a media property value written in a note to a photo, video or PDF. */
export function resolveMediaText(
	app: App,
	raw: string,
	sourceFile: TFile,
): MediaSource | null {
	const parsed = parseMediaText(raw);
	if (!parsed) return null;

	if (parsed.url !== undefined) {
		const url = parsed.url;
		if (url.toLowerCase().startsWith('file:///')) {
			if (!Platform.isDesktopApp) return null;
			const path = decodeURI(url.slice('file://'.length));
			const kind = mediaKindOf(extensionOf(path));
			// PDFs are read through the vault, so only vault PDFs are shown.
			if (!kind || kind === 'pdf') return null;
			return {
				kind,
				src: Platform.resourcePathPrefix + url.slice('file:///'.length),
				file: null,
			};
		}
		let pathname: string;
		try {
			pathname = new URL(url).pathname;
		} catch {
			return null;
		}
		const kind = remoteKindOf(pathname);
		if (!kind) return null;
		return { kind, src: url, file: null };
	}

	if (parsed.linkpath) {
		const file = app.metadataCache.getFirstLinkpathDest(
			parsed.linkpath,
			sourceFile.path,
		);
		return fromFile(app, file);
	}
	return null;
}
