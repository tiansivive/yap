import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Q from "@yap/shared/modalities/multiplicity";

import * as Src from "@yap/src/index";
import * as NF from "@yap/elaboration/normalization";
import * as R from "@yap/shared/rows";
import { match, P } from "ts-pattern";

type Projection = Extract<Src.Term, { type: "projection" }>;

export const infer = ({ label, term }: Projection): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term, metadata: { action: "infer", description: "Projection of label: " + label } }, function* () {
		const [tm, ty, us] = yield* EB.infer(term);
		const inferred = yield* project(label, tm, ty, us);
		return [EB.Constructors.Proj(label, tm), inferred, us] satisfies EB.AST; // TODO: Subtract usages?
	});

export const project = function* (label: string, tm: EB.Term, ty: NF.Value, us: Q.Usages): M.Elaboration<NF.Value> {
	const ctx = yield* M.reader.ask();
	const nf = match(yield* NF.view(ty))
		.with(NF.View.Flex, function* () {
			// const rowTypeCtor = EB.Constructors.Pi("rx", "Explicit", EB.Constructors.Lit(Lit.Row()), EB.Constructors.Lit(Lit.Type()));
			// const ann = NF.evaluate(ctx, rowTypeCtor);
			// const ctor = NF.evaluate(ctx, EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, ann)));

			const ctor = NF.Constructors.Atom("Schema");

			//const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
			const kind = NF.Type;
			const val = yield* NF.normalize(EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind)));

			const r: NF.Row = R.Constructors.Variable(yield* EB.freshMeta(ctx.env.length, NF.Row));
			const xtension = NF.Constructors.Extension(label, val, r);
			const inferred = NF.Constructors.App(ctor, NF.Constructors.Row(xtension), "Explicit");

			yield* M.constrain({ type: "assign", left: inferred, right: ty, lvl: ctx.env.length });

			return val;
		})
		.with(NF.View.Sealed(), ({ value }) => structural(value))
		.otherwise(({ kind }) => {
			throw new Error(`Expected Row Type, got a ${kind} type`);
		});

	return yield* nf;

	function* structural(structure: NF.Value): M.Elaboration<NF.Value> {
		return yield* match(structure)
			.with(NF.Patterns.Schema, function* ({ func, arg }) {
				const from = (l: string, row: NF.Row): M.Elaboration<[NF.Row, NF.Value]> =>
					match([R.lookup(row, l), row.tail] as const)
						.with([P.nonNullable, P._], ([value]) => M.of<[NF.Row, NF.Value]>([row, value]))
						.with([P._, P.nonNullable], function* ([, tail]) {
							const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
							const val = yield* NF.normalize(EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind)));
							return [R.Constructors.Row([...row.entries, { label: l, value: val }], tail), val] satisfies [NF.Row, NF.Value];
						})
						.otherwise(() => M.fail({ type: "MissingLabel", label: l, row }));

				const [r, v]: [NF.Row, NF.Value] = yield* from(label, arg.row);
				const inferred = NF.Constructors.App(func, NF.Constructors.Row(r), "Explicit");
				yield* M.constrain({ type: "assign", left: inferred, right: ty, lvl: ctx.env.length });
				return v;
			})
			.with(NF.Patterns.Sigma, function* ({ binder }) {
				// Sigma types have the form: Σ(r: Row). Body(r)
				// The binder annotation is a Row type
				// We look up the label in the binder's row annotation

				if (binder.annotation.type !== "Row") {
					throw new Error("Sigma binder annotation must be a Row");
				}

				// Look up the label in the binder's row annotation
				const from = (l: string, row: NF.Row): M.Elaboration<NF.Value> =>
					match([R.lookup(row, l), row.tail] as const)
						.with([P.nonNullable, P._], ([value]) => M.of<NF.Value>(value))
						.with([P._, P.nonNullable], function* ([, tail]) {
							const kind = NF.Constructors.Var(yield* EB.freshMeta(ctx.env.length, NF.Type));
							const val = yield* NF.normalize(EB.Constructors.Var(yield* EB.freshMeta(ctx.env.length, kind)));
							const open = R.Constructors.Variable<NF.Value, NF.Variable>(tail);
							yield* M.constrain({
								type: "assign",
								left: NF.Constructors.Row(NF.Constructors.Extension(l, val, open)),
								right: NF.Constructors.Row(open),
								lvl: ctx.env.length,
							});
							return val;
						})
						.otherwise(() => M.fail({ type: "MissingLabel", label: l, row }));

				return yield* from(label, binder.annotation.row);
			})
			.with(NF.Patterns.SigmaV2, function* (sig) {
				const self = yield* NF.normalize(tm);
				return yield* project(label, tm, yield* NF.apply(sig.binder, sig.closure, self), us);
			})
			.otherwise(_ => {
				throw new Error("Expected Row Type");
			});
	}
};
