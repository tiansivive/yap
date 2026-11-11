import * as NF from "@yap/elaboration/normalization";
import type * as M from "@yap/elaboration/shared/effects";
import type * as Metas from "@yap/elaboration/shared/metas";
import type * as Eff from "@yap/utils/effects";

export function* arrow(from: NF.Value, to: NF.Value): Eff.Eff<Eff.Actions<typeof M.reader> | Eff.Only<typeof Metas.registry, "Registry.get">, NF.Value> {
	return NF.Constructors.Pi("x", "Explicit", from, yield* NF.closeVal(to));
}
