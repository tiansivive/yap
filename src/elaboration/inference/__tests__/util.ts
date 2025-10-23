import Nearley from "nearley";
import Grammar from "@yap/src/grammar";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as Lib from "@yap/shared/lib/primitives";
import { omit } from "lodash/fp";

// Create a fresh parser for expressions (Ann grammar start)
export const mkParser = () => {
	const g = { ...Grammar, ParserStart: "Ann" } as typeof Grammar;
	return new Nearley.Parser(Nearley.Grammar.fromCompiled(g), { keepHistory: true });
};

export const parseExpr = (src: string) => {
	const parser = mkParser();
	const data = parser.feed(src);
	if (data.results.length !== 1) {
		throw new Error(`Ambiguous or failed parse: expected 1 result, got ${data.results.length}`);
	}
	return data.results[0];
};

export const mkCtx = () => Lib.defaultContext();

// Run elaboration/inference for a source string; returns elaborated term, type, usages, constraints and displays.
export const elaborateFrom = (src: string) => {
	EB.resetSupply("meta");
	EB.resetSupply("var");

	const term = parseExpr(src);
	const ctx = mkCtx();

	const result = EB.V2.Do(function* () {
		const [tm, ty] = yield* EB.infer.gen(term);
		const { constraints: csts, metas, types } = yield* EB.V2.listen();
		const constraints = csts.map(c => (c.type === "assign" ? omit("trace", c) : c));
		return { tm, ty, constraints, metas, types } as const;
	});

	const out = result(ctx);
	if (out.result._tag === "Left") {
		throw new Error(EB.V2.display(out.result.left));
	}
	const { tm, ty, constraints, metas, types } = out.result.right;

	const pretty = {
		term: EB.Display.Term(tm, { env: ctx.env, zonker: ctx.zonker, metas: { ...ctx.metas, ...metas } }),
		type: NF.display(ty, { env: ctx.env, zonker: ctx.zonker, metas: { ...ctx.metas, ...metas } }),
		constraints: constraints.map((c: any) => EB.Display.Constraint(c, { env: ctx.env, zonker: ctx.zonker, metas: { ...ctx.metas, ...metas } })),
	};

	// Build a snapshot-friendly object
	return {
		src,
		displays: pretty,
		structure: {
			term: tm,
			type: ty,
			constraints,
			metas,
			typedTerms: types,
		},
	};
};
