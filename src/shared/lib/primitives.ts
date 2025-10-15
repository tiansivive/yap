
import * as NF from "@yap/elaboration/normalization"
import * as EB from "@yap/elaboration"

import * as Q from "@yap/shared/modalities/multiplicity"
import * as Lit from "@yap/shared/literals"

import * as Sub from "@yap/elaboration/unification/substitution"
import { Types } from "@yap/utils"

import { isEqual } from "lodash"

export const defaultContext = () => ({
    env: [],
    implicits: [],
    sigma: {},
    trace: [],
    imports: Elaborated(),
    zonker: Sub.empty,
    ffi: PrimOps,
    metas: {},
} satisfies EB.Context);

export const Terms = () => ({
    Type: EB.Constructors.Lit(Lit.Type()),
    Num: EB.Constructors.Lit(Lit.Atom("Num")),
    Bool: EB.Constructors.Lit(Lit.Atom("Bool")),
    String: EB.Constructors.Lit(Lit.Atom("String")),
    Unit: EB.Constructors.Lit(Lit.Atom("Unit")),
    "+": EB.Constructors.Var({ type: "Foreign", name: "$add" }),
    "-": EB.Constructors.Var({ type: "Foreign", name: "$sub" }),
    "*": EB.Constructors.Var({ type: "Foreign", name: "$mul" }),
    "/": EB.Constructors.Var({ type: "Foreign", name: "$div" }),
    "&&": EB.Constructors.Var({ type: "Foreign", name: "$and" }),
    "||": EB.Constructors.Var({ type: "Foreign", name: "$or" }),
    "==": EB.Constructors.Var({ type: "Foreign", name: "$eq" }),
    "!=": EB.Constructors.Var({ type: "Foreign", name: "$neq" }),
    "<": EB.Constructors.Var({ type: "Foreign", name: "$lt" }),
    ">": EB.Constructors.Var({ type: "Foreign", name: "$gt" }),
    "<=": EB.Constructors.Var({ type: "Foreign", name: "$lte" }),
    ">=": EB.Constructors.Var({ type: "Foreign", name: "$gte" }),
    "%": EB.Constructors.Var({ type: "Foreign", name: "$mod" }),

    "<>": EB.Constructors.Lit(Lit.Atom("<>")),
    "++": EB.Constructors.Lit(Lit.Atom("++")),

})

export const NormalForms = {
    Num: () => NF.Constructors.Lit(Lit.Atom("Num")),
    Bool: () => NF.Constructors.Lit(Lit.Atom("Bool")),
    String: () => NF.Constructors.Lit(Lit.Atom("String")),
    Unit: () => NF.Constructors.Lit(Lit.Atom("Unit")),
}



// const BinaryOp = (ty: NF.Value, tm: EB.Term) => NF.Constructors.Pi("x", "Explicit", { nf: ty, modalities: modalities() }, {
//     type: "Closure",
//     ctx: defaultContext(),
//     term: EB.Constructors.Pi("y", "Explicit", modalities(), tm, tm)
// })

