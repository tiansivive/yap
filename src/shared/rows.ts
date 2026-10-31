import assert from "node:assert";

import { P } from "ts-pattern";

import * as E from "fp-ts/lib/Either";

import * as PP from "@yap/shared/pretty";

export type Injection<T> = { type: "injection"; label: string; value: T; term: T };
export type Projection<T> = { type: "projection"; label: string; term: T };

export type Entry<T> = { label: string; value: T };

/** `X` adds fields to every entry, such as the source location of a field. */
export type Row<T, V, X = unknown> = { entries: ReadonlyArray<Entry<T> & X>; tail?: V };

/* A closed row has no tail key at all, so rows compare equal however they were built. */
const make = <T, V, X>(entries: ReadonlyArray<Entry<T> & X>, tail: V | undefined): Row<T, V, X> => (tail === undefined ? { entries } : { entries, tail });

export const Constructors = {
	Empty: <T, V, X = unknown>(): Row<T, V, X> => ({ entries: [] }),
	Variable: <T, V, X = unknown>(tail: V): Row<T, V, X> => ({ entries: [], tail }),
	Extension: <T, V>(label: string, value: T, row: Row<T, V>): Row<T, V> => {
		assert(!row.entries.some(entry => entry.label === label), `Row labels are unique, but "${label}" is already present`);
		return make([{ label, value }, ...row.entries], row.tail);
	},
	Row: <T, V, X = unknown>(entries: ReadonlyArray<Entry<T> & X>, tail?: V): Row<T, V, X> => {
		assert(new Set(entries.map(({ label }) => label)).size === entries.length, "Row labels are unique");
		return make(entries, tail);
	},
};

export const Patterns = {
	NonEmpty: { entries: [P._, ...P.array(P._)] },
	Empty: { entries: [], tail: P.optional(P.nullish) },
	/** A row with no entries, only a tail variable. */
	Tail: { entries: [], tail: P.nonNullable },
} as const;

export const display =
	<T, V>(pretty: { term: (term: T) => string; var: (variable: V) => string }) =>
	(row: Row<T, V>): string => {
		const fields = row.entries.map(({ label, value }) => `${label}: ${pretty.term(value)}`).join(", ");
		const parts = [fields, ...(row.tail === undefined ? [] : [`| ${pretty.var(row.tail)}`])].filter(part => part !== "");

		return parts.length === 0 ? "[]" : `[ ${parts.join(" ")} ]`;
	};

export const displayDoc =
	<T, V>(pretty: { term: (term: T) => PP.Doc; var: (variable: V) => PP.Doc }) =>
	(row: Row<T, V>): PP.Doc =>
		row.entries.length === 0 && row.tail === undefined
			? "[]"
			: PP.row(
					row.entries.map(({ label, value }) => [label, ": ", pretty.term(value)]),
					row.tail === undefined ? undefined : ["| ", pretty.var(row.tail)],
				);

export const traverse = <T, V, A, B>(row: Row<T, V>, onVal: (value: T, label: string) => A, onVar: (v: V) => Row<A, B>): Row<A, B> => {
	const fields = Constructors.Row<A, B>(row.entries.map(({ label, value }) => ({ label, value: onVal(value, label) })));
	return row.tail === undefined ? fields : append(fields, onVar(row.tail));
};

export const fold = <T, V, A>(row: Row<T, V>, onVal: (value: T, label: string, acc: A) => A, onVar: (v: V, acc: A) => A, acc: A): A => {
	const fields = row.entries.reduce((acc, { label, value }) => onVal(value, label, acc), acc);
	return row.tail === undefined ? fields : onVar(row.tail, fields);
};

export const append = <T, V>(left: Row<T, V>, right: Row<T, V>): Row<T, V> => {
	assert(left.tail === undefined, "Cannot append to a row with a tail");
	return Constructors.Row([...left.entries, ...right.entries], right.tail);
};

/** Leijen's rewrite: the field under `label`, and the row without it. */
export const rewrite = <T, V, X = unknown>(row: Row<T, V, X>, label: string): E.Either<{ tag: "Missing"; label: string }, { value: T; rest: Row<T, V, X> }> => {
	const index = row.entries.findIndex(entry => entry.label === label);

	return index < 0 ? E.left({ tag: "Missing", label }) : E.right({ value: row.entries[index].value, rest: make(row.entries.toSpliced(index, 1), row.tail) });
};

export const lookup = <T, V>(row: Row<T, V>, label: string): T | undefined => row.entries.find(entry => entry.label === label)?.value;
