import { isMatching, match, P } from "ts-pattern";
import * as O from "fp-ts/Option";
import * as A from "fp-ts/Array";

import * as EB from "@yap/elaboration";
import * as R from "@yap/shared/rows";
import * as NF from "./syntax/term";

export const mapContext = (
	context: NF.Context,
	onValue: (value: NF.Value, ctx: EB.Context) => NF.Value,
	source: (source: NF.Source) => NF.Source,
): NF.Context => {
	const value = (value: NF.Value) => onValue(value, context.ctx);
	const optional = (v: NF.Value | undefined) => O.toUndefined(O.option.map(O.fromNullable(v), value));
	const entries = (xs: readonly { label: string; value: NF.Value }[]) => xs.map(x => ({ ...x, value: value(x.value) }));
	return match(context)
		.with({ type: "Function" }, c => ({ ...c, argument: source(c.argument) }))
		.with({ type: "Argument" }, c => ({ ...c, func: value(c.func) }))
		.with({ type: "Applied" }, c => ({ ...c, arg: value(c.arg) }))
		.with({ type: "SuspensionIdentity" }, c => ({ ...c, payload: source(c.payload), annotation: value(c.annotation), signature: optional(c.signature) }))
		.with({ type: "SuspensionPayload" }, c => ({ ...c, identity: value(c.identity), annotation: value(c.annotation), signature: optional(c.signature) }))
		.with({ type: "HandlingIdentity" }, c => ({ ...c, handler: source(c.handler), body: source(c.body), signature: optional(c.signature) }))
		.with({ type: "HandlingHandler" }, c => ({ ...c, identity: value(c.identity), body: source(c.body), signature: optional(c.signature) }))
		.with({ type: "RowTail" }, c => ({ ...c, preceding: entries(c.preceding) }))
		.with({ type: "ModalLiquid" }, c => ({ ...c, value: value(c.value) }))
		.with({ type: "Let" }, c => ({ ...c, annotation: value(c.annotation), self: value(c.self), following: source(c.following) }))
		.with({ type: "Sequence" }, c => ({ ...c, following: source(c.following) }))
		.with({ type: "Reset" }, c => ({ ...c, identity: value(c.identity), handler: value(c.handler), signature: optional(c.signature) }))
		.with({ type: "Project" }, c => c)
		.with({ type: "InjectionBase" }, c => ({ ...c, injected: source(c.injected) }))
		.with({ type: "InjectionValue" }, c => ({ ...c, base: value(c.base) }))
		.with({ type: "Row" }, c => ({ ...c, preceding: entries(c.preceding), following: source(c.following) }))
		.with({ type: "Match" }, c => ({ ...c, alternatives: source(c.alternatives) }))
		.with({ type: "Modal" }, c => ({ ...c, liquid: source(c.liquid) }))
		.exhaustive();
};

export const referenced = (source: NF.Source, depth = 0, seen: ReadonlySet<object> = new Set()): NF.Value[] => {
	if (seen.has(source.term)) {
		return [];
	}
	const within = new Set([...seen, source.term]);
	return [
		...A.fromOption(O.fromNullable(source.observed)),
		...references(source.term, depth).flatMap(ref =>
			match(ref)
				.with({ type: "Value" }, ({ value }) => [value])
				.with({ type: "Env" }, ({ index }) => {
					const entry = source.ctx.env[index];
					return entry ? [entry.nf, ...(isMatching(P.instanceOf(Error), entry.type[2]) ? [] : [entry.type[2]])] : [];
				})
				.with({ type: "Local" }, ({ index }) => {
					const frame = source.ctx.local[index];
					return frame && !within.has(frame) ? referenced({ ctx: frame.ctx, term: frameTerm(frame) }, 0, new Set([...within, frame])) : [];
				})
				.with({ type: "Free" }, ({ name }) => {
					const entry = source.ctx.imports[name];
					return entry ? [entry[1], ...referenced({ ctx: source.ctx, term: entry[0] }, 1, within)] : [];
				})
				.with({ type: "Label" }, ({ name }) => {
					const sigma = source.ctx.sigma[name];
					const record = source.ctx.record[name];
					return [
						...A.fromOption(O.fromNullable(sigma?.value)),
						...A.fromOption(O.fromNullable(record?.value)),
						...(record?.term ? referenced({ ctx: source.ctx, term: record.term }, 0, within) : []),
					];
				})
				.exhaustive(),
		),
	];
};

