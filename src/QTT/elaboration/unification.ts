import { match, P } from "ts-pattern";
import _ from "lodash";

import * as F from "fp-ts/lib/function";
import * as A from "fp-ts/Array";

import * as EB from "@qtt/elaboration";
import * as NF from "@qtt/elaboration/normalization";
import { M } from "@qtt/elaboration";
import { Subst } from "@qtt/elaboration/substitution";

import * as Err from "@qtt/elaboration/errors";
import * as R from "@qtt/shared/rows";

import * as Src from "@qtt/src/index";
import * as Log from "@qtt/shared/logging";

const empty: Subst = {};
export const unify = (left: NF.Value, right: NF.Value, lvl: number): M.Elaboration<Subst> => {
	if (Log.peek() !== "unify") {
		Log.push("unify");
	}
	const lDisplay = NF.display(left);
	const rDisplay = NF.display(right);
	Log.logger.debug("[left]", rDisplay);
	Log.logger.debug("[right]", lDisplay);

	const res = match([left, right])
		.with([{ type: "Neutral" }, P._], ([n, v]) => unify(n.value, v, lvl))
		.with([P._, { type: "Neutral" }], ([v, n]) => unify(v, n.value, lvl))
		.with([NF.Patterns.Lit, NF.Patterns.Lit], ([lit1, lit2]) => {
			if (!_.isEqual(lit1.value, lit2.value)) {
				throw Err.UnificationFailure(lit1, lit2);
			}

			return M.of(empty);
		})
		.with(
			[NF.Patterns.Lambda, NF.Patterns.Lambda],
			([lam1, lam2]) => lam1.binder.icit === lam2.binder.icit,
			([lam1, lam2]) =>
				M.chain(M.ask(), ctx => {
					const body1 = NF.apply(ctx.imports, lam1.closure, NF.Constructors.Rigid(lvl));
					const body2 = NF.apply(ctx.imports, lam2.closure, NF.Constructors.Rigid(lvl));
					return unify(body1, body2, lvl + 1);
				}),
		)

		.with(
			[NF.Patterns.Pi, NF.Patterns.Pi],
			([pi1, pi2]) => pi1.binder.icit === pi2.binder.icit,
			([pi1, pi2]) =>
				F.pipe(
					unify(pi1.binder.annotation[0], pi2.binder.annotation[0], lvl),
					M.chain(M.ask),
					M.chain(ctx => {
						const body1 = NF.apply(ctx.imports, pi1.closure, NF.Constructors.Rigid(lvl));
						const body2 = NF.apply(ctx.imports, pi2.closure, NF.Constructors.Rigid(lvl));
						return unify(body1, body2, lvl + 1);
					}),
				),
		)

		.with([NF.Patterns.Flex, P._], ([meta, v]) => M.fmap(M.ask(), ctx => bind(ctx, meta.variable, v)))
		.with([P._, NF.Patterns.Flex], ([v, meta]) => M.fmap(M.ask(), ctx => bind(ctx, meta.variable, v)))

		.with([NF.Patterns.Rigid, NF.Patterns.Rigid], ([rigid1, rigid2]) => {
			if (_.isEqual(rigid1.variable, rigid2.variable)) {
				return M.of(empty);
			}

			throw new Error("Unification: Rigid variables are different");
		})

		.otherwise(ts => {
			throw new Error("Unification Failure!");
		});

	return M.fmap(res, subst => {
		Log.logger.debug("[Result] ", subst);

		if (Log.peek() === "unify") {
			Log.pop();
		}
		return subst;
	});
};

const bind = (ctx: EB.Context, v: NF.Variable, ty: NF.Value): Subst => {
	if (v.type !== "Meta") {
		throw new Error("Unification: Can only bind meta variables");
	}

	if (ty.type === "Var" && _.isEqual(ty.variable, v)) {
		return empty;
	}

	if (!occursCheck(ctx, v, ty)) {
		return { [v.index]: ty };
	}

	// solution is a mu type
	throw new Error("Unification: Occurs check failed. Need to implement mu type");
};

const occursCheck = (ctx: EB.Context, v: NF.Variable, ty: NF.Value): boolean =>
	match(ty)
		.with(NF.Patterns.Var, ({ variable }) => _.isEqual(variable, v))
		.with({ type: "Neutral" }, ({ value }) => occursCheck(ctx, v, value))
		.with(NF.Patterns.Lambda, ({ closure }) => occursCheck(ctx, v, NF.apply(ctx.imports, closure, NF.Constructors.Rigid(ctx.env.length))))
		.with(NF.Patterns.Pi, ({ closure }) => occursCheck(ctx, v, NF.apply(ctx.imports, closure, NF.Constructors.Rigid(ctx.env.length))))
		.with(NF.Patterns.App, ({ func, arg }) => occursCheck(ctx, v, func) || occursCheck(ctx, v, arg))

		.with(NF.Patterns.Row, ({ row }) =>
			R.fold(
				row,
				(nf, _, acc) => acc || occursCheck(ctx, v, nf),
				rv => rv.type === "Meta" && _.isEqual(rv, v),
				false,
			),
		)
		.otherwise(() => false);
