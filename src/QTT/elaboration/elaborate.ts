import { match } from "ts-pattern";

import * as F from "fp-ts/lib/function";

import * as EB from ".";
import * as NF from "./normalization";
import * as M from "./monad";

import * as Src from "@qtt/src/index";
import * as Lit from "@qtt/shared/literals";
import * as Q from "@qtt/shared/modalities/multiplicity";
import * as Log from "@qtt/shared/logging";

import { P } from "ts-pattern";

import { displayConstraint, displayContext } from "./pretty";

import { freshMeta } from "./supply";

export type Constraint = { type: "assign"; left: NF.Value; right: NF.Value } | { type: "usage"; computed: Q.Multiplicity; expected: Q.Multiplicity };

export function infer(ast: Src.Term): M.Elaboration<EB.AST> {
	const result = F.pipe(
		M.ask(),
		M.chain(ctx => {
			Log.push("infer");
			Log.logger.debug(Src.display(ast), { Context: displayContext(ctx) });
			const { env } = ctx;
			return match(ast)
				.with({ type: "lit" }, ({ value }): M.Elaboration<EB.AST> => {
					const atom: Lit.Literal = match(value)
						.with({ type: "String" }, _ => Lit.Atom("String"))
						.with({ type: "Num" }, _ => Lit.Atom("Num"))
						.with({ type: "Bool" }, _ => Lit.Atom("Bool"))
						.with({ type: "Atom" }, _ => Lit.Atom("Type"))
						.exhaustive();

					return M.of<EB.AST>([{ type: "Lit", value }, { type: "Lit", value: atom }, Q.noUsage(ctx.env.length)]);
				})

				.with({ type: "hole" }, _ => {
					const meta = EB.Constructors.Var(freshMeta());
					const ty = NF.evaluate(env, ctx.imports, meta);
					// const modal = NF.infer(env, annotation);
					return M.of<EB.AST>([meta, ty, Q.noUsage(ctx.env.length)]);
				})

				.with({ type: "var" }, ({ variable }) => M.of<EB.AST>(EB.lookup(variable, ctx)))

				.with({ type: "row" }, ({ row }) =>
					F.pipe(
						EB.Rows.elaborate(row),
						M.fmap(([row, ty, qs]): EB.AST => [EB.Constructors.Row(row), NF.Row, qs]), // QUESTION:? can we do anything to the ty row? Should we?
					),
				)
				.with({ type: "struct" }, ({ row }) =>
					M.fmap(EB.Rows.elaborate(row), ([row, ty, qs]): EB.AST => [EB.Constructors.Struct(row), NF.Constructors.Schema(ty), qs]),
				)
				.with({ type: "schema" }, ({ row }) => M.fmap(EB.Rows.elaborate(row), ([row, ty, qs]): EB.AST => [EB.Constructors.Schema(row), NF.Type, qs]))

				.with({ type: "variant" }, ({ row }) =>
					M.fmap(EB.Rows.elaborate(row), ([row, ty, qs]): EB.AST => [EB.Constructors.Variant(row), NF.Constructors.Variant(ty), qs]),
				)

				.with({ type: "projection" }, ({ term, label }) =>
					F.pipe(
						M.Do,
						M.let("term", infer(term)),
						M.bind("inferred", ({ term: [tm, ty, us] }) => EB.Proj.project(label, tm, ty, us)),
						M.fmap(({ term: [tm, , us], inferred }): EB.AST => [EB.Constructors.Proj(label, tm), inferred, us]), // TODO: Subtract usages?
					),
				)
				.with({ type: "injection" }, ({ label, value, term }) =>
					F.pipe(
						M.Do,
						M.let("value", infer(value)),
						M.let("term", infer(term)),
						M.bind("inferred", ({ value, term }) => EB.Inj.inject(label, value, term)),
						M.fmap(({ term: [tm, , u1], value: [val, , u2], inferred }): EB.AST => [EB.Constructors.Inj(label, val, tm), inferred, Q.add(u1, u2)]),
					),
				)
				.with({ type: "annotation" }, ({ term, ann, multiplicity }) =>
					F.pipe(
						M.Do,
						M.let("ann", check(ann, NF.Type)),
						M.bind("type", ({ ann: [type, us] }) => {
							const val = NF.evaluate(env, ctx.imports, type);
							return M.of([val, us] as const);
						}),
						M.bind("term", ({ type: [type, us] }) => check(term, type)),
						M.fmap(({ term: [term], type: [type, us] }): EB.AST => [term, type, us]),
					),
				)

				.with({ type: "application" }, EB.Application.infer)
				.with({ type: "pi" }, { type: "arrow" }, EB.Pi.infer)
				.with({ type: "lambda" }, EB.Lambda.infer)
				.with({ type: "match" }, EB.Match.infer)
				.otherwise(() => {
					throw new Error("Not implemented yet");
				});
		}),
		M.discard(([tm, ty, us]) => {
			Log.logger.debug("[Result] " + Src.display(ast), { Term: EB.display(tm), Type: NF.display(ty), Usages: us });
			Log.pop();
			return M.of(null);
		}),
	);
	return result;
}

