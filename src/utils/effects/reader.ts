import * as Eff from "@yap/utils/effects/freer";

type ReaderHandlers<R> = Eff.Handlers & {
	ask: () => Eff.Resume<R>;
	asks: <A>(f: (environment: R) => A) => Eff.Resume<A>;
	local: <A>(this: Eff.Effect<string, Eff.Handlers, unknown>, modify: (environment: R) => R, action: () => Eff.Eff<Eff.Operation, A>) => Eff.Scoped<A>;
};

export type ReaderEffect<R> = Eff.Effect<"Reader", ReaderHandlers<R>, undefined>;

export const Reader = <R>(environment: R): ReaderEffect<R> =>
	Eff.defineEffect<"Reader", ReaderHandlers<R>>("Reader", {
		ask: () => Eff.resume(environment),
		asks: <A>(f: (env: R) => A) => Eff.resume(f(environment)),
		local: function <A>(this: Eff.Effect<string, Eff.Handlers, unknown>, modify: (env: R) => R, action: () => Eff.Eff<Eff.Operation, A>) {
			return Eff.scoped(action, effects => effects.map(effect => (effect === this ? Eff.override(this, Reader(modify(environment))) : effect)));
		},
	});
