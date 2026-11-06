import { EditorState, Extension, Prec, RangeSetBuilder, StateField, Transaction } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import {
	App,
	Component,
	MarkdownPostProcessorContext,
	MarkdownRenderer,
	TFile,
	editorInfoField,
	editorLivePreviewField,
	getLinkpath,
} from 'obsidian';
import { MediaSource, resolveMediaText } from '../media/resolve';
import { extensionOf } from '../media/kinds';
import type { MediaNoteFilter } from './media-note-filter';

/** Obsidian's internal embed factory: (context, file, subpath) → embed component. */
type EmbedFactory = (this: unknown, context: unknown, file: unknown, subpath: string) => unknown;

/** `![[target#sub|alias]]`: the target and the alias (size or caption). */
const EMBED = /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

/**
 * A media note is a note whose media property (a setting, default `url`)
 * links to a photo, video or PDF in the vault. Its embed shows that file
 * the way embedding the file itself would: no quote bar, title or open
 * link around it.
 */
export class MediaNoteEmbeds extends Component {
	constructor(
		readonly app: App,
		private readonly property: () => string,
		private readonly filter: MediaNoteFilter,
		private readonly registerPostProcessor: (processor: (el: HTMLElement, ctx: MarkdownPostProcessorContext) => void) => void,
		private readonly registerEditorExtension: (extension: Extension) => void,
	) {
		super();
	}

	onload(): void {
		if (this.routeEmbeds()) {
			this.registerEditorExtension(revealFiller(this));
			return;
		}
		// Fallback when Obsidian's embed factories aren't where we expect:
		// draw the media ourselves (without Obsidian's image controls).
		this.registerPostProcessor((el, ctx) => this.retarget(el, ctx.sourcePath));
		// Obsidian draws embeds as block widgets from a state field; ours is
		// one too, ahead of it, so it is the one shown.
		this.registerEditorExtension(Prec.highest(livePreviewEmbeds(this)));
	}

	/**
	 * Hands a media note's embed to the embed factory for its media file's
	 * type, so Obsidian builds a real image, video or PDF embed: its own
	 * controls, keys, resizing and viewer, in reading view and the editor.
	 * Obsidian has no public hook for this; the factories are private, as
	 * Custom Views also uses them (the agreed exception). Returns false when
	 * they aren't there, and undoes itself on unload.
	 */
	private routeEmbeds(): boolean {
		const registry = (this.app as App & { embedRegistry?: { embedByExtension?: Record<string, EmbedFactory | undefined> } })
			.embedRegistry?.embedByExtension;
		const original = registry?.md;
		if (!registry || typeof original !== 'function') return false;
		const mediaOfNote = (note: TFile): MediaSource | null => this.mediaOfNote(note);
		const fromWeb = (embed: unknown, note: TFile, src: string): unknown => this.loadFromWeb(embed, note, src);
		// A function, not an arrow: Obsidian calls factories with its own `this`.
		const routed: EmbedFactory = function (this: unknown, context, file, subpath) {
			const media = file instanceof TFile ? mediaOfNote(file) : null;
			if (media && file instanceof TFile) {
				const extension = media.file ? media.file.extension : extensionOf(urlPath(media.src));
				const factory = registry[extension.toLowerCase()];
				if (typeof factory === 'function') {
					if (media.file) return factory.call(this, context, media.file, '');
					return fromWeb(factory.call(this, context, file, ''), file, media.src);
				}
			}
			return original.call(this, context, file, subpath);
		};
		registry.md = routed;
		this.register(() => {
			if (registry.md === routed) registry.md = original;
		});
		return true;
	}

	/**
	 * For a media note whose media is a web address: an image or video embed
	 * built for the note, whose `loadFile` sees the web address as the note's
	 * resource path, just while it reads it (synchronously, at its start).
	 * The rest is Obsidian's own embed, controls included.
	 */
	private loadFromWeb(embed: unknown, note: TFile, src: string): unknown {
		const loadable = embed as { loadFile?: (...args: unknown[]) => unknown } | null;
		const load = loadable?.loadFile;
		if (!loadable || typeof load !== 'function') return embed;
		const { vault } = this.app;
		loadable.loadFile = function (this: unknown, ...args: unknown[]): unknown {
			// Whatever was there before (normally nothing: the method is on the prototype).
			const before = Object.getOwnPropertyDescriptor(vault, 'getResourcePath');
			const resolve = vault.getResourcePath.bind(vault);
			vault.getResourcePath = (file: TFile): string => (file === note ? src : resolve(file));
			try {
				return load.apply(this, args);
			} finally {
				if (before) Object.defineProperty(vault, 'getResourcePath', before);
				else delete (vault as { getResourcePath?: unknown }).getResourcePath;
			}
		};
		return embed;
	}

