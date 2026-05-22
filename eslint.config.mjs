import eslint from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import n from "eslint-plugin-n";
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
		ignores: ["coverage*", "lib", "node_modules", "pnpm-lock.yaml", "**/*.snap", "src/parser/grammar.ts"],
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
		files: ["**/*.js", "**/*.ts"],
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

			// These on-by-default rules work well for this repo if configured
			"@typescript-eslint/no-unused-vars": ["error", { caughtErrors: "all" }],

			// ── Immutability ────────────────────────────────────
			"prefer-const": "error",
			"no-var": "error",
			"no-param-reassign": "error",
			"no-plusplus": "error",

			// ── Strict equality ─────────────────────────────────
			eqeqeq: ["error", "always"],

			// ── Type safety ─────────────────────────────────────
			"@typescript-eslint/no-non-null-assertion": "error",
			"@typescript-eslint/consistent-type-assertions": ["warn", { assertionStyle: "never" }],

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
		files: ["src/lowering/**/*.ts"],
		rules: {
			"no-restricted-syntax": ["error", ...bannedSyntax.filter(s => !s.selector.includes("'push'"))],
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
		files: ["**/*.test.*"],
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
		},
	},
);
