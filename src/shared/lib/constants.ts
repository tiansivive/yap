import * as EB from "@yap/elaboration"
import * as Lib from "@yap/shared/lib/primitives"

export const defaultContext: EB.Context = {
    env: [],
    implicits: [],
    labels: {},
    sigma: {},
    record: {},
    trace: [],
    imports: { ...Lib.Elaborated() },
    ffi: Lib.PrimOps,
};