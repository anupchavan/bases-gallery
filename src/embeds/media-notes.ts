import { EditorState, Extension, Prec, RangeSetBuilder, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
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
import { resolveMediaText } from '../media/resolve';
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
		if (this.routeEmbeds()) return;
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
		const mediaOfNote = (note: TFile): TFile | null => this.mediaOfNote(note);
		// A function, not an arrow: Obsidian calls factories with its own `this`.
		const routed: EmbedFactory = function (this: unknown, context, file, subpath) {
			const media = file instanceof TFile ? mediaOfNote(file) : null;
			const factory = media ? registry[media.extension.toLowerCase()] : undefined;
			if (media && typeof factory === 'function') return factory.call(this, context, media, '');
			return original.call(this, context, file, subpath);
		};
		registry.md = routed;
		this.register(() => {
			if (registry.md === routed) registry.md = original;
		});
		return true;
	}

	/** The media file a linked note stands for, or null when it isn't a media note. */
	mediaOf(linktext: string, sourcePath: string): TFile | null {
		const note = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(linktext), sourcePath);
		return note ? this.mediaOfNote(note) : null;
	}

	/** The media file a note stands for, or null when it isn't a media note. */
	mediaOfNote(note: TFile): TFile | null {
		const property = this.property();
		if (!property || note.extension !== 'md') return null;
		const value: unknown = this.app.metadataCache.getFileCache(note)?.frontmatter?.[property];
		const raw = Array.isArray(value) ? (value as unknown[])[0] : value;
		if (typeof raw !== 'string') return null;
		const media = resolveMediaText(this.app, raw, note)?.file ?? null;
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
			if (media) embed.setAttribute('src', media.path);
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
 * Live Preview: a media note's embed is drawn as the media file's own embed
 * (rendered by Obsidian through `MarkdownRenderer`), except while the cursor
 * is on it, when the link shows as text to edit, like any other embed.
 */
function livePreviewEmbeds(embeds: MediaNoteEmbeds): Extension {
	const find = (state: EditorState): EmbedMatch[] => {
		const matches: EmbedMatch[] = [];
		const text = state.doc.toString();
		if (!text.includes('![[')) return matches;
		for (const match of text.matchAll(EMBED)) {
			const from = match.index ?? 0;
			matches.push({ from, to: from + match[0].length, target: match[1]?.trim() ?? '', alias: match[2]?.trim() });
		}
		return matches;
	};
	const decorate = (state: EditorState, matches: EmbedMatch[]): DecorationSet => {
		const builder = new RangeSetBuilder<Decoration>();
		if (!state.field(editorLivePreviewField)) return builder.finish();
		const sourcePath = state.field(editorInfoField).file?.path ?? '';
		const { ranges } = state.selection;
		for (const { from, to, target, alias } of matches) {
			// The cursor on the link shows it as text, to edit.
			if (ranges.some((range) => range.from <= to && range.to >= from)) continue;
			const media = embeds.mediaOf(target, sourcePath);
			if (!media) continue;
			const markdown = alias ? `![[${media.path}|${alias}]]` : `![[${media.path}]]`;
			builder.add(from, to, Decoration.replace({ widget: new MediaEmbedWidget(embeds, markdown, sourcePath), block: true }));
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
			const matches = tr.docChanged ? find(tr.state) : value.matches;
			return { matches, decorations: decorate(tr.state, matches) };
		},
		provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
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
