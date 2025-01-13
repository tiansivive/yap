import { match } from "ts-pattern";
import {
	Abs,
	Alt,
	Ann,
	App,
	Bound,
	Free,
	Lit,
	Match,
	Neutral,
	Predicate,
	Refined,
	Refinement,
	Term,
	Var,
	Variable,
} from "../terms.js";

import * as F from "fp-ts/function";
import * as Rec from "fp-ts/Record";

export const betaReduce: any = () => {
	throw "Beta Reduce: Not implemented";
};

type Subst = Record<number, Term>;

export const subst: (sub: Subst, term: Term) => Term = (sub, term) => {
	const subst_ = (cutoff: number, v: Variable): Term =>
		match(v)
			.with({ tag: "Bound" }, ({ deBruijn }) => {
				const found = sub[deBruijn - cutoff];

				return found ? shift(deBruijn, found) : Var(v);
			})
			.run();

	return tmap(subst_, 0, term);
};

export const shift: (d: number, t: Term) => Term = (d, t) => {
	const shift_ = (c: number, v: Variable): Term =>
		match(v)
			.with({ tag: "Bound" }, ({ deBruijn }) =>
				deBruijn < c ? Var(Bound(deBruijn)) : Var(Bound(deBruijn + d)),
			)
			.with({ tag: "Free" }, Var)
			.run();

	return tmap(shift_, 0, t);
};

export const tmap: (
	onvar: (c: number, v: Variable) => Term,
	cutoff: number,
	term: Term,
) => Term = (onvar, cutoff, term) => {
	const walk = (c: number, t: Term): Term =>
		match(t)
			.with({ tag: "Lit" }, () => t)
			.with({ tag: "Var" }, ({ variable }) => onvar(c, variable))
			.with({ tag: "Abs" }, ({ binder, body }) =>
				Abs(binder, walk(c + 1, body)),
			)
			.with({ tag: "App" }, ({ func, arg }) => App(walk(c, func), walk(c, arg)))

			.with({ tag: "Match" }, ({ term, alternatives }) =>
				Match(
					walk(c, term),
					alternatives.map((alt) => Alt(alt.pattern, walk(c, alt.term))),
				),
			)
			.with({ tag: "Ann" }, ({ term, ann }) => Ann(walk(c, term), walk(c, ann)))
			.with({ tag: "Refined" }, ({ term, ref }) =>
				Refined(walk(c, term), rmap(onvar, c, ref)),
			)

			.with({ tag: "Neutral" }, ({ term }) => Neutral(walk(c, term)))
			.run();

	return walk(cutoff, term);
};

export const rmap: (
	onvar: (c: number, v: Variable) => Term,
	c: number,
	ref: Refinement,
) => Refinement = (onvar, c, ref) =>
	match(ref)
		.with({ tag: "Hole" }, F.identity)
		.with({ tag: "Template" }, F.identity)
		.with({ tag: "Predicate" }, ({ variable, predicate }) =>
			Predicate(variable, tmap(onvar, c, predicate)),
		)
		.run();

export const compose: (s1: Subst, s2: Subst) => Subst = (s1, s2) => {
	const mapped = F.pipe(
		s2,
		Rec.map((t) => subst(s1, t)),
	);
	return { ...s1, ...mapped };
};
