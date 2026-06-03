import * as NF from "@yap/elaboration/normalization";
import * as R from "@yap/shared/rows";
import * as Lit from "@yap/shared/literals";
import { match } from "ts-pattern";
import type { JsonValue, JsonObject } from "type-fest";

import type { Payload } from "../graph";

export class BridgeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BridgeError";
	}
}

export const toJson = (nf: NF.Value): JsonValue =>
	match(nf)
		.with(NF.Patterns.Lit, ({ value }) =>
			match(value)
				.with({ type: "Num" }, ({ value: n }) => n)
				.with({ type: "Bool" }, ({ value: b }) => b)
				.with({ type: "String" }, ({ value: s }) => s)
				.with({ type: "Atom" }, ({ value: a }) => a)
				.with({ type: "unit" }, () => null)
				.exhaustive(),
		)
		.with(NF.Patterns.Row, ({ row }) => rowToJson(row))
		.with(NF.Patterns.Array, ({ arg: { row } }) => rowToArrayElements(row))
		.with(NF.Patterns.Schema, ({ arg: { row } }) => rowToJson(row))
		.otherwise(() => {
			throw new BridgeError(`Cannot convert NF.Value to JSON: unsupported type ${nf.type}`);
		});

const rowToJson = (row: NF.Row): JsonObject =>
	match(row)
		.with({ type: "extension" }, ({ label, value, row: rest }) => ({
			...rowToJson(rest),
			[label]: toJson(value),
		}))
		.with({ type: "empty" }, (): JsonObject => ({}))
		.otherwise(() => {
			throw new BridgeError("Cannot convert row to JSON: row is not concrete (contains variable)");
		});

const rowToArrayElements = (row: NF.Row): JsonValue[] =>
	match(row)
		.with({ type: "extension" }, ({ value, row: rest }) => [toJson(value), ...rowToArrayElements(rest)])
		.with({ type: "empty" }, (): JsonValue[] => [])
		.otherwise(() => {
			throw new BridgeError("Cannot convert array row to JSON: row is not concrete (contains variable)");
		});

export const toPayload = (nf: NF.Value): Payload => {
	const json = toJson(nf);
	return typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Payload) : { value: json };
};

export const fromJson = (json: JsonValue): NF.Value => {
	if (json === null) {
		return NF.Constructors.Lit(Lit.Unit());
	}

	if (typeof json === "number") {
		return NF.Constructors.Lit(Lit.Num(json));
	}

	if (typeof json === "boolean") {
		return NF.Constructors.Lit(Lit.Bool(json));
	}

	if (typeof json === "string") {
		return NF.Constructors.Lit(Lit.String(json));
	}

	if (Array.isArray(json)) {
		return arrayToNf(json);
	}
	return objectToNf(json as JsonObject);
};

const arrayToNf = (arr: JsonValue[]): NF.Value => {
	const row = arr.reduceRight<NF.Row>((acc, el, idx) => R.Constructors.Extension(String(idx), fromJson(el), acc), R.Constructors.Empty());
	return NF.Constructors.App(NF.Constructors.Lit(Lit.Atom("Array")), NF.Constructors.Row(row), "Explicit");
};

const objectToNf = (obj: JsonObject): NF.Value => {
	const row = Object.entries(obj).reduceRight<NF.Row>((acc, [key, val]) => R.Constructors.Extension(key, fromJson(val ?? null), acc), R.Constructors.Empty());
	return NF.Constructors.App(NF.Constructors.Lit(Lit.Atom("Schema")), NF.Constructors.Row(row), "Explicit");
};

export const fromPayload = (p: Payload): NF.Value => fromJson(p as JsonValue);
