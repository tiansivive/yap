import { match, P } from "ts-pattern";
import {
	Bool,
	Exists,
	Free,
	Lit,
	Literal,
	Pi,
	Predicate,
	Refined,
	Template,
	Term,
	Var,
} from "../../terms.js";
import { Context } from "./context.js";
import { Constraint } from "./horn-constraints.js";

import * as Ctx from "./context.js";
import * as HC from "./horn-constraints.js";
import { nameless } from "../../desugar/nameless.js";

import * as Lib from "../../lib.js";
import { RefEQ, tru, TT } from "./helpers.js";

import * as I from "../infer.js";

import _ from "lodash";
import { subtype } from "./subtyping.js";

import * as X from "../../utils.js";
import { check } from "./check.js";

export const synth: (
	ctx: Context,
	t: Term,
) => { term: Term; constraint: Constraint } = (ctx, t) => {
	return match(t)
		.with({ tag: "Var" }, ({ variable }) => ({
			constraint: tru,
			term: Ctx.lookup(ctx, variable).ann,
		}))
		.with({ tag: "Lit" }, ({ value }) => ({
			constraint: tru,
			term: lit(value),
		}))

		.with({ tag: "App" }, ({ func, arg }) => {
			const { term: f, constraint: cf } = synth(ctx, func);
			const a = _.isEqual(I.infer(ctx, arg), Lib.Types.Type)
				? insertTemplates(ctx, arg)
				: synth(ctx, arg).term;

			const { term, constraint: ca } = incorporate(ctx, a, f);

			return { term, constraint: HC.And(cf, ca) };
		})
		.with({ tag: "Ann" }, ({ term, ann }) => ({
			term: insertTemplates(ctx, term),
			constraint: check(ctx, term, ann),
		}))
		.with({ tag: "Refined" }, ({ term, ref }) => synth(ctx, term)) // TODO:FIXME If the synthesized term is a refined term, we have to merge the refinements
		.otherwise(() => {
			throw X.error("Synth not yet implemented", t);
		});
};

const incorporate: (
	ctx: Context,
	t: Term,
	ty: Term,
) => { term: Term; constraint: Constraint } = (ctx, t, f) =>
	match(f)
		.with({ tag: "Exists" }, ({ variable, sort, term }) =>
			Ctx.extend(ctx, Pi(variable, sort), (ctx) => {
				const { constraint, term: out } = incorporate(ctx, t, term);
				return { constraint, term: Exists(variable, sort, out) };
			}),
		)
		.with({ tag: "Abs", binder: { tag: "Pi" } }, ({ binder, body }) => ({
			term: Exists(binder.variable, t, body),
			constraint: subtype(ctx, t, binder.ann),
		}))
		.otherwise(() => {
			throw X.error("Cannot existentially quantify over non-pi term", [t, f]);
		});

const lit: (val: Literal) => Term = (val) => {
	const ty = match(val)
		.with({ tag: "Bool" }, (value) =>
			Refined(
				Lib.Types.Bool,
				Predicate("b", RefEQ(Var(Free("b")), Lit(value))),
			),
		)
		.with({ tag: "Int" }, (value) =>
			Refined(Lib.Types.Int, Predicate("i", RefEQ(Var(Free("i")), Lit(value)))),
		)
		.with({ tag: "String" }, (value) =>
			Refined(
				Lib.Types.String,
				Predicate("s", RefEQ(Var(Free("s")), Lit(value))),
			),
		)

		.with({ tag: "Unit" }, (value) =>
			Refined(
				Lib.Types.Unit,
				Predicate("u", RefEQ(Var(Free("u")), Lit(value))),
			),
		)
		.with({ tag: "Type" }, (value) =>
			Refined(
				Lib.Types.Type,
				Predicate("t", RefEQ(Var(Free("t")), Lit(value))),
			),
		)
		.with({ tag: "Kind" }, (value) =>
			Refined(
				Lib.Types.Kind,
				Predicate("k", RefEQ(Var(Free("k")), Lit(value))),
			),
		)
		.run();

	return nameless(ty);
};

let counter = 0;
const insertTemplates: (ctx: Context, t: Term) => Term = (ctx, t) =>
	match(t)
		.with({ tag: "Refined", ref: { tag: "Hole" } }, ({ term }) => {
			counter++;
			const xs = ctx.local.map(({ variable }) => Free(variable));
			const template: Term = {
				tag: "Refined",
				term,
				ref: Template(`K${counter}`, `V${counter}`, xs),
			};
			return nameless(template);
		})
		.with({ tag: "Abs", binder: { tag: "Pi" } }, ({ binder, body }) => {
			const ann = insertTemplates(ctx, binder.ann);
			const out = Ctx.extend(ctx, binder, (ctx) => insertTemplates(ctx, body));
			return TT(binder.variable, ann, out);
		})
		.with({ tag: "Abs", binder: { tag: "Lambda" } }, () => {
			throw X.error("Template insertion not yet implemented for lambda", t);
		})
		.with({ tag: "Abs", binder: { tag: "Let" } }, () => {
			throw X.error("Template insertion not yet implemented for let", t);
		})
		.with({ tag: "Match" }, () => {
			throw X.error("Template insertion not yet implemented for match", t);
		})
		.otherwise(() => t);
