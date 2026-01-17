import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";

import * as tmp from "./tmp";

import * as F from "fp-ts/lib/function";
import * as Lit from "@yap/shared/literals";

import { match } from "ts-pattern";
import assert from "node:assert";

import * as R from "@yap/shared/rows";
import { isLeft } from "fp-ts/lib/Either";

type Injection = Extract<CST.Types.SyntaxNode, { type: "injection" }>;

export const infer = (injection: Injection): M.Elaboration<tmp.Typing> =>
	M.track(
		{ tag: "src", type: "ts-node", node: injection, metadata: { action: "infer", description: "Injection" } },
		M.Do<tmp.Typing, tmp.Typing>(function* () {
			const { record, updates } = CST.Utils.extractFields(injection, "record", ["updates"]);

			type Assignment = Extract<CST.Types.SyntaxNode, { type: "assignment" }>;

			const fold = function* (assignments: Assignment[], typing: tmp.Typing): Generator<M.Elaboration<any>, tmp.Typing, any> {
				if (assignments.length === 0) {
					return typing;
				}

				const [assignment, ...rest] = assignments;
				const { key, value } = CST.Utils.extractFields(assignment, "key", "value");

				const val = yield* tmp.infer(value);
				const tm = yield* tmp.infer(record);

				const injected = yield* inject.gen(key.text, val, tm);
				const ast: tmp.Typing = [EB.Constructors.Inj(key.text, val[0], tm[0]), injected];

				return yield* fold(rest, ast);
			};
			const typing = yield* tmp.infer(record);
			const assignments = updates.filter((u): u is Assignment => u.type === "assignment");

			return yield* fold(assignments, typing);
		}),
	);
infer.gen = F.flow(infer, M.pure);

const inject = (label: string, value: tmp.Typing, tm: tmp.Typing): M.Elaboration<NF.Value> =>
	M.Do(function* () {
		const ctx = yield* M.ask();
		const val = yield* M.pure(
			match(tm[1])
				.with({ type: "Neutral" }, ({ value: v }) => inject(label, value, [tm[0], v]))
				.with({ type: "Var" }, _ =>
					M.Do(function* () {
						const r: NF.Row = { type: "variable", variable: yield* EB.freshMeta(ctx.env.length, NF.Row) };
						const rowTypeCtor = EB.Constructors.Pi("rx", "Explicit", EB.Constructors.Lit(Lit.Row()), EB.Constructors.Lit(Lit.Type()));
						const ann = NF.evaluate(ctx, rowTypeCtor);
						const ctor = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, ann)));

						const inferred = NF.Constructors.App(ctor, NF.Constructors.Row(r), "Explicit");
						const extended = NF.Constructors.App(ctor, NF.Constructors.Row(NF.Constructors.Extension(label, value[1], r)), "Explicit");

						yield* M.tell("constraint", { type: "assign", left: inferred, right: tm[1], lvl: ctx.env.length });
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

						return M.of(NF.Constructors.Sigma(sig.binder.variable, ann, NF.Constructors.Closure(sig.closure.ctx, schema)));
					}

					return M.of(NF.Constructors.Sigma(sig.binder.variable, NF.Constructors.Row(rewritten.right), sig.closure));
				})
				.with(NF.Patterns.Schema, NF.Patterns.Variant, ({ func, arg }) => {
					const rewritten = R.rewrite(arg.row, label);
					if (isLeft(rewritten)) {
						const extended = NF.Constructors.App(func, NF.Constructors.Row(NF.Constructors.Extension(label, value[1], arg.row)), "Explicit");
						return M.of(extended);
					}

					return M.of(NF.Constructors.App(func, NF.Constructors.Row(rewritten.right), "Explicit"));
				})
				.otherwise(_ => {
					throw new Error("Injection: Expected Row type");
				}),
		);
		return val;
	});

inject.gen = F.flow(inject, M.pure);
