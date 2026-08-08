import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as M from "@yap/elaboration/shared/effects";

import * as Src from "@yap/src/index";
import * as Lit from "@yap/shared/literals";

import * as R from "@yap/shared/rows";
import { capitalize } from "lodash";

type Tags<T, K> = K extends string ? (T extends { [k in K]: infer U } ? U : never) : never;
export type Inference<T, Key> = Key extends string
	? Tags<T, Key> extends string
		? {
				[k in Tags<T, Key> as Capitalize<k>]: (pattern: Extract<Src.Pattern, { [t in Key]: k }>) => M.Elaboration<Result>;
			}
		: never
	: never;

export type Result = [EB.Pattern, NF.Value, Q.Usages, Binder[]];
export type Binder = [string, NF.Value];

export const infer: Inference<Src.Pattern, "type"> = {
	Lit: function* (pat) {
		const atom: Lit.Literal = match(pat.value)
			.with({ type: "String" }, _ => Lit.Atom("String"))
			.with({ type: "Num" }, _ => Lit.Atom("Num"))
			.with({ type: "Bool" }, _ => Lit.Atom("Bool"))
			.with({ type: "Atom" }, _ => Lit.Atom("Type"))
			.with({ type: "unit" }, _ => Lit.Atom("Unit"))

			.exhaustive();

		const ctx = yield* M.reader.ask();
		return [EB.Constructors.Patterns.Lit(pat.value), NF.Constructors.Lit(atom), Q.noUsage(ctx.env.length), []] satisfies Result;
	},

	Var: function* (pat) {
		const ctx = yield* M.reader.ask();

		// TODO:FIXME: Remove this check for now. Let's ignore matching on defined variables for now, until we answer how to match on lambdas and others
		// const free = ctx.imports[pat.value.value];
		// if (free) {
		// 	const [tm, ty, us] = free;
		// 	return [EB.Constructors.Patterns.Var(pat.value.value, tm), ty, us, []];
		// }
		const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
		const meta = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));
		const va = NF.evaluate(ctx, meta);
		const zero = Q.noUsage(ctx.env.length);
		const binder: Binder = [pat.value.value, va];
		return [{ type: "Binder", value: pat.value.value }, va, zero, [binder]];
	},

	Row: function* (pat) {
		const [r, rowty, rus, binders] = yield* elaborate(pat.row);
		return [EB.Constructors.Patterns.Row(r), NF.Constructors.Row(rowty), rus, binders] satisfies Result;
	},

	Struct: function* (pat) {
		const [tm, ty, qs, binders] = yield* elaborate(pat.row);
		return [EB.Constructors.Patterns.Struct(tm), NF.Constructors.Schema(ty), qs, binders] satisfies Result;
	},

	Variant: function* (pat) {
		//const ctx = yield* M.reader.ask();
		const [r, rowty, rus, binders] = yield* elaborate(pat.row);
		// const addVar = function* (nfr: NF.Row): M.Elaboration<NF.Row> {
		// 	if (nfr.type === "empty") {
		// 		return R.Constructors.Variable(yield* EB.freshMeta(ctx.env.length, NF.Row));
		// 	}

		// 	if (nfr.type === "variable") {
		// 		return nfr;
		// 	}
		// 	const tail = yield* addVar(nfr.row);
		// 	return R.Constructors.Extension(nfr.label, nfr.value, tail);
		// };

		// const tail = yield* addVar(rowty);
		return [EB.Constructors.Patterns.Variant(r), NF.Constructors.Variant(rowty), rus, binders] satisfies Result;
	},

	Wildcard: function* (_) {
		const ctx = yield* M.reader.ask();
		const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
		const meta = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));
		return [EB.Constructors.Patterns.Wildcard(), meta, Q.noUsage(ctx.env.length), []];
	},

	Tuple: function* (pat) {
		const [r, rowty, qs, binders] = yield* elaborate(pat.row);
		return [EB.Constructors.Patterns.Struct(r), NF.Constructors.Schema(rowty), qs, binders] satisfies Result;
	},

	List: function* (pat) {
		const ctx = yield* M.reader.ask();
		const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
		const mvar = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));

		const v = NF.evaluate(ctx, mvar);

		const validate = function* (val: Src.Pattern) {
			const key = capitalize(val.type) as keyof typeof infer;

			const result = yield* infer[key](val as Extract<Src.Pattern, { type: typeof key }>);
			yield* M.constrain({ type: "assign", left: result[1], right: v, lvl: ctx.env.length });
			return result;
		};

		const es = yield* M.traverse(pat.elements, validate);

		const [pats, binders] = es.reduce(([pats, binders], [pat, , , b]) => [pats.concat(pat), binders.concat(b)], [[], []] as [EB.Pattern[], Binder[]]);

		const ty = NF.Constructors.Indexed(NF.Constructors.Lit(Lit.Atom("Num")), v, NF.Constructors.Var({ type: "Foreign", name: "defaultArray" }));

		return [
			EB.Constructors.Patterns.List(pats, pat.rest?.value),
			ty,
			Q.noUsage(ctx.env.length),
			pat.rest ? binders.concat([[pat.rest.value, ty /*, Q.noUsage(ctx.env.length)*/]]) : binders,
		];
	},
};

type Row = R.Row<EB.Pattern, string>;
type RowResult = [Row, NF.Row, Q.Usages, Binder[]];

const elaborate = function* (r: R.Row<Src.Pattern, Src.Variable>): M.Elaboration<RowResult> {
	const ctx = yield* M.reader.ask();

	const rr: RowResult = yield* match(r)
		.with({ type: "empty" }, function* (_r) {
			const meta = yield* EB.freshMeta(ctx.env.length, NF.Row);
			const fresh = `$row_${meta.val}`;
			const binder: Binder = [fresh, NF.Constructors.Var(meta)];
			const zeros = Q.noUsage(ctx.env.length);
			// If the pattern row is empty, we create a fresh row variable so we can match against wider rows
			// The user never sees this variable, but it allows unification to work properly
			return [R.Constructors.Variable(fresh), R.Constructors.Variable(meta), zeros, [binder]] satisfies RowResult;
		})
		.with({ type: "variable" }, function* ({ variable }) {
			const meta = yield* EB.freshMeta(ctx.env.length, NF.Row);
			const zero = Q.noUsage(ctx.env.length);
			const binder: Binder = [variable.value, NF.Constructors.Var(meta) /*zero*/];
			return [R.Constructors.Variable(variable.value), R.Constructors.Variable(meta), zero, [binder]] satisfies RowResult;
		})
		.with({ type: "extension" }, function* ({ label, value, row }) {
			const key = capitalize(value.type) as Capitalize<typeof value.type>;
			const val = yield* infer[key](value as any);
			const r = yield* elaborate(row);
			const q = Q.add(val[2], r[2]);
			const ty = NF.Constructors.Extension(label, val[1], r[1]);
			const tm = EB.Constructors.Patterns.Extension(label, val[0], r[0]);
			const binders = [val[3], r[3]].flat();
			return [tm, ty, q, binders] satisfies RowResult;
		})
		.otherwise(_ => {
			throw new Error("Expected Row Type");
		});

	return rr;
};
