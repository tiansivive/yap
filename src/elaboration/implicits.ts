import * as F from "fp-ts/lib/function";

import * as EB from "@yap/elaboration";
import * as V2 from "@yap/elaboration/shared/monad.v2";
import * as NF from "@yap/elaboration/normalization";

import * as Generalization from "@yap/elaboration/normalization/generalization";

import * as Log from "@yap/shared/logging";
import { match, P } from "ts-pattern";

import * as R from "@yap/shared/rows";
import _ from "lodash";
import { Subst } from "./unification/substitution";

export function insert(node: EB.AST): V2.Elaboration<EB.AST> {
	const [term, ty, us] = node;
	return V2.Do(function* () {
		const ctx = yield* V2.ask();
		const r = match(node)
			.with([{ type: "Abs", binding: { type: "Lambda", icit: "Implicit" } }, P._, P._], () => V2.of<EB.AST>(node))
			.with([P._, { type: "Abs", binder: { type: "Pi", icit: "Implicit" } }, P._], ([, pi]) =>
				V2.Do(function* () {
					const found = yield* V2.pure(EB.resolveImplicit(pi.binder.annotation.nf));

					if (found) {
						if (!_.isEmpty(found[1])) {
							throw new Error("insert: Found implicit with constraints; What to do here?");
						}
						const bodyNF = NF.apply(pi.binder, pi.closure, pi.binder.annotation.nf);
						const tm = EB.Constructors.App("Implicit", term, found[0]);
						return [tm, bodyNF, us] satisfies EB.AST;
					}
					const meta = yield* EB.freshMeta(ctx.env.length, pi.binder.annotation.nf);
					const mvar = EB.Constructors.Var(meta);
					const vNF = NF.evaluate(ctx, mvar);

					const tm = EB.Constructors.App("Implicit", term, mvar);
					const bodyNF = NF.apply(pi.binder, pi.closure, vNF);
					const r = yield* insert.gen([tm, bodyNF, us]);
					return r;
				}),
			)
			.otherwise(() => V2.of<EB.AST>(node));
		return yield* V2.pure(r);
	});
}

insert.gen = F.flow(insert, V2.pure);

export const wrapLambda = (term: EB.Term, ty: NF.Value): EB.Term => {
	return match(ty)
		.with(
			{ type: "Abs", binder: { type: "Pi", icit: "Implicit" } },
			_ => term.type === "Abs" && (term.binding.type === "Lambda" || term.binding.type === "Pi") && term.binding.icit === "Implicit",
			_ => term,
		)
		.with({ type: "Abs", binder: { type: "Pi", icit: "Implicit" } }, pi => {
			const binding: EB.Binding = { type: "Lambda", variable: pi.binder.variable, icit: pi.binder.icit };
			return EB.Constructors.Abs(binding, wrapLambda(term, NF.apply(pi.binder, pi.closure, NF.Constructors.Rigid(0))));
		})
		.otherwise(() => term);
};

type Meta = Extract<EB.Variable, { type: "Meta" }>;
export const metas = (tm: EB.Term, zonker: Subst): Meta[] => {
	const _metas = (tm: EB.Term): Meta[] => {
		const ms = match(tm)
			.with({ type: "Var" }, ({ variable }) => {
				if (variable.type !== "Meta") {
					return [];
				}

				if (!zonker[variable.val]) {
					return [variable];
				}

				return Generalization.metas(zonker[variable.val], zonker);
			})
			.with({ type: "Lit" }, () => [])
			.with({ type: "Abs", binding: { type: "Lambda" } }, ({ body, binding }) => _metas(body))
			.with({ type: "Abs", binding: { type: "Pi" } }, ({ body, binding }) => [..._metas(binding.annotation), ..._metas(body)])
			.with({ type: "Abs", binding: { type: "Mu" } }, ({ body, binding }) => [..._metas(binding.annotation), ..._metas(body)])
			.with({ type: "App" }, ({ func, arg }) => [..._metas(func), ..._metas(arg)])
			.with({ type: "Row" }, ({ row }) =>
				R.fold(
					row,
					(val, l, ms) => ms.concat(_metas(val)),
					(v, ms) => (v.type === "Meta" ? [...ms, v] : ms),
					[] as Meta[],
				),
			)
			.with({ type: "Proj" }, ({ term }) => _metas(term))
			.with({ type: "Inj" }, ({ value, term }) => [..._metas(value), ..._metas(term)])
			//.with({ type: "Annotation" }, ({ term, ann }) => [..._metas(term), ..._metas(ann)])
			.with({ type: "Match" }, ({ scrutinee, alternatives }) => [..._metas(scrutinee), ...alternatives.flatMap(alt => _metas(alt.term))])
			.with({ type: "Block" }, ({ return: ret, statements }) => [..._metas(ret), ...statements.flatMap(s => _metas(s.value))])
			.with({ type: "Modal" }, ({ term }) => _metas(term))
			.otherwise(() => {
				throw new Error("metas: Not implemented yet");
			});

		return ms;
	};
	return _metas(tm);
};

