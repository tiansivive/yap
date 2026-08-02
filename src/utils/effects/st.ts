import * as Eff from "@yap/utils/effects/freer";

export const ST = <S>(initial: S) => {
	// ST owns this cell; its mutations are observable only through its operations.
	// eslint-disable-next-line no-restricted-syntax
	let state = initial;

	return Eff.defineEffect(
		"ST",
		{
			get: () => Eff.resume(state),
			put: (value: S) => {
				state = value;
				return Eff.resume(undefined);
			},
			modify: (update: (value: S) => S) => {
				state = update(state);
				return Eff.resume(undefined);
			},
		},
		() => state,
	);
};