export const mapSourceValues = (
	source: NF.Source,
	value: (value: NF.Value, ctx: EB.Context) => NF.Value,
	term: (term: EB.Term, ctx: EB.Context, depth: number) => EB.Term,
	depth = 0,
	seen: ReadonlySet<object> = new Set(),
): NF.Source => {
	if (seen.has(source.term)) {
		return source;
	}
	const within = new Set([...seen, source.term]);
	const refs = references(source.term, depth);
	const env = source.ctx.env.map((entry, index) => {
		if (!refs.some(ref => ref.type === "Env" && ref.index === index)) {
			return entry;
		}
		const nf = value(entry.nf, source.ctx);
		const annotation = isMatching(P.instanceOf(Error), entry.type[2]) ? entry.type[2] : value(entry.type[2], source.ctx);
		return nf === entry.nf && annotation === entry.type[2]
			? entry
			: { ...entry, nf, type: [entry.type[0], entry.type[1], annotation] satisfies typeof entry.type };
	});
	const local = source.ctx.local.map((frame, index) => {
		if (within.has(frame) || !refs.some(ref => ref.type === "Local" && ref.index === index)) {
			return frame;
		}
		const original = { ctx: frame.ctx, term: frameTerm(frame) };
		const mapped = mapSourceValues(original, value, term, 0, new Set([...within, frame]));
		if (mapped === original) {
			return frame;
		}
		return match(mapped.term)
			.with(EB.CtorPatterns.Nu, ({ binding }) => ({ ...frame, ctx: mapped.ctx, terms: binding.scoped, source: frame.source ? binding : undefined }))
			.otherwise(() => frame);
	});
	const imports = Object.fromEntries(
		Object.entries(source.ctx.imports).map(([name, entry]) => {
			if (!refs.some(ref => ref.type === "Free" && ref.name === name)) {
				return [name, entry];
			}
			const mapped = term(entry[0], source.ctx, 1);
			const annotation = value(entry[1], source.ctx);
			return [name, mapped === entry[0] && annotation === entry[1] ? entry : ([mapped, annotation, entry[2]] satisfies EB.AST)];
		}),
	);
	const sigma = Object.fromEntries(
		Object.entries(source.ctx.sigma).map(([name, entry]) => {
			const mapped = refs.some(ref => ref.type === "Label" && ref.name === name) ? value(entry.value, source.ctx) : entry.value;
			return [name, mapped === entry.value ? entry : { value: mapped }];
		}),
	);
	const record = Object.fromEntries(
		Object.entries(source.ctx.record).map(([name, entry]) => {
			if (!refs.some(ref => ref.type === "Label" && ref.name === name)) {
				return [name, entry];
			}
			const mapped = O.toUndefined(O.option.map(O.fromNullable(entry.term), t => term(t, source.ctx, 0)));
			const observed = O.toUndefined(O.option.map(O.fromNullable(entry.value), v => value(v, source.ctx)));
			return [name, mapped === entry.term && observed === entry.value ? entry : { term: mapped, value: observed }];
		}),
	);
	const embedded = refs.flatMap(ref => (ref.type === "Value" ? [[ref.value, value(ref.value, source.ctx)] satisfies [NF.Value, NF.Value]] : []));
	const replacements = new Map(embedded);
	const mapped = term(
		embedded.some(([before, after]) => before !== after) ? mapTermValues(source.term, v => replacements.get(v) ?? v) : source.term,
		source.ctx,
		depth,
	);
	const observed = source.observed ? value(source.observed, source.ctx) : undefined;
	const changed =
		observed !== source.observed ||
		mapped !== source.term ||
		env.some((entry, i) => entry !== source.ctx.env[i]) ||
		local.some((entry, i) => entry !== source.ctx.local[i]) ||
		Object.entries(imports).some(([name, entry]) => entry !== source.ctx.imports[name]) ||
		Object.entries(sigma).some(([name, entry]) => entry !== source.ctx.sigma[name]) ||
		Object.entries(record).some(([name, entry]) => entry !== source.ctx.record[name]);
	return changed ? { ctx: { ...source.ctx, env, local, imports, sigma, record }, term: mapped } : source;
};

type Reference = { type: "Env" | "Local"; index: number } | { type: "Free" | "Label"; name: string } | { type: "Value"; value: NF.Value };

