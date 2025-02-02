import * as F from "fp-ts/lib/function";

import * as EB from "@qtt/elaboration";
import { M } from "@qtt/elaboration";
import * as NF from "@qtt/elaboration/normalization";

import * as Log from "@qtt/shared/logging";
import { match, P } from "ts-pattern";

export function insert(node: EB.AST): EB.M.Elaboration<EB.AST> {
	const [term, ty, us] = node;
	return F.pipe(
		M.ask(),
		M.chain(ctx => {
			Log.push("insert");
			Log.logger.debug("[Term] " + EB.display(term), { Context: EB.displayContext(ctx) });
			Log.logger.debug("[Type] " + NF.display(ty), { Context: EB.displayContext(ctx) });
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
			Log.push("result");
			Log.logger.debug("[Term] " + EB.display(tm));
			Log.logger.debug("[Type] " + NF.display(ty));
			Log.pop();
			Log.pop();
			return M.of(null);
		}),
	);
}
