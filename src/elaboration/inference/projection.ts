import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as Src from "@yap/src/index";
import * as NF from "@yap/elaboration/normalization";
import { match } from "ts-pattern";

type Projection = Extract<Src.Term, { type: "projection" }>;

export const infer = ({ label, term }: Projection): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term, metadata: { action: "infer", description: "Projection of label: " + label } }, function* () {
		const [tm, ty, us] = yield* EB.infer(term);
		const inferred = yield* project(label, tm, ty, us);
		return [EB.Constructors.Proj(label, tm), inferred, us] satisfies EB.AST; // TODO: Subtract usages?
	});

export const project = function* (label: string, tm: EB.Term, ty: NF.Value, us: Q.Usages): M.Elaboration<NF.Value> {
	const ctx = yield* M.reader.ask();
	const nf = match(ty)
		.with({ type: "Neutral" }, ({ value }) => project(label, tm, value, us))
		.with(NF.Patterns.Flex, function* (_) {
			// const rowTypeCtor = EB.Constructors.Pi("rx", "Explicit", EB.Constructors.Lit(Lit.Row()), EB.Constructors.Lit(Lit.Type()));
			// const ann = NF.evaluate(ctx, rowTypeCtor);
			// const ctor = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, ann)));

			const ctor = NF.Constructors.Atom("Schema");

			//const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const kind = NF.Type;
			const val = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind)));

			const r: NF.Row = { type: "variable", variable: yield* EB.freshMeta(ctx.env.length, NF.Row) };
			const xtension = NF.Constructors.Extension(label, val, r);
			const inferred = NF.Constructors.App(ctor, NF.Constructors.Row(xtension), "Explicit");

			yield* M.constrain({ type: "assign", left: inferred, right: ty, lvl: ctx.env.length });

			return val;
		})
		.with(NF.Patterns.Schema, function* ({ func, arg }) {
			const from = (l: string, row: NF.Row): M.Elaboration<[NF.Row, NF.Value]> => {
				return match(row)
					.with({ type: "empty" }, _ => {
						return M.fail({ type: "MissingLabel", label: l, row });
						//throw new Error("Label not found: " + l);
					})
					.with(
						{ type: "extension" },
						({ label: l_ }) => l === l_,
						({ label, value, row }) => M.of<[NF.Row, NF.Value]>([NF.Constructors.Extension(label, value, row), value]),
					)
					.with({ type: "extension" }, function* (r) {
						const [rr, vv]: [NF.Row, NF.Value] = yield* from(l, r.row);
						return [NF.Constructors.Extension(r.label, r.value, rr), vv] satisfies [NF.Row, NF.Value];
					})
					.with({ type: "variable" }, function* (r) {
						const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
						const val = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind)));
						return [NF.Constructors.Extension(l, val, r), val] satisfies [NF.Row, NF.Value];
					})
					.exhaustive();
			};

			const [r, v]: [NF.Row, NF.Value] = yield* from(label, arg.row);
			const inferred = NF.Constructors.App(func, NF.Constructors.Row(r), "Explicit");
			yield* M.constrain({ type: "assign", left: inferred, right: ty, lvl: ctx.env.length });
			return v;
		})
		.with(NF.Patterns.Sigma, function* ({ binder, closure: _cls }) {
			// Sigma types have the form: Σ(r: Row). Body(r)
			// The binder annotation is a Row type
			// We look up the label in the binder's row annotation

			if (binder.annotation.type !== "Row") {
				throw new Error("Sigma binder annotation must be a Row");
			}

			// Look up the label in the binder's row annotation
			const from = (l: string, row: NF.Row): M.Elaboration<NF.Value> =>
				match(row)
					.with({ type: "empty" }, _ => M.fail({ type: "MissingLabel", label: l, row }))
					.with(
						{ type: "extension" },
						({ label: l_ }) => l === l_,
						({ value }) => M.of<NF.Value>(value),
					)
					.with({ type: "extension" }, r => from(l, r.row))
					.with({ type: "variable" }, function* (r) {
						const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
						const val = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind)));
						const newRow = NF.Constructors.Extension(l, val, r);
						yield* M.constrain({
							type: "assign",
							left: NF.Constructors.Row(newRow),
							right: NF.Constructors.Row(row),
							lvl: ctx.env.length,
						});
						return val;
					})
					.exhaustive();

			return yield* from(label, binder.annotation.row);
		})
		.otherwise(_ => {
			throw new Error("Expected Row Type");
		});

	return yield* nf;
};
