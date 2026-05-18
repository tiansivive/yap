// Theory interface: the shared boundary between the CDCL boolean core and
// theory-specific reasoning modules (EUF, arithmetic, etc.).
// https://github.com/tiansivive/z-yap/blob/main/zettels/cdcl-t-solver.md

import * as E from "fp-ts/Either";
import type { Clause, Literal, Conflict } from "../cdcl/core";

export type TheoryPropagation = {
	readonly literals: readonly Literal[];
	readonly justification: readonly Literal[];
};

export type TheoryCheck = E.Either<Conflict, readonly TheoryPropagation[]>;

export type Theory = {
	readonly name: string;
	readonly assert: (literal: Literal) => TheoryCheck;
	readonly check: () => TheoryCheck;
	readonly push: () => void;
	readonly pop: () => void;
	readonly explain: (literal: Literal) => readonly Literal[];
};
