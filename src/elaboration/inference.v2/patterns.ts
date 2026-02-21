import { match } from "ts-pattern";



import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";


import * as M from "@yap/monad"

import * as Src from "@yap/src/index";
import * as Lit from "@yap/shared/literals";

import * as R from "@yap/shared/rows";
import { capitalize } from "lodash";

import * as CST from "@yap/cst";
import { PatternNode, SyntaxType } from "@yap/cst/types/generated";
import { iife } from "@yap/utils";


type Tags<T, K> = K extends string ? (T extends { [k in K]: infer U } ? U : never) : never;


// Remove "pattern_" prefix if it exists
type RemovePatternPrefix<T extends string> = T extends `pattern_${infer Rest}` ? Rest : T;

// Convert snake_case to PascalCase
type SnakeToPascal<S extends string> =
	S extends `${infer First}_${infer Rest}`
	? `${Capitalize<First>}${SnakeToPascal<Rest>}`
	: Capitalize<S>;

// Normalize pattern names: remove prefix and convert to PascalCase
export type NormalizeKey<T extends string> = SnakeToPascal<RemovePatternPrefix<T>>;

// Runtime equivalent of NormalizeKey
export const normalizeKey = (key: string): string => {
	const withoutPrefix = key.startsWith("pattern_") ? key.slice(8) : key;
	return withoutPrefix
		.split("_")
		.map(capitalize)
		.join("");
};

export type Inference<T, Key> = Key extends string
	? Tags<T, Key> extends string
	? {
		[k in Tags<T, Key> as NormalizeKey<k>]: {
			(pattern: Extract<CST.Types.PatternNode, { [t in Key]: k }>): M.Elaboration<Result>;
			gen: (pattern: Extract<CST.Types.PatternNode, { [t in Key]: k }>) => ReturnType<typeof M.pure<Result>>;
		};
	}
	: "Error: Key does not map to string tags"
	: "Error: Key is not a string";

export type Result = [EB.Pattern, NF.Value, Binder[]];
export type Binder = [string, NF.Value];