export const generalize = (tm: EB.Term, ctx: EB.Context): EB.Term => {
	const ms = metas(tm, ctx.zonker);
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
		replaceMeta(tm, ms, 0, ctx),
	);
};

export const replaceMeta = (tm: EB.Term, ms: Meta[], lvl: number, ctx: EB.Context): EB.Term => {
	const sub = (tm: EB.Term, lvl: number): EB.Term => {
		const t = match(tm)
			.with({ type: "Var", variable: { type: "Meta" } }, ({ variable }) => {
				if (!ctx.zonker[variable.val]) {
					return EB.Constructors.Var(bindMeta(variable, ms, lvl));
				}

				return NF.quote(ctx, lvl, ctx.zonker[variable.val]);
				// console.warn("Generalize: Found meta variable", { variable });
				// console.warn("Term generalization yet to be fully implemented");
				// return EB.Constructors.Var(bindMeta(variable, ms, lvl));
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
			// .with({ type: "App", icit: "Implicit", arg: { type: "Var", variable: { type: "Meta" } } }, ({ icit, func, arg }) => {
			// 	return EB.Constructors.App(icit, sub(func, lvl), sub(arg, lvl));
			// })
			.with({ type: "App" }, ({ icit, func, arg }) => EB.Constructors.App(icit, sub(func, lvl), sub(arg, lvl)))
			.with({ type: "Row" }, ({ row }) => {
				const r = R.traverse(
					row,
					val => sub(val, lvl),
					v => ({ type: "variable", variable: bindMeta(v, ms, lvl) }),
				);
				return EB.Constructors.Row(r);
			})
			.with({ type: "Proj" }, ({ label, term }) => EB.Constructors.Proj(label, sub(term, lvl)))
			.with({ type: "Inj" }, ({ label, value, term }) => EB.Constructors.Inj(label, sub(value, lvl), sub(term, lvl)))
			//.with({ type: "Annotation" }, ({ term, ann }) => EB.Constructors.Annotation(sub(term, lvl), sub(ann, lvl)))
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

			.otherwise(() => {
				throw new Error("Generalize: Not implemented yet");
			});

		return t;
	};

	return sub(tm, lvl);
};

const bindMeta = (v: EB.Variable, ms: Meta[], lvl: number): EB.Variable => {
	if (v.type !== "Meta") {
		return v;
	}

	const i = ms.findIndex(m => m.val === v.val);
	if (i === -1) {
		// Not a meta that we are generalizing. If it doesn't show up in the meta list, then it must be in the zonker (solved)
		return v;
	}

	return EB.Bound(lvl - i - 1);
};

export const instantiate = (term: EB.Term, subst: Subst, metas: EB.Context["metas"]): EB.Term => {
	return EB.traverse(term, v => {
		if (v.variable.type !== "Meta") {
			return v;
		}

		if (!!subst[v.variable.val]) {
			// Solved meta means it's in the zonker = not unconstrained, so no need to instantiate it
			return v;
		}

		const { ann } = metas[v.variable.val];

		return match(ann)
			.with({ type: "Lit", value: { type: "Atom", value: "Row" } }, () => EB.Constructors.Row({ type: "empty" }))
			.with({ type: "Lit", value: { type: "Atom", value: "Type" } }, () => EB.Constructors.Lit({ type: "Atom", value: "Any" }))
			.with({ type: "Lit", value: { type: "Atom", value: "Any" } }, () => EB.Constructors.Lit({ type: "Atom", value: "Void" }))
			.otherwise(() => EB.Constructors.Var(v.variable));
	});
};