export function check(term: Src.Term, type: NF.Value): M.Elaboration<[EB.Term, Q.Usages]> {
	return F.pipe(
		M.ask(),
		M.chain(ctx => {
			Log.push("check");
			Log.logger.debug("Checking", { Context: displayContext(ctx) });
			Log.logger.debug(Src.display(term));
			Log.logger.debug(NF.display(type));

			return match([term, type])
				.with([{ type: "hole" }, P._], () => M.of<[EB.Term, Q.Usages]>([EB.Constructors.Var(freshMeta()), []]))
				.with(
					[{ type: "lambda" }, { type: "Abs", binder: { type: "Pi" } }],
					([tm, ty]) => tm.icit === ty.binder.icit,
					([tm, ty]) => {
						const bType = NF.apply(ctx.imports, ty.closure, NF.Constructors.Rigid(ctx.env.length));

						const ctx_ = EB.bind(ctx, tm.variable, ty.binder.annotation);
						return M.local(
							ctx_,
							F.pipe(
								check(tm.body, bType),
								M.discard(([, [vu]]) => M.tell({ type: "usage", expected: ty.binder.annotation[1], computed: vu })),
								M.fmap(([body, [, ...us]]): [EB.Term, Q.Usages] => [EB.Constructors.Lambda(tm.variable, tm.icit, body), us]),
							),
						);
					},
				)
				.with(
					[P._, { type: "Abs", binder: { type: "Pi" } }],
					([_, ty]) => ty.binder.icit === "Implicit",
					([tm, ty]) => {
						const bType = NF.apply(ctx.imports, ty.closure, NF.Constructors.Rigid(ctx.env.length));
						const ctx_ = EB.bindInsertedImplicit(ctx, ty.binder.variable, ty.binder.annotation);
						return M.local(
							ctx_,
							F.pipe(
								check(tm, bType),
								M.discard(([, [vu]]) => M.tell({ type: "usage", expected: ty.binder.annotation[1], computed: vu })),
								M.fmap(([tm, [, ...us]]): [EB.Term, Q.Usages] => [EB.Constructors.Lambda(ty.binder.variable, "Implicit", tm), us]),
							),
						);
					},
				)

				.otherwise(([tm, _]) =>
					F.pipe(
						infer(tm),
						M.chain(EB.Icit.insert),
						M.discard(([, inferred]) => M.tell({ type: "assign", left: inferred, right: type })),
						M.fmap(([tm, , us]): [EB.Term, Q.Usages] => [tm, us]),
					),
				);
		}),
		M.listen(([[tm, us], cs]) => {
			Log.logger.debug("[Result] " + EB.display(tm), { Usages: us, Constraints: cs.map(displayConstraint) });
			Log.pop();

			return [tm, us];
		}),
	);
}

const kindOf = (ty: NF.Value): M.Elaboration<NF.Value> =>
	match(ty)
		.with({ type: "Neutral" }, ({ value }) => kindOf(value))
		.with({ type: "Row" }, _ => M.of(NF.Row))
		.with({ type: "Var" }, ({ variable }) =>
			M.chain(M.ask(), ctx =>
				match(variable)
					.with({ type: "Free" }, ({ name }) => {
						const val = ctx.imports[name];

						if (!val) {
							throw new Error("Unbound free variable: " + name);
						}

						return kindOf(NF.evaluate(ctx.env, ctx.imports, val[0]));
					})
					.with({ type: "Meta" }, _ => M.of(NF.Constructors.Var(freshMeta())))
					.with({ type: "Bound" }, ({ index }) => M.of(ctx.env[index][0]))
					.exhaustive(),
			),
		)
		.otherwise(() => M.of(NF.Type));
