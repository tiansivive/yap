import * as Eff from "@yap/utils/effects/freer";
import { Monoid } from "fp-ts/lib/Monoid";

export const Writer = <W>(monoid: Monoid<W>) => {
	// eslint-disable-next-line no-restricted-syntax
	let w: W = monoid.empty;

	return Eff.defineEffect(
		"Writer",
		{
			tell: (value: W) => {
				w = monoid.concat(w, value);
				return Eff.resume(void 0);
			},

			listen: () => {
				return Eff.resume(w);
			},
		},
		() => w,
	);
};
