import * as F from "fp-ts/lib/function";

import * as EB from "@qtt/elaboration";
import * as NF from "@qtt/elaboration/normalization";

import { mkLogger } from "@qtt/shared/logging";
import { match, P } from "ts-pattern";

const { M } = EB;

const { log } = mkLogger();
export function insert(node: EB.AST): EB.M.Elaboration<EB.AST> {
	const [term, ty, us] = node;
	return F.pipe(
		M.ask(),
		M.chain(ctx => {
			log("entry", "Insert", { Term: EB.display(term), Type: NF.display(ty) });
			return match(node)
				.with([{ type: "Abs", binding: { type: "Lambda", icit: "Implicit" } }, P._, P._], () => M.of<EB.AST>(node))
				.with([P._, { type: "Abs", binder: { type: "Pi", icit: "Implicit" } }, P._], ([, pi]) => {
					const meta = EB.Constructors.Var(EB.freshMeta());
					const vNF = NF.evaluate(ctx.env, ctx.imports, meta);

					const tm = EB.Constructors.App("Implicit", term, meta);

					const bodyNF = NF.apply(ctx.imports, pi.closure, vNF);

					return insert([tm, bodyNF, us]);
				})
				.otherwise(() => M.of(node));
		}),
		M.discard(([tm, ty]) => {
			log("exit", "Result", { Term: EB.display(tm), Type: NF.display(ty) });
			return M.of(null);
		}),
	);
}
