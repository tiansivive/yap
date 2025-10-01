import { match } from "ts-pattern";

import * as EB from ".";
import * as Src from "@yap/src/index";

import * as V2 from "./shared/monad.v2";

export const infer = V2.regen((ast: Src.Term): V2.Elaboration<EB.AST> => {
	const result = V2.track<EB.AST>(
		{ tag: "src", type: "term", term: ast, metadata: { action: "infer" } },
		V2.Do(function* () {
			const ctx = yield* V2.ask();
			const elaboration = match(ast)
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
				.with({ type: "annotation" }, EB.Annotation.infer)
				.otherwise(v => {
					throw new Error("Not implemented yet: " + JSON.stringify(v));
				});

			return yield* V2.pure(elaboration);
		}),
	);
	return result;
});
// infer.gen = F.flow(infer, V2.pure)
