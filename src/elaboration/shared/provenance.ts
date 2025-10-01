import * as A from "fp-ts/Array";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as R from "@yap/shared/rows";

export type WithProvenance<T extends object> = T & { trace: Provenance[] };
export type Provenance = (
	| { tag: "src"; type: "term"; term: Src.Term }
	| { tag: "src"; type: "stmt"; stmt: Src.Statement }
	| { tag: "eb"; term: EB.Term }
	| { tag: "nf"; val: NF.Value }
	| { tag: "alt"; alt: Src.Alternative }
	| { tag: "unify"; type: "nf"; vals: [NF.Value, NF.Value] }
	| { tag: "unify"; type: "row"; rows: [NF.Row, NF.Row] }
) & { metadata?: Metadata };

type Metadata =
	| { action: "checking"; against: NF.Value; description?: string }
	| { action: "infer"; description?: string }
	| { action: "unification" }
	| { action: "alternative"; type: NF.Value; motive: string };

export const display = (provenance: Provenance[] = [], opts = { cap: 10 }, zonker: EB.Zonker, metas: EB.Context["metas"]): string => {
	return A.reverse(provenance)
		.map(p => {
			const pretty = (prov => {
				if (prov.tag === "unify" && prov.type === "nf") {
					return `\n\t${NF.display(prov.vals[0] as NF.Value, zonker, metas)}\nwith:\n\t${NF.display(prov.vals[1] as NF.Value, zonker, metas)}`;
				}

				if (prov.tag === "unify" && prov.type === "row") {
					const display = R.display<NF.Value, NF.Variable>({
						term: tm => NF.display(tm, zonker, metas),
						var: v => NF.display(NF.Constructors.Var(v), zonker, metas),
					});
					return `\n\t${display(prov.rows[0])}\nwith:\n\t${display(prov.rows[1])}`;
				}

				if (prov.tag === "src" && prov.type === "term") {
					return Src.display(prov.term);
				}

				if (prov.tag === "src" && prov.type === "stmt") {
					return Src.Stmt.display(prov.stmt);
				}

				if (prov.tag === "eb") {
					return EB.Display.Term(prov.term, zonker, metas);
				}

				if (prov.tag === "nf") {
					return NF.display(prov.val, zonker, metas);
				}

				if (prov.tag === "alt") {
					return Src.Alt.display(prov.alt);
				}

				throw new Error("Provenance [display]: Not implemented yet");
			})(p);

			const { metadata } = p;

			let loc = "";
			if (p.tag === "src") {
				const t = p.type === "term" ? p.term : p.stmt;
				loc = `\n@ line: ${t.location.from.line}, col: ${t.location.from.column}\n`;
			}

			if (metadata?.action === "checking") {
				const reason = metadata.description ? `\n\nReason: ${metadata.description}` : "";
				const msg = `While checking:\n\t${pretty}\nagainst:\n\t${NF.display(metadata.against, zonker, metas)}${reason}`;
				return `${msg}\n${loc}`;
			}
			if (metadata?.action === "alternative") {
				const msg = `In alternative:\n\t${pretty}\nwith type:\n\t${NF.display(metadata.type, zonker, metas)}\nWhile: ${metadata.motive}`;
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

			return "Provenance [display]: Not implemented yet:\n" + JSON.stringify(p);
		})
		.slice(0, opts.cap)
		.join("\n--------------------------------------------------------------------------------------------\n\n");
};
