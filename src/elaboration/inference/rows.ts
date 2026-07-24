import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";

import * as NF from "@yap/elaboration/normalization";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as Src from "@yap/src/index";

import * as F from "fp-ts/function";
import * as R from "@yap/shared/rows";

import { entries, setProp } from "@yap/utils";

type TRow = Extract<Src.Term, { type: "row" }>;

export const infer = (term: TRow): V2.Elaboration<EB.AST> =>
	V2.track(
		{ tag: "src", type: "term", term, metadata: { action: "infer", description: "Row" } },
		V2.Do(() =>
			V2.local(
				EB.muContext,
				V2.Do(function* () {
					const { fields, tail } = yield* withLabelContext.gen(term.row, collect(term.row));

					if (tail) {
						throw new Error("Row literals with tails are not supported");
					}

					const tm = fields.reduce<EB.Row>((r, { label, term }) => R.Constructors.Extension(label, term, r), R.Constructors.Empty());
					return [EB.Constructors.Row(tm), NF.Row, Q.noUsage(0)] satisfies EB.AST;
				}),
			),
		),
	);
infer.gen = F.flow(infer, V2.pure);

// TODO:FIXME update the label env to a stack to properly handle nested row types
export const withLabelContext = <A>(row: Src.Row, f: V2.Elaboration<A>): V2.Elaboration<A> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();
		const bindings = yield* extract(row, ctx.env.length);
		return yield* V2.local(
			ctx_ =>
				entries(bindings).reduce((ctx, [label, type]) => {
					const withLabel = EB.extendLabel(ctx, label, type);
					const neutral = NF.Constructors.Neutral("Symbolic", NF.Constructors.Var({ type: "Label", name: label }));
					return { ...withLabel, sigma: { ...withLabel.sigma, [label]: { value: neutral } } };
				}, ctx_),
			f,
		);
	});
withLabelContext.gen = <A>(row: Src.Row, f: V2.Elaboration<A>) => V2.pure(withLabelContext(row, f));

type Collected = { fields: { label: string; term: EB.Term; value: NF.Value }[]; tail?: { variable: EB.Variable; ty: NF.Value } };
export const collect = (row: Src.Row): V2.Elaboration<Collected> =>
	V2.Do(function* () {
		const ctx = yield* V2.ask();

		const initial: Collected = { fields: [] };
		const collected: Collected = yield R.fold<Src.Term, Src.Variable, V2.Elaboration<Collected>>(
			row,
			(val, lbl, acc) =>
				V2.Do(function* () {
					const [vtm, vty, _qs] = yield* EB.infer.gen(val);
					const type = ctx.labels[lbl];
					if (!type) {
						throw new Error("Elaborating Row Extension: Label not found");
					}

					//const nf = NF.evaluate(ctx, vtm);
					yield* V2.tell("constraint", [{ type: "assign", left: vty, right: type }]);

					const accumulated: Collected = yield* V2.pure(acc);
					return { fields: [...accumulated.fields, { label: lbl, term: vtm, value: vty }], tail: accumulated.tail };
				}),
			(v, acc) =>
				V2.Do(function* () {
					const [tm, ty, _qs] = yield* EB.lookup.gen(v, ctx);
					if (tm.type !== "Var") {
						throw new Error("Elaborating Row Var: Not a variable");
					}

					const unwrapped = NF.unwrapNeutral(ty);

					const accumulated: Collected = yield* V2.pure(acc);
					return { fields: accumulated.fields, tail: { variable: tm.variable, ty: unwrapped } };
				}),
			V2.of(initial),
		);

		return collected;
	});
collect.gen = F.flow(collect, V2.pure);

export const extract = function* (row: Src.Row, lvl: number): Generator<V2.Elaboration<any>, Record<string, NF.Value>, any> {
	if (row.type === "empty") {
		return {};
	}

	if (row.type === "variable") {
		return {};
	}

	const type = NF.Constructors.Flex(yield* EB.freshMeta(lvl, NF.Type));

	const rest = yield* extract({ ...row.row, location: row.location }, lvl);
	return setProp(rest, row.label, type);
};
