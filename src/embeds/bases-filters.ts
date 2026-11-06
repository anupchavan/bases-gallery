/**
 * Bases filters through Bases' own query parser and filter editor, the way
 * Custom Views does it. This is the plugin's one use of private API, agreed
 * as an exception: Obsidian has no public way to parse or test a Bases
 * filter, or to show its filter editor outside a base. Everything here is
 * found at run time and fails softly (no media notes, an error in settings)
 * if a future Obsidian changes it.
 */
import { BasesEntry, TFile, Platform, type App } from "obsidian";

export type BasesFilter = string | { and: BasesFilter[] } | { or: BasesFilter[] } | { not: BasesFilter[] };
export interface ParsedFilter {
	serialize(): BasesFilter;
	hasError(): boolean;
	test(entry: BasesEntry): boolean;
}
interface NativeViewConfig { name: string }
export interface NativeQuery {
	filters?: ParsedFilter;
	views: NativeViewConfig[];
	saveFn?: () => void;
	getViewConfig(name: string): NativeViewConfig;
	/** Before 1.15.1. */
	setGlobalFilters?(filters: BasesFilter | null): void;
	/** 1.15.1 and later: the base's filters, a view's name and that view's filters. */
	setFilters?(filters: BasesFilter | null, viewName: string, viewFilters: BasesFilter | null): void;
}
export interface NativeBuilder {
	innerContainerEl: HTMLElement;
	root?: { children?: unknown[]; advancedInputEditor?: { destroy(): void } };
	updateQuery(save: (filters: BasesFilter | null) => void, view: NativeViewConfig, filters?: ParsedFilter): void;
}
interface NativeToolbarItem {
	setOpen(open: boolean): void;
	scrollEl?: HTMLElement;
	/** 1.15+ holds the toolbar button here instead of on `button`. */
	containerEl?: HTMLElement;
	button?: { containerEl?: HTMLElement; setText?(text: string): void };
	menu?: { mobileTitleEl?: HTMLElement };
}
/** Obsidian 1.15 merged the global and per-view builders into one editor with two sections. */
interface NativeFilterSection { innerEl: HTMLElement; root?: NativeBuilder["root"] }
interface NativeFilterMenu {
	globalFilterBuilder?: NativeBuilder;
	filterEditor?: { updateQuery(save: (filters: (BasesFilter | null)[]) => void, filters: (ParsedFilter | null)[]): void };
	baseSection?: NativeFilterSection;
	createPage?(host: unknown): { containerEl: HTMLElement };
	toolbarItem?: NativeToolbarItem;
}
export interface NativeController {
	query: NativeQuery;
	viewName: string;
	ctx: unknown;
	filterMenu: NativeFilterMenu;
	buildBasesContext(): unknown;
	unload(): void;
}
interface ParseReceiver {
	app: { vault: { read(): Promise<string> } };
	file: TFile;
	controller: NativeController;
	requestSave(): void;
}
interface NativeEmbed {
	controller: NativeController;
	loadQuery(this: ParseReceiver): Promise<NativeQuery>;
	unload(): void;
}
interface QueryConstructor { parse(data: unknown): NativeQuery }
type EmbedFactory = (context: { app: App; containerEl: HTMLElement; sourcePath: string; linktext: string }, file: TFile, subpath: string) => NativeEmbed;
export interface NativeBasesApi {
	parse(filters: BasesFilter | null): NativeQuery;
	createEditor(host: HTMLElement, filters: BasesFilter | null, save: (filters: BasesFilter | null) => void, popover?: boolean): () => void;
	test(filter: ParsedFilter, file: TFile): boolean;
}

const apis = new WeakMap<App, Promise<NativeBasesApi>>();

/** Discover the real query/parser through Bases' registered embed factory. */
export function getNativeBasesApi(app: App): Promise<NativeBasesApi> {
	const cached = apis.get(app);
	if (cached) return cached;
	const pending = discover(app).catch((error) => { apis.delete(app); throw error; });
	apis.set(app, pending);
	return pending;
}

