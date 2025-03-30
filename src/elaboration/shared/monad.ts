import { Monoid } from "fp-ts/lib/Monoid";
import { Reader } from "fp-ts/lib/Reader";
import * as R from "fp-ts/lib/Reader";
import * as F from "fp-ts/lib/function";

import { Writer } from "fp-ts/lib/Writer";
import * as W from "fp-ts/lib/Writer";
import * as E from "fp-ts/lib/Either";

import * as EB from "@yap/elaboration";
import { Cause } from "./errors";
import { Either } from "fp-ts/lib/Either";

export type Elaboration<T> = Reader<EB.Context, Emitter<T>>;
type Emitter<T> = Writer<Accumulator, Either<Err, T>>;
export type Err = Cause & { provenance?: EB.Provenance[] };

type Accumulator = {
	constraints: (EB.Constraint & { provenance: EB.Provenance[] })[];
	binders: EB.Binder[];
};

const monoid: Monoid<Accumulator> = {
	concat: (x, y) => ({
		constraints: x.constraints.concat(y.constraints),
		binders: x.binders.concat(y.binders),
	}),
	empty: { constraints: [], binders: [] },
};

const URI = "Elaboration";
type URI = typeof URI;

declare module "fp-ts/HKT" {
	interface URItoKind<A> {
		readonly [URI]: Elaboration<A>;
	}
}

/************************************************************************************************************************
 * Functor combinators
 ************************************************************************************************************************/
export function fmap<A, B>(fa: Elaboration<A>, f: (x: A) => B): Elaboration<B>;
export function fmap<A, B>(f: (x: A) => B): (fa: Elaboration<A>) => Elaboration<B>;
export function fmap<A, B>(...args: [(x: A) => B] | [Elaboration<A>, (x: A) => B]): any {
	if (args.length === 1) {
		const [f] = args;
		return R.map<Emitter<A>, Emitter<B>>(W.map(E.map(f)));
	}

	const [fa, f] = args;
	return R.Functor.map(fa, W.map(E.map(f)));
}

/************************************************************************************************************************
 * Monad combinators
 ************************************************************************************************************************/
export function chain<A, B>(fa: Elaboration<A>, f: (x: A) => Elaboration<B>): Elaboration<B>;
export function chain<A, B>(f: (x: A) => Elaboration<B>): (fa: Elaboration<A>) => Elaboration<B>;
export function chain<A, B>(...args: [(x: A) => Elaboration<B>] | [Elaboration<A>, (x: A) => Elaboration<B>]) {
	const _chain = (rw: Elaboration<A>, f: (x: A) => Elaboration<B>): Elaboration<B> => {
		return (r: EB.Context): Emitter<B> => {
			const [a, w1] = rw(r)();
			if (E.isLeft(a)) {
				return W.Functor.map(W.tell(w1), _ => a);
			}

			const [b, w2] = f(a.right)(r)();
			return W.Functor.map(W.tell(monoid.concat(w1, w2)), _ => b);
		};
	};

	if (args.length === 1) {
		const [f] = args;
		return (rw: Elaboration<A>) => _chain(rw, f);
	}

	const [rw, f] = args;
	return _chain(rw, f);
}

export const of = <A>(a: A): Elaboration<A> => F.pipe(a, E.right, W.getPointed(monoid).of, R.of);
export const discard = <A, B>(f: (a: A) => Elaboration<B>) => chain<A, A>(val => fmap(f(val), () => val));

/************************************************************************************************************************
 * Foldable combinators
 ************************************************************************************************************************/
export const fold = <A, B>(f: (acc: B, a: A, i: number) => Elaboration<B>, acc: B, as: A[]): Elaboration<B> =>
	as.reduce((rw, a, i) => chain(rw, acc => f(acc, a, i)), of(acc));

/************************************************************************************************************************
 * Traversable combinators
 ************************************************************************************************************************/
export const traverse = <A, B>(as: A[], f: (a: A) => Elaboration<B>): Elaboration<B[]> => {
	return fold((acc, a) => fmap(f(a), b => acc.concat([b])), [] as B[], as);
};

/************************************************************************************************************************
 * Lifting
 ************************************************************************************************************************/
export const liftE = <A>(e: Either<Cause, A>): Elaboration<A> => R.of(W.getPointed(monoid).of(e));
export const liftW = <A>(w: Emitter<A>): Elaboration<A> => R.of(w);
export const liftR =
	<A>(fa: Reader<EB.Context, A>): Elaboration<A> =>
	(r: EB.Context) =>
		W.getPointed(monoid).of(E.right(fa(r)));

