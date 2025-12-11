import * as NF from "@yap/elaboration/normalization";
import { match, P } from "ts-pattern";

import * as Row from "@yap/shared/rows";

const unit = Symbol("unit");

export function encode(val: NF.Value): {} {
	const js = match(val)
		.with({ type: "Lit", value: P.select() }, value =>
			match(value)
				.with({ type: "Atom" }, atom => atom)
				.with({ type: "unit" }, () => unit)
				.otherwise(lit => lit.value),
		)
		.with(NF.Patterns.Struct, struct => {
			const obj = Row.fold(
				struct.arg.row,
				(val, lbl, acc) => ({ ...acc, [lbl]: encode(val) }),
				(_, acc) => acc,
				{},
			);
			return { tag: "Struct", payload: obj };
		})
		.with(NF.Patterns.Modal, modal => encode(modal.value))
		.with({ type: "Abs" }, abs => ({ tag: "Function", param: abs.binder.variable, body: "<function>" }))
		.otherwise(nf => {
			return { tag: "Unsupported", nf };
		});

	return js;
}

export function decode(js: any): NF.Value {
	if (js === unit) {
		return NF.Constructors.Lit({ type: "unit" });
	}

	if (typeof js === "number") {
		return NF.Constructors.Lit({ type: "Num", value: js });
	}

	if (typeof js === "string") {
		return NF.Constructors.Lit({ type: "String", value: js });
	}

	if (typeof js === "boolean") {
		return NF.Constructors.Lit({ type: "Bool", value: js });
	}

	if (typeof js === "object" && js.tag === "Struct") {
		const row = Object.entries(js.payload).reduce<NF.Row>((acc, [lbl, val]) => Row.Constructors.Extension(lbl, decode(val), acc), Row.Constructors.Empty());
		return Array.isArray(js.payload) ? NF.Constructors.Array(row) : NF.Constructors.Struct(row);
	}

	if (typeof js === "object" && js.tag === "Unsupported") {
		return js.nf as NF.Value;
	}

	if (js === undefined) {
		return NF.Constructors.Lit({ type: "unit" });
	}

	throw new Error(`Cannot decode value: ${JSON.stringify(js)}`);
}
