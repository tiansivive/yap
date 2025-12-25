import * as EB from "@yap/elaboration";
import * as Src from "@yap/src/index";

import * as E from "fp-ts/Either";
import * as F from "fp-ts/function";
import * as A from "fp-ts/Array";

import { Either } from "fp-ts/lib/Either";
import { Cause } from "./errors";
import * as Errors from "./errors";

import * as P from "./provenance";

import * as Modal from "@yap/verification/modalities/shared";
import * as Sub from "@yap/elaboration/unification/substitution";

export type Elaboration<A> = (ctx: EB.Context, w?: Omit<Collector<A>, "result">, st?: MutState) => [Collector<A>, MutState];

type Collector<A> = {
	constraints: P.WithProvenance<EB.Constraint>[];
	binders: EB.Binder[];
	metas: EB.Context["metas"];
	zonker: EB.Zonker;
	types: Record<EB.Term["id"], { nf: EB.NF.Value; modalities: Modal.Annotations<EB.Term> }>;
	result: Either<Err, A>;
};

type Accumulator = Omit<Collector<unknown>, "result">;
const concat: (fa: Accumulator, fb: Accumulator) => Accumulator = (fa, fb) => ({
	constraints: fa.constraints.concat(fb.constraints),
	binders: fa.binders.concat(fb.binders),
	metas: { ...fa.metas, ...fb.metas },
	types: { ...fa.types, ...fb.types },
	zonker: Sub.compose(fb.zonker, fa.zonker),
});
const empty: Accumulator = { constraints: [], binders: [], metas: {}, types: {}, zonker: Sub.empty };

export type MutState = {
	delimitations: Array<Delimitation>;
	skolems: Record<number, EB.Term>;
	nondeterminism: {
		solution: Record<number, EB.NF.Value[]>;
	};
};

export type Delimitation = {
	answer: { initial: EB.NF.Value; final: EB.NF.Value };
	//handlerQ: Array<{ meta: EB.Meta, handler: Src.Term, ann: EB.NF.Value }>;
	//solution: Record<number, { values: EB.NF.Value[], term: EB.Term }>;

	/** `
	 * Needed to know if any shift has occurred within the reset.
	 * If `false`, we can enforce that the initial and final answer types are the same.
	 * Dumb but effective.
	 **/
	shifted: boolean;
};

export const initialState: MutState = { delimitations: [], skolems: {}, nondeterminism: { solution: {} } };

export type Err = Cause & { provenance?: P.Provenance[]; ctx: EB.Context };

export const display = (err: Err): string => {
	const cause = Errors.display(err, err.ctx.zonker, err.ctx.metas);
	const prov = err.provenance ? P.display(err.provenance, { cap: 100 }, err.ctx.zonker, err.ctx.metas) : "";
	return prov ? `${cause}\n\nTrace:\n${prov}` : cause;
};

export const track: <A>(provenance: P.Provenance | P.Provenance[], fa: Elaboration<A>) => Elaboration<A> = (provenance, fa) => (ctx, w, st) => {
	const extended = { ...ctx, trace: ctx.trace.concat(provenance) };
	return fa(extended, w, st);
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
	...empty,
	result: E.right(a),
});

export const of =
	<A>(a: A): Elaboration<A> =>
	(ctx, w, st = initialState) => [mkCollector(a), st];

/******************
 *
 * DO NOTATION
 *
 ******************/
export type Unwrap<T> = T extends Elaboration<infer A> ? A : never;

export const ask = function* (): Generator<Elaboration<EB.Context>, EB.Context, EB.Context> {
	return yield (ctx, w, st = initialState) => [mkCollector(ctx), st];
};

export const asks = function* <A>(fn: (r: EB.Context) => A): Generator<Elaboration<A>, A, A> {
	return yield (ctx, w, st = initialState) => [mkCollector(fn(ctx)), st];
};

export function local<A>(modify: (ctx: EB.Context) => EB.Context, ma: Elaboration<A>): Generator<Elaboration<A>, A, A>;
export function local(modify: (ctx: EB.Context) => EB.Context): <A>(ma: Elaboration<A>) => Generator<Elaboration<A>, A, A>;
export function local<A>(...args: any[]): any {
	if (args.length === 1) {
		const [modify] = args as [(ctx: EB.Context) => EB.Context];
		return <B>(ma: Elaboration<B>) =>
			(function* (): Generator<Elaboration<B>, B, B> {
				const b: B = yield (ctx: EB.Context, w, st = initialState) => ma(modify(ctx), w, st);
				return b;
			})();
	}
	const [modify, ma] = args as [(ctx: EB.Context) => EB.Context, Elaboration<A>];
	return (function* (): Generator<Elaboration<A>, A, A> {
		const a: A = yield (ctx: EB.Context, w, st = initialState) => ma(modify(ctx), w, st);
		return a;
	})();
}

