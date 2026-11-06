# Media Manager

An Obsidian plugin that adds a **Gallery** layout to [Bases](https://help.obsidian.md/bases): your notes' photos, videos and PDFs as a mosaic or justified rows, with MUBI-style zoom, Netflix-style hover previews and a video player.

Requires Obsidian 1.13.0 or later, with **Bases** turned on in **Settings → Core plugins**.

## Install

Until the plugin is in the community store, install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat): add `anupchavan/obsidian-media-manager` as a beta plugin, then enable **Media Manager** in **Settings → Community plugins**.

## Usage

In a base, add a view and pick **Gallery** as its layout. Then choose the **Media property**: the property that holds each note's photo or video.

The property can be text or a list. Each value can be:

- a wiki link: `"[[sunset.jpg]]"`
- a Markdown link: `"[Sunset](media/sunset.jpg)"`
- a vault path: `media/sunset.jpg`
- a web address: `https://example.com/sunset.jpg`

```yaml
---
url: "[[sunset.jpg]]"
---
```

A list shows its first photo or video. With no media property chosen, a base that lists media files directly (for example with a `file.ext` filter) shows each file itself.

### Layouts

- **Mosaic**: tiles of different sizes that interlock in rows and columns.
- **Rows**: justified rows of equal height, like Google Photos, cropping each photo by at most 10% a side.

**Size by** sets which tiles are larger:

- **Related notes**: notes with more links, backlinks and shared tags get bigger tiles.
- **Property**: the **Size property** you choose, with `small`, `large` or a number.
- **None**: every tile aims for the same size.

**Smallest tile** keeps small tiles legible.

### Viewing

- Click a photo or video to fill the window. Scroll, click outside or press Esc to close.
- Cmd-click (Ctrl-click on Windows and Linux) opens the note instead.
- Rest the pointer on a video to preview it. The mute button keeps its setting.
- The **i** button in a zoomed photo or video shows the note's properties, the ones picked in the view's **Properties** menu.

Video keys while zoomed:

| Key | Action |
| --- | --- |
| Space or K | Play or pause |
| ← and → | Back or forward 5 seconds |
| J and L | Back or forward 10 seconds |
| ↑ and ↓ | Volume |
| M | Mute |
| F | Fullscreen |
| I | Properties |

In a zoomed photo or video, Cmd-← and Cmd-→ (Ctrl on Windows and Linux) show the previous and next item; photos also take ← and →. To use other keys, bind **Media Manager: Show previous item** and **Show next item** in **Settings → Hotkeys**.

### Images in notes

Images in your notes open with the same zoom instead of Obsidian's image viewer. Turn this off in **Settings → Media Manager → Zoom images in notes**. Linked images and small images such as icons keep Obsidian's behaviour.

### Media notes

A note whose `url` property links to a photo, video or PDF in your vault is a media note. Embedding it (`![[Sunset]]`) shows the media itself, like embedding the file, without the note's title, border or open link. Sizes work as usual: `![[Sunset|300]]`. Change or clear the property in **Settings → Media Manager → Media note property**. To limit media notes to some notes (say, those whose `categories` contain `[[Photos]]`), add Bases filters under **Media notes** in the same settings.

### Supported files

Photos: JPEG, PNG, GIF, WebP, AVIF, SVG, BMP. Videos: MP4, WebM, MOV, M4V, OGV, MKV (what plays depends on the codecs Obsidian's Chromium supports). PDFs in your vault show their first page and open in Obsidian's own PDF viewer. HDR photos and videos are detected; **Settings → Media Manager → HDR tiles** chooses whether tiles show them in HDR.

## Performance and privacy

- Startup does no work: everything waits until a gallery opens.
- Only the tiles on screen exist, so large vaults scroll smoothly.
- Sizes and thumbnails are cached on your device (IndexedDB), never uploaded.
- The plugin makes no network requests of its own. Web addresses in your notes are loaded by Obsidian like any embedded image.

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability or verify a release's files.

## Contributing

Issues and pull requests are welcome. When reporting a problem, include the relevant part of the `.base` file, an affected note's frontmatter and any console error. See [CONTRIBUTING.md](CONTRIBUTING.md) to set up a development build.

## License

[0BSD](LICENSE)
