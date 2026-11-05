import { BasesView, QueryController } from 'obsidian';

export const GALLERY_VIEW_TYPE = 'gallery';

export class GalleryView extends BasesView {
	readonly type = GALLERY_VIEW_TYPE;
	private readonly containerEl: HTMLElement;

	constructor(controller: QueryController, parentEl: HTMLElement) {
		super(controller);
		this.containerEl = parentEl.createDiv('bases-gallery-view');
	}

	onDataUpdated(): void {
		this.containerEl.empty();
		this.containerEl.createDiv({
			text: `${this.data.data.length} notes`,
		});
	}
}
