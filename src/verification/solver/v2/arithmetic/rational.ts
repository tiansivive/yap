// Exact rational arithmetic for v2 simplex computations.
// LIA = Linear Integer Arithmetic; LRA = Linear Real Arithmetic.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md

import { match } from "ts-pattern";

export type Rational = {
	readonly num: bigint;
	readonly den: bigint;
};

const DECIMAL_BASE = 10n;

const abs = (n: bigint): bigint => (n < 0n ? -n : n);

const gcd = (a: bigint, b: bigint): bigint => {
	const aa = abs(a);
	const bb = abs(b);
	return bb === 0n ? aa : gcd(bb, aa % bb);
};

export const Rational = {
	of: (num: bigint, den: bigint = 1n): Rational =>
		match(den)
			.with(0n, () => {
				throw new Error("Division by zero in Rational");
			})
			.otherwise(d => {
				const sign = d < 0n ? -1n : 1n;
				const g = gcd(abs(num), abs(d));
				return { num: (sign * num) / g, den: (sign * d) / g };
			}),

	from: (n: number): Rational => {
		const s = n.toString();
		const dot = s.indexOf(".");
		return match(dot)
			.with(-1, () => Rational.of(BigInt(n)))
			.otherwise(index => {
				const decimals = s.length - index - 1;
				const den = DECIMAL_BASE ** BigInt(decimals);
				const num = BigInt(s.replace(".", ""));
				return Rational.of(num, den);
			});
	},

	zero: { num: 0n, den: 1n } satisfies Rational,
	one: { num: 1n, den: 1n } satisfies Rational,
	minusOne: { num: -1n, den: 1n } satisfies Rational,

	add: (a: Rational, b: Rational): Rational => Rational.of(a.num * b.den + b.num * a.den, a.den * b.den),
	sub: (a: Rational, b: Rational): Rational => Rational.of(a.num * b.den - b.num * a.den, a.den * b.den),
	mul: (a: Rational, b: Rational): Rational => Rational.of(a.num * b.num, a.den * b.den),
	div: (a: Rational, b: Rational): Rational => Rational.of(a.num * b.den, a.den * b.num),
	neg: (a: Rational): Rational => ({ num: -a.num, den: a.den }),

	lt: (a: Rational, b: Rational): boolean => a.num * b.den < b.num * a.den,
	leq: (a: Rational, b: Rational): boolean => a.num * b.den <= b.num * a.den,
	eq: (a: Rational, b: Rational): boolean => a.num === b.num && a.den === b.den,
	gt: (a: Rational, b: Rational): boolean => Rational.lt(b, a),
	geq: (a: Rational, b: Rational): boolean => Rational.leq(b, a),

	isZero: (a: Rational): boolean => a.num === 0n,
	isPositive: (a: Rational): boolean => a.num > 0n,
	isNegative: (a: Rational): boolean => a.num < 0n,
	isInteger: (a: Rational): boolean => a.den === 1n,

	floor: (a: Rational): Rational => {
		const q = a.num / a.den;
		return a.num < 0n && a.num % a.den !== 0n ? Rational.of(q - 1n) : Rational.of(q);
	},

	ceil: (a: Rational): Rational => {
		const q = a.num / a.den;
		return a.num > 0n && a.num % a.den !== 0n ? Rational.of(q + 1n) : Rational.of(q);
	},

	toString: (a: Rational): string => (a.den === 1n ? `${a.num}` : `${a.num}/${a.den}`),
};