const frameTerm = (frame: EB.Frame): EB.Term =>
	EB.Constructors.Nu(
		{ ...frame.source, labels: frame.labels, scoped: frame.terms, annotation: frame.source?.annotation ?? EB.Type, mode: frame.source?.mode ?? "strict" },
		EB.Type,
	);

const mapTermValues = (term: EB.Term, value: (value: NF.Value) => NF.Value): EB.Term => {
	const recur = (term: EB.Term): EB.Term => mapTermValues(term, value);
	const row = (row: EB.Row): EB.Row =>
		R.traverse(row, recur, variable =>
			match(recur(EB.Constructors.Var(variable)))
				.with(EB.CtorPatterns.Var, ({ variable }) => R.Constructors.Variable<EB.Term, EB.Variable>(variable))
				.otherwise(() => {
					throw new Error("A stored row reference retains its variable");
				}),
		);
	const pattern = (p: EB.Pattern): EB.Pattern =>
		match(p)
			.with({ type: "Var" }, p => ({ ...p, term: recur(p.term) }))
			.with({ type: P.union("Row", "Struct", "Variant") }, p => ({ ...p, row: R.traverse(p.row, pattern, variable => R.Constructors.Variable(variable)) }))
			.with({ type: "List" }, p => ({ ...p, patterns: p.patterns.map(pattern) }))
			.otherwise(p => p);
	return match(term)
		.with(EB.CtorPatterns.Vars.DepLabel, EB.CtorPatterns.Vars.NuLabel, term =>
			EB.Constructors.Var({ ...term.variable, annotation: value(term.variable.annotation) }),
		)
		.with(EB.CtorPatterns.Var, EB.CtorPatterns.Lit, term => term)
		.with(EB.CtorPatterns.Nu, ({ binding, body }) =>
			EB.Constructors.Abs({ ...binding, scoped: row(binding.scoped), annotation: recur(binding.annotation) }, recur(body)),
		)
		.with({ type: "Abs", binding: { type: "Let" } }, ({ binding, body }) =>
			EB.Constructors.Abs({ ...binding, value: recur(binding.value), annotation: recur(binding.annotation) }, recur(body)),
		)
		.with({ type: "Abs" }, ({ binding, body }) => EB.Constructors.Abs({ ...binding, annotation: recur(binding.annotation) }, recur(body)))
		.with({ type: "App" }, ({ icit, func, arg }) => EB.Constructors.App(icit, recur(func), recur(arg)))
		.with({ type: "Row" }, term => EB.Constructors.Row(row(term.row)))
		.with({ type: "Proj" }, term => EB.Constructors.Proj(term.label, recur(term.term)))
		.with({ type: "Inj" }, term => EB.Constructors.Inj(term.label, recur(term.value), recur(term.term)))
		.with({ type: "Ann" }, term => EB.Constructors.Ann(recur(term.term), recur(term.ann)))
		.with({ type: "Match" }, term =>
			EB.Constructors.Match(
				recur(term.scrutinee),
				term.alternatives.map(alt => ({
					...alt,
					pattern: pattern(alt.pattern),
					term: recur(alt.term),
					binders: alt.binders.map(([name, ann]) => [name, value(ann)]),
				})),
			),
		)
		.with({ type: "Block" }, term =>
			EB.Constructors.Block(
				term.statements.map(stmt =>
					match(stmt)
						.with({ type: "Expression" }, stmt => ({ ...stmt, value: recur(stmt.value) }))
						.otherwise(stmt => ({ ...stmt, value: recur(stmt.value), annotation: value(stmt.annotation) })),
				),
				recur(term.return),
			),
		)
		.with({ type: "Reset" }, term =>
			EB.Constructors.Reset(recur(term.term), term.handling && { identity: recur(term.handling.identity), handler: recur(term.handling.handler) }),
		)
		.with({ type: "Suspend" }, term => EB.Constructors.Suspend(recur(term.identity), recur(term.payload), recur(term.annotation)))
		.with({ type: "Shift" }, term => EB.Constructors.Shift(recur(term.body)))
		.with({ type: "Bubble" }, term => EB.Constructors.Bubble(term.meta, value(term.ann), term.values.map(value), recur(term.shift)))
		.with({ type: "Modal" }, term => EB.Constructors.Modal(recur(term.term), { ...term.modalities, liquid: recur(term.modalities.liquid) }))
		.exhaustive();
};

