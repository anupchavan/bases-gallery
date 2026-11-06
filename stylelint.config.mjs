// Mirrors the CSS checks in Obsidian's plugin review, so they show up before a release does.
// The review flags features that its target Chromium only partly supports, and any !important.
export default {
	plugins: ['stylelint-no-unsupported-browser-features'],
	rules: {
		'plugin/no-unsupported-browser-features': [true, { browsers: ['chrome 132'], severity: 'warning' }],
		// The plugin review flags :has for its broad selector invalidation.
		'selector-pseudo-class-disallowed-list': [
			['has'],
			{ message: 'Avoid :has: it can cause significant performance issues. Toggle a class from code instead.' },
		],
		'declaration-no-important': [
			true,
			{
				message: "Avoid !important: raise the selector's specificity or use a CSS variable instead.",
			},
		],
	},
};