export const Elaborated: () => EB.Context['imports'] = () => {



    const PrimTypes: EB.Context['imports'] = {
        Num: [Terms().Num, NF.Type, []],
        Bool: [Terms().Bool, NF.Type, []],
        String: [Terms().String, NF.Type, []],
        Unit: [Terms().Unit, NF.Type, []],
        Type: [Terms().Type, NF.Type, []],
    }

    const dummyContext: EB.Context = {
        env: [],
        implicits: [],
        sigma: {},
        trace: [],
        imports: PrimTypes,
        zonker: Sub.empty,
        ffi: PrimOps,
        metas: {},
    }

    const reflectLiquid = (f: (p: EB.Term, q: EB.Term) => EB.Term) => {
        const i0 = EB.Constructors.Var({ type: "Bound", index: 0 });
        const i1 = EB.Constructors.Var({ type: "Bound", index: 1 });
        const i2 = EB.Constructors.Var({ type: "Bound", index: 2 });
        return EB.Constructors.Lambda("r", "Explicit", EB.DSL.eq(i0, f(i1, i2)), Terms().Num)
    }

    const mkModal = (base: EB.Term, liquid?: EB.Term) => liquid ? EB.Constructors.Modal(base, { quantity: Q.Many, liquid }) : base;

    const Num_Num_Num = ([r1, r2, r3]: [EB.Term?, EB.Term?, EB.Term?]) => NF.Constructors.Pi("x", "Explicit", NormalForms.Num(), {
        type: "Closure",
        ctx: dummyContext,
        term: EB.Constructors.Pi("y", "Explicit", mkModal(Terms().Num, r2), mkModal(Terms().Num, r3))
    })

    const Num_Num_Bool = NF.Constructors.Pi("x", "Explicit", NormalForms.Num(), {
        type: "Closure",
        ctx: dummyContext,
        term: EB.Constructors.Pi("y", "Explicit", Terms().Num, Terms().Bool)
    })

    const Bool_Bool_Bool = NF.Constructors.Pi("x", "Explicit", NormalForms.Bool(), {
        type: "Closure",
        ctx: dummyContext,
        term: EB.Constructors.Pi("y", "Explicit", Terms().Bool, Terms().Bool)
    })

    const Type_Type_Type = NF.Constructors.Pi("x", "Explicit", NF.Type, {
        type: "Closure",
        ctx: dummyContext,
        term: EB.Constructors.Pi("y", "Explicit", Terms().Type, Terms().Type)
    })

    return {
        ...PrimTypes,
        //"->": [Terms()["->"], Type_Type_Type, []],
        "+": [Terms()["+"], Num_Num_Num([, , reflectLiquid(EB.DSL.add)]), []],
        "-": [Terms()["-"], Num_Num_Num([, , reflectLiquid(EB.DSL.sub)]), []],
        "*": [Terms()["*"], Num_Num_Num([, , reflectLiquid(EB.DSL.mul)]), []],
        "/": [Terms()["/"], Num_Num_Num([, , reflectLiquid(EB.DSL.div)]), []],
        "&&": [Terms()["&&"], Bool_Bool_Bool, []],
        "||": [Terms()["||"], Bool_Bool_Bool, []],
        "==": [Terms()["=="], Num_Num_Bool, []],
        "!=": [Terms()["!="], Num_Num_Bool, []],
        "<": [Terms()["<"], Num_Num_Bool, []],
        ">": [Terms()[">"], Num_Num_Bool, []],
        "<=": [Terms()["<="], Num_Num_Bool, []],
        ">=": [Terms()[">="], Num_Num_Bool, []],
        "%": [Terms()["%"], Num_Num_Num([]), []],

    }
}

const typecheckNum = (val: NF.Value): val is Types.Brand<typeof NF.nf_tag, { type: "Lit", value: { type: "Num", value: number } }> => val.type === "Lit" && val.value.type === "Num"
const arithmetic = (x: NF.Value, y: NF.Value, fn: (a: number, b: number) => number): NF.Value => {
    if (!typecheckNum(x)) throw new Error(`Expected number, got ${NF.display(x, { zonker: Sub.empty, metas: {}, env: [] })}`);
    if (!typecheckNum(y)) throw new Error(`Expected number, got ${NF.display(y, { zonker: Sub.empty, metas: {}, env: [] })}`);
    const val = fn(x.value.value, y.value.value);
    return NF.Constructors.Lit(Lit.Num(val));
}

const typecheckBool = (val: NF.Value): val is Types.Brand<typeof NF.nf_tag, { type: "Lit", value: { type: "Bool", value: boolean } }> => val.type === "Lit" && val.value.type === "Bool"

const logical = (x: NF.Value, y: NF.Value, fn: (a: boolean, b: boolean) => boolean): NF.Value => {
    if (!typecheckBool(x)) throw new Error(`Expected boolean, got ${NF.display(x, { zonker: Sub.empty, metas: {}, env: [] })}`);
    if (!typecheckBool(y)) throw new Error(`Expected boolean, got ${NF.display(y, { zonker: Sub.empty, metas: {}, env: [] })}`);
    const val = fn(x.value.value, y.value.value);
    return NF.Constructors.Lit(Lit.Bool(val));
}

const comparison = (x: NF.Value, y: NF.Value, fn: (a: number, b: number) => boolean): NF.Value => {
    if (!typecheckNum(x)) throw new Error(`Expected number, got ${NF.display(x, { zonker: Sub.empty, metas: {}, env: [] })}`);
    if (!typecheckNum(y)) throw new Error(`Expected number, got ${NF.display(y, { zonker: Sub.empty, metas: {}, env: [] })}`);
    const val = fn(x.value.value, y.value.value);
    return NF.Constructors.Lit(Lit.Bool(val));
}

