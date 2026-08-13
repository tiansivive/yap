import * as A from "fp-ts/Array";

import * as Eff from "@yap/utils/effects";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as M from "./effects";
import type { Display } from "../pretty/pretty";

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

/** Provenance displays under an empty scope: its values quote against no binders. */
export const display = (provenance: readonly Provenance[] = [], opts = { cap: 10 }): Display<string> =>
	M.reader.local(ctx => ({ ...ctx, env: [] }), rendered(provenance, opts));

const rendered = function* (provenance: readonly Provenance[], opts: { cap: number }): Display<string> {
	/* Innermost first: the stack reads as the path that led to the error. */
	const entries = yield* Eff.traverse(A.reverse([...provenance]), function* (p): Display<string> {
		const pretty = yield* (function* (prov: Provenance): Display<string> {
			if (prov.tag === "unify" && prov.type === "nf") {
				return `\n\t${yield* NF.display(prov.vals[0])}\nwith:\n\t${yield* NF.display(prov.vals[1])}`;
			}

			if (prov.tag === "unify" && prov.type === "row") {
				return `\n\t${yield* NF.display(NF.Constructors.Row(prov.rows[0]))}\nwith:\n\t${yield* NF.display(NF.Constructors.Row(prov.rows[1]))}`;
			}

			if (prov.tag === "src" && prov.type === "term") {
				return Src.display(prov.term);
			}

			if (prov.tag === "src" && prov.type === "stmt") {
				return Src.Stmt.display(prov.stmt);
			}

			if (prov.tag === "eb") {
				return yield* EB.Display.Term(prov.term);
			}

			if (prov.tag === "nf") {
				return yield* NF.display(prov.val);
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
			const msg = `While checking:\n\t${pretty}\nagainst:\n\t${yield* NF.display(metadata.against)}${reason}`;
			return `${msg}\n${loc}`;
		}
		if (metadata?.action === "alternative") {
			const msg = `In alternative:\n\t${pretty}\nwith type:\n\t${yield* NF.display(metadata.type)}\nWhile: ${metadata.motive}`;
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
	});

	return entries.slice(0, opts.cap).join("\n--------------------------------------------------------------------------------------------\n\n");
};
