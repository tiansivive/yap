import eslint from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import n from "eslint-plugin-n";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";

const bannedMutation = [
	{
		selector: "CallExpression[callee.property.name='push']",
		message: ".push() is banned. Use spread or concat.",
	},
	{
		selector: "CallExpression[callee.property.name='pop']",
		message: ".pop() is banned. Use slice.",
	},
	{
		selector: "CallExpression[callee.property.name='shift']",
		message: ".shift() is banned. Use destructuring or slice.",
	},
	{
		selector: "CallExpression[callee.property.name='unshift']",
		message: ".unshift() is banned. Use spread.",
	},
	{
		selector: "CallExpression[callee.property.name='splice']",
		message: ".splice() is banned. Use slice + spread.",
	},
];

const bannedSyntax = [
	{
		selector: "VariableDeclaration[kind='let']",
		message: "let is banned. Use const, recursion, or reduce.",
	},
	{
		selector: "ForStatement",
		message: "for loops are banned. Use map/filter/reduce/recursion.",
	},
	{
		selector: "ForInStatement",
		message: "for-in loops are banned. Use Object.entries + map/reduce.",
	},
	{
		selector: "ForOfStatement",
		message: "for-of loops are banned. Use map/filter/reduce/recursion.",
	},
	{
		selector: "WhileStatement",
		message: "while loops are banned. Use recursion.",
	},
	{
		selector: "DoWhileStatement",
		message: "do-while loops are banned. Use recursion.",
	},
	{
		selector: "IfStatement > .alternate",
		message: "else is banned. Use early return, match, or ternary.",
	},
	{
		selector: "Literal[value=null]",
		message: "null is banned. Use undefined.",
	},
	...bannedMutation,
	{
		selector: "CallExpression[callee.name='pipe'][arguments.length=2]",
		message: "pipe(x, f) is just f(x). Call the function directly.",
	},
];

