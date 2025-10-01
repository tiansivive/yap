import * as EB from "@yap/elaboration";

import * as E from "fp-ts/Either";
import * as F from "fp-ts/function";
import * as A from "fp-ts/Array";

import { Either } from "fp-ts/lib/Either";
import { Cause } from "./errors";
import * as Errors from "./errors";

import * as P from "./provenance";

export type Elaboration<A> = (ctx: EB.Context, w?: Omit<Collector<A>, "result">) => Collector<A>;

type Collector<A> = {
	constraints: EB.WithProvenance<EB.Constraint>[];
	binders: EB.Binder[];
	metas: EB.Context["metas"];
	result: Either<Err, A>;
};
type Accumulator = Omit<Collector<unknown>, "result">;

export type Err = Cause & { provenance?: P.Provenance[] };

export const display = (err: Err, zonker: EB.Zonker, metas: EB.Context["metas"]): string => {
	const cause = Errors.display(err, zonker, metas);
	const prov = err.provenance ? P.display(err.provenance, { cap: 100 }, zonker, metas) : "";
	return prov ? `${cause}\n\nTrace:\n${prov}` : cause;
};

/************************************************************************************************************************
 * Functor combinators
 ************************************************************************************************************************/
export function fmap<A, B>(fa: Collector<A>, f: (x: A) => B): Collector<B>;
export function fmap<A, B>(f: (x: A) => B): (fa: Collector<A>) => Collector<B>;
export function fmap<A, B>(...args: [(x: A) => B] | [Collector<A>, (x: A) => B]): any {
	if (args.length === 1) {
		const [f] = args;
		return (fa: Collector<A>) => ({ ...fa, result: E.Functor.map(fa.result, f) });
	}

	const [fa, f] = args;
	return { ...fa, result: E.Functor.map(fa.result, f) };
}

const concat: (fa: Omit<Collector<unknown>, "result">, fb: Omit<Collector<unknown>, "result">) => Omit<Collector<unknown>, "result"> = (fa, fb) => ({
	constraints: fa.constraints.concat(fb.constraints),
	binders: fa.binders.concat(fb.binders),
	metas: { ...fa.metas, ...fb.metas },
});

export function chain<A, B>(fa: Collector<A>, f: (x: A) => Collector<B>): Collector<B>;
export function chain<A, B>(f: (x: A) => Collector<B>): (fa: Collector<A>) => Collector<B>;
export function chain<A, B>(...args: [(x: A) => Collector<B>] | [Collector<A>, (x: A) => Collector<B>]): any {
	const _chain = (fa: Collector<A>, f: (x: A) => Collector<B>) => {
		if (E.isLeft(fa.result)) {
			return fa;
		}
		const next = f(fa.result.right);
		const final = concat(fa, next);
		return { ...final, result: next.result };
	};
	if (args.length === 1) {
		const [f] = args;
		return (fa: Collector<A>) => _chain(fa, f);
	}

	const [fa, f] = args;
	return _chain(fa, f);
}

export const track: <A>(provenance: P.Provenance | P.Provenance[], fa: Elaboration<A>) => Elaboration<A> = (provenance, fa) => ctx => {
	const extended = { ...ctx, trace: ctx.trace.concat(provenance) };
	return fa(extended);
};

/************************************************************************************************************************
 * Foldable combinators
 ************************************************************************************************************************/
export const fold = <A, B>(f: (acc: B, a: A, i: number) => Elaboration<B>, initial: B, as: A[]): Elaboration<B> => {
	return as.reduce(
		(e, a, i) =>
			Do<B, B>(function* () {
				const acc = yield e;
				return yield f(acc, a, i);
			}),
		of(initial),
	);
};

/************************************************************************************************************************
 * Traversable combinators
 ************************************************************************************************************************/
export const traverse = <A, B>(as: A[], f: (a: A, i: number) => Elaboration<B>): Elaboration<B[]> => {
	return fold(
		(acc, a, i) =>
			Do<B[], B>(function* () {
				const b = yield f(a, i);
				return A.append(b)(acc);
			}),
		[] as B[],
		as,
	);
};

export const mkCollector = <A>(a: A): Collector<A> => ({
	constraints: [],
	binders: [],
	metas: {},
	result: E.right(a),
});

export const of =
	<A>(a: A): Elaboration<A> =>
	ctx =>
		mkCollector(a);
/******************
 *
 * DO NOTATION
 *
 ******************/
export type Unwrap<T> = T extends Elaboration<infer A> ? A : never;

export const ask = function* (): Generator<Elaboration<EB.Context>, EB.Context, EB.Context> {
	return yield mkCollector;
};

export const asks = function* <A>(fn: (r: EB.Context) => A): Generator<Elaboration<A>, A, A> {
	return yield F.flow(fn, mkCollector);
};

export function local<A>(modify: (ctx: EB.Context) => EB.Context, ma: Elaboration<A>): Generator<Elaboration<A>, A, A>;
export function local(modify: (ctx: EB.Context) => EB.Context): <A>(ma: Elaboration<A>) => Generator<Elaboration<A>, A, A>;
export function local<A>(...args: any[]): any {
	if (args.length === 1) {
		const [modify] = args as [(ctx: EB.Context) => EB.Context];
		return <B>(ma: Elaboration<B>) =>
			(function* (): Generator<Elaboration<B>, B, B> {
				const b: B = yield (ctx: EB.Context) => ma(modify(ctx));
				return b;
			})();
	}
	const [modify, ma] = args as [(ctx: EB.Context) => EB.Context, Elaboration<A>];
	return (function* (): Generator<Elaboration<A>, A, A> {
		const a: A = yield (ctx: EB.Context) => ma(modify(ctx));
		return a;
	})();
}

