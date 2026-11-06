# Contributing to Bases Gallery

## Development setup

You need Node.js 22.13 or later in the 22 line, or Node.js 24 or later, and an Obsidian vault for testing.

```bash
git clone https://github.com/anupchavan/bases-gallery.git
cd bases-gallery
npm install
npm run dev
```

Copy `main.js`, `manifest.json` and `styles.css` into `<Vault>/.obsidian/plugins/bases-gallery/` of a test vault and enable the plugin in **Settings → Community plugins**. To have every build copy itself there, create a gitignored `.local-deploy.json` (see "Local development deployment" in [AGENTS.md](AGENTS.md)).

| Command              | What it does                                 |
| -------------------- | -------------------------------------------- |
| `npm run dev`        | Watch build                                  |
| `npm run build`      | Type-check and production build              |
| `npm run lint`       | ESLint and Stylelint, no warnings allowed    |
| `npm run lint:fix`   | ESLint with auto-fix                         |
| `npm test`           | Tests for the build scripts                  |
| `npm run sync:local` | Copy the current build into the test vaults  |

## Pull requests

1. Branch from `main` and keep the change focused.
2. Run `npm run build`, `npm run lint` and `npm test`.
3. Describe what changed and why, and how you checked it in Obsidian (desktop, mobile, or both).

Use only Obsidian's public API, register listeners with the `this.register*` helpers, use sentence case for UI text, and avoid `!important` in CSS.
