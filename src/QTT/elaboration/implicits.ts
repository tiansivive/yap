import * as F from "fp-ts/lib/function";

import * as EB from "@qtt/elaboration";
import { M } from "@qtt/elaboration";
import * as NF from "@qtt/elaboration/normalization";

import * as Log from "@qtt/shared/logging";
import { match, P } from "ts-pattern";

import * as R from "@qtt/shared/rows";
import _ from "lodash";

export function insert(node: EB.AST): EB.M.Elaboration<EB.AST> {
	const [term, ty, us] = node;
	return F.pipe(
		M.ask(),
		M.chain(ctx => {
			Log.push("insert");
			Log.logger.debug("[Term] " + EB.Display.Term(term), { Context: EB.Display.Context(ctx) });
			Log.logger.debug("[Type] " + NF.display(ty), { Context: EB.Display.Context(ctx) });
			return match(node)
				.with([{ type: "Abs", binding: { type: "Lambda", icit: "Implicit" } }, P._, P._], () => M.of<EB.AST>(node))
				.with([P._, { type: "Abs", binder: { type: "Pi", icit: "Implicit" } }, P._], ([, pi]) => {
					return F.pipe(
						EB.resolveImplicit(pi.binder.annotation[0]),
						M.chain(found => {
							if (found) {
								if (!_.isEmpty(found[1])) {
									throw new Error("insert: Found implicit with constraints; What to do here?");
								}
								const bodyNF = NF.apply(ctx, "Pi", pi.closure, pi.binder.annotation[0]);
								const tm = EB.Constructors.App("Implicit", term, found[0]);
								return M.of<EB.AST>([tm, bodyNF, us]);
							}

							const meta = EB.freshMeta(ctx.env.length);
							const mvar = EB.Constructors.Var(meta);
							const vNF = NF.evaluate(ctx, mvar);

							const tm = EB.Constructors.App("Implicit", term, mvar);
							const bodyNF = NF.apply(ctx, "Pi", pi.closure, vNF);
							return F.pipe(
								M.of<EB.AST>([tm, bodyNF, us]),
								M.discard(_ => M.tell("constraint", { type: "resolve", meta: meta, annotation: pi.binder.annotation[0] })),
							);
						}),
						M.chain(insert),
					);
				})
				.otherwise(() => M.of(node));
		}),
		M.discard(([tm, ty]) => {
			Log.push("result");
			Log.logger.debug("[Term] " + EB.Display.Term(tm));
			Log.logger.debug("[Type] " + NF.display(ty));
			Log.pop();
			Log.pop();
			return M.of(null);
		}),
	);
}

type Meta = Extract<EB.Variable, { type: "Meta" }>;
export const metas = (tm: EB.Term): Meta[] => {
	const ms = match(tm)
		.with({ type: "Var" }, ({ variable }) => (variable.type === "Meta" ? [variable] : []))
		.with({ type: "Lit" }, () => [])
		.with({ type: "Abs", binding: { type: "Lambda" } }, ({ body }) => metas(body))
		.with({ type: "Abs", binding: { type: "Pi" } }, ({ body, binding }) => [...metas(binding.annotation), ...metas(body)])
		.with({ type: "Abs", binding: { type: "Mu" } }, ({ body, binding }) => [...metas(binding.annotation), ...metas(body)])
		.with({ type: "App" }, ({ func, arg }) => [...metas(func), ...metas(arg)])
		.with({ type: "Row" }, ({ row }) =>
			R.fold(
				row,
				(val, l, ms) => ms.concat(metas(val)),
				(v, ms) => (v.type === "Meta" ? [...ms, v] : ms),
				[] as Meta[],
			),
		)
		.with({ type: "Proj" }, ({ term }) => metas(term))
		.with({ type: "Inj" }, ({ value, term }) => [...metas(value), ...metas(term)])
		.with({ type: "Annotation" }, ({ term, ann }) => [...metas(term), ...metas(ann)])
		.with({ type: "Match" }, ({ scrutinee, alternatives }) => [...metas(scrutinee), ...alternatives.flatMap(alt => metas(alt.term))])
		.with({ type: "Block" }, ({ return: ret, statements }) => [...metas(ret), ...statements.flatMap(s => metas(s.value))])

		.with({ type: "Indexed" }, ixd => ixd.pairs.flatMap(p => [...metas(p.index), ...metas(p.value)]))
		.otherwise(() => {
			throw new Error("metas: Not implemented yet");
		});

	return ms;
};

