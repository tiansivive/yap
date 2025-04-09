import { match } from "ts-pattern";

import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as Log from "@yap/shared/logging";

import { M } from "@yap/elaboration";

import * as Src from "@yap/src/index";
import * as Lit from "@yap/shared/literals";

import * as R from "@yap/shared/rows";
import { capitalize } from "lodash";

type Tags<T, K> = K extends string ? (T extends { [k in K]: infer U } ? U : never) : never;
type Inference<T, Key> = Key extends string
	? Tags<T, Key> extends string
		? { [k in Tags<T, Key> as Capitalize<k>]: (pattern: Extract<Src.Pattern, { [t in Key]: k }>) => M.Elaboration<Result> }
		: never
	: never;

export type Result = [EB.Pattern, NF.Value, Q.Usages, Binder[]];
type Binder = [string, NF.Value, Q.Usages];

export const infer_: Inference<Src.Pattern, "type"> = {
	Lit: pat => {
		const atom: Lit.Literal = match(pat.value)
			.with({ type: "String" }, _ => Lit.Atom("String"))
			.with({ type: "Num" }, _ => Lit.Atom("Num"))
			.with({ type: "Bool" }, _ => Lit.Atom("Bool"))
			.with({ type: "Atom" }, _ => Lit.Atom("Type"))
			.with({ type: "unit" }, _ => Lit.Atom("Unit"))

			.exhaustive();

		return M.fmap(M.ask(), (ctx): Result => [EB.Constructors.Patterns.Lit(pat.value), NF.Constructors.Lit(atom), Q.noUsage(ctx.env.length), []]);
	},

	Var: pat =>
		M.fmap(M.ask(), (ctx): Result => {
			const free = ctx.imports[pat.value.value];
			// TODO:FIXME: Remove this check for now. Let's ignore matching on defined variables for now, until we answer how to match on lambdas and others
			if (free) {
				const [tm, ty, us] = free;
				return [EB.Constructors.Patterns.Var(pat.value.value, tm), ty, us, []];
			}
			const kind = NF.Constructors.Var(EB.freshMeta(ctx.env.length, NF.Type));
			const meta = EB.Constructors.Var(EB.freshMeta(ctx.env.length, kind));
			const va = NF.evaluate(ctx, meta);
			const zero = Q.noUsage(ctx.env.length);
			const binder: Binder = [pat.value.value, va, zero];
			return [{ type: "Binder", value: pat.value.value }, va, zero, [binder]];
		}),

	Row: pat => M.fmap(elaborate(pat.row), ([tm, ty, qs, binders]): Result => [EB.Constructors.Patterns.Row(tm), NF.Constructors.Row(ty), qs, binders]),
	Struct: pat => M.fmap(elaborate(pat.row), ([tm, ty, qs, binders]): Result => [EB.Constructors.Patterns.Struct(tm), NF.Constructors.Schema(ty), qs, binders]),

	Variant: pat =>
		F.pipe(
			M.Do,
			M.bind("ctx", M.ask),
			M.let("row", elaborate(pat.row)),
			M.fmap(({ ctx, row: [r, ty, qs, binders] }): Result => {
				const addVar = (nfr: NF.Row): NF.Row => {
					if (nfr.type === "empty") {
						return R.Constructors.Variable(EB.freshMeta(ctx.env.length, NF.Row));
					}

					if (nfr.type === "variable") {
						return nfr;
					}
					return R.Constructors.Extension(nfr.label, nfr.value, addVar(nfr.row));
				};

				return [EB.Constructors.Patterns.Variant(r), NF.Constructors.Variant(addVar(ty)), qs, binders];
			}),
		),
	Wildcard: () =>
		M.fmap(M.ask(), (ctx): Result => {
			const kind = NF.Constructors.Var(EB.freshMeta(ctx.env.length, NF.Type));
			const meta = NF.Constructors.Var(EB.freshMeta(ctx.env.length, kind));
			return [EB.Constructors.Patterns.Wildcard(), meta, Q.noUsage(ctx.env.length), []];
		}),

	Tuple: pat => M.fmap(elaborate(pat.row), ([tm, ty, qs, binders]): Result => [EB.Constructors.Patterns.Struct(tm), NF.Constructors.Schema(ty), qs, binders]),
	List: pat => {
		return M.chain(M.ask(), ctx => {
			const kind = NF.Constructors.Var(EB.freshMeta(ctx.env.length, NF.Type));
			const mvar = EB.Constructors.Var(EB.freshMeta(ctx.env.length, kind));
			const v = NF.evaluate(ctx, mvar);

			const validate = (val: Src.Pattern) => {
				const key = capitalize(val.type) as Capitalize<typeof val.type>;
				return F.pipe(
					infer[key](val as any),
					M.discard(([, ty]) => M.tell("constraint", { type: "assign", left: ty, right: v, lvl: ctx.env.length })),
				);
			};

			return M.fmap(M.traverse(pat.elements, validate), (es): Result => {
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
			});
		});
	},
};

const keys = Object.keys(infer_) as (keyof typeof infer_)[];
export const infer: Inference<Src.Pattern, "type"> = keys.reduce(
	(acc, key) => {
		const f = (pat: Src.Pattern) => {
			Log.push("pattern");

			Log.logger.debug(Src.Pat.display(pat));
			const result = infer_[key](pat as any) as M.Elaboration<Result>;

			return M.fmap(result, result => {
				Log.push("result");
				Log.logger.debug("[Type] " + NF.display(result[1]));
				Log.logger.debug("[Binders] (" + result[3].map(([name, va]) => `${name} : ${NF.display(va)}`).join(", ") + ")");
				Log.pop();
				Log.pop();
				return result;
			});
		};

		return { ...acc, [key]: f };
	},
	{} as Inference<Src.Pattern, "type">,
);

type Row = R.Row<EB.Pattern, string>;

type RowResult = [Row, NF.Row, Q.Usages, Binder[]];

const elaborate = (r: R.Row<Src.Pattern, Src.Variable>): M.Elaboration<RowResult> =>
	M.chain(M.ask(), ctx =>
		match(r)
			.with({ type: "empty" }, r => M.of<RowResult>([r, R.Constructors.Empty(), Q.noUsage(ctx.env.length), []]))
			.with({ type: "variable" }, ({ variable }) => {
				const meta = EB.freshMeta(ctx.env.length, NF.Row);
				const zero = Q.noUsage(ctx.env.length);
				const binder: Binder = [variable.value, NF.Constructors.Var(meta), zero];
				return M.of<RowResult>([R.Constructors.Variable(variable.value), R.Constructors.Variable(meta), zero, [binder]]);
			})
			.with({ type: "extension" }, ({ label, value, row }) => {
				const key = capitalize(value.type) as Capitalize<typeof value.type>;

				return F.pipe(
					M.Do,
					M.let("value", infer[key](value as any)),
					M.let("row", elaborate(row)),
					M.fmap(({ value, row }): RowResult => {
						const q = Q.add(value[2], row[2]);
						const ty = NF.Constructors.Extension(label, value[1], row[1]);
						const tm = EB.Constructors.Patterns.Extension(label, value[0], row[0]);
						const binders = [value[3], row[3]].flat();
						return [tm, ty, q, binders];
					}),
				);
			})
			.otherwise(_ => {
				throw new Error("Expected Row Type");
			}),
	);
