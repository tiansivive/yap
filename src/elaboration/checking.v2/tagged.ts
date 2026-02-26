import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";
import * as R from "@yap/shared/rows";

import { match } from "ts-pattern";
import { isLeft } from "fp-ts/lib/Either";

import * as tmp from "./tmp";

type TaggedNode = CST.Types.TaggedNode;

/** Check tagged value against any type.
 *  Tagged values are variant constructors: `#Foo 42`.
 *  When checked against a Variant type, the tag is looked up in the variant's row
 *  and the payload is checked against the expected type for that tag. */
export const check = function* (node: TaggedNode, type: NF.Value): M.Gelaboration<EB.Term> {
	return yield* match(type)
		.with(NF.Patterns.Variant, function* ({ arg }) {
			const { tag, payload } = CST.Utils.extractFields(node, "tag", "payload");
			const rewritten = R.rewrite(arg.row, tag.text);

			if (isLeft(rewritten) || rewritten.right.type !== "extension") {
				// Tag not found in variant or unexpected shape — fall back to infer+unify
				const ctx = yield* M.ask();
				const [tm, inferred] = yield* tmp.infer(node);
				yield* M.tell("constraint", { type: "assign", left: inferred, right: type, lvl: ctx.env.length });
				return tm;
			}

			const { value: expectedTy } = rewritten.right;
			const tm = yield* tmp.check(payload, expectedTy);
			const row = R.Constructors.Extension<EB.Term, EB.Variable>(tag.text, tm, R.Constructors.Empty());
			return EB.Constructors.Struct(row);
		})

		.otherwise(function* (ty) {
			const ctx = yield* M.ask();
			const [tm, inferred] = yield* tmp.infer(node);
			yield* M.tell("constraint", { type: "assign", left: inferred, right: ty, lvl: ctx.env.length });
			return tm;
		});
};
