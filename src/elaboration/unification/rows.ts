import { match, P } from "ts-pattern";
import _ from "lodash";
import * as E from "fp-ts/lib/Either";

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

		yield* match([r1, r2] as const)
			.with([R.Patterns.Empty, R.Patterns.Empty], function* () {
				/* Nothing to bind. */
			})
			.with(
				[R.Patterns.Tail, R.Patterns.Tail],
				([{ tail: v1 }, { tail: v2 }]) => _.isEqual(v1, v2),
				function* () {
					/* Same tail; nothing to bind. */
				},
			)
			.with(
				[Tails.Meta, P._],
				([{ tail }]) => !!s[tail.val],
				function* ([{ tail }]) {
					yield* unify(yield* solved(s[tail.val]), r2);
				},
			)
			.with(
				[P._, Tails.Meta],
				([, { tail }]) => !!s[tail.val],
				function* ([, { tail }]) {
					yield* unify(r1, yield* solved(s[tail.val]));
				},
			)
			.with([Tails.Meta, P._], function* ([{ tail }]) {
				yield* Sub.subst.bind(yield* bind(tail, NF.Constructors.Row(r2)));
			})
			.with([P._, Tails.Meta], function* ([, { tail }]) {
				yield* Sub.subst.bind(yield* bind(tail, NF.Constructors.Row(r1)));
			})

			.with(
				[R.Patterns.NonEmpty, P._],
				function* ([
					{
						entries: [{ label, value }, ...remaining],
					},
				]) {
					const rewritten = yield* rewrite(r2, label);

					/*
					 * Order is composition order: rewrite's row-tail bindings are already
					 * in the accumulator, the value unification reads them there, and the
					 * tail unification reads both. The nested unifications also see metas
					 * rewrite just minted — minting registers in the metacontext as it
					 * happens, so the interim writer-to-reader splice this case used to
					 * carry is gone.
					 */
					yield* U.unify(value, rewritten.value, lvl);
					yield* unify(R.Constructors.Row(remaining, r1.tail), rewritten.rest);
				},
			)

			.with(
				[R.Patterns.Empty, R.Patterns.NonEmpty],
				function* ([
					,
					{
						entries: [{ label }],
					},
				]) {
					return yield* M.fail(Err.MissingLabel(label, r1));
				},
			)

			.otherwise(r => {
				throw new Error("Unification: Row unification is described in Daan Leijen's paper 'Extensible records with scoped labels'." + JSON.stringify(r));
			});
	});

const solved = function* (solution: NF.Value): U.Unification<NF.Row> {
	return match(yield* NF.view(solution))
		.with(NF.View.Sealed(NF.Patterns.Row), ({ value }) => value.row)
		.otherwise(() => {
			throw new Error("Expected row");
		});
};

const Tails = {
	Meta: { entries: [], tail: { type: "Meta" } },
} as const;

/*
 * Rewrites `r` around `label`. When the label is absent the tail decides: a tail solved in the
 * accumulator is chased, an unsolved one is solved to a row holding a fresh field over a fresh
 * tail, and a closed row is missing the label.
 */
const rewrite = (r: NF.Row, label: string): U.Unification<{ value: NF.Value; rest: NF.Row }> =>
	E.match(
		function* (): U.Unification<{ value: NF.Value; rest: NF.Row }> {
			const ctx = yield* M.reader.ask();
			const lvl = ctx.env.length;
			const s = yield* Sub.subst.get();

			return yield* match(r.tail)
				.with(P.nullish, function* () {
					return yield* M.fail(Err.MissingLabel(label, r));
				})
				.with(
					{ type: "Meta" },
					({ val }) => !!s[val],
					function* ({ val }) {
						const chased = yield* rewrite(yield* solved(s[val]), label);
						return { value: chased.value, rest: R.Constructors.Row([...r.entries, ...chased.rest.entries], chased.rest.tail) };
					},
				)
				.with({ type: "Meta" }, function* ({ val }) {
					const kvar = NF.Constructors.Var(yield* EB.freshMeta(lvl, NF.Type));
					const tvar = NF.Constructors.Var(yield* EB.freshMeta(lvl, kvar));
					const fresh = yield* EB.freshMeta(lvl, NF.Row);
					yield* Sub.subst.bind(Sub.of(val, NF.Constructors.Row(R.Constructors.Extension(label, tvar, R.Constructors.Variable(fresh)))));

					return { value: tvar, rest: R.Constructors.Row(r.entries, fresh) };
				})
				.otherwise(function* () {
					return yield* M.fail(Err.Impossible("Expected meta variable"));
				});
		},
		function* (found: { value: NF.Value; rest: NF.Row }): U.Unification<{ value: NF.Value; rest: NF.Row }> {
			return found;
		},
	)(R.rewrite(r, label));
