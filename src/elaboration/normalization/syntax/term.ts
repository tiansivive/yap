import * as R from "@yap/shared/rows";
import * as EB from "@yap/elaboration";

import * as Lit from "@yap/shared/literals";
import { Literal } from "@yap/shared/literals";
import { Implicitness } from "@yap/shared/implicitness";
import { match, P } from "ts-pattern";
import { Types } from "@yap/utils";

import * as Modal from "@yap/verification/modalities/shared";

export const nf_tag: unique symbol = Symbol("NF");

export type Value = Types.Brand<typeof nf_tag, Constructor> & { id: number };
type Constructor =
	| { type: "Var"; variable: Variable }
	| { type: "Lit"; value: Literal }
	| { type: "App"; func: Value; arg: Value; icit: Implicitness }
	| { type: "Proj"; base: Value; label: string }
	| { type: "Match"; closure: Closure; scrutinee: Value }
	| { type: "Inj"; base: Value; label: string; injected: Value }
	| { type: "Row"; row: Row }
	| { type: "Abs"; binder: Binder; closure: Closure }
	| { type: "Neutral"; kind: Neutral; value: Value }
	| { type: "Modal"; value: Value; modalities: Modalities }
	| { type: "External"; name: string; arity: number; compute: (...args: Value[]) => Value; args: Value[] }
	| {
			type: "Existential";
			variable: string;
			annotation: Value;
			body: {
				ctx: EB.Context;
				value: Value;
			};
	  }; // Used during verification only

export type Row = R.Row<Value, Variable>;
export type TaggedParts = { label: string; payload: Value };
export type Neutral = "Symbolic" | "Sealed" | "Blocked";

export type Binder =
	| { type: "Pi"; variable: string; annotation: Value; icit: Implicitness }
	| { type: "Lambda"; variable: string; annotation: Value; icit: Implicitness }
	| { type: "Mu"; variable: string; annotation: Value; source: string }
	| { type: "Sigma"; variable: string; annotation: Value };

export type Variable =
	| { type: "Bound"; lvl: number }
	| { type: "Free"; name: string }
	| { type: "Label"; name: string }
	| { type: "Foreign"; name: string }
	/**
	 * @see Unification.bind for the reason why we need to store the level
	 */
	| { type: "Meta"; val: number; lvl: number };

export type Closure =
	| { type: "Closure"; ctx: EB.Context; term: EB.Term }
	| { type: "PrimOp"; ctx: EB.Context; term: EB.Term; arity: number; compute: (...args: Value[]) => Value }
	| { type: "Continuation"; ctx: EB.Context; term: EB.Term; frames: EB.NF.StackFrame[]; results: Value[] };

export type Modalities = Modal.Annotations<Value>;

let currentId = 0;
const nextId = () => ++currentId;
export const resetId = () => {
	currentId = 0;
};
export const mk = (val: Constructor): Value => {
	return { ...Types.make(nf_tag, val), id: nextId() };
};

