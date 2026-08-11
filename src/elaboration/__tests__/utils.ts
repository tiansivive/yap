import * as Eff from "@yap/utils/effects";

import * as EB from "@yap/elaboration";
import * as Metas from "@yap/elaboration/shared/metas";
import * as Errors from "@yap/elaboration/shared/errors";
import * as NF from "@yap/elaboration/normalization";
import * as Lib from "@yap/shared/lib/primitives";
import * as Sub from "@yap/elaboration/unification/substitution";

import Nearley from "nearley";
import Grammar from "@yap/src/grammar";
import { V2 } from "@yap/elaboration";
import { update } from "@yap/utils";

import * as E from "fp-ts/lib/Either";
import * as F from "fp-ts/lib/function";
import * as A from "fp-ts/lib/Array";
import * as R from "fp-ts/lib/Record";

import { runEB } from "../inference/__tests__/util";

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
	const { answer, collected, state, registry } = runEB(ctx, () => EB.Stmt.infer(stmt));

	if (Eff.failed(answer)) {
		throw new Error(Errors.display(answer[Eff.ABORT], Metas.solutions(registry), {}));
	}

	const [term, type] = answer;
	const constraints = collected.constraints;

	// Bridge to the v2 solver until it converts (M4): the registry view stands in
	// for the old writer channels.
	const { answer: metas } = runEB(ctx, () => Metas.asContext(registry), registry);
	if (Eff.failed(metas)) {
		throw new Error("asContext failed");
	}
	const withMetas = update(ctx, "metas", prev => ({ ...prev, ...metas }));
	const v2ctx = update(withMetas, "zonker", z => ({ ...z, ...Metas.solutions(registry) }));
	const [solved] = EB.solve(constraints)(v2ctx, undefined, V2.initialState);

	if (E.isLeft(solved.result)) {
		throw new Error(V2.display(solved.result.left));
	}

	const { zonker: solution, resolutions } = solved.result.right;

	const pretty = {
		term: EB.Display.Statement(term, { zonker: solution, metas, env: [] }),
		type: NF.display(type, { zonker: solution, metas, env: [] }),
		solution: Sub.display(solution, metas),
		constraints: constraints.map(c => EB.Display.Constraint(c, { zonker: Sub.empty, metas, env: [] })),
		state: {
			nondeterminism: F.pipe(
				state.nondeterminism.solution,
				R.toEntries,
				A.map(([k, vs]): [string, string[]] => [k, vs.map(val => NF.display(val, { zonker: solution, metas, env: [] }))]),
				R.fromEntries,
			),
		},
	};
	return {
		pretty,
		structure: {
			term,
			type,
			metas,
			registry,
			constraints,
			state,
			solution,
			resolutions,
		},
	};
};
