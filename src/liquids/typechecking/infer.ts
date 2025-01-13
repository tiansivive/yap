import { Term } from "../terms.js";
import { Context } from "./validation/context.js";

export const infer: (ctx: Context, t: Term) => Term = (ctx, t) => t;
