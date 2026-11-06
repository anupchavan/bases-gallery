# Bases Gallery

## Project overview

- Target: Obsidian Community Plugin (TypeScript → bundled JavaScript), plugin id `bases-gallery`.
- Adds a **Gallery** layout to Bases through the public `registerBasesView` API (`src/main.ts`, `src/view/gallery-view.ts`). Requires Obsidian 1.13.0+ (`minAppVersion`).
- Use only Obsidian's public, typed API from the `obsidian` package. No private or undocumented APIs, no monkey-patching of Obsidian internals, no casts to reach unexported members.
- Entry point: `src/main.ts` compiled to `main.js` and loaded by Obsidian.
- Required release artifacts: `main.js`, `manifest.json`, and optional `styles.css`.

## Environment & tooling

- Node.js: 22.13+ in the 22 line, or 24+ (required by eslint 10 and stylelint 18). CI runs 22, 24 and 26.
- **Package manager: npm** (required for this sample - `package.json` defines npm scripts and dependencies).
- **Bundler: esbuild** (required for this sample - `esbuild.config.mjs` and build scripts depend on it). Alternative bundlers like Rollup or webpack are acceptable for other projects if they bundle all external dependencies into `main.js`.
- Types: `obsidian` type definitions.

**Note**: This sample project has specific technical dependencies on npm and esbuild. If you're creating a plugin from scratch, you can choose different tools, but you'll need to replace the build configuration accordingly.

### Install

```bash
npm install
```

### Dev (watch)

```bash
npm run dev
```

### Production build

```bash
npm run build
```

## Linting

