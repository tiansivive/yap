import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";
import * as R from "@yap/shared/rows";

import { match } from "ts-pattern";

import * as tmp from "./tmp";

type TupleNode = CST.Types.TupleNode;

/** Check tuple against any type.
 *  Tuples are positional row types: `{Nat, Str}`.
 *  When checked against Type, each element is checked against Type
 *  using numeric string keys ('0', '1', ...) and the result is wrapped as a Schema. */
export const check = function* (node: TupleNode, type: NF.Value): M.Gelaboration<EB.Term> {
	return yield* match(type)
		.with(NF.Patterns.Type, function* () {
			const { element: elements, tail } = CST.Utils.extractFields(node, ["element"], "tail");

			if (tail && tail.type !== "identifier") {
				throw new Error("Expected tuple tail to be an identifier");
			}

			const row = yield* elements.reduceRight<M.Gelaboration<EB.Row>>(
				function* (acc, el, i) {
					const tm = yield* tmp.check(el, NF.Type);
					const rest = yield* acc;
					return R.Constructors.Extension(i.toString(), tm, rest);
				},
				(function* () {
					if (!tail || tail.type !== "identifier") {
						return R.Constructors.Empty() as EB.Row;
					}
					const ctx = yield* M.ask();
					const [tm, ty] = yield* EB.lookup.gen({ type: "name", value: tail.text }, ctx);

					if (tm.type !== "Var") {
						throw new Error("Expected row variable in tuple tail");
					}
					yield* M.tell("constraint", { type: "assign", left: ty, right: NF.Row, lvl: ctx.env.length });
					return R.Constructors.Variable(tm.variable) as EB.Row;
				})(),
			);

			return EB.Constructors.Schema(row);
		})

		.otherwise(function* (ty) {
			const ctx = yield* M.ask();
			const [tm, inferred] = yield* tmp.infer(node);
			yield* M.tell("constraint", { type: "assign", left: inferred, right: ty, lvl: ctx.env.length });
			return tm;
		});
};
