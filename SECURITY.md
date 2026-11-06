# Security policy

## Supported versions

Only the latest release of Media Manager receives security fixes. Update before reporting, and say which version you tested.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub's private vulnerability reporting](https://github.com/anupchavan/obsidian-media-manager/security/advisories/new). Do not open a public issue, discussion or pull request for an unfixed vulnerability.

A useful report includes:

- the Media Manager and Obsidian versions, and your platform (desktop or mobile, and OS)
- the smallest note, media file or `.base` file that reproduces the problem
- what an attacker controls, and what they gain

You will get an acknowledgement within 7 days. Fixes ship in a new release, and the advisory is published once that release is available. Reporters are credited in the advisory unless they ask not to be.

## Trust model

Media Manager shows photos, videos and PDFs that notes point to, and runs no code from notes or settings.

**Note contents are not trusted.** Notes often come from somewhere else: shared vaults, synced folders, web clippings or imported files. Nothing in a note's properties, body or linked media should be able to run code, inject HTML or reach files the note didn't link to. Property values are shown through Obsidian's own `Value.renderTo`, and media is loaded only as images, videos or PDFs.

**Media files are not trusted.** Headers are parsed in plain TypeScript with bounds checks (`src/media/dimensions.ts`), images and videos are decoded by Obsidian's Chromium, and PDFs by Obsidian's own PDF.js.

**Network.** The plugin makes no network requests of its own. A web address in a note's media property is loaded by Obsidian like any embedded image. Maps in the properties panel come from the Obsidian Maps plugin, which loads map tiles from the server set in its own settings.

**Private Obsidian API.** Media notes use Bases' filter parser and Obsidian's embed factories, which have no public API (`src/embeds/`). They are found at run time, only read and wrap what Obsidian already does, and do nothing if Obsidian changes them.

### In scope

- Note contents or media files that run JavaScript, inject HTML or attributes, or crash or hang Obsidian
- A note or media file that makes the plugin read files or settings it wasn't pointed at
- Problems in the released `main.js`, `manifest.json` or `styles.css`

### Out of scope

- Someone who can already edit your vault's `.obsidian` folder, where the plugin and its settings are stored. They can already install plugins.
- Vulnerabilities in Obsidian, its Chromium, PDF.js or the Obsidian Maps plugin. Report those to [Obsidian](https://obsidian.md/security).
- Advisories for development dependencies (test, lint and build tools) that do not reach the released files. Dependabot tracks these and they are fixed as routine maintenance.

## Verifying a release

Every release is built by GitHub Actions from its tag and published with [build provenance attestations](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations). To check that a downloaded file came from this repository's workflow:

```bash
gh attestation verify main.js --repo anupchavan/obsidian-media-manager
```

## For contributors

Changes are reviewed against the trust model above. In particular:

- **Never insert note data as HTML.** Use `createEl`, `setText` or `Value.renderTo`; no `innerHTML`, `insertAdjacentHTML` or `eval`.
- **No network access in plugin code.** Media comes from the vault or from addresses the user wrote.
- **Keep private API in `src/embeds/`,** behind run-time checks that fail softly, and list each use in the audit.
- **Keep runtime dependencies few.** Every package in `dependencies` ships inside `main.js`. Prefer Obsidian's API over a new package, and explain any new runtime dependency in the pull request.
- **Run `npm audit` before opening a pull request** that changes `package.json` or `package-lock.json`.
- **Never commit secrets or personal vault data.** `data.json` holds your local settings and must stay out of commits.

If you are unsure whether a change affects security, say so in the pull request and it will get a closer look.
