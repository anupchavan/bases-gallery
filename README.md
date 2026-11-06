# Media Manager

Manage media files as Markdown notes. Media Manager adds a **Gallery** layout to [Bases](https://help.obsidian.md/bases) that shows each note's photo, video or PDF as a mosaic or as justified rows. Click any item to fill the window, preview videos by resting the pointer on them, play them with a full player, read PDFs in Obsidian's own viewer, and see each note's properties (and a map) beside the media. Notes that stand for a media file can be embedded like the file itself.

Requires Obsidian 1.13.0 or later, with **Bases** turned on in **Settings → Core plugins**.

- [Install](#install)
- [Quick start](#quick-start)
- [Pointing notes at their media](#pointing-notes-at-their-media)
- [Gallery options](#gallery-options)
- [Browsing the gallery](#browsing-the-gallery)
- [The zoom](#the-zoom)
- [Videos](#videos)
- [PDFs](#pdfs)
- [Properties and maps](#properties-and-maps)
- [Images in notes](#images-in-notes)
- [Media notes](#media-notes)
- [Settings](#settings)
- [Commands and keys](#commands-and-keys)
- [Supported files](#supported-files)
- [Performance, storage and privacy](#performance-storage-and-privacy)
- [Troubleshooting](#troubleshooting)

## Install

**From Obsidian:** open **Settings → Community plugins → Browse**, search for **Media Manager**, select **Install**, then **Enable**.

**Beta versions, with BRAT:** install [BRAT](https://github.com/TfTHacker/obsidian42-brat), run **BRAT: Add a beta plugin for testing**, enter `anupchavan/obsidian-media-manager`, then enable **Media Manager** in **Settings → Community plugins**.

**By hand:** download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/anupchavan/obsidian-media-manager/releases/latest) into `<your vault>/.obsidian/plugins/media-manager/`, reload Obsidian and enable the plugin.

## Quick start

1. Make a note for a photo, with a property that links to it:

   ```yaml
   ---
   url: "[[sunset.jpg]]"
   ---
   ```

2. Create a base (**New base** in the file explorer, or `Ctrl/Cmd+P` → **Bases: Create new base**) and filter it to those notes, for example **folder is** `Photos`.
3. Open the view menu at the top left of the base, select **Add view**, and choose **Gallery** as the layout.
4. In the view's options, set **Media property** to `url` (or whatever property your notes use).
5. Click any tile to fill the window. Scroll, click outside or press `Esc` to come back.

## Pointing notes at their media

The gallery reads one property per note, the **Media property** you choose in the view's options. It can be a single value or a list; a list shows its first photo, video or PDF. Each value can be:

| Written as | Example |
| --- | --- |
| Wiki link | `"[[sunset.jpg]]"` |
| Markdown link | `"[Sunset](media/sunset.jpg)"` |
| Vault path | `media/sunset.jpg` or `<media/sunset.jpg>` |
| Web address | `https://example.com/sunset.jpg` |
| File on your computer (desktop only) | `file:///Users/me/Pictures/sunset.jpg` |

Quotes and angle brackets around a value are ignored. Links are resolved like any other link in the note, so a bare file name works when it's unique in the vault.

**No media property?** If the base lists media files themselves (for example a filter like `file.ext == "jpg"`), leave **Media property** empty and each file shows as its own tile.

## Gallery options

Open them from the view menu at the top left of the base, where you choose the view's layout.

| Option | What it does |
| --- | --- |
| **Layout** | **Mosaic** interlocks tiles of different sizes across rows and columns, with no gaps. **Rows** lays tiles out in justified rows of equal height, like Google Photos, cropping each item by at most 10% a side. |
| **Media property** | The property that holds each note's photo, video or PDF. See [above](#pointing-notes-at-their-media). |
| **Size by** (Mosaic only) | Which tiles are larger. **Related notes**: notes with more links, backlinks and shared tags get bigger tiles, so the hubs of a collection stand out. **Property**: the **Size property** decides. **None**: every tile aims for the same size. |
| **Size property** (when **Size by** is **Property**) | A property with `small`, `large`, `s`, `l`, or a number (`2` is twice the area of a normal tile, up to `8`). |
| **Smallest tile** | The smallest a tile may get, in pixels (60 to 400, default 140). Raise it for bigger tiles overall. |
| **Location property** | The property with a note's location, for the map in the zoom. Default `coordinates`. See [Properties and maps](#properties-and-maps). |

The base's own **Properties** menu chooses which properties the zoom's card shows. Sorting, filters and grouping work as in any base.

## Browsing the gallery

- Tiles load as you scroll; only the tiles on screen exist, so galleries of thousands of notes stay smooth.
- A small chip marks video tiles with their length (`0:12`) and PDF tiles with their page count.
- **Rest the pointer on a video tile** for half a second to preview it in place. The button in its corner mutes or unmutes previews; the choice is remembered.
- **Click** a tile to open it in the [zoom](#the-zoom). **Cmd-click** (Ctrl-click on Windows and Linux) opens the note instead.
- HDR photos and videos are detected. On an HDR display the grid shows them in HDR unless **HDR tiles** is off in [settings](#settings).

## The zoom

Clicking a tile grows it to fill the window, the way MUBI's notebook does: the tile becomes the full photo, uncropped, and the page fades behind it.

| To | Do this |
| --- | --- |
| Close | Click outside the media, press `Esc`, or scroll the page (the photo rides along, then shrinks back onto its tile) |
| Go to the previous or next item | `Cmd+←` / `Cmd+→` (`Ctrl` on Windows and Linux). On photos, `←` / `→` also work. |
| Show the note's properties | Rest the pointer on the **i** button in the top-right corner, or click it to keep them open. Press `I` to toggle. |
| Open the note | Close the zoom and Cmd-click the tile |

Photos never grow past their real size, so small images stay sharp. The previous/next keys move through the gallery in order, and the gallery scrolls underneath so closing lands on the right tile.

## Videos

Clicking a video opens it in the zoom and plays it with sound, unless previews are muted. If its preview was playing, it carries on from the same moment.

The controls show while the pointer is on the video, and hide after two seconds of no movement while it plays. Clicking the video plays or pauses it; double-clicking toggles fullscreen.

| Key | Action |
| --- | --- |
| `Space` or `K` | Play or pause |
| `←` / `→` | Back or forward 5 seconds |
| `J` / `L` | Back or forward 10 seconds |
| `↑` / `↓` | Volume up or down |
| `M` | Mute or unmute |
| `F` | Fullscreen |
| `Cmd+←` / `Cmd+→` | Previous or next item |
| `Esc` | Leave fullscreen, then close |

In fullscreen the background is black and the corners square. Which codecs play depends on Obsidian's built-in Chromium; see [Supported files](#supported-files).

## PDFs

PDF tiles show their first page and page count. Clicking one opens the page in the zoom and then loads Obsidian's own PDF viewer in place, with its toolbar, page navigation, zoom and search. The scroll wheel scrolls the PDF; click outside or press `Esc` to close. The properties card sits in the bottom-right corner for PDFs, clear of the viewer's toolbar.

Only PDFs in your vault are shown; PDFs from web addresses are skipped.

## Properties and maps

The **i** button in the zoom opens a card with the note's properties, laid out like a Bases card: the first property as the title, the rest as a label over the value. The card shows the properties chosen in the base's **Properties** menu, drawn by Bases itself, so links, tags, lists and dates look the same as elsewhere. Clicking a link in the card closes the zoom and follows it.

- **Hover** the button to peek at the card; it hides again when the pointer leaves.
- **Click** the button to pin the card open (the button stays highlighted). It stays open for the next items until you click it again or press `I`.
- The card nests in the media's corner and scrolls if a note has many properties.

**Maps.** If the note has a location and the [Obsidian Maps](https://obsidian.md/plugins?id=maps) plugin is installed and enabled, the card ends with a small map of that place. Write the location in the **Location property** (default `coordinates`) as text or a list:

```yaml
---
coordinates: "48.85837, 2.294481"
---
```

```yaml
---
coordinates: [48.85837, 2.294481]
---
```

The map is drawn by Obsidian Maps and loads map tiles from the server set in its settings (OpenFreeMap by default). If Obsidian Maps is turned off, the map's place shows "Unknown view type: map".

## Images in notes

Images in your notes open with the same zoom instead of Obsidian's image viewer: click an image in reading view or while editing. Images that are links, and small images such as icons, keep their usual behaviour.

Turn this off with **Zoom images in notes** in [settings](#settings).

## Media notes

A media note is a note that stands for one photo, video or PDF: its **Media note property** (default `url`) links to the file. Embedding a media note shows the media itself, exactly as if you had embedded the file:

```markdown
![[Sunset]]
![[Sunset|300]]
```

instead of the note's title, border and text. In reading view and while editing, the embed is Obsidian's own image, video or PDF embed, so everything works as usual: the resize handle (which writes the size into the link, `![[Sunset|300]]`), the zoom and **Edit this block** buttons, and the photo staying in view below the link while you edit it.

**Choosing which notes count.** By default every note whose media note property links to media counts. To limit it, add Bases filters under **Media notes** in [settings](#settings), for example "**categories** contains `[[Photos]]`" or "**file.folder** is `Photos`". The filters use the same editor as a base's filters.

**Turning it off.** Clear **Media note property**.

> [!note]
> Obsidian has no public API for filters outside a base or for changing how embeds are built, so media notes use Bases' and Obsidian's internals, the same way the Custom Views plugin does. If a future Obsidian version changes them, media notes go back to ordinary note embeds until the plugin is updated; nothing else is affected.

## Settings

**Settings → Media Manager**:

| Setting | Default | What it does |
| --- | --- | --- |
| **HDR tiles** | On | On HDR displays, show HDR photos and videos in HDR in the grid. Off uses smaller standard thumbnails and less memory. Opened items are always in HDR. |
| **Zoom images in notes** | On | Open images in notes with the gallery zoom instead of Obsidian's image viewer. |
| **Media note property** | `url` | The property that links a media note to its photo, video or PDF. Empty turns media notes off. |
| **Media notes** | No filters | Bases filters that decide which notes are media notes. No filters: every note with the property. |

Per-gallery options (layout, sizes, properties) live in each Gallery view's options, so different bases can look different.

## Commands and keys

| Command | Default keys |
| --- | --- |
| **Media Manager: Show previous item** | `Cmd+←` / `Ctrl+←` while zoomed |
| **Media Manager: Show next item** | `Cmd+→` / `Ctrl+→` while zoomed |

The keys work inside the zoom without setup. The commands let you bind other keys in **Settings → Hotkeys**; they're only available while something is zoomed. See [The zoom](#the-zoom) and [Videos](#videos) for the other keys.

## Supported files

| Kind | Formats |
| --- | --- |
| Photos | JPEG, PNG, GIF, WebP, AVIF, SVG, BMP |
| Videos | MP4, MOV, M4V, WebM, OGV, MKV (H.264, HEVC, VP9 and AV1 play; iPhone HDR and Dolby Vision play their HDR base layer) |
| Documents | PDF (vault files only) |

**Known limits:**
- HEIC and HEIF photos are recognised but don't display: Obsidian's Chromium can't decode them yet.
- Dolby Atmos and other Dolby audio (AC-3, E-AC-3, AC-4) play without sound. Use **Open in default app** on the file instead.
- The plugin hasn't been tested on phones or tablets yet.

## Performance, storage and privacy

- **Startup:** the plugin does no work when Obsidian starts; everything waits until you open a gallery.
- **Speed:** only on-screen tiles exist, tile sizes are computed once per page of 120 items, and images are decoded off the main thread.
- **Storage:** photo sizes and thumbnails (WebP, at a few sizes) are cached in Obsidian's local app storage (IndexedDB) on your device, up to 300 MB; the oldest thumbnails are removed first. Nothing is added to your notes or media, and the cache is never synced or uploaded.
- **Network:** the plugin makes no network requests of its own. Web addresses in your notes are loaded by Obsidian like any embedded image. Maps load tiles through Obsidian Maps.

## Troubleshooting

**The gallery says "No media in this property."** The notes in the base don't have a photo, video or PDF in the **Media property**. Check the property name, and that links resolve (a wiki link to a file that isn't in the vault shows nothing).

**The gallery says "Pick a media property in the view options."** Choose a **Media property**, or filter the base to media files and leave it empty.

**A video shows its icon but won't play.** Its codec isn't supported by Obsidian's Chromium (for example some AVI or WMV files). Converting to MP4 (H.264 or HEVC) fixes it.

**There's no map in the card.** The note has no valid location in the **Location property**, or Obsidian Maps isn't installed and enabled. "Unknown view type: map" means Obsidian Maps is off.

**A media note embeds as an ordinary note.** Check that its **Media note property** links to a photo, video or PDF in the vault, and that it matches the **Media notes** filters.

**Clicking an image in a note opens Obsidian's viewer.** **Zoom images in notes** is off, the image is a link, or it's smaller than 48 pixels.

When reporting a problem, include the relevant part of the `.base` file, an affected note's frontmatter, your Obsidian version, and any error from **View → Toggle Developer Tools → Console**.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) to set up a development build.

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability privately or verify a release's files.

## License

[0BSD](LICENSE)
