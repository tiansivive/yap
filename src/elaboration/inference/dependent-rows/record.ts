import { match, P } from "ts-pattern";

import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as M from "@yap/elaboration/shared/effects";
import * as Err from "@yap/elaboration/shared/errors";
import * as Src from "@yap/src/index";
import * as Q from "@yap/shared/modalities/multiplicity";
import * as R from "@yap/shared/rows";
import * as E from "fp-ts/lib/Either";

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

	return yield* match(expected)
		.with(R.Patterns.NonEmpty, ({ entries: [{ label, value: type }, ...remaining] }) =>
			E.match(
				(): M.Elaboration<Inferred> => M.fail(Err.MissingLabel(label, source)),
				function* (field: { value: Src.Term; rest: Source }): M.Elaboration<Inferred> {
					const [[term, usages], references, rest] = yield* scoped(
						label,
						function* () {
							return [yield* EB.check(field.value, type), type] as const;
						},
						() => check(field.rest, R.Constructors.Row(remaining, expected.tail)),
					);

					return {
						term: R.Constructors.Extension(label, term, rest.term),
						type: R.Constructors.Extension(label, type, rest.type),
						usages: Q.add(usages, rest.usages),
						references: { [label]: references, ...rest.references },
					};
				},
			)(R.rewrite(source, label)),
		)
		.with({ tail: P.nonNullable }, function* () {
			const inferred = yield* infer(source);
			yield* M.constrain({ type: "assign", left: NF.Constructors.Row(inferred.type), right: NF.Constructors.Row(expected), lvl: ctx.env.length });

			return inferred;
		})
		.otherwise(() =>
			match(source)
				.with(R.Patterns.NonEmpty, ({ entries: [{ label }] }) => M.fail(Err.MissingLabel(label, expected)))
				.with({ tail: P.nonNullable }, () => M.fail(Err.Impossible("Dependent value row cannot have a tail variable")))
				.otherwise(() => M.of(empty(ctx.env.length))),
		);
};

export const infer = function* (source: Source): M.Elaboration<Inferred> {
	return yield* match(source)
		.with(R.Patterns.NonEmpty, function* ({ entries: [{ label, value }, ...remaining] }) {
			const [[term, type, usages], references, rest] = yield* scoped(
				label,
				function* () {
					const ast = yield* EB.infer(value);
					return [ast, ast[1]] as const;
				},
				() => infer(R.Constructors.Row(remaining, source.tail)),
			);

			return {
				term: R.Constructors.Extension(label, term, rest.term),
				type: R.Constructors.Extension(label, type, rest.type),
				usages: Q.add(usages, rest.usages),
				references: { [label]: references, ...rest.references },
			} satisfies Inferred;
		})
		.with({ tail: P.nonNullable }, () => M.fail(Err.Impossible("Dependent value row cannot have a tail variable")))
		.otherwise(function* () {
			const ctx = yield* M.reader.ask();
			return empty(ctx.env.length);
		});
};

const empty = (lvl: number): Inferred => ({
	term: R.Constructors.Empty<EB.Term, EB.Variable>(),
	type: R.Constructors.Empty<NF.Value, NF.Variable>(),
	usages: Q.noUsage(lvl),
	references: {},
});

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
