import * as Eff from "@yap/utils/effects/freer";

export const Except = <E>() =>
	Eff.defineEffect("Except", {
		raise: (error: E) => Eff.abort(error),
	});
