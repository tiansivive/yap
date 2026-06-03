import * as NF from "@yap/elaboration/normalization";
import { match } from "ts-pattern";
import type { JsonObject } from "type-fest";

import type { Rule, Pattern, Constructor, Edge } from "./rule";
import type { Tag, Label } from "../vocabulary";

export class ReaderError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ReaderError";
	}
}

const getString = (nf: NF.Value, field: string): string =>
	match(nf)
		.with(NF.Patterns.Lit, ({ value }) =>
			match(value)
				.with({ type: "String" }, ({ value: s }) => s)
				.otherwise(() => {
					throw new ReaderError(`Expected String for ${field}, got ${value.type}`);
				}),
		)
		.otherwise(() => {
			throw new ReaderError(`Expected Lit for ${field}, got ${nf.type}`);
		});

const getField = (row: NF.Row, label: string): NF.Value =>
	match(row)
		.with({ type: "extension", label }, ({ value }) => value)
		.with({ type: "extension" }, ({ row: rest }) => getField(rest, label))
		.with({ type: "empty" }, () => {
			throw new ReaderError(`Missing field: ${label}`);
		})
		.otherwise(() => {
			throw new ReaderError(`Row contains variable, cannot extract field: ${label}`);
		});

const getRow = (nf: NF.Value, context: string): NF.Row =>
	match(nf)
		.with(NF.Patterns.Row, ({ row }) => row)
		.with(NF.Patterns.Schema, ({ arg: { row } }) => row)
		.otherwise(() => {
			throw new ReaderError(`Expected Row or Schema for ${context}, got ${nf.type}`);
		});

const getArray = (nf: NF.Value, context: string): NF.Value[] =>
	match(nf)
		.with(NF.Patterns.Array, ({ arg: { row } }) => rowToArray(row))
		.otherwise(() => {
			throw new ReaderError(`Expected Array for ${context}, got ${nf.type}`);
		});

const rowToArray = (row: NF.Row): NF.Value[] =>
	match(row)
		.with({ type: "extension" }, ({ value, row: rest }) => [value, ...rowToArray(rest)])
		.with({ type: "empty" }, () => [])
		.otherwise(() => {
			throw new ReaderError("Array row contains variable");
		});

const readPattern = (nf: NF.Value): Pattern => {
	const row = getRow(nf, "Pattern");
	const bind = getString(getField(row, "bind"), "Pattern.bind");
	const tag = getString(getField(row, "tag"), "Pattern.tag") as Tag;
	return { bind, tag };
};

const readConstructor = (nf: NF.Value): Constructor => {
	const row = getRow(nf, "Constructor");
	const bind = getString(getField(row, "bind"), "Constructor.bind");
	const tag = getString(getField(row, "tag"), "Constructor.tag") as Tag;
	const payloadStr = getString(getField(row, "payload"), "Constructor.payload");
	const payload = JSON.parse(payloadStr) as JsonObject;
	return { bind, tag, payload };
};

const readEdge = (nf: NF.Value): Edge => {
	const row = getRow(nf, "Edge");
	const source = getString(getField(row, "source"), "Edge.source");
	const label = getString(getField(row, "label"), "Edge.label") as Label;
	const target = getString(getField(row, "target"), "Edge.target");
	return { source, label, target };
};

const readLhs = (nf: NF.Value): Rule["lhs"] => {
	const row = getRow(nf, "lhs");
	const nodes = getArray(getField(row, "nodes"), "lhs.nodes").map(readPattern);
	const edges = getArray(getField(row, "edges"), "lhs.edges").map(readEdge);
	return { nodes, edges };
};

const readRhs = (nf: NF.Value): Rule["rhs"] => {
	const row = getRow(nf, "Constructor");
	const nodes = getArray(getField(row, "nodes"), "rhs.nodes").map(readConstructor);
	const edges = getArray(getField(row, "edges"), "rhs.edges").map(readEdge);
	return { nodes, edges };
};

export const read = (nf: NF.Value): Rule => {
	const row = getRow(nf, "Rule");
	const lhs = readLhs(getField(row, "lhs"));
	const rhs = readRhs(getField(row, "rhs"));
	return { lhs, rhs };
};