export const generalize = (tm: EB.Term): EB.Term => {
	const ms = metas(tm);
	const charCode = 97; // 'a'
	return ms.reduce(
		(tm, m, i) =>
			EB.Constructors.Abs(
				{
					type: "Lambda",
					icit: "Implicit",
					variable: `${String.fromCharCode(charCode + i)}`,
				},
				tm,
			),
		replaceMeta(tm, ms, 0),
	);
};

export const replaceMeta = (tm: EB.Term, ms: Meta[], lvl: number): EB.Term => {
	const sub = (tm: EB.Term, lvl: number): EB.Term => {
		const t = match(tm)
			.with({ type: "Var", variable: { type: "Meta" } }, ({ variable }) => {
				const i = ms.findIndex(m => m.val === variable.val);

				if (i === -1) {
					throw new Error("Generalize: Meta not found");
				}

				return EB.Constructors.Var(EB.Bound(lvl - i - 1));
			})
			.with({ type: "Var" }, () => tm)
			.with({ type: "Lit" }, () => tm)
			.with({ type: "Abs", binding: { type: "Lambda" } }, ({ binding, body }) => EB.Constructors.Abs(binding, sub(body, lvl + 1)))
			.with({ type: "Abs", binding: { type: "Pi" } }, ({ binding, body }) =>
				EB.Constructors.Abs({ ...binding, annotation: sub(binding.annotation, lvl) }, sub(body, lvl + 1)),
			)
			.with({ type: "Abs", binding: { type: "Mu" } }, ({ binding, body }) =>
				EB.Constructors.Abs({ ...binding, annotation: sub(binding.annotation, lvl) }, sub(body, lvl + 1)),
			)
			.with({ type: "App" }, ({ icit, func, arg }) => EB.Constructors.App(icit, sub(func, lvl), sub(arg, lvl)))
			.with({ type: "Row" }, ({ row }) => {
				console.log("Generalize Row: Not implemented yet");
				return EB.Constructors.Row(row);
			})
			.with({ type: "Proj" }, ({ label, term }) => EB.Constructors.Proj(label, sub(term, lvl)))
			.with({ type: "Inj" }, ({ label, value, term }) => EB.Constructors.Inj(label, sub(value, lvl), sub(term, lvl)))
			.with({ type: "Annotation" }, ({ term, ann }) => EB.Constructors.Annotation(sub(term, lvl), sub(ann, lvl)))
			.with({ type: "Match" }, ({ scrutinee, alternatives }) =>
				EB.Constructors.Match(
					sub(scrutinee, lvl),
					alternatives.map(alt => ({ pattern: alt.pattern, term: sub(alt.term, lvl) })),
				),
			)
			.with({ type: "Block" }, ({ return: ret, statements }) => {
				const stmts = statements.map(s => {
					if (s.type === "Let") {
						return { ...s, value: sub(s.value, lvl), annotation: sub(s.annotation, lvl) };
					}
					return { ...s, value: sub(s.value, lvl) };
				});
				return EB.Constructors.Block(stmts, sub(ret, lvl));
			})
			.with({ type: "Indexed" }, (ixd): EB.Term => {
				const pairs = ixd.pairs.map(p => ({
					index: sub(p.index, lvl),
					value: sub(p.value, lvl),
				}));
				return { type: "Indexed", pairs };
			})
			.otherwise(() => {
				throw new Error("Generalize: Not implemented yet");
			});

		return t;
	};

	return sub(tm, lvl);
};