- ESLint is preconfigured with `eslint-plugin-obsidianmd` for Obsidian-specific rules. Stylelint (`stylelint.config.mjs`) mirrors the CSS checks in Obsidian's plugin review: no `!important`, and no features Obsidian's Chromium only partly supports.
- `npm run lint` runs both with `--max-warnings 0`. `npm run lint:fix` applies ESLint fixes.
- `tsconfig.json` sets `"types": []`, so `npm run build` fails if plugin code uses Node globals (they don't exist on mobile).
- `.github/workflows/lint.yml` builds, lints and tests every push and pull request.

## File & folder conventions

- **Organize code into multiple files**: Split functionality across separate modules rather than putting everything in `main.ts`.
- Source lives in `src/`. Keep `main.ts` small and focused on plugin lifecycle (loading, unloading, registering commands).
- **Example file structure**:
    ```
    src/
      main.ts           # Plugin entry point, lifecycle management
      settings.ts       # Settings interface and defaults
      commands/         # Command implementations
        command1.ts
        command2.ts
      ui/              # UI components, modals, views
        modal.ts
        view.ts
      utils/           # Utility functions, helpers
        helpers.ts
        constants.ts
      types.ts         # TypeScript interfaces and types
    ```
- **Do not commit build artifacts**: Never commit `node_modules/`, `main.js`, or other generated files to version control.
- Keep the plugin small. Avoid large dependencies. Prefer browser-compatible packages.
- Generated output should be placed at the plugin root or `dist/` depending on your build setup. Release artifacts must end up at the top level of the plugin folder in the vault (`main.js`, `manifest.json`, `styles.css`).

## Manifest rules (`manifest.json`)

- Must include (non-exhaustive):
    - `id` (plugin ID; for local dev it should match the folder name)
    - `name`
    - `version` (Semantic Versioning `x.y.z`)
    - `minAppVersion`
    - `description`
    - `isDesktopOnly` (boolean)
    - Optional: `author`, `authorUrl`, `fundingUrl` (string or map)
- Never change `id` after release. Treat it as stable API.
- Keep `minAppVersion` accurate when using newer APIs.
- Canonical requirements are coded here: https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/validate-plugin-entry.yml

## Testing

- `npm test` runs the Node test runner over `scripts/*.test.mjs` and `test/*.test.mjs` (layouts, header parsing, local deploy).
- Manual install for testing: copy `main.js`, `manifest.json`, `styles.css` to:
    ```
    <Vault>/.obsidian/plugins/bases-gallery/
    ```
- Reload Obsidian and enable the plugin in **Settings → Community plugins**.

### Development vault

The repo lives inside its test vault, the same way as Custom Views: the vault is `~/Projects/bases-gallery` and this repo is its `.obsidian/plugins/bases-gallery` folder, so every build is already installed. The Hot Reload plugin in that vault reloads the plugin when `main.js` or `styles.css` changes. The vault's notes and media (Unsplash photos, Pexels videos) are outside this repo and not committed.

### Local development deployment (other vaults)

After the first manual install, list the installed plugin folders in a gitignored `.local-deploy.json`:

```json
{ "targets": ["/path/to/Vault/.obsidian/plugins/bases-gallery"] }
```

Successful `npm run build` and `npm run dev` builds then copy JS, CSS and manifest to every target. Dev mode also rebuilds on `styles.css` and `manifest.json` changes. For a one-off copy without a build, run `npm run sync:local`. A target is refused unless its `manifest.json` id is `bases-gallery`. `data.json` and other vault files are never copied. Replaced files are backed up in `.local-deploy-backups/`. Check for the `[local deploy]` line before reporting an install; the sync installs files but does not reload the running app (use the Hot Reload plugin or reload Obsidian).

## Commands & settings

- Any user-facing commands should be added via `this.addCommand(...)`.
- If the plugin has configuration, provide a settings tab and sensible defaults.
- Persist settings using `this.loadData()` / `this.saveData()`.
- Use stable command IDs; avoid renaming once released.

## Versioning & releases

- `npm version <x.y.z>` bumps `package.json`, then `version-bump.mjs` updates `manifest.json` and adds the version → `minAppVersion` entry to `versions.json`. Tags have no `v` prefix (`.npmrc`).
- Write the release notes in `.github/release-notes/<x.y.z>.md` before releasing. The release workflow fails without them.
- Release by pushing the tag, or by running **Release Obsidian plugin** from the Actions tab with the version (it tags the chosen branch itself).
- `.github/workflows/release.yml` lints, tests and builds, checks that the tag, `manifest.json`, `package.json` and `versions.json` agree, attests build provenance, and creates a **draft** release with `main.js`, `manifest.json` and `styles.css`. Publish the draft by hand.
- Betas: put the beta version in `manifest-beta.json` (same fields as `manifest.json`) and release that version. It ships as a pre-release installable with BRAT. Keep `manifest.json` on the stable version (undo the `npm version` change to it) so the community store keeps offering that.
- After the initial release, follow the process to add/update the plugin in the community catalog.

## Security, privacy, and compliance

Follow Obsidian's **Developer Policies** and **Plugin Guidelines**. In particular:

- Default to local/offline operation. Only make network requests when essential to the feature.
- No hidden telemetry. If you collect optional analytics or call third-party services, require explicit opt-in and document clearly in `README.md` and in settings.
- Never execute remote code, fetch and eval scripts, or auto-update plugin code outside of normal releases.
- Minimize scope: read/write only what's necessary inside the vault. Do not access files outside the vault.
- Clearly disclose any external services used, data sent, and risks.
- Respect user privacy. Do not collect vault contents, filenames, or personal information unless absolutely necessary and explicitly consented.
- Avoid deceptive patterns, ads, or spammy notifications.
- Register and clean up all DOM, app, and interval listeners using the provided `register*` helpers so the plugin unloads safely.

## UX & copy guidelines (for UI text, commands, settings)

- Prefer sentence case for headings, buttons, and titles.
- Use clear, action-oriented imperatives in step-by-step copy.
- Use **bold** to indicate literal UI labels. Prefer "select" for interactions.
- Use arrow notation for navigation: **Settings → Community plugins**.
- Keep in-app strings short, consistent, and free of jargon.

## Performance

- Keep startup light. Defer heavy work until needed.
- Avoid long-running tasks during `onload`; use lazy initialization.
- Batch disk access and avoid excessive vault scans.
- Debounce/throttle expensive operations in response to file system events.

## Coding conventions

- TypeScript with `"strict": true` preferred.
- **Keep `main.ts` minimal**: Focus only on plugin lifecycle (onload, onunload, addCommand calls). Delegate all feature logic to separate modules.
- **Split large files**: If any file exceeds ~200-300 lines, consider breaking it into smaller, focused modules.
- **Use clear module boundaries**: Each file should have a single, well-defined responsibility.
- Bundle everything into `main.js` (no unbundled runtime deps).
- Avoid Node/Electron APIs if you want mobile compatibility; set `isDesktopOnly` accordingly.
- Prefer `async/await` over promise chains; handle errors gracefully.

## Mobile

- Where feasible, test on iOS and Android.
- Don't assume desktop-only behavior unless `isDesktopOnly` is `true`.
- Avoid large in-memory structures; be mindful of memory and storage constraints.

## Agent do/don't

**Do**

- Add commands with stable IDs (don't rename once released).
- Provide defaults and validation in settings.
- Write idempotent code paths so reload/unload doesn't leak listeners or intervals.
- Use `this.register*` helpers for everything that needs cleanup.

**Don't**

- Introduce network calls without an obvious user-facing reason and documentation.
- Ship features that require cloud services without clear disclosure and explicit opt-in.
- Store or transmit vault contents unless essential and consented.

## Common tasks

### Organize code across multiple files

**main.ts** (minimal, lifecycle only):

```ts
import { Plugin } from 'obsidian';
import { MySettings, DEFAULT_SETTINGS } from './settings';
import { registerCommands } from './commands';

export default class MyPlugin extends Plugin {
	settings!: MySettings;

	async onload() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MySettings>,
		);
		registerCommands(this);
	}
}
```

**settings.ts**:

```ts
export interface MySettings {
	enabled: boolean;
	apiKey: string;
}

export const DEFAULT_SETTINGS: MySettings = {
	enabled: true,
	apiKey: '',
};
```

**commands/index.ts**:

```ts
import { Plugin } from 'obsidian';
import { doSomething } from './my-command';

export function registerCommands(plugin: Plugin) {
	plugin.addCommand({
		id: 'do-something',
		name: 'Do something',
		callback: () => doSomething(plugin),
	});
}
```

### Add a command

```ts
this.addCommand({
	id: 'your-command-id',
	name: 'Do the thing',
	callback: () => this.doTheThing(),
});
```

### Persist settings

```ts
interface MySettings { enabled: boolean }
const DEFAULT_SETTINGS: MySettings = { enabled: true };

async onload() {
  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MySettings>);
  await this.saveData(this.settings);
}
```

### Register listeners safely

```ts
this.registerEvent(
	this.app.workspace.on('file-open', (f) => {
		/* ... */
	}),
);
this.registerDomEvent(activeWindow, 'resize', () => {
	/* ... */
});
this.registerInterval(
	window.setInterval(() => {
		/* ... */
	}, 1000),
);
```

## Troubleshooting

- Plugin doesn't load after build: ensure `main.js` and `manifest.json` are at the top level of the plugin folder under `<Vault>/.obsidian/plugins/<plugin-id>/`.
- Build issues: if `main.js` is missing, run `npm run build` or `npm run dev` to compile your TypeScript source code.
- Commands not appearing: verify `addCommand` runs after `onload` and IDs are unique.
- Settings not persisting: ensure `loadData`/`saveData` are awaited and you re-render the UI after changes.
- Mobile-only issues: confirm you're not using desktop-only APIs; check `isDesktopOnly` and adjust.

## References

- Obsidian sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin
- API documentation: https://docs.obsidian.md
- Developer policies: https://docs.obsidian.md/Developer+policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Style guide: https://help.obsidian.md/style-guide
