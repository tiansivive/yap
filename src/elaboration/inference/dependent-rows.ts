import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as Err from "@yap/elaboration/shared/errors";
import * as Src from "@yap/src/index";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as R from "@yap/shared/rows";

import assert from "node:assert";

const Patterns = {
	Rows: {
		Empty: { type: "empty" } as const,
		Extension: { type: "extension" } as const,
		Variable: { type: "variable" } as const,
	},
};

export type Prepared = {
	core: EB.Row;
	value: NF.Row;
};

export type Inferred = {
	term: EB.Row;
	type: NF.Row;
	usages: Q.Usages;
};

type Source = R.Row<Src.Term, Src.Variable>;

export const prepare = function* (source: Source, lvl: number): M.Elaboration<Prepared> {
	return yield* match(source)
		.with(Patterns.Rows.Empty, () =>
			M.of<Prepared>({ core: R.Constructors.Empty<EB.Term, EB.Variable>(), value: R.Constructors.Empty<NF.Value, NF.Variable>() }),
		)
		.with(Patterns.Rows.Extension, function* ({ label, row }) {
			const meta = yield* EB.freshMeta(lvl, NF.Type);
			const rest = yield* prepare(row, lvl);

			return {
				core: R.Constructors.Extension(label, EB.Constructors.Var(meta), rest.core),
				value: R.Constructors.Extension(label, NF.Constructors.Flex(meta), rest.value),
			};
		})
		.with(Patterns.Rows.Variable, function* () {
			const meta = yield* EB.freshMeta(lvl, NF.Row);
			return {
				core: R.Constructors.Variable(meta),
				value: R.Constructors.Variable(meta),
			} satisfies Prepared;
		})
		.exhaustive();
};

export const annotate = function* (source: Source, prepared: Prepared): M.Elaboration<[EB.Row, Q.Usages]> {
	return yield* match([source, prepared.core, prepared.value] as const)
		.with([Patterns.Rows.Empty, Patterns.Rows.Empty, Patterns.Rows.Empty], function* () {
			const ctx = yield* M.reader.ask();
			return [R.Constructors.Empty<EB.Term, EB.Variable>(), Q.noUsage(ctx.env.length)] satisfies [EB.Row, Q.Usages];
		})
		.with([Patterns.Rows.Extension, Patterns.Rows.Extension, Patterns.Rows.Extension], function* ([src, core, value]) {
			assert(src.label === core.label && core.label === value.label, "Prepared row labels must match the source row");

			const [term, , usages] = yield* EB.infer(src.value);
			const field = yield* NF.normalize(term);
			const ctx = yield* M.reader.ask();
			yield* M.constrain({ type: "assign", left: field, right: value.value, lvl: ctx.env.length });

			const [row, rest] = yield* annotate(src.row, { core: core.row, value: value.row });
			return [R.Constructors.Extension(src.label, term, row), Q.add(usages, rest)] satisfies [EB.Row, Q.Usages];
		})
		.with([Patterns.Rows.Variable, Patterns.Rows.Variable, Patterns.Rows.Variable], function* ([src, , value]) {
			const ctx = yield* M.reader.ask();
			const [term, type, usages] = yield* EB.lookup(src.variable, ctx);
			assert(term.type === "Var", "Dependent row tails must elaborate to variables");
			yield* M.constrain({ type: "assign", left: type, right: NF.Row, lvl: ctx.env.length });

			const tail = yield* NF.normalize(EB.Constructors.Row(R.Constructors.Variable(term.variable)));
			assert(tail.type === "Row", "Dependent row tails must normalize to rows");
			yield* M.constrain({ type: "assign", left: tail, right: NF.Constructors.Row(value), lvl: ctx.env.length });

			return [R.Constructors.Variable(term.variable), usages] satisfies [EB.Row, Q.Usages];
		})
		.otherwise(function* () {
			return yield* M.fail(Err.Impossible("Prepared annotation row diverged from its source row"));
		});
};

export const infer = function* (source: Source, prepared: Prepared): M.Elaboration<Inferred> {
	return yield* match([source, prepared.core, prepared.value] as const)
		.with([Patterns.Rows.Empty, Patterns.Rows.Empty, Patterns.Rows.Empty], function* () {
			const ctx = yield* M.reader.ask();
			return {
				term: R.Constructors.Empty<EB.Term, EB.Variable>(),
				type: R.Constructors.Empty<NF.Value, NF.Variable>(),
				usages: Q.noUsage(ctx.env.length),
			} satisfies Inferred;
		})
		.with([Patterns.Rows.Extension, Patterns.Rows.Extension, Patterns.Rows.Extension], function* ([src, core, value]) {
			assert(src.label === core.label && core.label === value.label, "Prepared row labels must match the source row");

			const [term, type, usages] = yield* EB.infer(src.value);
			const ctx = yield* M.reader.ask();
			yield* M.constrain({ type: "assign", left: type, right: value.value, lvl: ctx.env.length });

			const rest = yield* infer(src.row, { core: core.row, value: value.row });
			return {
				term: R.Constructors.Extension(src.label, term, rest.term),
				type: R.Constructors.Extension(src.label, type, rest.type),
				usages: Q.add(usages, rest.usages),
			};
		})
		.with([Patterns.Rows.Variable, Patterns.Rows.Variable, Patterns.Rows.Variable], function* ([src, , value]) {
			const ctx = yield* M.reader.ask();
			const [term, type, usages] = yield* EB.lookup(src.variable, ctx);
			assert(term.type === "Var", "Dependent row tails must elaborate to variables");

			yield* match(type)
				.with(NF.Patterns.Schema, function* ({ arg }) {
					yield* M.constrain({ type: "assign", left: arg, right: NF.Constructors.Row(value), lvl: ctx.env.length });
				})
				.with(NF.Patterns.Flex, function* () {
					yield* M.constrain({ type: "assign", left: type, right: NF.Constructors.Schema(value), lvl: ctx.env.length });
				})
				.otherwise(function* () {
					return yield* M.fail(Err.Impossible("Dependent value row tail must have a struct type"));
				});

			return { term: R.Constructors.Variable(term.variable), type: value, usages } satisfies Inferred;
		})
		.otherwise(function* () {
			return yield* M.fail(Err.Impossible("Prepared inference row diverged from its source row"));
		});
};

