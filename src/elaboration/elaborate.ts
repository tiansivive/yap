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
			/* `&foo` / `$foo` elaborate to the label variable itself, not to a projection. The
			 * projection is what a reducible position wants, so the sites that need one desugar
			 * explicitly; everything else keeps a symbolic reference that never reduces. */
			/* A Σ dep-label's type is a fresh meta standing for the sibling's value. Register it
			 * against the binder it resolved through, so that binder's boundary can constrain it
			 * once the row is elaborated. The resolved index rides in the returned variable. */
			.with({ type: "var", variable: { type: "dep-label" } }, function* ({ variable }) {
				const ast = yield* EB.lookup(variable, ctx);
				yield* match([ast[0], NF.unwrapNeutral(ast[1])] as const)
					.with([EB.CtorPatterns.Vars.DepLabel, NF.Patterns.Flex], function* ([term, ref]) {
						yield* M.windows.record(ctx.env.length - 1 - term.variable.index, { label: term.variable.name, meta: ref.variable });
					})
					.otherwise(function* () {});

				return ast;
			})
			.with({ type: "var", variable: { type: "nu-label" } }, ({ variable }) => EB.lookup(variable, ctx))
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
