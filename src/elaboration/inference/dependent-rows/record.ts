import { match } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as Err from "@yap/elaboration/shared/errors";
import * as Src from "@yap/src/index";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as R from "@yap/shared/rows";
import * as E from "fp-ts/lib/Either";

import assert from "node:assert";

import { Patterns } from "./patterns";

export type Source = R.Row<Src.Term, Src.Variable>;

export type References = Record<string, readonly EB.Reference[]>;

export type Inferred = {
	term: EB.Row;
	type: NF.Row;
	usages: Q.Usages;
	references: References;
};

export const check = function* (source: Source, expected: NF.Row): M.Elaboration<Inferred> {
	const ctx = yield* M.reader.ask();

	return yield* match([expected, source] as const)
		.with([Patterns.Rows.Empty, Patterns.Rows.Empty], () =>
			M.of<Inferred>({
				term: R.Constructors.Empty<EB.Term, EB.Variable>(),
				type: R.Constructors.Empty<NF.Value, NF.Variable>(),
				usages: Q.noUsage(ctx.env.length),
				references: {},
			}),
		)
		.with([Patterns.Rows.Extension, Patterns.Rows.Extension], ([exp, src]) =>
			E.match(
				(): M.Elaboration<Inferred> => M.fail(Err.MissingLabel(exp.label, src)),
				function* (field: Source): M.Elaboration<Inferred> {
					assert(field.type === "extension", "A rewritten row begins with the requested label");

					const [[term, usages], references, rest] = yield* scoped(
						exp.label,
						function* () {
							return [yield* EB.check(field.value, exp.value), exp.value] as const;
						},
						() => check(field.row, exp.row),
					);

					return {
						term: R.Constructors.Extension(exp.label, term, rest.term),
						type: R.Constructors.Extension(exp.label, exp.value, rest.type),
						usages: Q.add(usages, rest.usages),
						references: { [exp.label]: references, ...rest.references },
					};
				},
			)(R.rewrite(src, exp.label)),
		)
		.with([Patterns.Rows.Variable, Patterns.Rows.Empty], [Patterns.Rows.Variable, Patterns.Rows.Extension], function* ([, src]) {
			const inferred = yield* infer(src);
			yield* M.constrain({ type: "assign", left: NF.Constructors.Row(inferred.type), right: NF.Constructors.Row(expected), lvl: ctx.env.length });

			return inferred;
		})
		.with([Patterns.Rows.Empty, Patterns.Rows.Variable], () => M.fail(Err.Impossible("Dependent value row cannot have a tail variable")))
		.with([Patterns.Rows.Extension, Patterns.Rows.Variable], ([exp, src]) => M.fail(Err.MissingLabel(exp.label, src)))
		.with([Patterns.Rows.Empty, Patterns.Rows.Extension], ([, src]) => M.fail(Err.MissingLabel(src.label, expected)))
		.otherwise(() => M.fail(Err.Impossible("Dependent checking row reached incompatible shapes")));
};

export const infer = function* (source: Source): M.Elaboration<Inferred> {
	return yield* match(source)
		.with(Patterns.Rows.Extension, function* (src) {
			const [[term, type, usages], references, rest] = yield* scoped(
				src.label,
				function* () {
					const ast = yield* EB.infer(src.value);
					return [ast, ast[1]] as const;
				},
				() => infer(src.row),
			);

			return {
				term: R.Constructors.Extension(src.label, term, rest.term),
				type: R.Constructors.Extension(src.label, type, rest.type),
				usages: Q.add(usages, rest.usages),
				references: { [src.label]: references, ...rest.references },
			} satisfies Inferred;
		})
		.with(Patterns.Rows.Variable, () => M.fail(Err.Impossible("Dependent value row cannot have a tail variable")))
		.with(Patterns.Rows.Empty, function* () {
			const ctx = yield* M.reader.ask();

			return {
				term: R.Constructors.Empty<EB.Term, EB.Variable>(),
				type: R.Constructors.Empty<NF.Value, NF.Variable>(),
				usages: Q.noUsage(ctx.env.length),
				references: {},
			} satisfies Inferred;
		})
		.exhaustive();
};

const scoped = function* <A extends readonly [EB.Term, ...unknown[]], B>(
	label: string,
	elaborate: () => M.Elaboration<readonly [A, NF.Value]>,
	rest: () => M.Elaboration<B>,
) {
	const ctx = yield* M.reader.ask();
	const [[elaborated, type], references] = yield* M.windows.within<EB.Reference>()({ scope: "local", lvl: ctx.local.length - 1 }, elaborate);
	const [frame, ...outer] = ctx.local;
	const done = {
		...frame,
		terms: R.Constructors.Extension(label, elaborated[0], frame.terms),
		types: R.Constructors.Extension(label, type, frame.types ?? R.Constructors.Empty<NF.Value, NF.Variable>()),
	};
	const remaining = yield* M.reader.local(c => ({ ...c, local: [done, ...outer] }), rest());

	return [elaborated, references, remaining] as const;
};