async function discover(app: App): Promise<NativeBasesApi> {
	const registry = (app as App & { embedRegistry?: { embedByExtension?: { base?: EmbedFactory } } }).embedRegistry;
	const factory = registry?.embedByExtension?.base;
	if (typeof factory !== "function" || typeof BasesEntry !== "function") {
		throw new Error("Turn on the Bases core plugin to edit these filters.");
	}
	const file: unknown = Object.create(TFile.prototype);
	if (!(file instanceof TFile)) throw new Error("Could not initialize native filters.");
	file.path = "__media_manager_rules__.base";
	file.name = "__media_manager_rules__.base";
	file.extension = "base";
	const host = createDiv();
	const seed = factory({ app, containerEl: host, sourcePath: "", linktext: "" }, file, "");
	let Query: QueryConstructor;
	try {
		if (typeof seed.loadQuery !== "function" || !globalBuilder(seed.controller?.filterMenu)) {
			throw new Error("This Obsidian version does not expose a compatible Bases filter editor.");
		}
		// loadQuery's receiver supplies its data source. This uses the native parser
		// without creating a file, reading user data, or patching the global vault.
		const query = await seed.loadQuery.call({
			app: { vault: { read: () => Promise.resolve("") } },
			file,
			controller: seed.controller,
			requestSave() {},
		});
		query.saveFn = () => {};
		Query = query.constructor as unknown as QueryConstructor;
		if (typeof Query.parse !== "function") throw new Error("The native Bases query parser is unavailable.");
	} finally {
		cleanup(() => seed.unload());
		host.remove();
	}
	const parse = (filters: BasesFilter | null): NativeQuery => Query.parse({
		...(filters === null ? {} : { filters }),
		views: [{ type: "table", name: "Rules" }],
	});
	return {
		parse,
		test(filter, target) {
			// BasesEntry is exported; its context constructor signature is internal.
			const Entry = BasesEntry as unknown as new (context: unknown, file: TFile) => BasesEntry;
			return filter.test(new Entry({ app, formulas: {}, local: null }, target));
		},
		createEditor(parent, filters, save, popover = false) {
			const query = parse(filters);
			const internalHost = createDiv();
			const embed = factory({ app, containerEl: internalHost, sourcePath: "", linktext: "" }, file, "");
			let builder: NativeBuilder | undefined;
			let disposed = false;
			const dispose = () => {
				if (disposed) return;
				disposed = true;
				cleanup(() => embed.controller?.filterMenu?.toolbarItem?.setOpen(false));
				cleanup(() => toolbarEl(embed.controller?.filterMenu?.toolbarItem)?.remove());
				destroyFormulaEditors(builder?.root);
				cleanup(() => builder?.innerContainerEl.remove());
				cleanup(() => embed.unload());
				internalHost.remove();
			};
			try {
				const controller = embed.controller;
				builder = globalBuilder(controller?.filterMenu);
				if (!builder) throw new Error("This Obsidian version does not expose a compatible Bases filter editor.");
				query.saveFn = () => {};
				controller.query = query;
				controller.viewName = "Rules";
				controller.ctx = controller.buildBasesContext();
				builder.updateQuery(value => {
					if (disposed) return;
					// Save first: Bases calls this inside a try/catch that hides
					// errors, so anything below that throws must not lose the edit.
					save(value);
					// Keep the editor's own query in step, for its suggestions.
					// 1.15.1 replaced setGlobalFilters with setFilters(base, view, viewFilters).
					cleanup(() => {
						if (typeof query.setGlobalFilters === "function") query.setGlobalFilters(value);
						else query.setFilters?.(value, "Rules", null);
						controller.ctx = controller.buildBasesContext();
					});
				}, query.getViewConfig("Rules"), query.filters);
				if (Platform.isMobile || popover) {
					const menu = controller.filterMenu;
					const toolbar = menu.toolbarItem;
					const buttonEl = toolbarEl(toolbar);
					if (!toolbar || !buttonEl || (!toolbar.scrollEl && typeof menu.createPage !== "function")) {
						throw new Error("This Obsidian version does not expose a compatible mobile Bases filter editor.");
					}
					if (popover) { toolbar.button?.setText?.("Rules"); toolbar.menu?.mobileTitleEl?.setText("Rules"); }
					// Preserve Bases' native sheet, pickers, focus scope, and dismissal.
					// Only global rules apply here; there is no second per-Bases-view scope.
					const rulesEl = builder.innerContainerEl;
					if (toolbar.scrollEl) toolbar.scrollEl.replaceChildren(rulesEl);
					else {
						// 1.15+ builds the menu page on open; show only the global section in it.
						const createPage = menu.createPage!.bind(menu);
						menu.createPage = host => {
							const page = createPage(host);
							page.containerEl.replaceChildren(rulesEl);
							return page;
						};
					}
					parent.replaceChildren(buttonEl);
				} else {
					parent.replaceChildren(builder.innerContainerEl);
				}
			} catch (error) {
				dispose();
				throw error;
			}
			return dispose;
		},
	};
}

function toolbarEl(toolbar: NativeToolbarItem | undefined): HTMLElement | undefined {
	return toolbar?.button?.containerEl ?? toolbar?.containerEl;
}

/** The global filter builder, in the shape every supported Obsidian version can provide. */
function globalBuilder(menu: NativeFilterMenu | undefined): NativeBuilder | undefined {
	if (menu?.globalFilterBuilder) return menu.globalFilterBuilder;
	const editor = menu?.filterEditor, section = menu?.baseSection;
	if (!editor || !section?.innerEl) return undefined;
	return {
		innerContainerEl: section.innerEl,
		get root() { return section.root; },
		updateQuery(save, _view, filters) {
			// The second section holds per-view filters, which media notes don't use.
			editor.updateQuery(([global]) => save(global ?? null), [filters ?? null, null]);
		},
	};
}

function destroyFormulaEditors(node: unknown): void {
	if (!node || typeof node !== "object") return;
	const item = node as {
		children?: unknown[];
		advancedInputEditor?: { destroy(): void } | null;
		leftInputEl?: { close(): void };
		operatorComponent?: { close(): void };
	};
	cleanup(() => item.leftInputEl?.close());
	cleanup(() => item.operatorComponent?.close());
	cleanup(() => item.advancedInputEditor?.destroy());
	item.advancedInputEditor = null;
	item.children?.forEach(destroyFormulaEditors);
}

/** Native controls may change independently; one failed disposer must not retain the rest. */
function cleanup(action: () => void): void {
	try {
		action();
	} catch {
		// Keep going: the other disposers still run.
	}
}
