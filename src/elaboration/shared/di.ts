type DI<D, A> = (env: D) => A;

export const ask = function* <D>(): Generator<DI<D, D>, D, D> {
	const r: D = yield env => env;
	return r;
};

export const asks = function* <D, A>(fn: (r: D) => A): Generator<DI<D, A>, A, A> {
	const a: A = yield fn;
	return a;
};

export const lift = function* <D, A>(a: A): Generator<DI<D, A>, A, A> {
	const r: A = yield (_: D) => a;
	return r;
};

// Magic: G captures the generator return type, and we infer env as MergeEnvs<G>
export function Do<G extends Generator<any, any, any>, T = G extends Generator<any, infer R, any> ? R : never>(gen: () => G): (env: MergeEnvs<G>) => T {
	return env => {
		const it = gen();
		let state = it.next();
		while (!state.done) {
			const res = state.value(env);
			state = it.next(res);
		}
		return state.value;
	};
}

// Extract all D types from the yield positions of a Generator
type YieldEnv<T> = T extends Generator<DI<infer D, any>, any, any> ? D : never;
type MergeEnvs<G> = G extends Generator<any, any, any> ? YieldEnv<G> : never;

// // Still not as good as I'd like
// export function* askBy<
//     K extends string,
//     D,
//     T extends Record<K, D> = { [P in K]: D }
// >(k: K): Generator<DI<T, D>, D, D> {
//     const r: D = yield (env) => env[k];
//     return r;
// }
