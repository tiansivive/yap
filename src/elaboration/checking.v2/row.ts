import { match, P } from "ts-pattern";

import * as CST from "@yap/cst";
import * as EB from "@yap/elaboration";
import * as Err from "@yap/elaboration/shared/errors";
import * as M from "@yap/monad";
import * as NF from "@yap/normalization";
import * as R from "@yap/shared/rows";

import * as E from "fp-ts/lib/Either";
import { entries, set, setProp } from "@yap/utils";
import assert from "node:assert";

import * as tmp from "./tmp";

type Field = CST.Types.KeyValueNode;
type Identifier = CST.Types.IdentifierNode;
type Pair = [string, CST.Types.SyntaxNode];
type RowNode = R.Row<CST.Types.SyntaxNode, Identifier>;
type Bindings = Record<string, EB.Sigma>;

type Collected = {
	fields: Array<{ label: string; term: EB.Term; value: NF.Value }>;
	tail?: Identifier;
};

const toPairs = (fields: CST.Types.SyntaxNode[]): Pair[] => {
	return fields.map(field => {
		if (field.type !== "key_value") {
			throw new Error("Expected key-value fields");
		}
		const { key, value } = CST.Utils.extractFields(field, "key", "value");
		return [key.text, value];
	});
};

const toRow = (pairs: Pair[], tail?: Identifier): RowNode => {
	const base: RowNode = tail ? R.Constructors.Variable(tail) : R.Constructors.Empty();
	return pairs.reduceRight<RowNode>((row, [label, value]) => R.Constructors.Extension(label, value, row), base);
};

export const extractBindings = function* (pairs: Pair[], tail?: Identifier): M.Gelaboration<Bindings> {
	if (tail) {
		return {};
	}

	if (pairs.length === 0) {
		return {};
	}

	const ctx = yield* M.ask();
	const lvl = ctx.env.length;

	const ktm = NF.Constructors.Flex(yield* EB.freshMeta(lvl, NF.Type));
	const tm = NF.Constructors.Flex(yield* EB.freshMeta(lvl, ktm));
	const ty = NF.Constructors.Flex(yield* EB.freshMeta(lvl, NF.Type));

	const [[label], ...rest] = pairs;
	const sigma: EB.Sigma = { term: NF.quote(ctx, ctx.env.length, tm), nf: tm, ann: ty };

	const result = yield* extractBindings(rest, tail);
	return setProp(result, label, sigma);
};

const inSigmaContext = function* <A>(pairs: Pair[], tail: Identifier | undefined, isAnnotation: boolean, action: () => M.Gelaboration<A>): M.Gelaboration<A> {
	const bindings = yield* extractBindings(pairs, tail);
	return yield* M.local(ctx => entries(bindings).reduce((ctx, [label, sig]) => EB.extendSigma(ctx, label, sig, isAnnotation), ctx), M.Do(action));
};

export const check = function* (fields: CST.Types.SyntaxNode[], tail: Identifier | undefined, ty: NF.Value, _lvl: number): M.Gelaboration<EB.Row> {
	const pairs = toPairs(fields);
	const isAnnotation = match(ty)
		.with(NF.Patterns.Type, () => true)
		.otherwise(() => false);

	return yield* inSigmaContext(pairs, tail, isAnnotation, function* () {
		const row = toRow(pairs, tail);
		const result: M.Elaboration<EB.Row> = R.fold<CST.Types.SyntaxNode, Identifier, M.Elaboration<EB.Row>>(
			row,
			(val, label, acc) =>
				M.Do(function* () {
					const tm = yield* tmp.check(val, ty);
					const r: EB.Row = yield* M.pure(acc);
					return R.Constructors.Extension(label, tm, r) satisfies EB.Row;
				}),
			(v, acc) =>
				M.Do(function* () {
					const ctx = yield* M.ask();
					const [tm, vty] = yield* EB.lookup.gen({ type: "name", value: v.text }, ctx);
					assert(tm.type === "Var", "Expected row variable in struct value check");
					yield* M.tell("constraint", { type: "assign", left: vty, right: NF.Row, lvl: ctx.env.length });

					const r: EB.Row = yield* M.pure(acc);
					const rvar: EB.Row = R.Constructors.Variable(tm.variable);
					return R.append(r, rvar) satisfies EB.Row;
				}),
			M.of<EB.Row>(R.Constructors.Empty()),
		);

		return yield* M.pure(result);
	});
};

