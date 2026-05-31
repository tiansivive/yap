import * as E from "fp-ts/Either";
import { pipe } from "fp-ts/function";

import type * as EB from "@yap/elaboration";
import type * as NF from "@yap/elaboration/normalization";

import type { Graph } from "../graph";
import { translate } from "../translate";
import type { Location } from "../provenance";
import { descriptor as eta } from "../passes/eta";
import { descriptor as saturate } from "../passes/saturate";
import { descriptor as shiftReset } from "../passes/shift-reset";
import { descriptor as pattern } from "../passes/pattern";
import { descriptor as closure } from "../passes/closure";
import type { Inconsistency, Pipeline } from "./configure";
import { configure } from "./configure";
import type { Violation } from "./verify";
import { verify } from "./verify";

export type { Descriptor, Vocabulary, Delta } from "./descriptor";
export { Initial, none } from "./descriptor";
export type { Inconsistency, Pipeline } from "./configure";
export { configure } from "./configure";
export type { Violation } from "./verify";
export { verify } from "./verify";

export type CompileError =
	| { readonly type: "PipelineConfig"; readonly errors: ReadonlyArray<Inconsistency> }
	| { readonly type: "Verification"; readonly violations: ReadonlyArray<Violation> };

export type CompileOpts = {
	readonly locations?: ReadonlyMap<number, Location>;
	readonly types?: Record<number, { nf: NF.Value }>;
	readonly arities?: Record<string, number>;
	readonly zonker?: import("@yap/elaboration/unification/substitution").Subst;
	readonly parentBinders?: ReadonlyArray<string>;
};

export const defaultPipeline: E.Either<ReadonlyArray<Inconsistency>, Pipeline> = configure(eta, saturate, shiftReset, pattern, closure);

export const compile = (term: EB.Term, opts?: CompileOpts): E.Either<CompileError, Graph> =>
	pipe(
		defaultPipeline,
		E.mapLeft((errors): CompileError => ({ type: "PipelineConfig", errors })),
		E.map(p => {
			const g = translate(term, opts);
			return { graph: p.run(g), vocabulary: p.finalVocabulary };
		}),
		E.chain(({ graph, vocabulary }) =>
			pipe(
				verify(graph, vocabulary),
				E.mapLeft((violations): CompileError => ({ type: "Verification", violations })),
			),
		),
	);