type Channel = "constraint" | "binder" | "meta" | "type" | "zonker";
type Payload<K extends Channel> = K extends "constraint"
	? OptionalLvl<EB.Constraint>
	: K extends "binder"
		? EB.Binder
		: K extends "meta"
			? { meta: EB.Meta; ann: EB.NF.Value }
			: K extends "type"
				? { term: EB.Term; nf: EB.NF.Value; modalities: Modal.Annotations<EB.Term> }
				: K extends "zonker"
					? EB.Zonker
					: never;

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
			return { constraints: addProvenance(cs), binders: [], metas: {}, types: {}, zonker: empty.zonker };
		}
		if (channel === "binder") {
			return { constraints: [], binders: many as Payload<"binder">[], metas: {}, types: {}, zonker: empty.zonker };
		}

		if (channel === "meta") {
			return {
				constraints: [],
				binders: [],
				metas: (many as Payload<"meta">[]).reduce((m, { meta, ann }) => ({ ...m, [meta.val]: { meta, ann } }), {}),
				types: {},
				zonker: empty.zonker,
			};
		}

		if (channel === "type") {
			return {
				constraints: [],
				binders: [],
				metas: {},
				zonker: empty.zonker,
				types: (many as Payload<"type">[]).reduce((m, { term, nf, modalities }) => ({ ...m, [term.id]: { nf, modalities } }), {}),
			};
		}

		if (channel === "zonker") {
			return {
				constraints: [],
				binders: [],
				metas: {},
				types: {},
				zonker: (many as Payload<"zonker">[]).reduce((z, zk) => Sub.compose(zk, z), ctx.zonker),
			};
		}
		console.warn("Tell: unknown channel:", channel);
		console.warn("Continuing without telling anything");
		return empty;
	})();

	return yield* pure((ctx, w, st = initialState) => [{ ...writer, result: E.right(undefined) }, st]);
};

export const listen = function* (): Generator<Elaboration<Accumulator>, Accumulator, Accumulator> {
	return yield (_, w = empty, st = initialState) => [mkCollector(w), st];
};

export const fail = function* <A>(cause: Cause): Generator<Elaboration<any>, A, any> {
	const ctx = yield* ask();
	return yield* liftE(E.left({ ...cause, provenance: ctx.trace, ctx }));
};
// export const catchErr = function* <A>(handler: (err: Err) => Elaboration<A>): Generator<Elaboration<A>, A, A> {
// 	return yield* (ctx: EB.Context) => {
// 		const result = handler(ctx);
// 		return mkCollector(result);
// 	};
// };
/***********************
 *
 *  Mutable state operations
 *
 ***********************/

export const getSt = function* (): Generator<Elaboration<MutState>, MutState, MutState> {
	return yield (ctx, w, st = initialState) => [mkCollector(st), st];
};

export const putSt = function* (newSt: MutState): Generator<Elaboration<void>, void, void> {
	return yield (ctx, w, st = initialState) => [mkCollector(undefined), newSt];
};

export const modifySt = function* (f: (st: MutState) => MutState): Generator<Elaboration<void>, void, void> {
	return yield (ctx, w, st = initialState) => [mkCollector(undefined), f(st)];
};

export const localSt = function* <A>(modify: (st: MutState) => MutState, ma: Elaboration<A>): Generator<Elaboration<A>, A, A> {
	return yield (ctx, w, st = initialState) => {
		const [result] = ma(ctx, w, modify(st));
		return [result, st];
	};
};

/***********************
 * 
 * Lifting
 * 
 /***********************/

export const lift = function* <A>(a: A): Generator<Elaboration<A>, A, A> {
	return yield (_ctx, _w, st = initialState) => [mkCollector(a), st];
};

export const liftC = function* <A>(c: Collector<A>): Generator<Elaboration<A>, A, A> {
	return yield (_ctx, _w, st = initialState) => [c, st];
};

export const liftE = <A>(e: E.Either<Err, A>): Generator<Elaboration<A>, A, A> => {
	return liftC({ ...empty, result: e });
};

export const pure = function* <A>(ma: Elaboration<A>): Generator<Elaboration<A>, A, A> {
	return yield ma;
};

export const regen = <A, B>(f: (a: A) => Elaboration<B>) => {
	const gen = F.flow(f, pure);
	return Object.assign(f, { gen });
};

export function Do<R, A>(gen: () => Generator<Elaboration<any>, R, A>): Elaboration<R> {
	return (ctx, _, initialSt = initialState) => {
		const it = gen();

		let collected: Omit<Collector<unknown>, "result"> = empty;
		let mutableState: MutState = initialSt;
		let state = it.next();

		while (!state.done) {
			const [ma, st] = state.value(ctx, collected, mutableState); // pipe context for each step of the generator
			collected = concat(collected, ma); // accumulate results a la Writer
			mutableState = st;

			// Error handling semantics : short-circuit on first error
			if (E.isLeft(ma.result)) {
				return [ma, mutableState];
			}
			state = it.next(ma.result.right); // proceed with the sequence until the next yield
		}
		const result = mkCollector(state.value);
		result.binders = collected.binders;
		result.constraints = collected.constraints;
		result.metas = collected.metas;
		result.types = collected.types;
		result.zonker = collected.zonker;
		return [result, mutableState];
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
