import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";

import * as tmp from "./tmp";
import { match } from "ts-pattern";

import * as Lit from "@yap/shared/literals";
import * as F from "fp-ts/function";

type Projection = Extract<CST.Types.SyntaxNode, { type: "projection" }>;

export const infer = (node: Projection): M.Elaboration<tmp.Typing> =>
	M.track(
		{ tag: "src", type: "ts-node", node, metadata: { action: "infer", description: "Projection node" } },
		M.Do(function* () {
			
			const { record, key } = CST.Utils.extractFields(node, "record", "key");

			const label = key.text;
			const [tm, ty] = yield* tmp.infer(record);

			const projected = yield* M.pure(project(label, tm, ty));

			return [EB.Constructors.Proj(label, tm), projected] satisfies tmp.Typing;
		}),
	);

export const project = (label: string, tm: EB.Term, ty: NF.Value): M.Elaboration<NF.Value> =>
	M.Do(function* () {
		const ctx = yield* M.ask();
		const nf = yield* M.pure(
			match(ty)
				.with({ type: "Neutral" }, ({ value }) => project(label, tm, value))
				.with(NF.Patterns.Flex, _ =>
					M.Do(function* () {
						const ctor = NF.Constructors.Atom("Schema");
						const kind = NF.Type;
						const val = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind)));

						const r: NF.Row = { type: "variable", variable: yield* EB.freshMeta(ctx.env.length, NF.Row) };
						const xtension = NF.Constructors.Extension(label, val, r);
						const inferred = NF.Constructors.App(ctor, NF.Constructors.Row(xtension), "Explicit");

						yield* M.tell("constraint", { type: "assign", left: inferred, right: ty, lvl: ctx.env.length });

						return val;
					}),
				)
				.with(NF.Patterns.Schema, ({ func, arg }) =>
					M.Do(function* () {
						const from = function* (l: string, row: NF.Row): Generator<M.Elaboration<any>, [NF.Row, NF.Value], any> {
							return yield* M.pure(
								match(row)
									.with({ type: "empty" }, _ => {
										throw new Error(`Label not found: ${l}`);
									})
									.with(
										{ type: "extension" },
										({ label: l_ }) => l === l_,
										({ label, value, row }) => M.of<[NF.Row, NF.Value]>([NF.Constructors.Extension(label, value, row), value]),
									)
									.with({ type: "extension" }, r =>
										M.Do(function* () {
											const [rr, vv]: [NF.Row, NF.Value] = yield* from(l, r.row);
											return [NF.Constructors.Extension(r.label, r.value, rr), vv] satisfies [NF.Row, NF.Value];
										}),
									)
									.with({ type: "variable" }, r =>
										M.Do(function* () {
											const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
											const val = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind)));
											return [NF.Constructors.Extension(l, val, r), val] satisfies [NF.Row, NF.Value];
										}),
									)
									.exhaustive(),
							);
						};

						const [r, v]: [NF.Row, NF.Value] = yield* from(label, arg.row);
						const inferred = NF.Constructors.App(func, NF.Constructors.Row(r), "Explicit");
						yield* M.tell("constraint", { type: "assign", left: inferred, right: ty, lvl: ctx.env.length });
						return v;
					}),
				)
				.with(NF.Patterns.Sigma, ({ binder, closure }) =>
					M.Do(function* () {
						// Sigma types have the form: Σ(r: Row). Body(r)
						// The binder annotation is a Row type
						// We look up the label in the binder's row annotation

						if (binder.annotation.type !== "Row") {
							throw new Error("Sigma binder annotation must be a Row");
						}

						// Look up the label in the binder's row annotation
						const from = (l: string, row: NF.Row): M.Elaboration<NF.Value> =>
							match(row)
								.with({ type: "empty" }, _ => M.Do(() => M.fail<NF.Value>({ type: "MissingLabel", label: l, row })))
								.with(
									{ type: "extension" },
									({ label: l_ }) => l === l_,
									({ value }) => M.of<NF.Value>(value),
								)
								.with({ type: "extension" }, r => from(l, r.row))
								.with({ type: "variable" }, r =>
									M.Do(function* () {
										const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
										const val = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind)));
										const newRow = NF.Constructors.Extension(l, val, r);
										yield* M.tell("constraint", {
											type: "assign",
											left: NF.Constructors.Row(newRow),
											right: NF.Constructors.Row(row),
											lvl: ctx.env.length,
										});
										return val;
									}),
								)
								.exhaustive();

						return yield* M.pure(from(label, binder.annotation.row));
					}),
				)
				.otherwise(_ => {
					throw new Error("Expected Row Type");
				}),
		);

		return nf;
	});
