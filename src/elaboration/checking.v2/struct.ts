import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";

import { entries } from "@yap/utils";
import { match } from "ts-pattern";
import assert from "node:assert";

import * as Row from "./row";
import * as StructInfer from "../inference.v2/structs";

type StructNode = CST.Types.StructNode;

type Extracted = {
	fields: CST.Types.KeyValueNode[];
	tail?: CST.Types.IdentifierNode;
};

const extractFields = (struct: StructNode): Extracted => {
	const { field: fields, tail } = CST.Utils.extractFields(struct, ["field"], "tail");

	if (fields.some(field => field.type !== "key_value")) {
		throw new Error("Expected all struct fields to be key-value pairs");
	}
	if (tail && tail.type !== "identifier") {
		throw new Error("Expected struct tail to be an identifier");
	}

	return { fields: fields as CST.Types.KeyValueNode[], tail: tail as CST.Types.IdentifierNode | undefined };
};

/** Check struct against any type.
 *  Pattern matches on type shape and routes to appropriate checker. */
export const check = function* (struct: StructNode, type: NF.Value): M.Gelaboration<EB.Term> {
	return yield* match(type)
		.with(NF.Patterns.Type, function* () {
			const ctx = yield* M.ask();
			const { fields, tail } = extractFields(struct);
			const row = yield* Row.check(fields, tail, NF.Type, ctx.env.length);
			return EB.Constructors.Sigma("$sig", EB.Constructors.Row(row), EB.Constructors.Schema(row));
		})

		.with(NF.Patterns.HashMap, function* (hashmap) {
			const ctx = yield* M.ask();
			const { fields, tail } = extractFields(struct);
			const row = yield* Row.check(fields, tail, hashmap.value.func.arg, ctx.env.length);
			yield* M.tell("constraint", {
				type: "assign",
				left: hashmap.value.arg,
				right: NF.Constructors.Var({ type: "Foreign", name: "defaultHashMap" }),
				lvl: ctx.env.length,
			});
			return EB.Constructors.Struct(row);
		})

		.with(NF.Patterns.Schema, function* (schema) {
			const { fields, tail } = extractFields(struct);
			const pairs: [string, CST.Types.SyntaxNode][] = fields.map(field => {
				const { key, value } = CST.Utils.extractFields(field, "key", "value");
				return [key.text, value];
			});
			const bindings = yield* Row.extractBindings(pairs, tail);

			const row = yield* M.local(
				ctx => entries(bindings).reduce((ctx, [label, sig]) => EB.extendSigma(ctx, label, sig), ctx),
				M.Do(function* () {
					return yield* Row.traverse(fields, tail, schema.arg.row, bindings);
				}),
			);

			return EB.Constructors.Struct(row);
		})

		.with(NF.Patterns.Sigma, function* (sig) {
			const ctx = yield* M.ask();
			const [rtm, rty] = yield* StructInfer.infer.gen(struct);

			const rv = NF.evaluate(ctx, rtm);
			assert(rv.type === "App" && rv.arg.type === "Row", "Expected struct term to evaluate to an application of a Row");
			const ty = NF.apply(sig.binder, sig.closure, NF.Constructors.Row(rv.arg.row));

			yield* M.tell("constraint", { type: "assign", left: ty, right: rty, lvl: ctx.env.length });
			return rtm;
		})

		.otherwise(function* (ty) {
			const ctx = yield* M.ask();
			const [tm, inferred] = yield* StructInfer.infer.gen(struct);
			yield* M.tell("constraint", { type: "assign", left: inferred, right: ty, lvl: ctx.env.length });
			return tm;
		});
};