const references = (term: EB.Term, depth = 0, labels = 0): Reference[] => {
	const recur = (term: EB.Term, d = depth, l = labels) => references(term, d, l);
	const semantic = (value: NF.Value): Reference => ({ type: "Value", value });
	const row = (row: EB.Row, d = depth, l = labels): Reference[] => [
		...row.entries.flatMap(({ value }) => recur(value, d, l)),
		...(row.tail ? recur(EB.Constructors.Var(row.tail), d, l) : []),
	];
	const pattern = (p: EB.Pattern): Reference[] =>
		match(p)
			.with({ type: "Var" }, p => recur(p.term))
			.with({ type: P.union("Row", "Struct", "Variant") }, p => p.row.entries.flatMap(({ value }) => pattern(value)))
			.with({ type: "List" }, p => p.patterns.flatMap(pattern))
			.otherwise(() => []);
	return match(term)
		.with(EB.CtorPatterns.Vars.Bound, ({ variable }) => (variable.index >= depth ? [{ type: "Env", index: variable.index - depth } satisfies Reference] : []))
		.with(EB.CtorPatterns.Vars.DepLabel, ({ variable }) => [
			semantic(variable.annotation),
			...(variable.index >= depth ? [{ type: "Env", index: variable.index - depth } satisfies Reference] : []),
		])
		.with(EB.CtorPatterns.Vars.NuLabel, ({ variable }) => [
			semantic(variable.annotation),
			...(variable.meta ? [semantic(NF.Constructors.Var(variable.meta))] : []),
			...(variable.index >= labels ? [{ type: "Local", index: variable.index - labels } satisfies Reference] : []),
		])
		.with(EB.CtorPatterns.Vars.Meta, ({ variable }) => [semantic(NF.Constructors.Var(variable))])
		.with({ type: "Var", variable: { type: P.union("Free", "Label") } }, ({ variable }) => [variable])
		.with(EB.CtorPatterns.Var, EB.CtorPatterns.Lit, () => [])
		.with(EB.CtorPatterns.Nu, ({ binding, body }) => [
			...recur(binding.annotation, depth, labels + 1),
			...row(binding.scoped, depth, labels + 1),
			...recur(body, depth, labels + 1),
		])
		.with(EB.CtorPatterns.Sigma, ({ binding, body }) => [...recur(binding.annotation), ...recur(body)])
		.with({ type: "Abs", binding: { type: "Let" } }, ({ binding, body }) => [
			...recur(binding.annotation),
			...recur(binding.value, depth + 1),
			...recur(body, depth + 1),
		])
		.with({ type: "Abs" }, ({ binding, body }) => [...recur(binding.annotation), ...recur(body, depth + 1)])
		.with({ type: "App" }, ({ func, arg }) => [...recur(func), ...recur(arg)])
		.with({ type: "Row" }, term => row(term.row))
		.with({ type: "Proj" }, term => recur(term.term))
		.with({ type: "Inj" }, ({ value, term }) => [...recur(value), ...recur(term)])
		.with({ type: "Ann" }, ({ term, ann }) => [...recur(term), ...recur(ann)])
		.with({ type: "Match" }, ({ scrutinee, alternatives }) => [
			...recur(scrutinee),
			...alternatives.flatMap(alt => [...pattern(alt.pattern), ...alt.binders.map(([, ann]) => semantic(ann)), ...recur(alt.term, depth + alt.binders.length)]),
		])
		.with({ type: "Block" }, ({ statements, return: term }) => {
			const block = statements.reduce<{ depth: number; refs: Reference[] }>(
				(acc, stmt) => {
					const next = acc.depth + (stmt.type === "Let" ? 1 : 0);
					return { depth: next, refs: [...acc.refs, ...recur(stmt.value, next), ...(stmt.type === "Expression" ? [] : [semantic(stmt.annotation)])] };
				},
				{ depth, refs: [] },
			);
			return [...block.refs, ...recur(term, block.depth)];
		})
		.with({ type: "Reset" }, ({ term, handling }) => [...recur(term), ...(handling ? [...recur(handling.identity), ...recur(handling.handler)] : [])])
		.with({ type: "Suspend" }, ({ identity, payload, annotation }) => [...recur(identity), ...recur(payload), ...recur(annotation)])
		.with({ type: "Shift" }, ({ body }) => recur(body))
		.with({ type: "Bubble" }, ({ shift, ann, values }) => [...recur(shift), semantic(ann), ...values.map(semantic)])
		.with({ type: "Modal" }, ({ term, modalities }) => [...recur(term), ...recur(modalities.liquid)])
		.exhaustive();
};
