import * as EB from "@yap/elaboration";
import * as M from "@yap/elaboration/shared/effects";

import * as NF from "@yap/elaboration/normalization";
import * as Src from "@yap/src/index";

import * as R from "@yap/shared/rows";
import * as Q from "@yap/shared/modalities/multiplicity";
import { match } from "ts-pattern";
import * as DependentRows from "./dependent-rows";

type Struct = Extract<Src.Term, { type: "struct" }>;
type Field = { label: string; term: EB.Term; value: NF.Value };

export const infer = (node: Struct): M.Elaboration<EB.AST> =>
	M.tracer.track({ tag: "src", type: "term", term: node, metadata: { action: "infer", description: "Struct" } }, () =>
		closed(node.row) ? struct(node.row) : open(node.row),
	);

export const struct = function* (row: Src.Row): M.Elaboration<EB.AST> {
	const [binder, inferred] = yield* DependentRows.nu(row, () => DependentRows.infer(row));
	return [EB.Constructors.Nu(binder, EB.Constructors.Struct(inferred.term)), NF.Constructors.Schema(inferred.type), inferred.usages] satisfies EB.AST;
};

const open = function* (row: Src.Row): M.Elaboration<EB.AST> {
	const ctx = yield* M.reader.ask();
	const { fields, tail } = yield* EB.Rows.withLabelContext(row, EB.Rows.collect(row));
	if (!tail) {
		throw new Error("Closed struct row should have used dependent Nu inference");
	}

	const [tm, ty] = yield* match(tail.ty)
		.with({ type: "Lit", value: { type: "Atom", value: "Row" } }, () => openSchema(fields, tail.variable))
		.with(NF.Patterns.Schema, s => mergeSchema(fields, tail.variable, s.arg.row))
		.with(NF.Patterns.Flex, meta => ambiguousTail(fields, tail.variable, meta))
		.otherwise(() => {
			throw new Error("Elaborating Struct: Tail type is neither Schema, Row nor Flex");
		});

	return [tm, ty, Q.noUsage(ctx.env.length)] satisfies EB.AST;
};

const openSchema = (fields: Field[], variable: EB.Variable): M.Elaboration<readonly [EB.Term, NF.Value]> => {
	const row = fields.reduceRight<EB.Row>((r, { label, term }) => R.Constructors.Extension(label, term, r), R.Constructors.Variable(variable));
	return M.of([EB.Constructors.Schema(row), NF.Type] as const);
};

const mergeSchema = (fields: Field[], variable: EB.Variable, row: NF.Row): M.Elaboration<readonly [EB.Term, NF.Value]> => {
	const [term, type] = rows(fields, [R.Constructors.Variable(variable), row]);
	return M.of([EB.Constructors.Struct(term), NF.Constructors.Schema(type)] as const);
};

/**
 * If tail is a meta variable, we cannot be sure if it's a struct or a schema.
 * We default to struct, and emit a constraint equating the meta to a schema over a fresh meta of type Row.
 * This fresh meta will end up generalized, therefore quantifying this term over some polymorphic row type.
 * Therefore the type is the inferred row + the fresh meta of type Row
 */
const ambiguousTail = function* (fields: Field[], variable: EB.Variable, meta: NF.Value): M.Elaboration<readonly [EB.Term, NF.Value]> {
	const ctx = yield* M.reader.ask();
	const freshRowMeta = yield* EB.freshMeta(ctx.env.length, NF.Row);
	const schemaTy = NF.Constructors.Schema(R.Constructors.Variable(freshRowMeta));
	yield* M.constrain({ type: "assign", left: meta, right: schemaTy, lvl: ctx.env.length });

	const [term, type] = rows(fields, [R.Constructors.Variable(variable), R.Constructors.Variable(freshRowMeta)]);
	return [EB.Constructors.Struct(term), NF.Constructors.Schema(type)] as const;
};

const rows = (fields: Field[], start: [EB.Row, NF.Row]): [EB.Row, NF.Row] =>
	fields.reduceRight<[EB.Row, NF.Row]>(
		([term, type], { label, term: field, value }) => [R.Constructors.Extension(label, field, term), R.Constructors.Extension(label, value, type)],
		start,
	);

const closed = (row: R.Row<Src.Term, Src.Variable>): boolean =>
	R.fold(
		row,
		(_value, _label, rest) => rest,
		() => false,
		true,
	);