	/** The media a linked note stands for, or null when it isn't a media note. */
	mediaOf(linktext: string, sourcePath: string): MediaSource | null {
		const note = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(linktext), sourcePath);
		return note ? this.mediaOfNote(note) : null;
	}

	/** The media a note stands for (in the vault or on the web), or null when it isn't a media note. */
	mediaOfNote(note: TFile): MediaSource | null {
		const property = this.property();
		if (!property || note.extension !== 'md') return null;
		const value: unknown = this.app.metadataCache.getFileCache(note)?.frontmatter?.[property];
		const raw = Array.isArray(value) ? (value as unknown[])[0] : value;
		if (typeof raw !== 'string') return null;
		const media = resolveMediaText(this.app, raw, note);
		return media && this.filter.matches(note) ? media : null;
	}

	/**
	 * Reading view: embeds are still empty when post-processors run, so
	 * pointing one at the media file makes Obsidian render its own normal
	 * media embed there, sized by the embed's alias as usual. Obsidian has
	 * no public hook for embeds; `.internal-embed` and its `src` are how it
	 * marks them in rendered Markdown.
	 */
	private retarget(el: HTMLElement, sourcePath: string): void {
		for (const embed of el.findAll('.internal-embed[src]')) {
			const src = embed.getAttribute('src');
			const media = src ? this.mediaOf(src, sourcePath) : null;
			if (media?.file) embed.setAttribute('src', media.file.path);
		}
	}
}

interface EmbedMatch {
	from: number;
	to: number;
	target: string;
	alias: string | undefined;
}

interface EmbedState {
	/** Every embed in the note; found again only when the text changes. */
	matches: EmbedMatch[];
	decorations: DecorationSet;
}

/**
 * Live Preview fallback, when Obsidian's embed factories aren't available:
 * a media note's embed is drawn as the media file's own embed, except while
 * the cursor is on it, when the link shows as text.
 */
function livePreviewEmbeds(embeds: MediaNoteEmbeds): Extension {
	/** Embeds in `from`–`to` of the document (whole lines). */
	const scan = (state: EditorState, from: number, to: number): EmbedMatch[] => {
		const matches: EmbedMatch[] = [];
		const text = state.sliceDoc(from, to);
		if (!text.includes('![[')) return matches;
		for (const match of text.matchAll(EMBED)) {
			const start = from + (match.index ?? 0);
			matches.push({ from: start, to: start + match[0].length, target: match[1]?.trim() ?? '', alias: match[2]?.trim() });
		}
		return matches;
	};
	const find = (state: EditorState): EmbedMatch[] => scan(state, 0, state.doc.length);
	/**
	 * After an edit: rescan only the lines it touched and move the rest, so
	 * typing in a long note doesn't read the whole note each keystroke.
	 */
	const refind = (tr: Transaction, before: EmbedMatch[]): EmbedMatch[] => {
		const { state, changes } = tr;
		const touched: [number, number][] = [];
		changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
			touched.push([state.doc.lineAt(fromB).from, state.doc.lineAt(toB).to]);
		});
		const inTouched = (pos: number): boolean => touched.some(([from, to]) => pos >= from && pos <= to);
		const kept: EmbedMatch[] = [];
		for (const match of before) {
			if (changes.touchesRange(match.from, match.to)) continue;
			const moved = { ...match, from: changes.mapPos(match.from), to: changes.mapPos(match.to) };
			if (!inTouched(moved.from)) kept.push(moved);
		}
		for (const [from, to] of touched) kept.push(...scan(state, from, to));
		// Overlapping touched lines can find the same embed twice.
		kept.sort((a, b) => a.from - b.from);
		return kept.filter((match, i) => i === 0 || match.from !== kept[i - 1]?.from);
	};
	const touching = (state: EditorState, { from, to }: EmbedMatch): boolean =>
		state.selection.ranges.some((range) => range.from <= to && range.to >= from);
	const decorate = (state: EditorState, matches: EmbedMatch[]): DecorationSet => {
		const builder = new RangeSetBuilder<Decoration>();
		if (!state.field(editorLivePreviewField)) return builder.finish();
		const sourcePath = state.field(editorInfoField).file?.path ?? '';
		for (const match of matches) {
			const { from, to, target, alias } = match;
			// The cursor on the link shows it as text, to edit.
			if (touching(state, match)) continue;
			const media = embeds.mediaOf(target, sourcePath);
			if (!media) continue;
			const markdown = media.file
				? alias
					? `![[${media.file.path}|${alias}]]`
					: `![[${media.file.path}]]`
				: `![${alias ?? ''}](<${media.src}>)`;
			const widget = new MediaEmbedWidget(embeds, markdown, sourcePath);
			builder.add(from, to, Decoration.replace({ widget, block: true }));
		}
		return builder.finish();
	};
	return StateField.define<EmbedState>({
		create: (state) => {
			const matches = find(state);
			return { matches, decorations: decorate(state, matches) };
		},
		update: (value, tr) => {
			const modeChanged = tr.startState.field(editorLivePreviewField) !== tr.state.field(editorLivePreviewField);
			if (!tr.docChanged && !tr.selection && !modeChanged) return value;
			const matches = tr.docChanged ? refind(tr, value.matches) : value.matches;
			return { matches, decorations: decorate(tr.state, matches) };
		},
		provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
	});
}

