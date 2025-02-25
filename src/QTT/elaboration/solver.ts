import { M } from "@qtt/elaboration";
import * as EB from "@qtt/elaboration";
import * as Src from "@qtt/src/index";
import * as NF from "@qtt/elaboration/normalization";
import { match, P } from "ts-pattern";
import { Subst, Substitute } from "./substitution";
import * as Sub from "./substitution";

import * as Err from "@qtt/elaboration/errors";
import * as Log from "@qtt/shared/logging";

import * as F from "fp-ts/lib/function";
import * as A from "fp-ts/Array";

const empty: Subst = {};

type Ctaint = EB.Constraint & { provenance: EB.Provenance[] };
export const solve = (cs: Array<Ctaint>): M.Elaboration<Subst> =>
	M.chain(M.ask(), ctx => {
		if (Log.peek() !== "solver") {
			Log.push("solver");
		}
		return M.fmap(_solve(cs, ctx, empty), s => {
			Log.logger.debug("[Solution] " + Sub.display(s));
			Log.pop();
			return s;
		});
	});

const _solve = (cs: Array<Ctaint>, _ctx: EB.Context, subst: Subst): M.Elaboration<Subst> => {
	Log.logger.debug("[Still to solve] " + cs.length);

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

	const solution = match(c)
		.with({ type: "assign" }, ({ left, right }) => {
			Log.push("constraint");
			Log.logger.debug("[Assign] " + NF.display(left) + " ~~ " + NF.display(right));

			Log.pop();
			return F.pipe(
				EB.unify(left, right, _ctx.env.length),
				M.chain(s => _solve(rest, _ctx, Sub.compose(_ctx, s, subst))),
			);
		})
		.with({ type: "usage" }, ({}) => {
			console.warn("Usage constraint not implemented yet");
			return _solve(rest, _ctx, subst);
		})
		.otherwise(() => {
			throw new Error("Solve: Not implemented yet");
		});

	return M.catchError(solution, e => {
		console.error(Err.display(e));
		console.error(displayProvenance(c.provenance));
		return M.fail(e);
	});
};

export const displayProvenance = (provenance: EB.Provenance[] = []): string => {
	const normalize = (str: string) => str.replace(/\n+/g, "").trim();
	return A.reverse(provenance)
		.map(p => {
			const pretty = (([type, val]) => {
				if (type === "unify") {
					return `${NF.display(val[0])} ~~ ${NF.display(val[1])}`;
				}

				if (type === "src") {
					return Src.display(val);
				}

				if (type === "eb") {
					return EB.Display.Term(val);
				}

				if (type === "nf") {
					return NF.display(val);
				}

				if (type === "alt") {
					return Src.Alt.display(val);
				}
				throw new Error("displayProvenance: Not implemented yet");
			})(p);

			const [id, val, metadata] = p;
			const where = metadata ? `In ${metadata.action}:` : "In:";
			const why = metadata?.motive ? `\nWhile: ${metadata.motive}` : "";
			const loc = id === "src" ? `@ line: ${val.location.from.line}, col: ${val.location.from.column}\n` : "";

			return `${loc}${where}\t${normalize(pretty)}${why}`;
		})
		.join("\n\n");
};