export const Constructors = {
	Var: (variable: Variable): Value => mk({ type: "Var", variable }),
	Pi: (variable: string, icit: Implicitness, annotation: Value, closure: Closure) =>
		mk({
			type: "Abs" as const,
			binder: { type: "Pi" as const, variable, icit, annotation },
			closure,
		}) as Value & { type: "Abs"; binder: { type: "Pi" } },
	Sigma: (variable: string, annotation: Value, closure: Closure) => mk({ type: "Abs" as const, binder: { type: "Sigma", variable, annotation }, closure }),
	Mu: (variable: string, source: string, annotation: Value, closure: Closure): Value =>
		mk({
			type: "Abs" as const,
			binder: { type: "Mu", variable, annotation, source },
			closure,
		}),
	Exists: (variable: string, annotation: Value, body: { ctx: EB.Context; value: Value }): Value =>
		mk({
			type: "Existential",
			variable,
			annotation,
			body,
		}),
	Lambda: (variable: string, icit: Implicitness, closure: Closure, annotation: Value): Value =>
		mk({
			type: "Abs" as const,
			binder: { type: "Lambda" as const, variable, icit, annotation },
			closure,
		}),
	Rigid: (lvl: number): Value =>
		mk({
			type: "Neutral",
			kind: "Symbolic",
			value: Constructors.Var({ type: "Bound", lvl }),
		}),
	Flex: (variable: Extract<Variable, { type: "Meta" }>): Value =>
		mk({
			type: "Neutral",
			kind: "Symbolic",
			value: Constructors.Var(variable),
		}),
	Lit: (value: Literal) =>
		mk({
			type: "Lit" as const,
			value,
		}),
	Atom: (value: string) => mk(Constructors.Lit(Lit.Atom(value))),
	Neutral: (kind: Neutral, value: Value) =>
		mk({
			type: "Neutral" as const,
			kind,
			value,
		}),
	App: (func: Value, arg: Value, icit: Implicitness) =>
		mk({
			type: "App" as const,
			func,
			arg,
			icit,
		}),
	Indexed: (index: Value, value: Value, strategy: Value): Value => {
		const indexed = Constructors.App(Constructors.Var({ type: "Foreign", name: "Indexed" }), index, "Explicit");
		const valued = Constructors.App(indexed, value, "Explicit");
		return Constructors.Neutral("Sealed", Constructors.App(valued, strategy, "Implicit"));
	},
	Closure: (ctx: EB.Context, term: EB.Term): Closure => ({ type: "Closure", ctx, term }),
	Primop: (ctx: EB.Context, term: EB.Term, arity: number, compute: (...args: Value[]) => Value): Closure => ({ type: "PrimOp", ctx, term, arity, compute }),

	Row: (row: Row): Value => mk({ type: "Row", row }),
	Extension: (label: string, value: Value, row: Row): Row => ({ type: "extension", label, value, row }),

	Schema: (row: Row): Value => Constructors.Neutral("Sealed", Constructors.App(Constructors.Lit(Lit.Atom("Schema")), Constructors.Row(row), "Explicit")),
	Variant: (row: Row): Value => Constructors.Neutral("Sealed", Constructors.App(Constructors.Lit(Lit.Atom("Variant")), Constructors.Row(row), "Explicit")),
	Struct: (row: Row): Value => Constructors.Neutral("Sealed", Constructors.App(Constructors.Lit(Lit.Atom("Struct")), Constructors.Row(row), "Explicit")),
	Tagged: (tag: string, payload: Value): Value =>
		Constructors.Struct(Constructors.Extension("__tag", Constructors.Lit(Lit.Atom(tag)), Constructors.Extension("payload", payload, R.Constructors.Empty()))),
	Array: (row: Row): Value => Constructors.Neutral("Sealed", Constructors.App(Constructors.Lit(Lit.Atom("Array")), Constructors.Row(row), "Explicit")),

	Proj: (base: Value, label: string): Value => mk({ type: "Proj", base, label }),
	Match: (closure: Closure, scrutinee: Value): Value => mk({ type: "Match", closure, scrutinee }),
	Inj: (base: Value, label: string, injected: Value): Value => mk({ type: "Inj", base, label, injected }),
	StuckMatch: (closure: Closure, scrutinee: Value): Value => Constructors.Neutral("Blocked", Constructors.Match(closure, scrutinee)),
	StuckProj: (base: Value, label: string): Value => Constructors.Neutral("Blocked", Constructors.Proj(base, label)),
	StuckInj: (base: Value, label: string, injected: Value): Value => Constructors.Neutral("Blocked", Constructors.Inj(base, label, injected)),
	Modal: (value: Value, modalities: Modalities): Value =>
		mk({
			type: "Modal",
			value,
			modalities,
		}),
	External: (name: string, arity: number, compute: (...args: Value[]) => Value, args: Value[]): Value => mk({ type: "External", name, arity, compute, args }),
};

export const Type: Value = mk({
	type: "Lit",
	value: { type: "Atom", value: "Type" },
});

export const Row: Value = mk({
	type: "Lit",
	value: { type: "Atom", value: "Row" },
});

export const Indexed: Value = mk({
	type: "Var",
	variable: { type: "Foreign", name: "Indexed" },
});

export const Any = mk({
	type: "Lit",
	value: { type: "Atom", value: "Any" },
});

