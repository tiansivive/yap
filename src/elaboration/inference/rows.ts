import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";

import * as NF from "@yap/elaboration/normalization";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Src from "@yap/src/index";

import * as R from "@yap/shared/rows";

import { entries } from "@yap/utils";

type TRow = Extract<Src.Term, { type: "row" }>;

export const infer = (term: TRow): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term, metadata: { action: "infer", description: "Row" } }, function* () {
		return yield* M.reader.local(
			EB.muContext,
			(function* () {
				const { fields, tail } = yield* withLabelContext(term.row, collect(term.row));

				if (tail) {
					throw new Error("Row literals with tails are not supported");
				}

				const tm = fields.reduce<EB.Row>((r, { label, term }) => R.Constructors.Extension(label, term, r), R.Constructors.Empty());
				return [EB.Constructors.Row(tm), NF.Row, Q.noUsage(0)] satisfies EB.AST;
			})(),
		);
	});

// TODO:FIXME update the label env to a stack to properly handle nested row types
export const withLabelContext = function* <A>(row: Src.Row, f: M.Elaboration<A>): M.Elaboration<A> {
	const ctx = yield* M.reader.ask();
	const bindings = yield* extract(row, ctx.env.length);
	return yield* M.reader.local(
		ctx_ =>
			entries(bindings).reduce((ctx, [label, type]) => {
				const withLabel = EB.extendLabel(ctx, label, type);
				const neutral = NF.Constructors.Neutral("Symbolic", NF.Constructors.Var({ type: "Label", name: label }));
				return { ...withLabel, sigma: { ...withLabel.sigma, [label]: { value: neutral } } };
			}, ctx_),
		f,
	);
};

type Collected = { fields: { label: string; term: EB.Term; value: NF.Value }[]; tail?: { variable: EB.Variable; ty: NF.Value } };
export const collect = function* (row: Src.Row): M.Elaboration<Collected> {
	const ctx = yield* M.reader.ask();

	const initial: Collected = { fields: [] };
	const collected: Collected = yield* R.fold<Src.Term, Src.Variable, M.Elaboration<Collected>>(
		row,
		(val, lbl, acc) =>
			(function* () {
				const [vtm, vty, _qs] = yield* EB.infer(val);
				const type = ctx.labels[lbl];
				if (!type) {
					throw new Error("Elaborating Row Extension: Label not found");
				}

				//const nf = NF.evaluate(ctx, vtm);
				yield* M.constrain([{ type: "assign", left: vty, right: type, lvl: ctx.env.length }]);

				const accumulated: Collected = yield* acc;
				return { fields: [...accumulated.fields, { label: lbl, term: vtm, value: vty }], tail: accumulated.tail };
			})(),
		(v, acc) =>
			(function* () {
				const [tm, ty, _qs] = yield* EB.lookup(v, ctx);
				if (tm.type !== "Var") {
					throw new Error("Elaborating Row Var: Not a variable");
				}

				const accumulated: Collected = yield* acc;
				return { fields: accumulated.fields, tail: { variable: tm.variable, ty } };
			})(),
		M.of(initial),
	);

	return collected;
};

export const extract = function* (row: Src.Row, lvl: number): M.Elaboration<Record<string, NF.Value>> {
	const types = yield* M.traverse(row.entries, function* ({ label }) {
		return [label, NF.Constructors.Flex(yield* EB.freshMeta(lvl, NF.Type))] as const;
	});

	return Object.fromEntries(types);
};
