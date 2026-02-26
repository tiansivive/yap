import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";

import { match } from "ts-pattern";

import * as tmp from "./tmp";

type InjectionNode = CST.Types.InjectionNode;

/** Check injection against any type.
 *  Injections are record updates: `{ record | key = value, ... }`.
 *  When checked against Type, each assignment's value and the base record
 *  are checked against Type, folding updates into nested Inj constructors. */
export const check = function* (node: InjectionNode, type: NF.Value): M.Gelaboration<EB.Term> {
	return yield* match(type)
		.with(NF.Patterns.Type, function* () {
			const { record, updates } = CST.Utils.extractFields(node, "record", ["updates"]);

			const assignments = updates.filter((u): u is CST.Types.AssignmentNode => u.type === "assignment");

			if (!record) {
				throw new Error("Injection checked against Type requires a base record");
			}

			const base = yield* tmp.check(record, NF.Type);

			const result = yield* assignments.reduce<M.Gelaboration<EB.Term>>(
				function* (acc, assignment) {
					const { key, value } = CST.Utils.extractFields(assignment, "key", "value");
					const val = yield* tmp.check(value, NF.Type);
					const tm = yield* acc;
					return EB.Constructors.Inj(key.text, val, tm);
				},
				(function* () {
					return base;
				})(),
			);

			return result;
		})

		.otherwise(function* (ty) {
			const ctx = yield* M.ask();
			const [tm, inferred] = yield* tmp.infer(node);
			yield* M.tell("constraint", { type: "assign", left: inferred, right: ty, lvl: ctx.env.length });
			return tm;
		});
};