const collectRow = function* (row: RowNode): M.Gelaboration<Collected> {
	const initial: Collected = { fields: [] };

	const collected: M.Elaboration<Collected> = R.fold<CST.Types.SyntaxNode, Identifier, M.Elaboration<Collected>>(
		row,
		(val, label, acc) =>
			M.Do(function* () {
				const ctx = yield* M.ask();
				const [tm, ty] = yield* tmp.infer(val);
				const sigma = ctx.sigma[label];
				if (!sigma) {
					throw new Error("Elaborating Row Extension: Label not found");
				}

				yield* M.tell("constraint", [{ type: "assign", left: ty, right: sigma.nf }]);

				const accumulated: Collected = yield* M.pure(acc);
				return { fields: [...accumulated.fields, { label, term: tm, value: ty }], tail: accumulated.tail } satisfies Collected;
			}),
		(v, acc) =>
			M.Do(function* () {
				const accumulated: Collected = yield* M.pure(acc);
				return { fields: accumulated.fields, tail: v } satisfies Collected;
			}),
		M.of(initial),
	);

	return yield* M.pure(collected);
};

const traverseRow = function* (row: RowNode, expected: NF.Row, bindings: Bindings): M.Gelaboration<EB.Row> {
	const branch: M.Gelaboration<EB.Row> = match<[NF.Row, RowNode]>([expected, row])
		.with(
			[{ type: "empty" }, { type: "empty" }],
			(): M.Gelaboration<EB.Row> =>
				(function* () {
					yield* M.lift(R.Constructors.Empty());
					return R.Constructors.Empty();
				})(),
		)
		.with(
			[{ type: "extension" }, { type: "empty" }],
			([{ label }, r]): M.Gelaboration<EB.Row> =>
				(function* () {
					return yield* M.fail<EB.Row>(Err.MissingLabel(label, r));
				})(),
		)

		.with([{ type: "extension" }, { type: "extension" }], ([{ label, value, row }, r]): M.Gelaboration<EB.Row> => {
			const rewritten = R.rewrite(r, label);
			if (E.isLeft(rewritten)) {
				return (function* () {
					return yield* M.fail<EB.Row>(Err.MissingLabel(label, r));
				})();
			}

			if (rewritten.right.type !== "extension") {
				return (function* () {
					return yield* M.fail<EB.Row>(Err.Impossible("Rewriting a row extension should result in another row extension"));
				})();
			}

			const { value: rv, row: rr } = rewritten.right;

			return (function* () {
				return yield* M.local(
					ctx => set(ctx, `sigma.${label}.ann`, value),
					M.Do(function* () {
						const tm = yield* tmp.check(rv, value);
						const sigma = bindings[label];
						if (!sigma) {
							throw new Error("Elaborating Row Extension: Label not found");
						}
						const ctx = yield* M.ask();
						const nf = NF.evaluate(ctx, tm);
						yield* M.tell("constraint", { type: "assign", left: nf, right: sigma.nf, lvl: ctx.env.length });

						const rt = yield* traverseRow(rr as RowNode, row, bindings);
						return EB.Constructors.Extension(label, tm, rt) satisfies EB.Row;
					}),
				);
			})();
		})
		.with(
			[P._, { type: "variable" }],
			(): M.Gelaboration<EB.Row> =>
				(function* () {
					return yield* M.fail<EB.Row>(Err.Impossible("Cannot have row var in a struct value"));
				})(),
		)
		.with(
			[{ type: "variable" }, { type: "empty" }],
			([v]): M.Gelaboration<EB.Row> =>
				(function* () {
					const ctx = yield* M.ask();
					yield* M.tell("constraint", { type: "assign", left: NF.Constructors.Row({ type: "empty" }), right: NF.Constructors.Row(v), lvl: ctx.env.length });
					return R.Constructors.Empty() satisfies EB.Row;
				})(),
		)
		.with(
			[{ type: "variable" }, { type: "extension" }],
			([v, r]): M.Gelaboration<EB.Row> =>
				(function* () {
					const collected = yield* collectRow(r);
					if (collected.tail) {
						throw new Error("Cannot have row variables in struct values");
					}

					const inferred = collected.fields.reduce<{ tm: EB.Row; ty: NF.Row }>(
						(acc, { label, value, term }) => ({
							tm: EB.Constructors.Extension(label, term, acc.tm),
							ty: NF.Constructors.Extension(label, value, acc.ty),
						}),
						{ tm: R.Constructors.Empty(), ty: { type: "empty" } },
					);

					const ctx = yield* M.ask();
					yield* M.tell("constraint", { type: "assign", left: NF.Constructors.Row(inferred.ty), right: NF.Constructors.Row(v), lvl: ctx.env.length });
					return inferred.tm;
				})(),
		)
		.with(
			[P._, { type: "extension" }],
			([r, { label }]): M.Gelaboration<EB.Row> =>
				(function* () {
					return yield* M.fail<EB.Row>(Err.MissingLabel(label, r));
				})(),
		)
		.otherwise((): M.Gelaboration<EB.Row> => {
			throw new Error("Unknown row action");
		});

	return yield* branch;
};

export const traverse = function* (fields: Field[], tail: Identifier | undefined, expected: NF.Row, bindings: Bindings): M.Gelaboration<EB.Row> {
	const pairs = toPairs(fields);
	const row = toRow(pairs, tail);
	return yield* traverseRow(row, expected, bindings);
};