export default tseslint.config(
	{
		ignores: [
			"coverage*",
			"lib",
			"node_modules",
			"pnpm-lock.yaml",
			"**/*.snap",
			"src/parser/grammar.ts",
			// Build artifacts
			"bin",
			"dist",
			// Nested repo with its own conventions
			"z-yap",
			// Not part of the tsconfig project: highlight grammars, browser assets, example FFI shims
			"tooling",
			"src/cli/explore/static",
			"examples/**/*.js",
			// Deprecated direct-lowering path (D-006). NOTE: mir.ts, interpret.ts, and
			// shared/primops are still live (GRAM bridge + pipeline imports) — migrate them
			// out so they regain lint coverage, then delete the rest.
			"src/lowering",
		],
	},
	{
		linterOptions: {
			reportUnusedDisableDirectives: "error",
		},
	},
	eslint.configs.recommended,
	{
		...n.configs["flat/recommended"],
		rules: {
			...n.configs["flat/recommended"].rules,
			"n/no-missing-import": "off",
		},
	},
	...tseslint.config({
		extends: tseslint.configs.recommendedTypeChecked,
		files: ["**/*.js", "**/*.mjs", "**/*.ts"],
		plugins: { "unused-imports": unusedImports },
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["*.*s", "eslint.config.js"],
					defaultProject: "./tsconfig.json",
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// These on-by-default rules don't work well for this repo and we like them off.
			"no-constant-condition": "off",
			// V2.Do dispatch: every ts-pattern .with() handler is a function* so the match
			// delegates uniformly; pure branches legitimately never yield.
			"require-yield": "off",
			// Namespace-based APIs are the house style (coding-style.mdc).
			"@typescript-eslint/no-namespace": "off",
			// Open-vocabulary aliases (GRAM Tag/Label are both string) make unions like
			// Tag | Label checker-identical but reader-meaningful; keep the documentation.
			"@typescript-eslint/no-duplicate-type-constituents": "off",

			// Dead imports are auto-fixable (--fix and IDE-on-save keep them at zero);
			// unused locals stay manual review below, since they can be bug symptoms.
			"unused-imports/no-unused-imports": "error",

			// These on-by-default rules work well for this repo if configured
			// `_`-prefix declares a binding intentionally unused: descriptive param names,
			// documented destructurings. Unprefixed unused bindings stay errors (rot).
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					caughtErrors: "all",
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
					destructuredArrayIgnorePattern: "^_",
					ignoreRestSiblings: true,
				},
			],
			// The else-ban pushes side-effect ternaries; allow them here rather than fight it.
			"@typescript-eslint/no-unused-expressions": ["error", { allowTernary: true }],

			// ── Immutability ────────────────────────────────────
			"prefer-const": "error",
			"no-var": "error",
			"no-param-reassign": "error",

			// ── Strict equality ─────────────────────────────────
			eqeqeq: ["error", "always"],

			// ── Type safety ─────────────────────────────────────
			"@typescript-eslint/no-non-null-assertion": "error",
			"@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],

			// ── fp-ts: composition over inspection ──────────────
			"no-restricted-properties": [
				"error",
				{
					property: "isSome",
					message: "Don't inspect Option. Use map/match/getOrElse.",
				},
				{
					property: "isNone",
					message: "Don't inspect Option. Use map/match/getOrElse.",
				},
				{
					property: "isLeft",
					message: "Don't inspect Either. Use map/chain/match.",
				},
				{
					property: "isRight",
					message: "Don't inspect Either. Use map/chain/match.",
				},
			],

			// ── Banned syntax ───────────────────────────────────
			"no-restricted-syntax": ["error", ...bannedSyntax],
		},
	}),
	{
		// In declaration files an import can be load-bearing with zero references:
		// module-hood decides whether `declare module` augments or replaces.
		files: ["**/*.d.ts"],
		rules: {
			"unused-imports/no-unused-imports": "off",
		},
	},
	{
		// Primitives table uses sparse tuples for positional-optional entries.
		files: ["src/shared/lib/**"],
		rules: {
			"no-sparse-arrays": "off",
		},
	},
	{
		// CLI entry points: thin commander glue over untyped cmd/opts objects;
		// process.exit is the correct exit path; hashbang is intentional.
		extends: [tseslint.configs.disableTypeChecked],
		files: ["scripts/**"],
		rules: {
			"n/no-process-exit": "off",
			"n/hashbang": "off",
		},
	},
	{
		// Root config files: CJS, untyped, outside the project graph.
		extends: [tseslint.configs.disableTypeChecked],
		files: ["*.config.js", "*.config.cjs", "*.config.mjs"],
		rules: {
			"@typescript-eslint/no-require-imports": "off",
		},
	},
	{
		files: ["*.jsonc"],
		rules: {
			"jsonc/comma-dangle": "off",
			"jsonc/no-comments": "off",
			"jsonc/sort-keys": "error",
		},
	},
	{
		extends: [tseslint.configs.disableTypeChecked],
		files: ["**/*.md/*.ts"],
	},
	{
		files: ["**/*.test.*", "**/__tests__/**"],
		languageOptions: {
			globals: vitest.environments.env.globals,
		},
		plugins: { vitest },
		rules: {
			...vitest.configs.recommended.rules,

			// These on-by-default rules aren't useful in test files.
			"@typescript-eslint/no-unsafe-assignment": "off",
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/consistent-type-assertions": "off",
			// Tests exercise untyped boundaries (Nearley results, new Function, FFI shims);
			// the unsafe-* family and explicit any are noise there.
			"@typescript-eslint/no-unsafe-member-access": "off",
			"@typescript-eslint/no-unsafe-argument": "off",
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/no-explicit-any": "off",
			// Either narrowing (if (E.isRight(r)) …) is the natural assertion idiom in tests.
			"no-restricted-properties": "off",
		},
	},
);
