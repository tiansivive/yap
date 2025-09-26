import * as EB from "@yap/elaboration"
import * as Lib from "@yap/shared/lib/primitives"
import * as Sub from "@yap/elaboration/unification/substitution";

export const defaultContext: EB.Context = {
    env: [],
    types: [],
    names: [],
    implicits: [],
    sigma: {},
    trace: [],
    imports: { ...Lib.Elaborated },
    zonker: Sub.empty,
    ffi: {},
};