export const infer: Inference<CST.Types.PatternNode, "type"> = {
	Literal: M.regen(pat => {
		const node = pat.firstChild;
		if (!node) {
			throw new Error("Literal node has no children");
		}

		const typing: readonly [Lit.Literal, Lit.Literal] = match(node.type)
			.with(SyntaxType.String, _ => [Lit.String(node.text), Lit.Atom("String")] as const)
			.with(SyntaxType.Number, _ => [Lit.Num(Number(node.text)), Lit.Atom("Num")] as const)
			.with(SyntaxType.Boolean, _ => [Lit.Bool(node.text === "true"), Lit.Atom("Bool")] as const)
			.with(SyntaxType.Bang, _ => [Lit.unit(), Lit.Atom("Unit")] as const)
			.with(SyntaxType.Unit, _ => [Lit.Unit(), Lit.Atom("Type")] as const)
			.with(SyntaxType.Row, _ => [Lit.Row(), Lit.Atom("Type")] as const)
			.with(SyntaxType.TypeOfTypes, _ => [Lit.Type(), Lit.Atom("Type")] as const)
			.otherwise(_ => {
				throw new Error(`Unknown literal type: ${node.type}`);
			})

		return M.Do<Result, EB.Context>(function* () {
			return [EB.Constructors.Patterns.Lit(typing[0]), NF.Constructors.Lit(typing[1]), []] satisfies Result;
		});
	}),

	Identifier: M.regen(pat =>
		M.Do(function* () {
			const ctx = yield* M.ask();

			// TODO:FIXME: Remove this check for now. Let's ignore matching on defined variables for now, until we answer how to match on lambdas and others
			// const free = ctx.imports[pat.value.value];
			// if (free) {
			// 	const [tm, ty, us] = free;
			// 	return [EB.Constructors.Patterns.Var(pat.value.value, tm), ty, us, []];
			// }
			const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const meta = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));
			const va = NF.evaluate(ctx, meta);
			const binder: Binder = [pat.text, va];
			return [{ type: "Binder", value: pat.text }, va, [binder]];
		}),
	),
	Row: M.regen(pat =>
		M.Do(function* () {

			const { field: pairs, tail } = CST.Utils.extractFields(pat, ["field"], "tail")


			if (pairs.some(p => p.type !== "key_value")) {
				throw new Error("Expected all row elements to be key-value pairs");
			}
			if (tail && tail.type !== "identifier") {
				throw new Error("Expected row tail to be an identifier");
			}

			// Extract label-pattern tuples from key-value pairs
			const pats = (pairs as CST.Types.PatternKeyValueNode[]).map<[string, CST.Types.SyntaxNode]>(pair => {
				const { key: label, pattern } = CST.Utils.extractFields(pair, "key", "pattern");
				return [label.text, pattern];
			});

			const [r, rowty, binders] = yield* elaborate(pats, tail as CST.Types.IdentifierNode | undefined);
			return [EB.Constructors.Patterns.Row(r), NF.Constructors.Row(rowty), binders] satisfies Result;
		}),
	),
	Struct: M.regen(pat =>
		M.Do(function* () {
			const { field: pairs, tail } = CST.Utils.extractFields(pat, ["field"], "tail")

			// Extract label-pattern tuples from key-value pairs
			const pats = (pairs as CST.Types.PatternKeyValueNode[]).map<[string, CST.Types.SyntaxNode]>(pair => {
				const { key: label, pattern } = CST.Utils.extractFields(pair, "key", "pattern");
				return [label.text, pattern];
			});

			const [tm, ty, binders] = yield* elaborate(pats, tail as CST.Types.IdentifierNode | undefined);
			return [EB.Constructors.Patterns.Struct(tm), NF.Constructors.Schema(ty), binders] satisfies Result;
		}),
	),

	Tagged: M.regen(pat =>
		M.Do(function* () {
			const ctx = yield* M.ask();
			const { tag, payload } = CST.Utils.extractFields(pat, "tag", "payload");

			const meta = yield* EB.freshMeta(ctx.env.length, NF.Row);
			const binder: Binder = [`$row_${meta.val}`, NF.Constructors.Var(meta)];


			const id = normalizeKey(payload.type) as NormalizeKey<PatternNode["type"]>;
			const val = yield* infer[id].gen(payload as any);
			const ty = NF.Constructors.Extension(tag.text, val[1], R.Constructors.Variable(meta));
			const tm = EB.Constructors.Patterns.Extension(tag.text, val[0], R.Constructors.Variable(binder[0]));
			const binders = [val[2], [binder]].flat();

			return [EB.Constructors.Patterns.Variant(tm), NF.Constructors.Variant(ty), binders] satisfies Result;
		}),
	),

	Wildcard: M.regen(_ =>
		M.Do(function* () {
			const ctx = yield* M.ask();
			const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const meta = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));
			return [EB.Constructors.Patterns.Wildcard(), meta, []];
		}),
	),

	Tuple: M.regen(pat =>
		M.Do(function* () {
			const { element: elements, tail } = CST.Utils.extractFields(pat, ["element"], "tail");

			// Build index-based label-pattern tuples
			const pats: [string, CST.Types.PatternNode][] = elements.map((elem, idx) => [
				idx.toString(),
				elem as CST.Types.PatternNode
			]);

			const [tm, ty, binders] = yield* elaborate(pats, tail as CST.Types.IdentifierNode | undefined);
			return [EB.Constructors.Patterns.Struct(tm), NF.Constructors.Schema(ty), binders] satisfies Result;
		}),
	),
	List: M.regen(pat =>
		M.Do(function* () {
			const ctx = yield* M.ask();
			const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const mvar = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));

			const v = NF.evaluate(ctx, mvar);

			const validate = (val: CST.Types.PatternNode) =>
				M.Do(function* () {
					const key = capitalize(val.type) as keyof typeof infer;

					const result = yield* infer[key].gen(val as Extract<Src.Pattern, { type: typeof key }>);
					yield* M.tell("constraint", { type: "assign", left: result[1], right: v });
					return result;
				});

			const { element: elements, tail } = CST.Utils.extractFields(pat, ["element"], "tail");
			const es = yield* M.pure(M.traverse(elements as CST.Types.PatternNode[], validate));

			const [pats, binders] = es.reduce(([pats, binders], [pat, , b]) => [pats.concat(pat), binders.concat(b)], [[], []] as [EB.Pattern[], Binder[]]);

			const indexing = NF.Constructors.App(NF.Indexed, NF.Constructors.Lit(Lit.Atom("Num")), "Explicit");
			const values = NF.Constructors.App(indexing, v, "Explicit");

			const ty = NF.Constructors.App(values, NF.Constructors.Var({ type: "Foreign", name: "defaultArray" }), "Implicit");

			return [
				EB.Constructors.Patterns.List(pats, tail?.text),
				NF.Constructors.Neutral(ty),
				tail ? binders.concat([[tail.text, ty]]) : binders,
			];
		}),
	),
};

type Row = R.Row<EB.Pattern, string>;
type RowResult = [Row, NF.Row, Binder[]];

const elaborate = function* (labeledPatterns: [string, CST.Types.SyntaxNode][], tail?: CST.Types.IdentifierNode | undefined): Generator<M.Elaboration<any>, RowResult, any> {

	const ctx = yield* M.ask();

	const init = yield* iife(function* () {
		const meta = yield* EB.freshMeta(ctx.env.length, NF.Row);
		const varname = tail ? tail.text : `$row_${meta.val}`;
		const binder: Binder = [varname, NF.Constructors.Var(meta)];
		return [R.Constructors.Variable(varname), R.Constructors.Variable(meta), [binder]] satisfies RowResult;
	})

	const foldRight = function* (pairs: [string, CST.Types.SyntaxNode][], acc: RowResult): Generator<M.Elaboration<any>, RowResult, any> {
		if (pairs.length === 0) {
			return acc;
		}
		const [label, pattern] = pairs[pairs.length - 1];
		const rest = pairs.slice(0, -1);

		// Process the rest first (right to left)
		const r = yield* foldRight(rest, acc);

		// Then process current pair with the result
		const id = normalizeKey(pattern.type) as NormalizeKey<PatternNode["type"]>;
		const val = yield* infer[id].gen(pattern as any);
		const ty = NF.Constructors.Extension(label, val[1], r[1]);
		const tm = EB.Constructors.Patterns.Extension(label, val[0], r[0]);
		const binders = [val[2], r[2]].flat();

		return [tm, ty, binders] satisfies RowResult;
	};

	const row = yield* foldRight(labeledPatterns, init)
	return row;

};
