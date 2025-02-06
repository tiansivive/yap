import { match } from "ts-pattern";

import * as F from "fp-ts/lib/function";

import * as EB from ".";
import * as NF from "./normalization";
import * as M from "./monad";

import * as Src from "@qtt/src/index";
import * as Lit from "@qtt/shared/literals";
import * as Q from "@qtt/shared/modalities/multiplicity";
import * as Log from "@qtt/shared/logging";

import { P } from "ts-pattern";

import { freshMeta } from "./supply";

type Subst = { [key: number]: NF.Value };

export const unify = (left: NF.Value, right: NF.Value, lvl: number): M.Elaboration<Subst> => {
	if (Log.peek() !== "unify") {
		Log.push("unify");
	}
	const lDisplay = NF.display(left);
	const rDisplay = NF.display(right);
	Log.logger.debug("[left]", rDisplay);
	Log.logger.debug("[right]", lDisplay);

	const res = match([left, right])
		.with(
			[
				{ type: "Abs", binder: { type: "Pi" } },
				{ type: "Abs", binder: { type: "Pi" } },
			],
			([pi1, pi2]) => {
				return M.chain(M.ask(), ctx => {
					const body1 = NF.apply(ctx.imports, pi1.closure, NF.Constructors.Rigid(lvl));
					const body2 = NF.apply(ctx.imports, pi2.closure, NF.Constructors.Rigid(lvl));
					return unify(body1, body2, lvl + 1);
				});
			},
		)
		.with([{ type: "Neutral" }, P._], ([n, v]) => {
			return unify(n.value, v, lvl);
		})
		.with([P._, { type: "Neutral" }], ([v, n]) => {
			return unify(v, n.value, lvl);
		})
		.otherwise(ts => {
			console.error("Left: ", NF.display(ts[0]));
			console.error("Right: ", NF.display(ts[1]));
			throw new Error("Unification: Not implemented yet");
		});

	return M.fmap(res, subst => {
		Log.logger.debug("[Result] ", subst);

		if (Log.peek() === "unify") {
			Log.pop();
		}
		return subst;
	});
};
