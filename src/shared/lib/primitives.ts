
import * as NF from "@yap/elaboration/normalization"
import * as EB from "@yap/elaboration"

import * as Q from "@yap/shared/modalities/multiplicity"
import * as Lit from "@yap/shared/literals"

import * as Eff from "@yap/utils/effects"
import * as M from "@yap/elaboration/shared/effects"
import * as Metas from "@yap/elaboration/shared/metas"

import { isEqual } from "lodash"

export const defaultContext = () => ({
    env: [],
    implicits: [],
    labels: {},
    sigma: {},
    record: {},
    trace: [],
    imports: Elaborated(),
    ffi: PrimOps,
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

    "<>": EB.Constructors.Var({ type: "Foreign", name: "$concat" }),
    "++": EB.Constructors.Var({ type: "Foreign", name: "$concat" }),

})

export const NormalForms = {
    Num: () => NF.Constructors.Lit(Lit.Atom("Num")),
    Bool: () => NF.Constructors.Lit(Lit.Atom("Bool")),
    String: () => NF.Constructors.Lit(Lit.Atom("String")),
    Unit: () => NF.Constructors.Lit(Lit.Atom("Unit")),
}





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
        labels: {},
        sigma: {},
        record: {},
        trace: [],
        imports: PrimTypes,
        ffi: PrimOps,
    }

    const reflectLiquid = (returnType: EB.Term) => (f: (p: EB.Term, q: EB.Term) => EB.Term) => {
        const i0 = EB.Constructors.Var({ type: "Bound", index: 0 });
        const i1 = EB.Constructors.Var({ type: "Bound", index: 1 });
        const i2 = EB.Constructors.Var({ type: "Bound", index: 2 });
        return EB.Constructors.Lambda("r", "Explicit", EB.DSL.eq(i0, f(i2, i1)), returnType)
    }

    const mkModal = (base: EB.Term, liquid?: EB.Term) => liquid ? EB.Constructors.Modal(base, { quantity: Q.Many, liquid }) : base;

    const Num_Num_Num = ([r1, r2, r3]: [EB.Term?, EB.Term?, EB.Term?]) => NF.Constructors.Pi("x", "Explicit", NormalForms.Num(), {
        type: "Closure",
        ctx: dummyContext,
        term: EB.Constructors.Pi("y", "Explicit", mkModal(Terms().Num, r2), mkModal(Terms().Num, r3))
    })

    const Num_Num_Bool = ([r1, r2, r3]: [EB.Term?, EB.Term?, EB.Term?]) => NF.Constructors.Pi("x", "Explicit", NormalForms.Num(), {
        type: "Closure",
        ctx: dummyContext,
        term: EB.Constructors.Pi("y", "Explicit", mkModal(Terms().Num, r2), mkModal(Terms().Bool, r3))
    })

    const Bool_Bool_Bool = NF.Constructors.Pi("x", "Explicit", NormalForms.Bool(), {
        type: "Closure",
        ctx: dummyContext,
        term: EB.Constructors.Pi("y", "Explicit", Terms().Bool, Terms().Bool)
    })

    const String_String_String = NF.Constructors.Pi("x", "Explicit", NormalForms.String(), {
        type: "Closure",
        ctx: dummyContext,
        term: EB.Constructors.Pi("y", "Explicit", Terms().String, Terms().String)
    })

    const Type_Type_Type = NF.Constructors.Pi("x", "Explicit", NF.Type, {
        type: "Closure",
        ctx: dummyContext,
        term: EB.Constructors.Pi("y", "Explicit", Terms().Type, Terms().Type)
    })

    return {
        ...PrimTypes,
        //"->": [Terms()["->"], Type_Type_Type, []],
        "+": [Terms()["+"], Num_Num_Num([, , reflectLiquid(Terms().Num)(EB.DSL.add)]), []],
        "-": [Terms()["-"], Num_Num_Num([, , reflectLiquid(Terms().Num)(EB.DSL.sub)]), []],
        "*": [Terms()["*"], Num_Num_Num([, , reflectLiquid(Terms().Num)(EB.DSL.mul)]), []],
        "/": [Terms()["/"], Num_Num_Num([, , reflectLiquid(Terms().Num)(EB.DSL.div)]), []],
        "&&": [Terms()["&&"], Bool_Bool_Bool, []],
        "||": [Terms()["||"], Bool_Bool_Bool, []],
        "==": [Terms()["=="], Num_Num_Bool([, , reflectLiquid(Terms().Bool)(EB.DSL.eq)]), []],
        "!=": [Terms()["!="], Num_Num_Bool([, , reflectLiquid(Terms().Bool)(EB.DSL.neq)]), []],
        "<": [Terms()["<"], Num_Num_Bool([, , reflectLiquid(Terms().Bool)(EB.DSL.lt)]), []],
        ">": [Terms()[">"], Num_Num_Bool([, , reflectLiquid(Terms().Bool)(EB.DSL.gt)]), []],
        "<=": [Terms()["<="], Num_Num_Bool([, , reflectLiquid(Terms().Bool)(EB.DSL.lte)]), []],
        ">=": [Terms()[">="], Num_Num_Bool([, , reflectLiquid(Terms().Bool)(EB.DSL.gte)]), []],
        "%": [Terms()["%"], Num_Num_Num([]), []],
        "<>": [Terms()["<>"], String_String_String, []],
        "++": [Terms()["++"], String_String_String, []],

    }
}

/* FFI type errors render at a boundary: a run over a blank scope. */
const blank: EB.Context = { env: [], implicits: [], labels: {}, sigma: {}, record: {}, imports: {}, ffi: {}, trace: [] };
const shown = (v: NF.Value): string => Eff.run(() => NF.display(v), [M.reader.handlers(blank), Metas.registry.handlers({})])[0];

