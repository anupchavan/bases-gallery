import { Plugin } from 'obsidian';
import { GALLERY_VIEW_TYPE, GalleryView } from './gallery-view';

export default class BasesGalleryPlugin extends Plugin {
	onload(): void {
		this.registerBasesView(GALLERY_VIEW_TYPE, {
			name: 'Gallery',
			icon: 'lucide-layout-grid',
			factory: (controller, containerEl) =>
				new GalleryView(controller, containerEl),
		});
	}
}
