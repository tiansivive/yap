import { match, P } from "ts-pattern";
import _ from "lodash";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as NF from "@yap/elaboration/normalization";
import * as Sub from "./substitution";

import * as Err from "@yap/elaboration/shared/errors";
import * as R from "@yap/shared/rows";

import { bind } from ".";

import * as U from "@yap/elaboration/unification";

export const unify = (r1: NF.Row, r2: NF.Row): U.Unification<void> =>
	M.tracer.track({ tag: "unify", type: "row", rows: [r1, r2], metadata: { action: "unification" } }, function* (): U.Unification<void> {
		const ctx = yield* M.reader.ask();
		const lvl = ctx.env.length;
		const s = yield* Sub.subst.get();

		yield* match([r1, r2])
			.with([{ type: "empty" }, { type: "empty" }], function* () {
				/* Nothing to bind. */
			})
			.with(
				[{ type: "variable" }, { type: "variable" }],
				([{ variable: v1 }, { variable: v2 }]) => _.isEqual(v1, v2),
				function* () {
					/* Same tail; nothing to bind. */
				},
			)
			.with(
				[{ type: "variable", variable: { type: "Meta" } }, P._],
				([{ variable }]) => !!s[variable.val],
				function* ([v, r]) {
					const nf = s[v.variable.val];

					if (nf.type !== "Row") {
						throw new Error("Expected row");
					}
					yield* unify(nf.row, r);
				},
			)
			.with(
				[P._, { type: "variable", variable: { type: "Meta" } }],
				([_l, { variable }]) => !!s[variable.val],
				function* ([r, v]) {
					const nf = s[v.variable.val];

					if (nf.type !== "Row") {
						throw new Error("Expected row");
					}
					yield* unify(r, nf.row);
				},
			)
			.with([{ type: "variable", variable: { type: "Meta" } }, P._], function* ([{ variable }, r]) {
				yield* Sub.subst.bind(yield* bind(variable, NF.Constructors.Row(r)));
			})
			.with([P._, { type: "variable", variable: { type: "Meta" } }], function* ([r, { variable }]) {
				yield* Sub.subst.bind(yield* bind(variable, NF.Constructors.Row(r)));
			})

			.with([{ type: "extension" }, P._], function* ([{ label, value, row }, r]) {
				const rewritten = yield* rewrite(r, label);

				if (rewritten.type !== "extension") {
					return yield* M.fail(Err.Impossible("Expected extension"));
				}

				/*
				 * Order is composition order: rewrite's row-tail bindings are already
				 * in the accumulator, the value unification reads them there, and the
				 * tail unification reads both. The nested unifications also see metas
				 * rewrite just minted — minting registers in the metacontext as it
				 * happens, so the interim writer-to-reader splice this case used to
				 * carry is gone.
				 */
				yield* U.unify(value, rewritten.value, lvl);
				yield* unify(row, rewritten.row);
			})

			.with([{ type: "empty" }, { type: "extension" }], function* ([r, { label }]) {
				return yield* M.fail(Err.MissingLabel(label, r));
			})
			.with([{ type: "extension" }, { type: "empty" }], function* ([{ label }, r]) {
				return yield* M.fail(Err.MissingLabel(label, r));
			})

			.otherwise(r => {
				throw new Error("Unification: Row unification is described in Daan Leijen's paper 'Extensible records with scoped labels'." + JSON.stringify(r));
			});
	});

// TODO: Use `rewrite` from `rows.ts`
const rewrite = function* (r: NF.Row, label: string): U.Unification<NF.Row> {
	const ctx = yield* M.reader.ask();
	const lvl = ctx.env.length;

	return yield* match(r)
		.with({ type: "empty" }, function* () {
			return yield* M.fail(Err.MissingLabel(label, r));
		})
		.with(
			{ type: "extension" },
			({ label: l }) => label === l,
			function* ({ label: l, value, row }) {
				return R.Constructors.Extension(l, value, row);
			},
		)
		.with({ type: "extension" }, function* ({ label: lbl, value: val, row }) {
			const rewritten = yield* rewrite(row, label);

			if (rewritten.type !== "extension") {
				return yield* M.fail(
					Err.Impossible("Expected extension: " + R.display<NF.Value, NF.Variable>({ term: v => NF.display(v, ctx), var: v => JSON.stringify(v) })(rewritten)),
				);
			}

			return R.Constructors.Extension(rewritten.label, rewritten.value, R.Constructors.Extension(lbl, val, rewritten.row));
		})
		.with({ type: "variable" }, function* ({ variable }) {
			if (variable.type !== "Meta") {
				return yield* M.fail(Err.Impossible("Expected meta variable"));
			}

			// If this meta variable is already bound in the accumulator, chase it first
			const s = yield* Sub.subst.get();
			const solved = s[variable.val];

			if (solved) {
				if (solved.type !== "Row") {
					throw new Error("Expected row");
				}
				return yield* rewrite(solved.row, label);
			}

			const kvar = NF.Constructors.Var(yield* EB.freshMeta(lvl, NF.Type));
			const tvar = NF.Constructors.Var(yield* EB.freshMeta(lvl, kvar));
			const rvar: NF.Row = R.Constructors.Variable(yield* EB.freshMeta(lvl, NF.Row));
			const rf = R.Constructors.Extension(label, tvar, rvar);
			yield* Sub.subst.bind(Sub.of(variable.val, NF.Constructors.Row(rf)));

			return rf;
		})
		.exhaustive();
};
