import { match } from "ts-pattern";

export type Injection<T> = { type: "injection"; label: string; value: T; term: T };
export type Projection<T> = { type: "projection"; label: string; term: T };

export type Row<T, V> = { type: "empty" } | { type: "extension"; label: string; value: T; row: Row<T, V> } | { type: "variable"; variable: V };

export const display =
	<T, V>(pretty: { term: (term: T) => string; var: (variable: V) => string }) =>
	(row: Row<T, V>): string => {
		if (row.type === "empty") {
			return "[]";
		}

		const recurse = (r: Row<T, V>): string =>
			match(r)
				.with({ type: "empty" }, () => "")
				.with({ type: "extension" }, ({ label, value, row }) => {
					const v = pretty.term(value);

					if (row.type === "empty") {
						return `${label}: ${v}`;
					}

					if (row.type === "variable") {
						return `${label}: ${v} ${recurse(row)}`;
					}

					return `${label}: ${v}, ${recurse(row)}`;
				})
				.with({ type: "variable" }, ({ variable }) => `| ${pretty.var(variable)}`)
				.run();

		return `[ ${recurse(row)} ]`;
	};

export const Constructors = {
	Extension: <T, V>(label: string, value: T, row: Row<T, V>): Row<T, V> => ({ type: "extension", label, value, row }),
	Variable: <T, V>(variable: V): Row<T, V> => ({ type: "variable", variable }),
	Empty: <T, V>(): Row<T, V> => ({ type: "empty" }),
};

export const traverse = <T, V, A, B>(row: Row<T, V>, onVal: (value: T) => A, onVar: (v: V) => Row<A, B>): Row<A, B> =>
	match(row)
		.with({ type: "empty" }, (r): Row<A, B> => r)
		.with({ type: "extension" }, ({ label, value, row }) => Constructors.Extension(label, onVal(value), traverse(row, onVal, onVar)))
		.with({ type: "variable" }, ({ variable }) => onVar(variable))
		.exhaustive();
