import { App, TFile, loadPdfJs } from 'obsidian';
import type { Size } from './dimensions';
import { pageSize, renderScale } from './pdf-page';

/**
 * Reads PDFs with the PDF.js that Obsidian ships, loaded on first use. One
 * worker is shared by every document and closed after a quiet spell; each
 * document is destroyed as soon as it has been read, and at most two are
 * open at a time.
 */

/** The parts of PDF.js used here. */
interface PdfJs {
	getDocument(source: { data: Uint8Array; worker?: PdfWorker }): LoadingTask;
	PDFWorker?: new () => PdfWorker;
}
interface PdfWorker {
	destroy(): void;
}
interface LoadingTask {
	promise: Promise<PdfDocument>;
	destroy(): Promise<void>;
}
interface PdfDocument {
	numPages: number;
	getPage(pageNumber: number): Promise<PdfPage>;
}
interface PdfPage {
	view: number[];
	rotate: number;
	getViewport(options: { scale: number }): Viewport;
	render(options: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: Viewport }): RenderTask;
	cleanup(): void;
}
interface Viewport {
	width: number;
	height: number;
}
interface RenderTask {
	promise: Promise<void>;
	/** Called between rendering slices; rendering goes on when `next` is called. */
	onContinue?: (next: () => void) => void;
}

const MAX_OPEN = 2;
/** The shared worker is closed after this long with no PDF open. */
const WORKER_IDLE_MS = 15_000;

let library: Promise<PdfJs> | null = null;
let worker: PdfWorker | null = null;
let idleTimer = 0;
let open = 0;
const waiting: (() => void)[] = [];

/** Page 1's size after rotation, and the page count. */
export function pdfSize(app: App, file: TFile): Promise<Size | null> {
	return withDocument(app, file, async (doc) => {
		const page = await doc.getPage(1);
		try {
			const size = pageSize(page.view, page.rotate);
			return size ? { ...size, pages: doc.numPages } : null;
		} finally {
			page.cleanup();
		}
	});
}

/**
 * Renders page 1 on white with its longest side at `longest` px and encodes
 * it as WebP. PDF.js draws on the main thread in short slices; each slice
 * waits for an idle moment so scrolling keeps its frames.
 */
export function renderFirstPage(app: App, file: TFile, longest: number, quality: number): Promise<Blob | null> {
	return withDocument(app, file, async (doc) => {
		const page = await doc.getPage(1);
		const canvas = createEl('canvas');
		try {
			const size = pageSize(page.view, page.rotate);
			if (!size) return null;
			const viewport = page.getViewport({ scale: renderScale(size, longest) });
			canvas.width = Math.max(1, Math.round(viewport.width));
			canvas.height = Math.max(1, Math.round(viewport.height));
			const context = canvas.getContext('2d', { alpha: false });
			if (!context) return null;
			context.fillStyle = 'white';
			context.fillRect(0, 0, canvas.width, canvas.height);
			const task = page.render({ canvas, canvasContext: context, viewport });
			task.onContinue = (next) => whenIdle(next);
			await task.promise;
			return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
		} finally {
			// Frees the canvas's pixels now rather than at garbage collection.
			canvas.width = 0;
			canvas.height = 0;
			page.cleanup();
		}
	});
}

/** Closes the shared worker if no PDF is open. */
export function releasePdfWorker(): void {
	window.clearTimeout(idleTimer);
	idleTimer = 0;
	if (open > 0 || waiting.length > 0) return;
	worker?.destroy();
	worker = null;
}

async function withDocument<T>(app: App, file: TFile, use: (doc: PdfDocument) => Promise<T | null>): Promise<T | null> {
	await acquire();
	let task: LoadingTask | null = null;
	try {
		const pdfjs = await loadLibrary();
		const data = new Uint8Array(await app.vault.readBinary(file));
		const shared = sharedWorker(pdfjs);
		task = pdfjs.getDocument(shared ? { data, worker: shared } : { data });
		return await use(await task.promise);
	} catch {
		return null;
	} finally {
		if (task) await task.destroy().catch(() => {});
		release();
	}
}

function loadLibrary(): Promise<PdfJs> {
	library ??= (loadPdfJs() as Promise<PdfJs>).catch((error: unknown) => {
		library = null;
		throw error;
	});
	return library;
}

/** The shared worker, made on first use; null when this PDF.js can't share one. */
function sharedWorker(pdfjs: PdfJs): PdfWorker | null {
	if (worker || !pdfjs.PDFWorker) return worker;
	try {
		worker = new pdfjs.PDFWorker();
	} catch {
		worker = null;
	}
	return worker;
}

function acquire(): Promise<void> {
	window.clearTimeout(idleTimer);
	idleTimer = 0;
	if (open < MAX_OPEN) {
		open++;
		return Promise.resolve();
	}
	return new Promise((resolve) => waiting.push(resolve));
}

function release(): void {
	const next = waiting.shift();
	if (next) {
		next();
		return;
	}
	open--;
	if (open === 0) idleTimer = window.setTimeout(releasePdfWorker, WORKER_IDLE_MS);
}

function whenIdle(callback: () => void): void {
	if (typeof window.requestIdleCallback === 'function') {
		window.requestIdleCallback(() => callback(), { timeout: 1000 });
	} else {
		window.setTimeout(callback, 0);
	}
}
