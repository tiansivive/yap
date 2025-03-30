
import * as NF from "@yap/elaboration/normalization"
import * as EB from "@yap/elaboration"

import * as Q from "@yap/shared/modalities/multiplicity"
import * as Lit from "@yap/shared/literals"

import { defaultContext } from "@yap/shared/lib/constants"

export const Terms = {
    Type: EB.Constructors.Lit(Lit.Type()),
    Num: EB.Constructors.Lit(Lit.Atom("Num")),
    Bool: EB.Constructors.Lit(Lit.Atom("Bool")),
    String: EB.Constructors.Lit(Lit.Atom("String")),
    Indexed: EB.Constructors.Lit(Lit.Atom("Indexed")),
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

}

export const NormalForms = {
    Num: NF.Constructors.Lit(Lit.Atom("Num")),
    Bool: NF.Constructors.Lit(Lit.Atom("Bool")),
    String: NF.Constructors.Lit(Lit.Atom("String")),
    Unit: NF.Constructors.Lit(Lit.Atom("Unit")),
    Indexed: NF.Constructors.Lit(Lit.Atom("Indexed")),
}


const Num_Num_Num = NF.Constructors.Pi("x", "Explicit", [NormalForms.Num, Q.Many], {
    ctx: defaultContext,
    term: EB.Constructors.Pi("y", "Explicit", Q.Many, Terms.Num, Terms.Num)
})

const Num_Num_Bool = NF.Constructors.Pi("x", "Explicit", [NormalForms.Num, Q.Many], {
    ctx: defaultContext,
    term: EB.Constructors.Pi("y", "Explicit", Q.Many, Terms.Num, Terms.Bool)
})

const Bool_Bool_Bool = NF.Constructors.Pi("x", "Explicit", [NormalForms.Bool, Q.Many], {
    ctx: defaultContext,
    term: EB.Constructors.Pi("y", "Explicit", Q.Many, Terms.Bool, Terms.Bool)
})

const Type_Type_Type = NF.Constructors.Pi("x", "Explicit", [NF.Type, Q.Many], {
    ctx: defaultContext,
    term: EB.Constructors.Pi("y", "Explicit", Q.Many, Terms.Type, Terms.Type)
})

const BinaryOp = (ty: NF.Value, tm: EB.Term) => NF.Constructors.Pi("x", "Explicit", [ty, Q.Many], {
    ctx: defaultContext,
    term: EB.Constructors.Pi("y", "Explicit", Q.Many, tm, tm)
})

export const Elaborated: EB.Context['imports'] = {
    Num: [Terms.Num, NF.Type, []],
    Bool: [Terms.Bool, NF.Type, []],
    String: [Terms.String, NF.Type, []],
    //{ [Num]: Num }Indexed: [Terms.Indexed, Type_Type_Type, []],
    Unit: [Terms.Unit, NF.Type, []],
    "+": [Terms["+"], Num_Num_Num, []],
    "-": [Terms["-"], Num_Num_Num, []],
    "*": [Terms["*"], Num_Num_Num, []],
    "/": [Terms["/"], Num_Num_Num, []],
    "&&": [Terms["&&"], Bool_Bool_Bool, []],
    "||": [Terms["||"], Bool_Bool_Bool, []],
    "==": [Terms["=="], Num_Num_Bool, []],
    "!=": [Terms["!="], Num_Num_Bool, []],
    "<": [Terms["<"], Num_Num_Bool, []],
    ">": [Terms[">"], Num_Num_Bool, []],
    "<=": [Terms["<="], Num_Num_Bool, []],
    ">=": [Terms[">="], Num_Num_Bool, []],
    "%": [Terms["%"], Num_Num_Num, []],

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