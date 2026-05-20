// Exact rational arithmetic for simplex computations.
// https://github.com/tiansivive/z-yap/blob/main/zettels/arithmetic-theory.md

const gcd = (a: bigint, b: bigint): bigint => {
	const absA = a < 0n ? -a : a;
	const absB = b < 0n ? -b : b;
	return absB === 0n ? absA : gcd(absB, absA % absB);
};

export type Rational = { readonly num: bigint; readonly den: bigint };

export const Rational = {
	of: (num: bigint, den: bigint = 1n): Rational => {
		if (den === 0n) {
			throw new Error("Division by zero in Rational");
		}
		const sign = den < 0n ? -1n : 1n;
		const g = gcd(num < 0n ? -num : num, den < 0n ? -den : den);
		return { num: (sign * num) / g, den: (sign * den) / g };
	},

	fromNumber: (n: number): Rational => {
		const s = n.toString();
		const dot = s.indexOf(".");

		if (dot === -1) {
			return Rational.of(BigInt(n));
		}
		const decimals = s.length - dot - 1;
		const den = 10n ** BigInt(decimals);
		const num = BigInt(s.replace(".", ""));
		return Rational.of(num, den);
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
