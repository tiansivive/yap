import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";
import * as R from "@yap/shared/rows";

import { match } from "ts-pattern";

import * as tmp from "./tmp";

type VariantNode = CST.Types.VariantNode;

/** Check variant against any type.
 *  Variants are type-level constructs: `| #Foo Nat | #Bar Str`.
 *  When checked against Type, each tag's payload is checked against Type
 *  and the result is wrapped as a Variant row type. */
export const check = function* (node: VariantNode, type: NF.Value): M.Gelaboration<EB.Term> {
	return yield* match(type)
		.with(NF.Patterns.Type, function* () {
			const tagged = node.variantNodes;
			const row = yield* tagged.reduceRight<M.Gelaboration<EB.Row>>(
				function* (acc, tag) {
					const { tag: label, payload } = CST.Utils.extractFields(tag, "tag", "payload");
					const tm = yield* tmp.check(payload, NF.Type);
					const rest = yield* acc;
					return R.Constructors.Extension(label.text, tm, rest);
				},
				(function* () {
					return R.Constructors.Empty() as EB.Row;
				})(),
			);
			return EB.Constructors.Variant(row);
		})

		.otherwise(function* (ty) {
			const ctx = yield* M.ask();
			const [tm, inferred] = yield* tmp.infer(node);
			yield* M.tell("constraint", { type: "assign", left: inferred, right: ty, lvl: ctx.env.length });
			return tm;
		});
};
