import { match, P } from "ts-pattern";
import _ from "lodash";

import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as Sub from "./substitution";
import { Subst } from "./substitution";

import * as Err from "@yap/elaboration/shared/errors";
import * as R from "@yap/shared/rows";

import { bind } from ".";

import * as U from "@yap/elaboration/unification";

export const unify = (r1: NF.Row, r2: NF.Row, s: Subst): V2.Elaboration<Subst> =>
	V2.track(
		{ tag: "unify", type: "row", rows: [r1, r2], metadata: { action: "unification" } },
		V2.Do(function* () {
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
					([_, { variable }]) => !!s[variable.val],
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
						const [rewritten, o1] = yield* V2.pure(rewrite(r, label, s));
						if (rewritten.type !== "extension") {
							return yield* V2.fail<Subst>(Err.Impossible("Expected extension"));
						}

						// INTERIM (elaboration monad RW->State refactor): `rewrite` above can mint fresh
						// metas (row-tail rewriting) mid-solve. Metas are recorded on the monad's *writer*
						// channel, which bubbles up but is NOT visible to the nested `unify` calls below;
						// the *reader* `ctx.metas` was frozen before solving, so a flex-flex kind lookup
						// ([[flex-flex-unification]]) for a just-minted meta misses its `.ann` and crashes.
						// Splice the metas told so far into the reader for the recursive unifications so
						// kind-checking still sees them. Remove once metas move onto threaded State — see
						// [[monad-split]] (RW->State) — which propagates new metas to every subsequent step,
						// nested recursion included, automatically.
						const { metas: told } = yield* V2.listen();
						const withMetas = (c: EB.Context): EB.Context => ({ ...c, metas: { ...c.metas, ...told } });

						const o2 = yield* V2.local(withMetas, U.unify(value, rewritten.value, lvl, Sub.compose(o1, s)));
						const o3 = yield* V2.local(withMetas, unify(row, rewritten.row, o2));

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
				({ label: l, value, row }) => V2.of<[NF.Row, Subst]>([R.Constructors.Extension(l, value, row), Sub.empty]),
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
											"Expected extension: " + R.display<NF.Value, NF.Variable>({ term: v => NF.display(v, ctx), var: v => JSON.stringify(v) })(rewritten),
										),
									),
								),
							);
						return res;
					}),
			)
			.with(
				{ type: "variable" },
				({ variable }): V2.Elaboration<[NF.Row, Subst]> =>
					V2.Do(function* () {
						if (variable.type !== "Meta") {
							return yield* V2.fail<[NF.Row, Subst]>(Err.Impossible("Expected meta variable"));
						}

						// If this meta variable is already solved in the current substitution, chase it first
						const solved = s[variable.val];
						if (solved) {
							if (solved.type !== "Row") {
								throw new Error("Expected row");
							}
							return yield* V2.pure(rewrite(solved.row, label, s));
						}

						const kvar = NF.Constructors.Var(yield* EB.freshMeta(lvl, NF.Type));
						const tvar = NF.Constructors.Var(yield* EB.freshMeta(lvl, kvar));
						const rvar: NF.Row = R.Constructors.Variable(yield* EB.freshMeta(lvl, NF.Row));
						const rf = R.Constructors.Extension(label, tvar, rvar);
						const sub = Sub.of(variable.val, NF.Constructors.Row(rf));
						return [rf, sub] satisfies [NF.Row, Subst];
					}),
			)
			.exhaustive();

		return yield* V2.pure(res);
	});