const tagged = (row: Row): TaggedParts | undefined => {
	const tag = R.lookup(row, "__tag");
	const payload = R.lookup(row, "payload");
	return match(tag)
		.with({ type: "Lit", value: { type: "Atom" } }, tag => (payload ? { label: tag.value.value, payload } : undefined))
		.otherwise(() => undefined);
};

const TaggedRow = (row: Row): row is Row => !!tagged(row);

export const Patterns = {
	Var: { type: "Var" } as const,
	Rigid: { type: "Var", variable: { type: "Bound" } } as const,
	Flex: { type: "Var", variable: { type: "Meta" } } as const,
	Free: { type: "Var", variable: { type: "Free" } } as const,
	Label: { type: "Var", variable: { type: "Label" } } as const,

	Lit: { type: "Lit" } as const,
	Atom: { type: "Lit", value: { type: "Atom" } } as const,
	Type: { type: "Lit", value: { type: "Atom", value: "Type" } } as const,
	Unit: { type: "Lit", value: { type: "Atom", value: "Unit" } } as const,
	Any: { type: "Lit", value: { type: "Atom", value: "Any" } } as const,
	Neutral: { type: "Neutral" } as const,
	Symbolic: { type: "Neutral", kind: "Symbolic" } as const,
	Sealed: { type: "Neutral", kind: "Sealed" } as const,
	Blocked: { type: "Neutral", kind: "Blocked" } as const,
	Unresolved: { type: "Neutral", kind: P.union("Symbolic", "Blocked") } as const,

	Variant: { type: "App", func: { type: "Lit", value: { type: "Atom", value: "Variant" } }, arg: { type: "Row" } } as const,
	Schema: { type: "App", func: { type: "Lit", value: { type: "Atom", value: "Schema" } }, arg: { type: "Row" } } as const,
	Struct: { type: "App", func: { type: "Lit", value: { type: "Atom", value: "Struct" } }, arg: { type: "Row" } } as const,
	Tagged: {
		type: "App",
		func: { type: "Lit", value: { type: "Atom", value: "Struct" } },
		arg: { type: "Row", row: P.when(TaggedRow) },
	} as const,
	Array: { type: "App", func: { type: "Lit", value: { type: "Atom", value: "Array" } }, arg: { type: "Row" } } as const,

	Proj: { type: "Proj" } as const,
	Match: { type: "Match" } as const,
	Inj: { type: "Inj" } as const,
	StuckMatch: { type: "Neutral", kind: "Blocked", value: { type: "Match" } } as const,
	StuckProj: { type: "Neutral", kind: "Blocked", value: { type: "Proj" } } as const,
	StuckApp: { type: "Neutral", kind: "Blocked", value: { type: "App" } } as const,
	StuckInj: { type: "Neutral", kind: "Blocked", value: { type: "Inj" } } as const,

	App: { type: "App" } as const,
	Pi: { type: "Abs", binder: { type: "Pi" } } as const,
	Sigma: { type: "Abs", binder: { type: "Sigma" } } as const,
	Lambda: { type: "Abs", binder: { type: "Lambda" } } as const,
	Mu: { type: "Abs", binder: { type: "Mu" } } as const,
	Row: { type: "Row" } as const,
	Modal: { type: "Modal" } as const,

	Recursive: {
		type: "App",
		func: {
			type: "Abs",
			binder: { type: "Mu" },
		},
	} as const,

	Indexed: {
		type: "App",
		icit: "Implicit",
		func: {
			type: "App",
			func: {
				type: "App",
				func: {
					type: "Var",
					variable: { type: "Foreign", name: "Indexed" },
				},
			},
		},
	} as const,

	HashMap: {
		type: "Neutral",
		value: {
			type: "App",
			icit: "Implicit",
			func: {
				type: "App",
				func: {
					type: "App",
					func: {
						type: "Var",
						variable: { type: "Foreign", name: "Indexed" },
					},
					arg: { type: "Lit", value: { type: "Atom", value: "String" } },
				},
			},
		},
	} as const,

	External: { type: "External" } as const,
};

export const TaggedValue = {
	extract: tagged,
} as const;