const checking = function* (source: Source, expected: NF.Row, prepared: Prepared, usages: Q.Usages): M.Elaboration<[EB.Row, Q.Usages]> {
	return yield* match([expected, source] as const)
		.with([Patterns.Rows.Empty, Patterns.Rows.Empty], () => M.of<[EB.Row, Q.Usages]>([R.Constructors.Empty<EB.Term, EB.Variable>(), usages]))
		.with([Patterns.Rows.Extension, Patterns.Rows.Extension], function* ([exp, src]) {
			const rewrittenSource = R.rewrite(src, exp.label);
			const rewrittenCore = R.rewrite(prepared.core, exp.label);
			const rewrittenValue = R.rewrite(prepared.value, exp.label);

			if (rewrittenSource._tag === "Left" || rewrittenCore._tag === "Left" || rewrittenValue._tag === "Left") {
				return yield* M.fail(Err.MissingLabel(exp.label, src));
			}

			assert(rewrittenSource.right.type === "extension", "Rewritten source row must begin with the requested label");
			assert(rewrittenCore.right.type === "extension", "Rewritten prepared Core row must begin with the requested label");
			assert(rewrittenValue.right.type === "extension", "Rewritten prepared value row must begin with the requested label");

			const field = rewrittenSource.right;
			const core = rewrittenCore.right;
			const placeholder = rewrittenValue.right;
			const [term, fieldUsages] = yield* EB.check(field.value, exp.value);
			const ctx = yield* M.reader.ask();
			yield* M.constrain({ type: "assign", left: exp.value, right: placeholder.value, lvl: ctx.env.length });

			const [row, rest] = yield* checking(field.row, exp.row, { core: core.row, value: placeholder.row }, usages);
			return [R.Constructors.Extension(exp.label, term, row), Q.add(fieldUsages, rest)] satisfies [EB.Row, Q.Usages];
		})
		.with([Patterns.Rows.Variable, Patterns.Rows.Empty], function* ([, src]) {
			const inferred = yield* infer(src, prepared);
			const ctx = yield* M.reader.ask();
			yield* M.constrain({ type: "assign", left: NF.Constructors.Row(inferred.type), right: NF.Constructors.Row(expected), lvl: ctx.env.length });
			return [inferred.term, Q.add(usages, inferred.usages)] satisfies [EB.Row, Q.Usages];
		})
		.with([Patterns.Rows.Variable, Patterns.Rows.Extension], function* ([, src]) {
			const inferred = yield* infer(src, prepared);
			const ctx = yield* M.reader.ask();
			yield* M.constrain({ type: "assign", left: NF.Constructors.Row(inferred.type), right: NF.Constructors.Row(expected), lvl: ctx.env.length });
			return [inferred.term, Q.add(usages, inferred.usages)] satisfies [EB.Row, Q.Usages];
		})
		.with([Patterns.Rows.Empty, Patterns.Rows.Variable], function* ([, src]) {
			const inferred = yield* infer(src, prepared);
			const ctx = yield* M.reader.ask();
			yield* M.constrain({ type: "assign", left: NF.Constructors.Row(inferred.type), right: NF.Constructors.Row(expected), lvl: ctx.env.length });
			return [inferred.term, Q.add(usages, inferred.usages)] satisfies [EB.Row, Q.Usages];
		})
		.with([Patterns.Rows.Extension, Patterns.Rows.Variable], ([exp, src]) => M.fail(Err.MissingLabel(exp.label, src)))
		.with([Patterns.Rows.Empty, Patterns.Rows.Extension], ([, src]) => M.fail(Err.MissingLabel(src.label, expected)))
		.otherwise(function* () {
			return yield* M.fail(Err.Impossible("Dependent checking row reached incompatible shapes"));
		});
};

export const check = function* (source: Source, expected: NF.Row, prepared: Prepared): M.Elaboration<[EB.Row, Q.Usages]> {
	const ctx = yield* M.reader.ask();
	return yield* checking(source, expected, prepared, Q.noUsage(ctx.env.length));
};
