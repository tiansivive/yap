import { M } from "@yap/elaboration";
import * as EB from "@yap/elaboration";
import * as Src from "@yap/src/index";
import * as NF from "@yap/elaboration/normalization";
import { match, P } from "ts-pattern";
import { Subst, Substitute } from "./unification/substitution";
import * as Sub from "./unification/substitution";

import * as Err from "@yap/elaboration/shared/errors";
import * as Log from "@yap/shared/logging";

import * as F from "fp-ts/lib/function";
import * as A from "fp-ts/Array";

const empty: Subst = {};

type Ctaint = EB.Constraint & { provenance: EB.Provenance[] };
export const solve = (cs: Array<Ctaint>): M.Elaboration<Subst> =>
	F.pipe(
		M.ask(),
		M.chain(ctx => {
			if (Log.peek() !== "solver") {
				Log.push("solver");
			}
			const filtered = cs.filter(c => c.type === "assign");
			const solution = M.catchError(_solve(filtered, ctx, empty), e => {
				console.error(Err.display(e));
				console.error(displayProvenance(e.provenance));
				return M.fail(e);
			});
			return M.fmap(solution, s => {
				Log.logger.debug("[Solution] " + Sub.display(s));
				Log.pop();
				return s;
			});
		}),
	);

const _solve = (cs: Array<Ctaint>, _ctx: EB.Context, subst: Subst): M.Elaboration<Subst> => {
	Log.logger.debug("[Still to solve] " + cs.length);

	if (cs.length === 0) {
		return M.of(subst);
	}

	const [c, ...rest] = cs.map(c => {
		if (c.type === "usage" || c.type === "resolve") {
			return c;
		}
		return {
			...c,
			left: Substitute(_ctx).nf(subst, c.left, c.lvl),
			right: Substitute(_ctx).nf(subst, c.right, c.lvl),
		};
	});

	const solution = match(c)
		.with({ type: "assign" }, ({ left, right, lvl }) => {
			Log.push("constraint");
			Log.logger.debug("[Left] " + NF.display(left));
			Log.logger.debug("[Right] " + NF.display(right));

			Log.pop();
			return F.pipe(
				EB.unify(left, right, lvl, subst),
				M.chain(s => {
					// return _solve(rest, _ctx, Sub.compose(_ctx, s, subst, lvl))
					return _solve(rest, _ctx, s);
				}),
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
		// console.error(displayProvenance(c.provenance));
		const e_ = { ...e, provenance: [...c.provenance, ...(e.provenance || [])] };
		return M.fail(e_);
	});
};

export const displayProvenance = (provenance: EB.Provenance[] = [], opts = { cap: 10 }): string => {
	return A.reverse(provenance)
		.map(p => {
			const pretty = (([type, val]) => {
				if (type === "unify") {
					return `\n\t${NF.display(val[0])}\nwith:\n\t${NF.display(val[1])}`;
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

			const loc = id === "src" ? `@ line: ${val.location.from.line}, col: ${val.location.from.column}\n` : "";

			if (metadata?.action === "checking") {
				const reason = metadata.description ? `\nReason: ${metadata.description}` : "";
				const msg = `While checking:\n\t${pretty}\nagainst:\n\t${NF.display(metadata.against)}${reason}`;
				return `${loc}${msg}`;
			}
			if (metadata?.action === "alternative") {
				const msg = `In alternative:\n\t${pretty}\nwith type:\n\t${NF.display(metadata.type)}\nWhile: ${metadata.motive}`;
				return `${loc}${msg}`;
			}
			if (metadata?.action === "infer") {
				const reason = metadata.description ? `\nReason: ${metadata.description}` : "";
				const msg = `While inferring:\n\t${pretty}${reason}`;
				return `${loc}${msg}`;
			}
			if (metadata?.action === "unification") {
				const msg = `\nWhile unifiying:\n\t${pretty}`;
				return `${loc}${msg}`;
			}

			return "displayProvenance: Not implemented yet:\n" + JSON.stringify(p);
		})
		.slice(0, opts.cap)
		.join("\n--------------------------------------------------------------------------------------------");
};