/**
 * After **Edit this block**, Obsidian keeps an image in view below its link
 * in a tooltip (`cm-image-reveal-tooltip`) over a gap it reserves. It builds
 * that image from the link target, so for a media note the tooltip comes
 * out empty. This fills it with the note's media, in the same structure
 * Obsidian uses for images. Part of the agreed embed exception.
 */
function revealFiller(embeds: MediaNoteEmbeds): Extension {
	return ViewPlugin.define((view) => {
		const fill = (): void => {
			const tooltip = view.dom.querySelector<HTMLElement>('.cm-image-reveal-tooltip');
			if (!tooltip || tooltip.childElementCount > 0) return;
			const { state } = view;
			const line = state.doc.lineAt(state.selection.main.head);
			const sourcePath = state.field(editorInfoField).file?.path ?? '';
			for (const match of line.text.matchAll(EMBED)) {
				const media = embeds.mediaOf(match[1]?.trim() ?? '', sourcePath);
				// Obsidian reveals images only.
				if (!media || media.kind !== 'image') continue;
				const wrapper = tooltip.createDiv('image-embed').createDiv('image-wrapper');
				wrapper.createEl('img', {
					cls: 'media-manager-reveal-media',
					attr: { src: media.src, alt: match[1]?.trim() ?? '' },
				});
				return;
			}
		};
		return {
			update(): void {
				// After Obsidian has drawn its tooltip for this update.
				view.requestMeasure({ read: () => null, write: fill });
			},
		};
	});
}

/** The media file's own embed, rendered by Obsidian and unloaded with the widget. */
class MediaEmbedWidget extends WidgetType {
	private owner: Component | null = null;

	constructor(
		private readonly embeds: MediaNoteEmbeds,
		private readonly markdown: string,
		private readonly sourcePath: string,
	) {
		super();
	}

	eq(other: MediaEmbedWidget): boolean {
		return other.markdown === this.markdown && other.sourcePath === this.sourcePath;
	}

	toDOM(): HTMLElement {
		const el = createDiv('media-manager-note-embed');
		const owner = this.embeds.addChild(new Component());
		this.owner = owner;
		void MarkdownRenderer.render(this.embeds.app, this.markdown, el, this.sourcePath, owner);
		return el;
	}

	destroy(): void {
		if (this.owner) this.embeds.removeChild(this.owner);
		this.owner = null;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

/** A web address's path, without its query or fragment ('' when it isn't one). */
function urlPath(src: string): string {
	try {
		return new URL(src).pathname;
	} catch {
		return '';
	}
}
