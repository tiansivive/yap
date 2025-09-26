import { match, P } from "ts-pattern";
import _ from "lodash";

import * as F from "fp-ts/lib/function";
import * as A from "fp-ts/Array";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Sub from "./substitution";
import { Subst } from "./substitution";

import * as Err from "@yap/elaboration/shared/errors";
import * as R from "@yap/shared/rows";

import { number } from "fp-ts";
import { bind } from ".";

import * as U from "@yap/elaboration/unification";

let count = 0;
export const unify = (r1: NF.Row, r2: NF.Row, s: Subst): V2.Elaboration<Subst> =>
	V2.track(
		["unify", [r1, r2], { action: "unification" }],
		V2.Do(function* () {
			// count++;
			// console.log("Unify rows:", count);
			const ctx = yield* V2.ask();

			const lvl = ctx.env.length;
			const subst = match([r1, r2])
				.with([{ type: "empty" }, { type: "empty" }], () => V2.of(s))
				.with(
					[{ type: "variable" }, { type: "variable" }],
					([{ variable: v1 }, { variable: v2 }]) => _.isEqual(v1, v2),
					() => V2.of(s),
				)
				.with(
					[{ type: "variable", variable: { type: "Meta" } }, P._],
					([{ variable }]) => !!s[variable.val],
					([v, r]) => {
						const nf = s[v.variable.val];

						if (nf.type !== "Row") {
							throw new Error("Expected row");
						}
						return unify(nf.row, r, s);
					},
				)
				.with(
					[P._, { type: "variable", variable: { type: "Meta" } }],
					([P_, { variable }]) => !!s[variable.val],
					([r, v]) => {
						const nf = s[v.variable.val];

						if (nf.type !== "Row") {
							throw new Error("Expected row");
						}
						return unify(r, nf.row, s);
					},
				)
				.with([{ type: "variable", variable: { type: "Meta" } }, P._], ([{ variable }, r]) => V2.of(bind(ctx, variable, NF.Constructors.Row(r))))
				.with([P._, { type: "variable", variable: { type: "Meta" } }], ([r, { variable }]) => V2.of(bind(ctx, variable, NF.Constructors.Row(r))))

				.with([{ type: "extension" }, P._], ([{ label, value, row }, r]) =>
					V2.Do(function* () {
						count++;
						// console.log("\nUnify rows rewrites", count);
						// const print = R.display<NF.Value, NF.Variable>({ term: v => NF.display(v, ctx.zonker), var: v => NF.display({ type: "Var", variable: v }, ctx.zonker) });
						// console.log("LHS:", print(r1));
						// console.log("RHS:", print(r2));
						// console.log("Current substitution:\n", Sub.display(s));

						// const intersection = A.intersection(number.Eq)(tail(row), Object.keys(s).map(Number));

						// if (intersection.length !== 0) {
						// 	throw new Error("Circular row type");
						// }

						const [rewritten, o1] = yield* V2.pure(rewrite(r, label, s));
						if (rewritten.type !== "extension") {
							return yield* V2.fail<Subst>(Err.Impossible("Expected extension"));
						}

						const o2 = yield* U.unify.gen(value, rewritten.value, lvl, Sub.compose(o1, s));
						const o3 = yield* unify.gen(row, rewritten.row, o2);

						return F.pipe(o3, Sub.compose(o2), Sub.compose(o1));
					}),
				)

				.with([{ type: "empty" }, { type: "extension" }], ([r, { label }]) => V2.Do<Subst, unknown>(() => V2.fail(Err.MissingLabel(label, r))))
				.with([{ type: "extension" }, { type: "empty" }], ([{ label }, r]) => V2.Do<Subst, unknown>(() => V2.fail(Err.MissingLabel(label, r))))

				.otherwise(r => {
					throw new Error(
						"Unification: Row unification is described in Daan Leijen's paper 'Extensible records with scoped labels'." +
							JSON.stringify(r) +
							"\n\nCall V2.fail()?",
					);
				});

			return yield* V2.pure(subst);
		}),
	);
unify.gen = (r1: NF.Row, r2: NF.Row, s: Subst) => V2.pure(unify(r1, r2, s));

const tail = (row: NF.Row): number[] =>
	match(row)
		.with({ type: "empty" }, () => [])
		.with({ type: "extension" }, ({ row }) => tail(row))
		.with({ type: "variable" }, ({ variable }) =>
			match(variable)
				.with({ type: "Meta" }, ({ val }) => [val])
				.otherwise(() => []),
		)
		.exhaustive();

// TODO: Use `rewrite` from `rows.ts`
const rewrite = (r: NF.Row, label: string, s: Subst): V2.Elaboration<[NF.Row, Subst]> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();
		const lvl = ctx.env.length;
		const res = match(r)
			.with({ type: "empty" }, (): V2.Elaboration<[NF.Row, Subst]> => V2.Do(() => V2.fail(Err.MissingLabel(label, r))))
			.with(
				{ type: "extension" },
				({ label: l }) => label === l,
				({ label: l, value, row }) => V2.of<[NF.Row, Subst]>([R.Constructors.Extension(l, value, row), {}]),
			)
			.with(
				{ type: "extension" },
				({ label: lbl, value: val, row }): V2.Elaboration<[NF.Row, Subst]> =>
					V2.Do<[NF.Row, Subst], [NF.Row, Subst]>(function* () {
						const [rewritten, sub] = yield rewrite(row, label, s);

						const res = yield match(rewritten)
							.with({ type: "extension" }, ({ label: l, value: v, row: r }) =>
								V2.of<[NF.Row, Subst]>([R.Constructors.Extension(l, v, R.Constructors.Extension(lbl, val, r)), sub]),
							)
							.otherwise(() =>
								V2.Do(() =>
									V2.fail(
										Err.Impossible(
											"Expected extension: " + R.display<NF.Value, NF.Variable>({ term: v => NF.display(v, ctx.zonker), var: v => JSON.stringify(v) }),
										),
									),
								),
							);
						return res;
					}),
			)
			.with({ type: "variable" }, ({ variable }): V2.Elaboration<[NF.Row, Subst]> => {
				if (variable.type !== "Meta") {
					return V2.Do(() => V2.fail(Err.Impossible("Expected meta variable")));
				}

				// If this meta variable is already solved in the current substitution, chase it first
				const solved = s[variable.val];
				if (solved) {
					if (solved.type !== "Row") {
						throw new Error("Expected row");
					}
					return rewrite(solved.row, label, s);
				}

				const kvar = NF.Constructors.Var(EB.freshMeta(lvl, NF.Type));
				const tvar = NF.Constructors.Var(EB.freshMeta(lvl, kvar));
				const rvar: NF.Row = R.Constructors.Variable(EB.freshMeta(lvl, NF.Row));
				const rf = R.Constructors.Extension(label, tvar, rvar);
				const sub = { [variable.val]: NF.Constructors.Row(rf) };
				return V2.of<[NF.Row, Subst]>([rf, sub]);
			})
			.exhaustive();

		return yield* V2.pure(res);
	});
