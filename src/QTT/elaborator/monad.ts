import { Monoid } from "fp-ts/lib/Monoid";
import { Reader } from "fp-ts/lib/Reader";
import * as R from "fp-ts/lib/Reader";

import { Writer } from "fp-ts/lib/Writer";
import * as W from "fp-ts/lib/Writer";

export type RW<R, W, T> = Reader<R, Writer<W, T>>;

const URI = "Elaboration";
type URI = typeof URI;

declare module "fp-ts/HKT" {
	interface URItoKind3<R, E, A> {
		readonly [URI]: RW<R, E, A>;
	}
}

export function fmap<R, W, A, B>(fa: RW<R, W, A>, f: (x: A) => B): RW<R, W, B>;
export function fmap<R, W, A, B>(
	f: (x: A) => B,
): (fa: RW<R, W, A>) => RW<R, W, B>;
export function fmap<R, W, A, B>(
	...args: [(x: A) => B] | [RW<R, W, A>, (x: A) => B]
): any {
	if (args.length === 1) {
		const [f] = args;
		return R.map<Writer<W, A>, Writer<W, B>>(W.map(f));
	}

	const [fa, f] = args;
	return R.Functor.map(fa, W.map(f));
}

export function getChain<W>(M: Monoid<W>) {
	function chain<R, A, B>(
		fa: RW<R, W, A>,
		f: (x: A) => RW<R, W, B>,
	): RW<R, W, B>;
	function chain<R, A, B>(
		f: (x: A) => RW<R, W, B>,
	): (fa: RW<R, W, A>) => RW<R, W, B>;
	function chain<R, A, B>(
		...args: [(x: A) => RW<R, W, B>] | [RW<R, W, A>, (x: A) => RW<R, W, B>]
	) {
		if (args.length === 1) {
			const [f] = args;
			return (rw: RW<R, W, A>) =>
				(r: R): Writer<W, B> => {
					const [a, w1] = rw(r)();
					const [b, w2] = f(a)(r)();

					return W.Functor.map(W.tell(M.concat(w1, w2)), (_) => b);
					// return W. [b, M.concat(w1, w2)]
				};
		}

		const [rw, f] = args;
		return (r: R): Writer<W, B> => {
			const [a, w1] = rw(r)();
			const [b, w2] = f(a)(r)();
			return W.Functor.map(W.tell(M.concat(w1, w2)), (_) => b);
			// return [b, M.concat(w1, w2)]
		};
	}

	return chain;
}

export const of =
	<R, W, A>(M: Monoid<W>) =>
	(a: A): RW<R, W, A> => {
		const w = W.getPointed(M).of(a);
		return R.of(w);
	};

export const liftW = <R, W, A>(w: Writer<W, A>): RW<R, W, A> => R.of(w);
export const liftR =
	<R, W, A>(M: Monoid<W>) =>
	(fa: Reader<R, A>): RW<R, W, A> =>
	(r: R) =>
		W.getPointed(M).of(fa(r));
// R.Functor.map(r, a => W.getPointed(M).of(a))

export const Do = <R, W>(M: Monoid<W>) => {
	return of<R, W, {}>(M)({});
};

export const bind =
	<R, W>(M: Monoid<W>) =>
	<N extends string, A, B>(
		name: Exclude<N, keyof A>,
		f: (a: A) => RW<R, W, B>,
	) =>
	(
		ma: RW<R, W, A>,
	): RW<
		R,
		W,
		{ readonly [K in keyof A | N]: K extends keyof A ? A[K] : B }
	> => {
		return getChain(M)(ma, (a) => {
			return fmap(f(a), (b) => Object.assign({}, a, { [name]: b }) as any);
		});
	};
