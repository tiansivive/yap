import { match, P } from "ts-pattern";
import { isEqual } from "lodash";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/monad";
import * as CST from "@yap/cst";
import * as Err from "@yap/elaboration/shared/errors";

import * as tmp from "./tmp";
import * as Pi from "./pi";

import * as Struct from "./struct";
import * as Variant from "./variant";
import * as Tuple from "./tuple";
import * as Injection from "./injection";
import * as Tagged from "./tagged";
import * as Match from "./match";

import { SyntaxType } from "@yap/cst/types/generated";

type Result = EB.Term;

export const check = (node: CST.Types.SyntaxNode, type: NF.Value): M.Elaboration<Result> =>
	M.track(
		{ tag: "src", type: "ts-node", node, metadata: { action: "checking", against: type } },
		M.Do(function* () {
			const ctx = yield* M.ask();

			const result: M.Gelaboration<Result> = match([node, type])
				.with([{ type: SyntaxType.Hole }, P._], function* () {
					const k = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
					return EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, k));
				})

				.with(
					[{ type: SyntaxType.Lambda }, { type: "Abs", binder: { type: "Pi" } }],
					([lambda, pi]) => {
						const { explicit, implicit } = CST.Utils.extractFields(lambda, "explicit", "implicit");
						const icitValue = explicit
							? "Explicit"
							: implicit
								? "Implicit"
								: (() => {
										throw new Error("Lambda must have either explicit or implicit parameters");
									})();
						return icitValue === pi.binder.icit;
					},
					([lambda, pi]) => Pi.check(lambda as CST.Types.LambdaNode, pi),
				)

				.with(
					[P._, { type: "Abs", binder: { type: "Pi" } }],
					([_, ty]) => ty.binder.icit === "Implicit",
					([_, ty]) => Pi.insertImplicit(node, ty),
				)

				.with([{ type: SyntaxType.Struct }, P._], ([struct, ty]) => Struct.check(struct, ty))

				.with([{ type: SyntaxType.Variant }, P._], ([variant, ty]) => Variant.check(variant, ty))

				.with([{ type: SyntaxType.Tuple }, P._], ([tuple, ty]) => Tuple.check(tuple, ty))

				.with([{ type: SyntaxType.Injection }, P._], ([inj, ty]) => Injection.check(inj, ty))

				.with([{ type: SyntaxType.Tagged }, P._], ([tagged, ty]) => Tagged.check(tagged, ty))

				.with([{ type: SyntaxType.Match }, P._], ([m, ty]) => Match.check(m, ty))

				.with(
					[{ type: SyntaxType.Literal }, { type: "Lit", value: { type: "Num" } }],
					([lit]) => lit.firstChild?.type === SyntaxType.Number,
					([lit, val]) =>
						(function* () {
							const child = lit.firstChild!;
							const value = Number(child.text);
							if (value === val.value.value) {
								return EB.Constructors.Lit({ type: "Num", value });
							}
							return yield* M.fail<Result>(Err.TypeMismatch(NF.Constructors.Lit({ type: "Num", value }), val));
						})(),
				)

				.with(
					[{ type: SyntaxType.Literal }, NF.Patterns.Type],
					([lit]) => lit.firstChild?.type === SyntaxType.Number,
					([lit]) =>
						(function* () {
							const child = lit.firstChild!;
							return EB.Constructors.Lit({ type: "Num", value: Number(child.text) });
						})(),
				)

				.otherwise(([, expected]) =>
					(function* () {
						const [tm, inferred] = yield* M.local(
							ctx => (isEqual(expected, NF.Type) ? EB.muContext(ctx) : ctx),
							M.Do(function* () {
								const ast = yield* tmp.infer(node);
								return yield* EB.Icit.insert.gen(ast as any);
							}),
						);
						yield* M.tell("constraint", { type: "assign", left: inferred, right: expected, lvl: ctx.env.length });
						return tm;
					})(),
				);

			return yield* result;
		}),
	);
