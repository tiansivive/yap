import { M } from "@qtt/elaboration";
import * as EB from "@qtt/elaboration";
import { match } from "ts-pattern";
import { Subst, Substitute } from "./substitution";

import * as F from "fp-ts/lib/function";
import { entries } from "../../utils/objects";

const empty: Subst = {};

export const solve = (cs: Array<EB.Constraint>): M.Elaboration<Subst> => M.chain(M.ask(), ctx => _solve(cs, ctx, empty));

const _solve = (cs: Array<EB.Constraint>, _ctx: EB.Context, subst: Subst): M.Elaboration<Subst> => {
	if (cs.length === 0) {
		return M.of(subst);
	}

	const [c, ...rest] = cs.map(c => {
		if (c.type === "usage") {
			return c;
		}
		return {
			...c,
			left: Substitute(_ctx).nf(subst, c.left),
			right: Substitute(_ctx).nf(subst, c.right),
		};
	});
	const res = match(c)
		.with({ type: "assign" }, ({ left, right }) =>
			F.pipe(
				EB.unify(left, right, _ctx.env.length),
				M.chain(s => _solve(rest, _ctx, compose(_ctx, s, subst))),
			),
		)
		.otherwise(() => {
			throw new Error("Solve: Not implemented yet");
		});

	return res;
};

const compose = (ctx: EB.Context, s1: Subst, s2: Subst): Subst => {
	const mapped = entries(s2).reduce((sub: Subst, [k, nf]) => ({ ...sub, [k]: Substitute(ctx).nf(s1, nf) }), {});
	return { ...s1, ...mapped };
};
