import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as EB from "@yap/elaboration";
import { U } from "@yap/elaboration";
import * as Src from "@yap/src/index";
import * as NF from "@yap/elaboration/normalization";
import { match, P } from "ts-pattern";
import { Subst } from "@yap/elaboration/unification/substitution";

import * as Err from "@yap/elaboration/shared/errors";
import * as Log from "@yap/shared/logging";

import * as F from "fp-ts/lib/function";
import * as A from "fp-ts/Array";

import * as Q from "@yap/shared/modalities/multiplicity";

const empty: Subst = {};

export type Constraint =
	| { type: "assign"; left: NF.Value; right: NF.Value; lvl: number }
	| { type: "usage"; computed: Q.Multiplicity; expected: Q.Multiplicity }
	| { type: "resolve"; meta: Extract<EB.Variable, { type: "Meta" }>; annotation: NF.Value };
// | { type: "sigma"; lvl: number; dict: Record<string, NF.Value> }

type Ctaint = EB.WithProvenance<Constraint>;
export const solve = (cs: Array<Ctaint>): V2.Elaboration<Subst> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();
		const solution = yield* V2.pure(_solve(cs, ctx, empty));

		return solution;
	});

const _solve = (cs: Array<Ctaint>, _ctx: EB.Context, subst: Subst): V2.Elaboration<Subst> => {
	if (cs.length === 0) {
		return V2.of(subst);
	}

	const [c, ...rest] = cs;

	return match(c)
		.with({ type: "assign" }, ({ left, right, lvl }) =>
			V2.Do<Subst, Subst>(function* () {
				const sub = yield* V2.local(F.identity, V2.track(c.trace, U.unify(left, right, lvl, subst)));
				const sol = yield _solve(rest, _ctx, sub);
				return sol;
			}),
		)
		.with({ type: "usage" }, ({ expected, computed }) => {
			return match([expected, computed])
				.with(["One", "One"], ["Many", P._], ["Zero", "Zero"], () => _solve(rest, _ctx, subst))
				.otherwise(() => V2.Do(() => V2.fail<Subst>(Err.MultiplicityMismatch(expected, computed))));
		})
		.otherwise(() => {
			throw new Error("Solve: Not implemented yet");
		});
};

export const displayProvenance = (provenance: EB.Provenance[] = [], opts = { cap: 10 }, zonker: EB.Zonker): string => {
	return A.reverse(A.chunksOf(3)(provenance))
		.map(p => {
			const pretty = (([type, val]) => {
				if (type === "unify") {
					if (val[0].type === "empty" || val[1].type === "extension" || val[1].type === "variable") {
						return `\n\t${JSON.stringify(val[0])}\nwith:\n\t${JSON.stringify(val[1])}`;
					}
					return `\n\t${NF.display(val[0] as NF.Value, zonker)}\nwith:\n\t${NF.display(val[1] as NF.Value, zonker)}`;
				}

				if (type === "src") {
					return Src.display(val as Src.Term);
				}

				if (type === "eb") {
					return EB.Display.Term(val, zonker);
				}

				if (type === "nf") {
					return NF.display(val, zonker);
				}

				if (type === "alt") {
					return Src.Alt.display(val);
				}
				throw new Error("displayProvenance: Not implemented yet");
			})(p);

			const [id, val, metadata] = p;

			const loc = id === "src" ? `\n@ line: ${val.location.from.line}, col: ${val.location.from.column}\n` : "\n";

			if (metadata?.action === "checking") {
				const reason = metadata.description ? `\n\nReason: ${metadata.description}` : "";
				const msg = `While checking:\n\t${pretty}\nagainst:\n\t${NF.display(metadata.against, zonker)}${reason}`;
				return `${msg}\n${loc}`;
			}
			if (metadata?.action === "alternative") {
				const msg = `In alternative:\n\t${pretty}\nwith type:\n\t${NF.display(metadata.type, zonker)}\nWhile: ${metadata.motive}`;
				return `${msg}\n${loc}`;
			}
			if (metadata?.action === "infer") {
				const reason = metadata.description ? `\n\nReason: ${metadata.description}` : "";
				const msg = `While inferring:\n\t${pretty}${reason}`;
				return `${msg}\n${loc}`;
			}
			if (metadata?.action === "unification") {
				const msg = `\nWhile unifying:\n\t${pretty}`;
				return `${msg}\n${loc}`;
			}

			return "displayProvenance: Not implemented yet:\n" + JSON.stringify(p);
		})
		.slice(0, opts.cap)
		.join("\n--------------------------------------------------------------------------------------------\n\n");
};
