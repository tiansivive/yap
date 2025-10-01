import { match } from "ts-pattern";

import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as Log from "@yap/shared/logging";

import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as Src from "@yap/src/index";
import * as Lit from "@yap/shared/literals";

import * as R from "@yap/shared/rows";
import { capitalize } from "lodash";

type Tags<T, K> = K extends string ? (T extends { [k in K]: infer U } ? U : never) : never;
export type Inference<T, Key> = Key extends string
	? Tags<T, Key> extends string
		? {
				[k in Tags<T, Key> as Capitalize<k>]: {
					(pattern: Extract<Src.Pattern, { [t in Key]: k }>): V2.Elaboration<Result>;
					gen: (pattern: Extract<Src.Pattern, { [t in Key]: k }>) => ReturnType<typeof V2.pure<Result>>;
				};
			}
		: never
	: never;

export type Result = [EB.Pattern, NF.Value, Q.Usages, Binder[]];
export type Binder = [string, NF.Value, Q.Usages];

export const infer: Inference<Src.Pattern, "type"> = {
	Lit: V2.regen(pat => {
		const atom: Lit.Literal = match(pat.value)
			.with({ type: "String" }, _ => Lit.Atom("String"))
			.with({ type: "Num" }, _ => Lit.Atom("Num"))
			.with({ type: "Bool" }, _ => Lit.Atom("Bool"))
			.with({ type: "Atom" }, _ => Lit.Atom("Type"))
			.with({ type: "unit" }, _ => Lit.Atom("Unit"))

			.exhaustive();

		return V2.Do<Result, EB.Context>(function* () {
			const ctx = yield* V2.ask();
			return [EB.Constructors.Patterns.Lit(pat.value), NF.Constructors.Lit(atom), Q.noUsage(ctx.env.length), []] satisfies Result;
		});
	}),

	Var: V2.regen(pat =>
		V2.Do(function* () {
			const ctx = yield* V2.ask();

			const free = ctx.imports[pat.value.value];
			// TODO:FIXME: Remove this check for now. Let's ignore matching on defined variables for now, until we answer how to match on lambdas and others
			if (free) {
				const [tm, ty, us] = free;
				return [EB.Constructors.Patterns.Var(pat.value.value, tm), ty, us, []];
			}
			const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const meta = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));
			const va = NF.evaluate(ctx, meta);
			const zero = Q.noUsage(ctx.env.length);
			const binder: Binder = [pat.value.value, va, zero];
			return [{ type: "Binder", value: pat.value.value }, va, zero, [binder]];
		}),
	),
	Row: V2.regen(pat =>
		V2.Do(function* () {
			const [r, rowty, rus, binders] = yield* elaborate.gen(pat.row);
			return [EB.Constructors.Patterns.Row(r), NF.Constructors.Row(rowty), rus, binders] satisfies Result;
		}),
	),
	Struct: V2.regen(pat =>
		V2.Do(function* () {
			const [tm, ty, qs, binders] = yield* elaborate.gen(pat.row);
			return [EB.Constructors.Patterns.Struct(tm), NF.Constructors.Schema(ty), qs, binders] satisfies Result;
		}),
	),

	Variant: V2.regen(pat =>
		V2.Do(function* () {
			const ctx = yield* V2.ask();
			const [r, rowty, rus, binders] = yield* elaborate.gen(pat.row);
			const addVar = function* (nfr: NF.Row): Generator<V2.Elaboration<any>, NF.Row, any> {
				if (nfr.type === "empty") {
					return R.Constructors.Variable(yield* EB.freshMeta(ctx.env.length, NF.Row));
				}

				if (nfr.type === "variable") {
					return nfr;
				}
				const tail = yield* addVar(nfr.row);
				return R.Constructors.Extension(nfr.label, nfr.value, tail);
			};

			const tail = yield* addVar(rowty);
			return [EB.Constructors.Patterns.Variant(r), NF.Constructors.Variant(tail), rus, binders] satisfies Result;
		}),
	),

	Wildcard: V2.regen(_ =>
		V2.Do(function* () {
			const ctx = yield* V2.ask();
			const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const meta = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));
			return [EB.Constructors.Patterns.Wildcard(), meta, Q.noUsage(ctx.env.length), []];
		}),
	),

	Tuple: V2.regen(pat =>
		V2.Do(function* () {
			const [r, rowty, qs, binders] = yield* elaborate.gen(pat.row);
			return [EB.Constructors.Patterns.Struct(r), NF.Constructors.Schema(rowty), qs, binders] satisfies Result;
		}),
	),
	List: V2.regen(pat =>
		V2.Do(function* () {
			const ctx = yield* V2.ask();
			const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const mvar = EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind));

			const v = NF.evaluate(ctx, mvar);

			const validate = (val: Src.Pattern) =>
				V2.Do(function* () {
					const key = capitalize(val.type) as keyof typeof infer;

					const result = yield* infer[key].gen(val as Extract<Src.Pattern, { type: typeof key }>);
					yield* V2.tell("constraint", { type: "assign", left: result[1], right: v });
					return result;
				});

			const es = yield* V2.pure(V2.traverse(pat.elements, validate));

			const [pats, binders] = es.reduce(([pats, binders], [pat, , , b]) => [pats.concat(pat), binders.concat(b)], [[], []] as [EB.Pattern[], Binder[]]);

			const indexing = NF.Constructors.App(NF.Indexed, NF.Constructors.Lit(Lit.Atom("Num")), "Explicit");
			const values = NF.Constructors.App(indexing, v, "Explicit");

			const ty = NF.Constructors.App(values, NF.Constructors.Var({ type: "Foreign", name: "defaultHashMap" }), "Implicit");

			return [
				EB.Constructors.Patterns.List(pats, pat.rest?.value),
				NF.Constructors.Neutral(ty),
				Q.noUsage(ctx.env.length),
				pat.rest ? binders.concat([[pat.rest.value, ty, Q.noUsage(ctx.env.length)]]) : binders,
			];
		}),
	),
};

type Row = R.Row<EB.Pattern, string>;
type RowResult = [Row, NF.Row, Q.Usages, Binder[]];

const elaborate = V2.regen(
	(r: R.Row<Src.Pattern, Src.Variable>): V2.Elaboration<RowResult> =>
		V2.Do(function* () {
			const ctx = yield* V2.ask();

			const rr: RowResult = yield match(r)
				.with({ type: "empty" }, r => V2.of([r, R.Constructors.Empty(), Q.noUsage(ctx.env.length), []] satisfies RowResult))
				.with({ type: "variable" }, ({ variable }) =>
					V2.Do(function* () {
						const meta = yield* EB.freshMeta(ctx.env.length, NF.Row);
						const zero = Q.noUsage(ctx.env.length);
						const binder: Binder = [variable.value, NF.Constructors.Var(meta), zero];
						return [R.Constructors.Variable(variable.value), R.Constructors.Variable(meta), zero, [binder]] satisfies RowResult;
					}),
				)
				.with({ type: "extension" }, ({ label, value, row }) =>
					V2.Do(function* () {
						const key = capitalize(value.type) as Capitalize<typeof value.type>;
						const val = yield* infer[key].gen(value as any);
						const r = yield* elaborate.gen(row);
						const q = Q.add(val[2], r[2]);
						const ty = NF.Constructors.Extension(label, val[1], r[1]);
						const tm = EB.Constructors.Patterns.Extension(label, val[0], r[0]);
						const binders = [val[3], r[3]].flat();
						return [tm, ty, q, binders] satisfies RowResult;
					}),
				)
				.otherwise(_ => {
					throw new Error("Expected Row Type");
				});

			return rr;
		}),
);