const typecheckNum = (val: NF.Value): val is NF.Value & { type: "Lit", value: { type: "Num", value: number } } => val.type === "Lit" && val.value.type === "Num"
const arithmetic = (x: NF.Value, y: NF.Value, fn: (a: number, b: number) => number): NF.Value => {

    if (!typecheckNum(x)) throw new Error(`Expected number, got ${shown(x)}`);
    if (!typecheckNum(y)) throw new Error(`Expected number, got ${shown(y)}`);
    const val = fn(x.value.value, y.value.value);
    return NF.Constructors.Lit(Lit.Num(val));
}


const typecheckBool = (val: NF.Value): val is NF.Value & { type: "Lit", value: { type: "Bool", value: boolean } } => val.type === "Lit" && val.value.type === "Bool"

const logical = (x: NF.Value, y: NF.Value, fn: (a: boolean, b: boolean) => boolean): NF.Value => {
    if (!typecheckBool(x)) throw new Error(`Expected boolean, got ${shown(x)}`);
    if (!typecheckBool(y)) throw new Error(`Expected boolean, got ${shown(y)}`);
    const val = fn(x.value.value, y.value.value);
    return NF.Constructors.Lit(Lit.Bool(val));
}

const comparison = (x: NF.Value, y: NF.Value, fn: (a: number, b: number) => boolean): NF.Value => {
    if (!typecheckNum(x)) throw new Error(`Expected number, got ${shown(x)}`);
    if (!typecheckNum(y)) throw new Error(`Expected number, got ${shown(y)}`);
    const val = fn(x.value.value, y.value.value);
    return NF.Constructors.Lit(Lit.Bool(val));
}

const typecheckLit = (val: NF.Value): val is NF.Value & { type: "Lit" } => val.type === "Lit"

const equality = (x: NF.Value, y: NF.Value, fn: (a: boolean) => boolean): NF.Value => {
    if (!typecheckLit(x)) throw new Error(`Expected literal, got ${shown(x)}`);
    if (!typecheckLit(y)) throw new Error(`Expected literal, got ${shown(y)}`);
    return NF.Constructors.Lit(Lit.Bool(fn(isEqual(x.value, y.value))));
}

const typecheckString = (val: NF.Value): val is NF.Value & { type: "Lit", value: { type: "String", value: string } } => val.type === "Lit" && val.value.type === "String"

const concatenate = (x: NF.Value, y: NF.Value): NF.Value => {
    if (!typecheckString(x)) throw new Error(`Expected string, got ${shown(x)}`);
    if (!typecheckString(y)) throw new Error(`Expected string, got ${shown(y)}`);
    const val = x.value.value + y.value.value;
    return NF.Constructors.Lit(Lit.String(val));
}


export const PrimOps: EB.Context['ffi'] = {
    $add: { arity: 2, compute: (x: NF.Value, y: NF.Value) => arithmetic(x, y, (a, b) => a + b) },
    $sub: { arity: 2, compute: (x: NF.Value, y: NF.Value) => arithmetic(x, y, (a, b) => a - b) },
    $mul: { arity: 2, compute: (x: NF.Value, y: NF.Value) => arithmetic(x, y, (a, b) => a * b) },
    $div: { arity: 2, compute: (x: NF.Value, y: NF.Value) => arithmetic(x, y, (a, b) => a / b) },
    $and: { arity: 2, compute: (x: NF.Value, y: NF.Value) => logical(x, y, (a, b) => a && b) },
    $or: { arity: 2, compute: (x: NF.Value, y: NF.Value) => logical(x, y, (a, b) => a || b) },
    $eq: { arity: 2, compute: (x: NF.Value, y: NF.Value) => equality(x, y, v => v) },
    $neq: { arity: 2, compute: (x: NF.Value, y: NF.Value) => equality(x, y, v => !v) },
    $lt: { arity: 2, compute: (x: NF.Value, y: NF.Value) => comparison(x, y, (a, b) => a < b) },
    $gt: { arity: 2, compute: (x: NF.Value, y: NF.Value) => comparison(x, y, (a, b) => a > b) },
    $lte: { arity: 2, compute: (x: NF.Value, y: NF.Value) => comparison(x, y, (a, b) => a <= b) },
    $gte: { arity: 2, compute: (x: NF.Value, y: NF.Value) => comparison(x, y, (a, b) => a >= b) },
    $mod: { arity: 2, compute: (x: NF.Value, y: NF.Value) => arithmetic(x, y, (a, b) => a % b) },
    $concat: { arity: 2, compute: (x: NF.Value, y: NF.Value) => concatenate(x, y) },
    $not: {
        arity: 1, compute: (x: NF.Value) => {
            if (!typecheckBool(x)) throw new Error(`Expected boolean, got ${shown(x)}`);
            return NF.Constructors.Lit(Lit.Bool(!x.value.value));
        }
    }

}


export const OP_AND = "$and";
export const OP_OR = "$or";
export const OP_EQ = "$eq";
export const OP_NEQ = "$neq";
export const OP_LT = "$lt";
export const OP_GT = "$gt";
export const OP_LTE = "$lte";
export const OP_GTE = "$gte";
export const OP_NOT = "$not";

export const OP_ADD = "$add";
export const OP_SUB = "$sub";
export const OP_MUL = "$mul";
export const OP_DIV = "$div";

export const OP_CONCAT = "$concat";



export const primopMapping: Record<string, string> = {
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

    [OP_CONCAT]: "++",

}