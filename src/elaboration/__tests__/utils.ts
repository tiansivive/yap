import * as Eff from "@yap/utils/effects";

import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Errors from "@yap/elaboration/shared/errors";
import * as NF from "@yap/elaboration/normalization";
import * as Lib from "@yap/shared/lib/primitives";
import * as Sub from "@yap/elaboration/unification/substitution";

import Nearley from "nearley";
import Grammar from "@yap/src/grammar";

import * as F from "fp-ts/lib/function";
import * as A from "fp-ts/lib/Array";
import * as R from "fp-ts/lib/Record";

import { runEB, shown } from "../inference/__tests__/util";

export const mkParser = () => {
	const g = { ...Grammar, ParserStart: "Letdec" };
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

export const elaborate = (src: string) => {
	EB.resetSupply("meta");
	EB.resetSupply("var");
	EB.resetId();
	NF.resetId();

	const stmt = parseExpr(src);
	if (stmt.type !== "let") {
		throw new Error("Expected a Let statement");
	}

	const ctx = Lib.defaultContext();

	/* One run: inference and solving share the registry; the solver commits its solutions. */
	const { answer, collected, state, registry } = runEB(ctx, function* () {
		const inferred = yield* EB.Stmt.infer(stmt);
		const { constraints } = yield* M.writer.peek();
		const { resolutions } = yield* EB.solve(constraints);

		return [inferred, resolutions] as const;
	});

	const disp = shown(ctx, registry);
	/* Constraints are what unification was asked to prove, so they show the metas as posed. */
	const posed = shown(ctx, Metas.unsolved(registry));

	if (Eff.failed(answer)) {
		throw new Error(disp(() => Errors.report(answer[Eff.ABORT])));
	}

	const [[term, type], resolutions] = answer;
	const constraints = collected.constraints;
	const solution = Metas.solutions(registry);

	const pretty = {
		term: disp(() => EB.Display.Statement(term)),
		type: disp(() => NF.display(type)),
		solution: disp(() => Sub.display(solution)),
		constraints: constraints.map(c => posed(() => EB.Display.Constraint(c))),
		state: {
			nondeterminism: F.pipe(
				state.nondeterminism.solution,
				R.toEntries,
				A.map(([k, vs]): [string, string[]] => [k, vs.map(val => disp(() => NF.display(val)))]),
				R.fromEntries,
			),
		},
	};
	return {
		pretty,
		structure: {
			term,
			type,
			metas: registry,
			registry,
			constraints,
			state,
			solution,
			resolutions,
		},
	};
};
