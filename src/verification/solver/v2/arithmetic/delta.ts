// δ-rationals: values c + kδ for a positive infinitesimal δ, ordered lexicographically. A strict bound `x > c` becomes
// the non-strict bound `x >= c + δ`, so the simplex compares values and bounds without tracking strictness.
// Dutertre and de Moura, "A Fast Linear-Arithmetic Solver for DPLL(T)", CAV 2006.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md

import { Rational } from "./rational";

export type Delta = {
	readonly real: Rational;
	readonly delta: Rational;
};

export const Delta = {
	zero: { real: Rational.zero, delta: Rational.zero } satisfies Delta,

	of: (real: Rational, delta: Rational): Delta => ({ real, delta }),

	add: (a: Delta, b: Delta): Delta => ({ real: Rational.add(a.real, b.real), delta: Rational.add(a.delta, b.delta) }),

	sub: (a: Delta, b: Delta): Delta => ({ real: Rational.sub(a.real, b.real), delta: Rational.sub(a.delta, b.delta) }),

	scale: (a: Delta, k: Rational): Delta => ({ real: Rational.mul(a.real, k), delta: Rational.mul(a.delta, k) }),

	lt: (a: Delta, b: Delta): boolean => Rational.lt(a.real, b.real) || (Rational.eq(a.real, b.real) && Rational.lt(a.delta, b.delta)),

	gt: (a: Delta, b: Delta): boolean => Delta.lt(b, a),

	leq: (a: Delta, b: Delta): boolean => !Delta.lt(b, a),

	geq: (a: Delta, b: Delta): boolean => !Delta.lt(a, b),
};
