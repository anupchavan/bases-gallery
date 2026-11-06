import { App, Setting, TFile } from 'obsidian';
import { BasesFilter, NativeBasesApi, ParsedFilter, getNativeBasesApi } from './bases-filters';

/**
 * Which notes are media notes: those that match the Bases filters set in
 * the plugin's settings (no filters: every note). Bases' parser is found
 * the first time a filter is needed; until then nothing matches, and
 * `onReady` lets open notes draw their media notes once it is there.
 */
export class MediaNoteFilter {
	private api: NativeBasesApi | null = null;
	private preparing = false;
	private parsedKey = '';
	private parsed: ParsedFilter | null = null;

	constructor(
		private readonly app: App,
		private readonly filters: () => BasesFilter | null,
		private readonly onReady: () => void,
	) {}

	matches(note: TFile): boolean {
		const filters = this.filters();
		if (filters === null) return true;
		if (!this.api) {
			void this.prepare();
			return false;
		}
		try {
			const key = JSON.stringify(filters);
			if (key !== this.parsedKey) {
				this.parsedKey = key;
				this.parsed = this.api.parse(filters).filters ?? null;
			}
			const filter = this.parsed;
			return !filter || (!filter.hasError() && this.api.test(filter, note));
		} catch {
			return false;
		}
	}

	private async prepare(): Promise<void> {
		if (this.preparing) return;
		this.preparing = true;
		try {
			this.api = await getNativeBasesApi(this.app);
			this.onReady();
		} catch {
			// Bases may be turned off; the next media note asks again.
		} finally {
			this.preparing = false;
		}
	}
}

/**
 * Shows Bases' own filter editor in a settings row, as Custom Views does,
 * for as long as the row exists. Returns the cleanup.
 */
export function mountFilterEditor(
	app: App,
	setting: Setting,
	filters: BasesFilter | null,
	save: (filters: BasesFilter | null) => void,
): () => void {
	setting.settingEl.addClass('media-manager-filter-setting');
	const host = setting.settingEl.createDiv('media-manager-filter-editor');
	let closed = false;
	let dispose: (() => void) | undefined;
	const mount = async (): Promise<void> => {
		host.empty();
		host.setText('Loading filters…');
		try {
			const api = await getNativeBasesApi(app);
			if (closed) return;
			host.empty();
			dispose = api.createEditor(host, filters, (value) => {
				if (closed) return;
				filters = value;
				save(value);
			});
		} catch (error) {
			if (closed) return;
			host.empty();
			host.createEl('p', {
				text: error instanceof Error ? error.message : 'The Bases filter editor could not be loaded.',
				attr: { role: 'alert' },
			});
			const retry = host.createEl('button', { text: 'Retry', attr: { type: 'button' } });
			retry.addEventListener('click', () => void mount());
		}
	};
	void mount();
	return () => {
		closed = true;
		dispose?.();
		host.empty();
	};
}