/************************************************************************************************************************
 * Do notation
 ************************************************************************************************************************/
export const Do = of<{}>({});

export const bind =
	<N extends string, A, B>(name: Exclude<N, keyof A>, f: (a: A) => Elaboration<B>) =>
	(ma: Elaboration<A>): Elaboration<{ readonly [K in keyof A | N]: K extends keyof A ? A[K] : B }> => {
		return chain(ma, a => {
			return fmap(f(a), b => Object.assign({}, a, { [name]: b }) as any);
		});
	};

export const bindTo = <N extends string>(name: N): (<A>(ma: Elaboration<A>) => Elaboration<{ [K in N]: A }>) => fmap(a => ({ [name]: a }) as any);

const _let = <N extends string, A, B>(
	name: Exclude<N, keyof A>,
	fa: Elaboration<B>,
): ((ma: Elaboration<A>) => Elaboration<{ readonly [K in keyof A | N]: K extends keyof A ? A[K] : B }>) => bind(name, () => fa);
export { _let as let };

/************************************************************************************************************************
 * Utility combinators
 ************************************************************************************************************************/

/**********************************
 * Context combinators
 **********************************/
export const ask = F.flow(R.ask, liftR<EB.Context>);

type Local = EB.Context | ((ctx: EB.Context) => EB.Context);
export const local: <A>(f: Local, rw: Elaboration<A>) => Elaboration<A> = (f, rw) => {
	return (ctx: EB.Context) => {
		const _ctx = typeof f === "function" ? f(ctx) : f;
		return rw(_ctx);
	};
};

/**********************************
 * Constraint combinators
 **********************************/
type Channel = "constraint" | "binder";
type Payload<K extends Channel> = K extends "constraint" ? EB.Constraint : EB.Binder;
export const tell = <K extends Channel>(channel: K, payload: Payload<K> | Payload<K>[]) =>
	chain(ask(), ({ trace }) => {
		const many = Array.isArray(payload) ? payload : [payload];

		const addProvenance = (cs: EB.Constraint[]) => cs.map(c => ({ ...c, provenance: trace }));
		const acc: Accumulator =
			channel === "constraint" ? { constraints: addProvenance(many as EB.Constraint[]), binders: [] } : { constraints: [], binders: many as EB.Binder[] };

		const w = W.Functor.map(W.tell(acc), E.right);
		return liftW<void>(w);
	});

export const listen =
	<A, B>(f: (aw: [A, Accumulator]) => B) =>
	(rw: Elaboration<A>): Elaboration<B> => {
		const tap = (emitter: Emitter<A>): Emitter<B> => {
			const [either, acc] = emitter();

			return W.Functor.map(W.tell(acc), _ => E.Functor.map(either, a => f([a, acc])));
		};
		return F.pipe(rw, R.map(tap));
	};

/**********************************
 * Provenance combinators
 **********************************/

export const track = <A>(provenance: EB.Provenance, rw: Elaboration<A>) =>
	local(ctx => {
		return { ...ctx, trace: ctx.trace.concat([provenance]) };
	}, rw);
export const trackMany = <A>(provenance: EB.Provenance[], rw: Elaboration<A>) =>
	local(ctx => {
		return { ...ctx, trace: ctx.trace.concat(provenance) };
	}, rw);

/**********************************
 * Exception handling
 **********************************/

export const fail = (cause: Err): Elaboration<never> =>
	chain(ask(), ctx => {
		return liftE(E.left({ ...cause, provenance: ctx.trace.concat(cause.provenance || []) }));
	});

export const catchError =
	<A>(rw: Elaboration<A>, f: (e: Err) => Elaboration<A>): Elaboration<A> =>
	r => {
		const [a, w] = rw(r)();
		if (E.isRight(a)) {
			return W.getPointed(monoid).of(a);
		}

		const [b, w2] = f(a.left)(r)();
		return W.Functor.map(W.tell(monoid.concat(w, w2)), _ => b);
	};

export const onError = <A>(rw: Elaboration<A>, f: (e: Cause) => unknown) => {
	return catchError(rw, e => {
		f(e);
		return fail(e);
	});
};

/**********************************
 * Run the monad
 **********************************/
export const run = <A>(rw: Elaboration<A>, ctx: EB.Context) => rw(ctx)();
