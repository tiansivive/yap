import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as F from "fp-ts/lib/function";

import * as R from "@yap/shared/rows";
import * as Q from "@yap/shared/modalities/multiplicity";
import { match } from "ts-pattern";

type Struct = Extract<Src.Term, { type: "struct" }>;

export const infer = (struct: Struct): V2.Elaboration<EB.AST> =>
	V2.track({ tag: "src", type: "term", term: struct, metadata: { action: "infer", description: "Struct" } }, commonStructInference(struct.row));
infer.gen = F.flow(infer, V2.pure);

export const commonStructInference = (row: Src.Row): V2.Elaboration<EB.AST> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();
		// const [row, ty, qs] = yield* EB.Rows.inSigmaContext.gen(struct.row, collect(struct.row));
		const { fields, tail } = yield* EB.Rows.inSigmaContext.gen(row, EB.Rows.collect(row));

		const mkRows = (start: [EB.Row, NF.Row]) =>
			fields.reduceRight<[EB.Row, NF.Row]>(
				([rtm, rty], { label, term, value }) => [R.Constructors.Extension(label, term, rtm), R.Constructors.Extension(label, value, rty)],
				start,
			);

		if (!tail) {
			const [rtm, rty] = mkRows([R.Constructors.Empty(), R.Constructors.Empty()]);
			// No tail, simple struct and respective schema type
			return [EB.Constructors.Struct(rtm), NF.Constructors.Schema(rty), Q.noUsage(ctx.env.length)] satisfies EB.AST;
		}

		const [tm, ty] = yield* match(tail.ty)
			.with({ type: "Lit", value: { type: "Atom", value: "Row" } }, function* () {
				// If tail is a var of type Row, then our term is a schema, which is of type Type. We can safely ignore the per-label inferred values (types)
				const rtm = fields.reduceRight<EB.Row>((r, { label, term }) => R.Constructors.Extension(label, term, r), R.Constructors.Variable(tail.variable));
				return [EB.Constructors.Schema(rtm), NF.Type] as const;
			})
			.with(NF.Patterns.Schema, function* (s) {
				// If tail is a schema itself, then our term is a "struct merger", meaning the type is a Schema composed of the fields + the tail schema's fields
				const [rtm, rty] = mkRows([R.Constructors.Variable(tail.variable), s.arg.row]);
				return [EB.Constructors.Struct(rtm), NF.Constructors.Schema(rty)] as const;
			})
			.with(NF.Patterns.Flex, function* (meta) {
				// If tail is a meta variable, we cannot be sure if it's a struct or a schema.
				// We default to struct, and emit a constraint equating the meta to a schema over a fresh meta of type Row.
				// This fresh meta will end up generalized, therefore quantifying this term over some polymorphic row type.
				// Therefore the type is the inferred row + the fresh meta of type Row
				const freshRowMeta = yield* EB.freshMeta(ctx.env.length, NF.Row);
				const schemaTy = NF.Constructors.Schema(R.Constructors.Variable(freshRowMeta));
				yield* V2.tell("constraint", { type: "assign", left: meta, right: schemaTy });

				const [rtm, rty] = mkRows([R.Constructors.Variable(tail.variable), R.Constructors.Variable(freshRowMeta)]);
				return [EB.Constructors.Struct(rtm), NF.Constructors.Schema(rty)] as const;
			})
			.otherwise(() => {
				throw new Error("Elaborating Struct: Tail type is neither Schema, Row nor Flex");
			});

		return [tm, ty, Q.noUsage(ctx.env.length)] satisfies EB.AST;
	});
