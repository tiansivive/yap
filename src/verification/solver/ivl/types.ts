export namespace IVL {
	export type Sort =
		| { tag: "Bool" }
		| { tag: "Int" }
		| { tag: "Real" }
		| { tag: "String" }
		| { tag: "Unit" }
		| { tag: "Row" }
		| { tag: "Fn"; args: Sort[]; ret: Sort }
		| { tag: "Uninterpreted"; name: string };

	export type RowTerm = { tag: "Empty" } | { tag: "Extend"; label: string; value: Term; rest: RowTerm } | { tag: "Var"; name: string };

	export type Term =
		| { tag: "Var"; name: string; sort: Sort }
		| { tag: "Const"; name: string; sort: Sort }
		| { tag: "Num"; value: string; sort: NumSort }
		| { tag: "Bool"; value: boolean }
		| { tag: "Str"; value: string }
		| { tag: "Arith"; op: ArithOp; args: [Term, Term]; sort: NumSort }
		| { tag: "App"; head: string; args: Term[]; sort: Sort }
		| { tag: "Select"; array: Term; index: Term; sort: Sort }
		| { tag: "Row"; row: RowTerm; sort: Sort };

	export type Formula =
		| { tag: "True"; origin?: string }
		| { tag: "False"; origin?: string }
		| { tag: "Atom"; op: AtomOp; args: [Term, Term]; origin?: string }
		| { tag: "Not"; value: Formula; origin?: string }
		| { tag: "And"; values: Formula[]; origin?: string }
		| { tag: "Or"; values: Formula[]; origin?: string }
		| { tag: "Implies"; left: Formula; right: Formula; origin?: string }
		| { tag: "Forall"; binders: Binder[]; body: Formula; triggers?: Trigger[]; origin?: string }
		| { tag: "Exists"; binders: Binder[]; body: Formula; origin?: string };

	export type Binder = { name: string; sort: Sort };
	export type Trigger = { terms: Term[] };
	export type AtomOp = "=" | "!=" | "<" | "<=" | ">" | ">=";
	export type ArithOp = "+" | "-" | "*" | "/";
	export type NumSort = Extract<Sort, { tag: "Int" | "Real" }>;
}