type Channel = "constraint" | "binder" | "meta";
type Payload<K extends Channel> = K extends "constraint" ? OptionalLvl<EB.Constraint> : K extends "binder" ? EB.Binder : { meta: EB.Meta; ann: EB.NF.Value };

type OptionalLvl<T> = T extends { type: "assign"; lvl: infer L } ? Omit<T, "lvl"> & { lvl?: L } : T;
export const tell = function* <K extends Channel>(channel: K, payload: Payload<K> | Payload<K>[]): Generator<Elaboration<any>, void, any> {
	const ctx = yield* ask();
	const many = Array.isArray(payload) ? payload : [payload];

	const addProvenance = (cs: EB.Constraint[]) => cs.map(c => ({ ...c, trace: ctx.trace }));
	const writer: Omit<Collector<unknown>, "result"> = (() => {
		if (channel === "constraint") {
			const cs = (many as Payload<"constraint">[]).map(c => {
				if (c.type !== "assign") {
					return c;
				}
				return { ...c, lvl: ctx.env.length };
			});
			return { constraints: addProvenance(cs), binders: [], metas: {} };
		}
		if (channel === "binder") {
			return { constraints: [], binders: many as Payload<"binder">[], metas: {} };
		}

		if (channel === "meta") {
			return { constraints: [], binders: [], metas: (many as Payload<"meta">[]).reduce((m, { meta, ann }) => ({ ...m, [meta.val]: { meta, ann } }), {}) };
		}
		console.warn("Tell: unknown channel:", channel);
		console.warn("Continuing without telling anything");
		return { constraints: [], binders: [], metas: {} };
	})();

	return yield* pure(ctx => ({ ...writer, result: E.right(undefined) }));
};

export const listen = function* (): Generator<Elaboration<Accumulator>, Accumulator, Accumulator> {
	return yield (_, w = { constraints: [], binders: [], metas: {} }) => mkCollector(w);
};

export const fail = function* <A>(cause: Err): Generator<Elaboration<any>, A, any> {
	const ctx = yield* ask();
	return yield* liftE(E.left({ ...cause, provenance: ctx.trace.concat(cause.provenance || []) }));
};

// export const catchErr = function* <A>(handler: (err: Err) => Elaboration<A>): Generator<Elaboration<A>, A, A> {
// 	return yield* (ctx: EB.Context) => {
// 		const result = handler(ctx);
// 		return mkCollector(result);
// 	};
// };

export const lift = function* <A>(a: A): Generator<Elaboration<A>, A, A> {
	return yield _ => mkCollector(a);
};

export const liftC = function* <A>(c: Collector<A>): Generator<Elaboration<A>, A, A> {
	return yield _ => c;
};

export const liftE = <A>(e: E.Either<Err, A>): Generator<Elaboration<A>, A, A> => {
	return liftC({
		constraints: [],
		binders: [],
		metas: {},
		result: e,
	});
};

export const pure = function* <A>(ma: Elaboration<A>): Generator<Elaboration<A>, A, A> {
	return yield ma;
};

export const regen = <A, B>(f: (a: A) => Elaboration<B>) => {
	const gen = F.flow(f, pure);
	return Object.assign(f, { gen });
};

export function Do<R, A>(gen: () => Generator<Elaboration<any>, R, A>): Elaboration<R> {
	return ctx => {
		const it = gen();

		let collected: Omit<Collector<unknown>, "result"> = {
			constraints: [],
			binders: [],
			metas: {},
		};
		let state = it.next();

		while (!state.done) {
			const ma = state.value(ctx, collected); // pipe context for each step of the generator
			collected = concat(collected, ma); // accumulate results a la Writer

			// accumulate results a la Writer
			if (E.isLeft(ma.result)) {
				return ma;
			} // Error handling semantics // Error handling semantics
			state = it.next(ma.result.right); // proceed with the sequence until the next yield
		}
		const result = mkCollector(state.value);
		result.binders = collected.binders;
		result.constraints = collected.constraints;
		return result;
	};
}

/**
 *
 *
 * GENERIC Do
 */
// const URI = "Collector";
// type URI = typeof URI;
// declare module "fp-ts/HKT" {
//     interface URItoKind<A> {
//         readonly [URI]: Collector<A>;
//     }
// }
// type UnwrapM<T> = T extends Kind<any, infer A> ? A : never;

// // yield*-friendly helper
// export function liftM<M extends URIS>() {
//     return function* <A>(ma: Kind<M, A>): Generator<Kind<M, A>, A, A> {
//         const a: A = yield ma as any;
//         return a;
//     };
// }

// // Do for any Monad1
// export function DoM<M extends URIS>(M: Monad1<M>) {
//     return function <Y extends Kind<M, any>, R>(
//         gen: () => Generator<Y, R, UnwrapM<Y>>
//     ): Kind<M, R> {

//         const it = gen();
//         let state = it.next();

//         while (!state.done) {
//             let exit = true;
//             M.map(state.value as any, (a: UnwrapM<Y>) => {
//                 state = it.next(a);
//                 exit = false;
//             });
//             if (exit) break;
//         }
//         return state.value
//     };
// }
