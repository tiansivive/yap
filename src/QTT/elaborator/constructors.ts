import { Tag } from "../../utils/types";
import { Implicitness, Literal } from "../shared";
import { Value, Binder, Closure } from "./normalized";

import * as El from "./syntax";

export const Term = {
	Lambda: <T>(variable: string, icit: Implicitness, body: T) => ({
		type: "Abs" as const,
		binding: { type: "Lambda" as const, variable, icit },
		body,
	}),
	Pi: <T>(variable: string, icit: Implicitness, annotation: T, body: T) => ({
		type: "Abs" as const,
		binding: { type: "Pi" as const, variable, icit, annotation },
		body,
	}),
	Var: (variable: El.Variable) => ({
		type: "Var" as const,
		variable,
	}),

	App: <T>(icit: Implicitness, func: T, arg: T) => ({
		type: "App" as const,
		icit,
		func,
		arg,
	}),
	Lit: (value: Literal) => ({
		type: "Lit" as const,
		value,
	}),
};

export const Type = {
	Pi: <A, B>(
		variable: string,
		icit: Implicitness,
		annotation: A,
		closure: B,
	) => ({
		type: "Abs" as const,
		binder: { type: "Pi" as const, variable, icit, annotation },
		closure,
	}),
	Lambda: <A>(variable: string, icit: Implicitness, closure: A) => ({
		type: "Abs" as const,
		binder: { type: "Lambda" as const, variable, icit },
		closure,
	}),
	Rigid: (lvl: number) => ({
		type: "Neutral" as const,
		value: {
			type: "Var" as const,
			variable: { type: "Bound" as const, index: lvl },
		},
	}),
	Lit: (value: Literal) => ({
		type: "Lit" as const,
		value,
	}),
	Neutral: <T>(value: T) => ({
		type: "Neutral" as const,
		value,
	}),
	App: <A, B>(func: A, arg: B, icit: Implicitness) => ({
		type: "App" as const,
		func,
		arg,
		icit,
	}),
};
