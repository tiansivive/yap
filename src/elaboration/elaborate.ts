import { match } from "ts-pattern";

import * as EB from ".";
import * as Src from "@yap/src/index";

import * as M from "./shared/effects";

import * as NF from "./normalization";
import * as Q from "@yap/shared/modalities/multiplicity";

export type AST = [EB.Term, NF.Value, Q.Usages];
export const infer = (ast: Src.Term): M.Elaboration<AST> => {
	const result = M.tracer.track({ tag: "src", type: "term", term: ast, metadata: { action: "infer" } }, function* () {
		const ctx = yield* M.reader.ask();
		const elaboration = match(ast)
			/* `&foo` and `$foo` elaborate to label variables, which never reduce; a site that needs
			 * the field's value builds the projection itself. The meta typing `&foo` is recorded for
			 * the Sigma binder it resolved to, which constrains it once its row is elaborated. */
			.with({ type: "var", variable: Src.Patterns.Vars.DepLabel }, function* ({ variable }) {
				const resolved = yield* EB.lookup(variable, ctx);
				yield* match([resolved[0], NF.unwrapNeutral(resolved[1])] as const)
					.with([EB.CtorPatterns.Vars.DepLabel, NF.Patterns.Flex], function* ([term, ref]) {
						yield* M.windows.record({ scope: "env", lvl: ctx.env.length - 1 - term.variable.index }, { label: term.variable.name, meta: ref.variable });
					})
					.otherwise(function* () {});

				return resolved;
			})
			.with({ type: "var" }, ({ variable }) => EB.lookup(variable, ctx))

			.with({ type: "lit" }, EB.Lit.infer)
			.with({ type: "hole" }, EB.Hole.infer)

			.with({ type: "row" }, EB.Rows.infer)
			.with({ type: "projection" }, EB.Proj.infer)
			.with({ type: "injection" }, EB.Inj.infer)

			.with({ type: "struct" }, EB.Struct.infer)
			.with({ type: "tuple" }, EB.Tuples.infer)
			.with({ type: "list" }, EB.List.infer)
			.with({ type: "dict" }, EB.Dict.infer)
			.with({ type: "variant" }, EB.Variant.infer)
			.with({ type: "tagged" }, EB.Tagged.infer)

			.with({ type: "pi" }, { type: "arrow" }, EB.Pi.infer)
			.with({ type: "lambda" }, EB.Lambda.infer)
			.with({ type: "application" }, EB.Application.infer)

			.with({ type: "match" }, EB.Match.infer)

			.with({ type: "block" }, EB.Block.infer)
			.with({ type: "modal" }, EB.Modal.infer)
			.with({ type: "annotation" }, EB.Annotation.infer)

			.with({ type: "reset" }, EB.Reset.infer)
			.with({ type: "shift" }, EB.Shift.infer)
			.with({ type: "resume" }, EB.Shift.resume)
			.otherwise(v => {
				throw new Error("Not implemented yet: " + JSON.stringify(v));
			});

		const [tm, ty, us] = yield* elaboration;
		return [tm, ty, us] satisfies AST;
	});
	return result;
};
