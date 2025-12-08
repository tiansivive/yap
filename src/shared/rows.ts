import { match, P } from "ts-pattern";

import * as E from "fp-ts/lib/Either";

export type Injection<T> = { type: "injection"; label: string; value: T; term: T };
export type Projection<T> = { type: "projection"; label: string; term: T };

export type Row<T, V> = { type: "empty" } | { type: "extension"; label: string; value: T; row: Row<T, V> } | { type: "variable"; variable: V };
export type Extension<T, V> = Extract<Row<T, V>, { type: "extension" }>;

export const Constructors = {
	Extension: <T, V>(label: string, value: T, row: Row<T, V>): Extension<T, V> => ({ type: "extension", label, value, row }),
	Variable: <T, V>(variable: V): Row<T, V> => ({ type: "variable", variable }),
	Empty: <T, V>(): Row<T, V> => ({ type: "empty" }),
};

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

export const traverse = <T, V, A, B>(row: Row<T, V>, onVal: (value: T, label: string) => A, onVar: (v: V) => Row<A, B>): Row<A, B> =>
	match(row)
		.with({ type: "empty" }, (r): Row<A, B> => r)
		.with({ type: "extension" }, ({ label, value, row }) => Constructors.Extension(label, onVal(value, label), traverse(row, onVal, onVar)))
		.with({ type: "variable" }, ({ variable }) => onVar(variable))
		.exhaustive();

export const fold = <T, V, A>(row: Row<T, V>, onVal: (value: T, label: string, acc: A) => A, onVar: (v: V, acc: A) => A, acc: A): A => {
	const recurse = (r: Row<T, V>, acc: A): A =>
		match(r)
			.with({ type: "empty" }, () => acc)
			.with({ type: "extension" }, ({ label, value, row }) => recurse(row, onVal(value, label, acc)))
			.with({ type: "variable" }, ({ variable }) => onVar(variable, acc))
			.run();

	return recurse(row, acc);
};

export const append = <T, V>(left: Row<T, V>, right: Row<T, V>): Row<T, V> => {
	return match(left)
		.with({ type: "empty" }, () => right)
		.with({ type: "extension" }, ({ label, value, row }) => Constructors.Extension(label, value, append(row, right)))
		.with({ type: "variable" }, () => {
			throw new Error("Cannot append to a variable row");
		})
		.exhaustive();
};

// FIXME:TODO: Improve Error handling. Most likely need to parameterize `rewrite` over the error type.
type Err = { tag: "Mismatch"; label: string } | { tag: "ExpectedExtension" } | { tag: "Other"; message: string };

export const rewrite = <T, V>(r: Row<T, V>, label: string, onVar?: (v: V) => E.Either<Err, [T, V]>): E.Either<Err, Row<T, V>> => {
	return match(r)
		.with({ type: "empty" }, () => E.left({ tag: "Mismatch", label } satisfies Err))
		.with(
			{ type: "extension" },
			({ label: l }) => label === l,
			({ label: l, value, row }) => E.right(Constructors.Extension(l, value, row)),
		)
		.with({ type: "extension" }, ({ label: lbl, value: val, row }) =>
			E.Monad.chain(rewrite(row, label, onVar), res =>
				match(res)
					.with({ type: "extension" }, ({ label: l, value: v, row: r }) => E.right(Constructors.Extension(l, v, Constructors.Extension(lbl, val, r))))
					.otherwise(() => E.left({ tag: "ExpectedExtension" } satisfies Err)),
			),
		)
		.with({ type: "variable" }, r => {
			if (!onVar) {
				return E.right(r);
			}
			return E.Functor.map(onVar(r.variable), ([val, v]) => {
				const rvar = Constructors.Variable<T, V>(v);
				const rf = Constructors.Extension<T, V>(label, val, rvar);
				return rf;
			});
		})
		.exhaustive();
};
