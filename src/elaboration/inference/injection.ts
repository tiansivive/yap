import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as NF from "@yap/elaboration/normalization";
import { match } from "ts-pattern";

import * as Lit from "@yap/shared/literals";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as R from "@yap/shared/rows";

import * as F from "fp-ts/function";
import { Liquid } from "@yap/verification/modalities";
import { isLeft } from "fp-ts/lib/Either";
import assert from "node:assert";

type Injection = Extract<EB.Term, { type: "injection" }>;

export const infer = (injection: Injection): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term: injection, metadata: { action: "infer", description: "Injection" } },
		V2.Do<EB.AST, EB.AST>(function* () {
			const { label, value, term } = injection;
			const val = yield* EB.infer.gen(value);
			const tm = yield* EB.infer.gen(term);
			const injected = yield* inject.gen(label, val, tm);
			return [EB.Constructors.Inj(label, val[0], tm[0]), injected, Q.add(tm[2], val[2])] satisfies EB.AST;
		}),
	);
infer.gen = F.flow(infer, V2.pure);

const inject = (label: string, value: EB.AST, tm: EB.AST): V2.Elaboration<NF.Value> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();
		const val = yield* V2.pure(
			match(tm[1])
				.with({ type: "Neutral" }, ({ value: v }) => inject(label, value, [tm[0], v, tm[2]]))
				.with({ type: "Var" }, _ =>
					V2.Do(function* () {
						const r: NF.Row = { type: "variable", variable: yield* EB.freshMeta(ctx.env.length, NF.Row) };
						const rowTypeCtor = EB.Constructors.Pi("rx", "Explicit", EB.Constructors.Lit(Lit.Row()), EB.Constructors.Lit(Lit.Type()));
						const ann = NF.evaluate(ctx, rowTypeCtor);
						const ctor = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, ann)));

						const inferred = NF.Constructors.App(ctor, NF.Constructors.Row(r), "Explicit");
						const extended = NF.Constructors.App(ctor, NF.Constructors.Row(NF.Constructors.Extension(label, value[1], r)), "Explicit");

						yield* V2.tell("constraint", { type: "assign", left: inferred, right: tm[1], lvl: ctx.env.length });
						return extended;
					}),
				)
				.with(NF.Patterns.Sigma, sig => {
					assert(sig.binder.annotation.type === "Row", "Injection: Expected Row type in Sigma binder annotation");
					const rewritten = R.rewrite(sig.binder.annotation.row, label);
					if (isLeft(rewritten)) {
						const ann = NF.Constructors.Row(NF.Constructors.Extension(label, value[1], sig.binder.annotation.row));

						const schema = match(sig.closure.term)
							.with(EB.CtorPatterns.Schema, ({ arg }) =>
								EB.Constructors.Schema(EB.Constructors.Extension(label, NF.quote(ctx, ctx.env.length, value[1]), arg.row)),
							)
							.otherwise(_ => {
								throw new Error("Injection: Expected Schema type in sigma injection");
							});

						return V2.of(NF.Constructors.Sigma(sig.binder.variable, ann, NF.Constructors.Closure(sig.closure.ctx, schema)));
					}

					return V2.of(NF.Constructors.Sigma(sig.binder.variable, NF.Constructors.Row(rewritten.right), sig.closure));
				})
				.with(NF.Patterns.Schema, NF.Patterns.Variant, ({ func, arg }) => {
					const rewritten = R.rewrite(arg.row, label);
					if (isLeft(rewritten)) {
						const extended = NF.Constructors.App(func, NF.Constructors.Row(NF.Constructors.Extension(label, value[1], arg.row)), "Explicit");
						return V2.of(extended);
					}

					return V2.of(NF.Constructors.App(func, NF.Constructors.Row(rewritten.right), "Explicit"));
				})
				.otherwise(_ => {
					throw new Error("Injection: Expected Row type");
				}),
		);
		return val;
	});

inject.gen = F.flow(inject, V2.pure);
