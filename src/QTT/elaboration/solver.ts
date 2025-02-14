import { M } from "@qtt/elaboration";
import * as EB from "@qtt/elaboration";
import * as Src from "@qtt/src/index";
import * as NF from "@qtt/elaboration/normalization";
import { match } from "ts-pattern";
import { Subst, Substitute } from "./substitution";

import * as F from "fp-ts/lib/function";
import * as A from "fp-ts/Array";
import { entries } from "../../utils/objects";

const empty: Subst = {};

type Ctaint = EB.Constraint & { provenance: EB.Provenance[] };
export const solve = (cs: Array<Ctaint>): M.Elaboration<Subst> => M.chain(M.ask(), ctx => _solve(cs, ctx, empty));

const _solve = (cs: Array<Ctaint>, _ctx: EB.Context, subst: Subst): M.Elaboration<Subst> => {
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
		.with({ type: "assign" }, ({ left, right }) => {
			try {
				return F.pipe(
					EB.unify(left, right, _ctx.env.length),
					M.chain(s => _solve(rest, _ctx, compose(_ctx, s, subst))),
				);
			} catch (e) {
				if (e instanceof Error) {
					console.error(e.message);
					console.error(displayProvenance(c.provenance));
				}
				throw e;
			}
		})
		.otherwise(() => {
			throw new Error("Solve: Not implemented yet");
		});

	return res;
};

const compose = (ctx: EB.Context, s1: Subst, s2: Subst): Subst => {
	const mapped = entries(s2).reduce((sub: Subst, [k, nf]) => ({ ...sub, [k]: Substitute(ctx).nf(s1, nf) }), {});
	return { ...s1, ...mapped };
};

const displayProvenance = (provenance: EB.Provenance[]): string => {
	const normalize = (str: string) => str.replace(/\n+/g, "").trim();
	return A.reverse(provenance)
		.map(([id, val, metadata]) => {
			const where = metadata ? `In ${metadata.action}:` : "In:";
			const why = metadata?.motive ? `\nWhile: ${metadata.motive}` : "";

			const pretty = id === "eb" ? EB.Display.Term(val) : id === "nf" ? NF.display(val) : id === "alt" ? Src.Alt.display(val) : Src.display(val);

			const loc = id === "src" ? `@ line: ${val.location.from.line}, col: ${val.location.from.column}\n` : "";

			return `${loc}${where}\t${normalize(pretty)}${why}`;
		})
		.join("\n\n");
};