export const FFI = {
    Indexed: (index: unknown) => (value: unknown) => (strat: unknown) => ({ index, value, strat }),
    defaultHashMap: "<Placeholder> default_hash_map",
    defaultArray: "<Placeholder> default_array",
    $add: (x: any) => (y: any) => x + y,
    $sub: (x: any) => (y: any) => x - y,
    $mul: (x: any) => (y: any) => x * y,
    $div: (x: any) => (y: any) => x / y,
    $and: (x: any) => (y: any) => x && y,
    $or: (x: any) => (y: any) => x || y,
    $eq: (x: any) => (y: any) => x == y,
    $neq: (x: any) => (y: any) => x != y,
    $lt: (x: any) => (y: any) => x < y,
    $gt: (x: any) => (y: any) => x > y,
    $lte: (x: any) => (y: any) => x <= y,
    $gte: (x: any) => (y: any) => x >= y,

}

export const PrimOps: EB.Context['ffi'] = {
    $add: { arity: 2, compute: (x: NF.Value, y: NF.Value) => arithmetic(x, y, (a, b) => a + b) },
    $sub: { arity: 2, compute: (x: NF.Value, y: NF.Value) => arithmetic(x, y, (a, b) => a - b) },
    $mul: { arity: 2, compute: (x: NF.Value, y: NF.Value) => arithmetic(x, y, (a, b) => a * b) },
    $div: { arity: 2, compute: (x: NF.Value, y: NF.Value) => arithmetic(x, y, (a, b) => a / b) },
    $and: { arity: 2, compute: (x: NF.Value, y: NF.Value) => logical(x, y, (a, b) => a && b) },
    $or: { arity: 2, compute: (x: NF.Value, y: NF.Value) => logical(x, y, (a, b) => a || b) },
    $eq: { arity: 2, compute: (x: NF.Value, y: NF.Value) => NF.Constructors.Lit(Lit.Bool(isEqual(x, y))) },
    $neq: { arity: 2, compute: (x: NF.Value, y: NF.Value) => NF.Constructors.Lit(Lit.Bool(!isEqual(x, y))) },
    $lt: { arity: 2, compute: (x: NF.Value, y: NF.Value) => comparison(x, y, (a, b) => a < b) },
    $gt: { arity: 2, compute: (x: NF.Value, y: NF.Value) => comparison(x, y, (a, b) => a > b) },
    $lte: { arity: 2, compute: (x: NF.Value, y: NF.Value) => comparison(x, y, (a, b) => a <= b) },
    $gte: { arity: 2, compute: (x: NF.Value, y: NF.Value) => comparison(x, y, (a, b) => a >= b) },
    $not: {
        arity: 1, compute: (x: NF.Value) => {
            if (!typecheckBool(x)) throw new Error(`Expected boolean, got ${NF.display(x, { zonker: Sub.empty, metas: {}, env: [] })}`);
            return NF.Constructors.Lit(Lit.Bool(!x.value.value));
        }
    }

}


export const OP_AND = "$and" as const;
export const OP_OR = "$or" as const;
export const OP_EQ = "$eq" as const;
export const OP_NEQ = "$neq" as const;
export const OP_LT = "$lt" as const;
export const OP_GT = "$gt" as const;
export const OP_LTE = "$lte" as const;
export const OP_GTE = "$gte" as const;
export const OP_NOT = "$not" as const;

export const OP_ADD = "$add" as const;
export const OP_SUB = "$sub" as const;
export const OP_MUL = "$mul" as const;
export const OP_DIV = "$div" as const;


export const operatorMap: Record<string, string> = {
    [OP_AND]: "&&",
    [OP_OR]: "||",
    [OP_EQ]: "==",
    [OP_NEQ]: "!=",
    [OP_LT]: "<",
    [OP_GT]: ">",
    [OP_LTE]: "<=",
    [OP_GTE]: ">=",
    [OP_NOT]: "!",

    [OP_ADD]: "+",
    [OP_SUB]: "-",
    [OP_MUL]: "*",
    [OP_DIV]: "/",

}