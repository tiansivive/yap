// IVL DSL: terse constructors for readable formula expressions.
// Usage: import * as DSL from "./ivl/dsl"

import { Build } from "./build";
import type { IVL } from "./types";

export const x = Build.var_("x", Build.Int);
export const y = Build.var_("y", Build.Int);
export const a = Build.var_("a", Build.Int);
export const b = Build.var_("b", Build.Int);

export const int = (n: number) => Build.num(n, Build.Int);

export const eq = (l: IVL.Term, r: IVL.Term, origin?: string) => Build.atom("=", l, r, origin);
export const neq = (l: IVL.Term, r: IVL.Term, origin?: string) => Build.atom("!=", l, r, origin);
export const gt = (l: IVL.Term, r: IVL.Term, origin?: string) => Build.atom(">", l, r, origin);
export const gte = (l: IVL.Term, r: IVL.Term, origin?: string) => Build.atom(">=", l, r, origin);
export const lt = (l: IVL.Term, r: IVL.Term, origin?: string) => Build.atom("<", l, r, origin);
export const lte = (l: IVL.Term, r: IVL.Term, origin?: string) => Build.atom("<=", l, r, origin);

export const T = Build.true_();
export const F = Build.false_();
export const not = Build.not;
export const and = Build.and;
export const or = Build.or;
export const implies = Build.implies;

export const add = (l: IVL.Term, r: IVL.Term) => Build.arith("+", l, r, Build.Int);
export const sub = (l: IVL.Term, r: IVL.Term) => Build.arith("-", l, r, Build.Int);
export const mul = (l: IVL.Term, r: IVL.Term) => Build.arith("*", l, r, Build.Int);

export const forall = Build.forall;
export const var_ = Build.var_;
