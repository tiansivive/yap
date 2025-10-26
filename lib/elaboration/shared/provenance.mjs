import "../../chunk-ZD7AOCMD.mjs";
import * as A from "fp-ts/Array";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";
import * as R from "@yap/shared/rows";
const display = (provenance = [], opts = { cap: 10 }, zonker, metas) => {
  const displayCtx = { zonker, metas, env: [] };
  return A.reverse(provenance).map((p) => {
    const pretty = ((prov) => {
      if (prov.tag === "unify" && prov.type === "nf") {
        return `
	${NF.display(prov.vals[0], displayCtx)}
with:
	${NF.display(prov.vals[1], displayCtx)}`;
      }
      if (prov.tag === "unify" && prov.type === "row") {
        const display2 = R.display({
          term: (tm) => NF.display(tm, displayCtx),
          var: (v) => NF.display(NF.Constructors.Var(v), displayCtx)
        });
        return `
	${display2(prov.rows[0])}
with:
	${display2(prov.rows[1])}`;
      }
      if (prov.tag === "src" && prov.type === "term") {
        return Src.display(prov.term);
      }
      if (prov.tag === "src" && prov.type === "stmt") {
        return Src.Stmt.display(prov.stmt);
      }
      if (prov.tag === "eb") {
        return EB.Display.Term(prov.term, displayCtx);
      }
      if (prov.tag === "nf") {
        return NF.display(prov.val, displayCtx);
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
      loc = `
@ line: ${t.location.from.line}, col: ${t.location.from.column}
`;
    }
    if (metadata?.action === "checking") {
      const reason = metadata.description ? `

Reason: ${metadata.description}` : "";
      const msg = `While checking:
	${pretty}
against:
	${NF.display(metadata.against, displayCtx)}${reason}`;
      return `${msg}
${loc}`;
    }
    if (metadata?.action === "alternative") {
      const msg = `In alternative:
	${pretty}
with type:
	${NF.display(metadata.type, displayCtx)}
While: ${metadata.motive}`;
      return `${msg}
${loc}`;
    }
    if (metadata?.action === "infer") {
      const reason = metadata.description ? `

Reason: ${metadata.description}` : "";
      const msg = `While inferring:
	${pretty}${reason}`;
      return `${msg}
${loc}`;
    }
    if (metadata?.action === "unification") {
      const msg = `
While unifying:
	${pretty}`;
      return `${msg}
${loc}`;
    }
    return "Provenance [display]: Not implemented yet:\n" + JSON.stringify(p);
  }).slice(0, opts.cap).join("\n--------------------------------------------------------------------------------------------\n\n");
};
export {
  display
};
//# sourceMappingURL=provenance.mjs.map