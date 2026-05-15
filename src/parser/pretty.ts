import { match } from "ts-pattern";

import * as Lit from "@yap/shared/literals";
import * as Icit from "@yap/shared/implicitness";
import * as PP from "@yap/shared/pretty";

import * as Src from "@yap/src/index";
import * as R from "@yap/shared/rows";

import * as Q from "@yap/shared/modalities/multiplicity";

const doc = (term: Src.Term): PP.Doc =>
	match(term)
		.with({ type: "lit" }, ({ value }) => Lit.display(value))
		.with({ type: "var" }, ({ variable }) => variable.value)
		.with({ type: "hole" }, () => "?")
		.with({ type: "arrow" }, ({ lhs, rhs, icit }) => PP.binder([Icit.display(icit), doc(lhs)], arr(icit), doc(rhs)))
		.with({ type: "lambda" }, ({ icit, variable, annotation, body }) => {
			const ann = annotation ? [": ", doc(annotation)] : "";
			return PP.binder(["λ(", variable, ann, ")"], arr(icit), doc(body));
		})
		.with({ type: "pi" }, ({ icit, variable, annotation, body }) => PP.binder(["Π(", variable, ": ", doc(annotation), ")"], arr(icit), doc(body)))
		.with({ type: "application" }, ({ icit, fn, arg }) => {
			const needsFnParens = fn.type !== "var" && fn.type !== "lit" && fn.type !== "application";
			const needsArgParens =
				arg.type === "lambda" || arg.type === "pi" || arg.type === "arrow" || arg.type === "annotation" || arg.type === "application" || arg.type === "match";
			return PP.app(PP.parensIf(needsFnParens, doc(fn)), Icit.display(icit), PP.parensIf(needsArgParens, doc(arg)));
		})
		.with({ type: "annotation" }, ({ term: tm, ann }) => PP.enclose(PP.parens, PP.group([doc(tm), " :", PP.nest(2, [PP.line, doc(ann)])])))
		.with({ type: "row" }, ({ row }) => R.displayDoc({ term: doc, var: (v: Src.Variable) => v.value })(row))
		.with({ type: "tuple" }, ({ row }) => ["tuple ", R.displayDoc({ term: doc, var: (v: Src.Variable) => v.value })(row)])
		.with({ type: "struct" }, ({ row }) => ["struct ", R.displayDoc({ term: doc, var: (v: Src.Variable) => v.value })(row)])
		.with({ type: "variant" }, ({ row }) => ["variant ", R.displayDoc({ term: doc, var: (v: Src.Variable) => v.value })(row)])
		.with({ type: "tagged" }, ({ tag, term: tm }) => PP.group(["(tagged ", tag, ":", PP.nest(2, [PP.line, doc(tm)]), ")"]))
		.with({ type: "list" }, ({ elements }) => PP.list(elements.map(doc)))
		.with({ type: "projection" }, ({ term: tm, label }) => ["(", doc(tm), ").", label])
		.with({ type: "injection" }, ({ label, value, term: tm }) => PP.group(["{ ", doc(tm), " | ", label, " =", PP.nest(2, [PP.line, doc(value)]), " }"]))
		.with({ type: "match" }, ({ scrutinee, alternatives }) =>
			PP.matchDoc(
				doc(scrutinee),
				alternatives.map(a => PP.alt(Pat.doc(a.pattern), doc(a.term))),
			),
		)
		.with({ type: "block" }, ({ statements, return: ret }) => PP.block(statements.map(Stmt.doc), ret ? doc(ret) : ""))
		.with({ type: "modal" }, ({ term: tm, modalities }) => {
			const q = modalities.quantity ? [Q.display(modalities.quantity), " "] : "";
			const l = modalities.liquid ? [" [| ", doc(modalities.liquid), " |]"] : "";
			return [q, doc(tm), l];
		})
		.otherwise(tm => `Display Term ${tm.type}: Not implemented`);

const arr = (icit: string) => (icit === "Implicit" ? "=>" : "->");

export const display = (term: Src.Term): string => PP.render(doc(term));

export const Alt = {
	display: (a: Src.Alternative): string => PP.render(PP.alt(Pat.doc(a.pattern), doc(a.term))),
};

export const Pat = {
	doc: (pat: Src.Pattern): PP.Doc =>
		match(pat)
			.with({ type: "lit" }, ({ value }) => Lit.display(value))
			.with({ type: "var" }, ({ value }) => value.value)
			.with({ type: "row" }, ({ row }) => R.displayDoc({ term: Pat.doc, var: (v: Src.Variable) => v.value })(row))
			.with({ type: "struct" }, ({ row }) => ["Struct ", R.displayDoc({ term: Pat.doc, var: (v: Src.Variable) => v.value })(row)])
			.with({ type: "variant" }, ({ row }) => ["Variant ", R.displayDoc({ term: Pat.doc, var: (v: Src.Variable) => v.value })(row)])
			.with({ type: "tuple" }, ({ row }) => ["Tuple ", R.displayDoc({ term: Pat.doc, var: (v: Src.Variable) => v.value })(row)])
			.with({ type: "list" }, ({ elements, rest }) => {
				const r = rest ? [" | ", rest.value] : "";
				return PP.list([...elements.map(Pat.doc), r]);
			})
			.otherwise(() => "Pattern Display: Not implemented"),
	display: (pat: Src.Pattern): string => PP.render(Pat.doc(pat)),
};

export const Stmt = {
	doc: (stmt: Src.Statement): PP.Doc =>
		match(stmt)
			.with({ type: "expression" }, ({ value }) => doc(value))
			.with({ type: "let" }, ({ variable, annotation, value, multiplicity }) => {
				const mul = multiplicity ? `${multiplicity} ` : "";
				return PP.letBinding(`${mul}${variable}`, annotation ? doc(annotation) : null, doc(value));
			})
			.otherwise(() => "Statement Display: Not implemented"),
	display: (stmt: Src.Statement): string => PP.render(Stmt.doc(stmt)),
};
