import * as EB from "@yap/elaboration"
import * as Lib from "@yap/shared/lib/primitives"

export const defaultContext: EB.Context = {
    env: [],
    types: [],
    names: [],
    implicits: [],
    sigma: {},
    trace: [],
    imports: { ...Lib.Elaborated },
    zonker: {}
};