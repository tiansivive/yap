import { isEqual } from "lodash";
import { match } from "ts-pattern";

import * as M from "@yap/elaboration/shared/effects";
import * as NF from "./syntax/term";
import { Do, result, type Evaluation, type Machine } from "./effects";

export function* bind(
	work: Evaluation<Machine<NF.Value>>,
	context: NF.ContextData,
	continued: (value: NF.Value) => Evaluation<Machine<NF.Value>>,
): Evaluation<Machine<NF.Value>> {
	const owner = yield* M.reader.ask();
	return yield* Do.let("value", work).in(({ value }) =>
		match(value)
			.with(NF.Patterns.Computation, ({ request, contexts, ctx }) =>
				result(NF.Constructors.Computation(request, [...contexts, { ...context, ctx: owner }], ctx)),
			)
			.otherwise(continued),
	);
}

export const observe = (value: NF.Value): NF.Value =>
	match(value)
		.with(NF.Patterns.Computation, ({ request, contexts }) =>
			contexts.every(context => context.type === "Function" || context.type === "Argument" || context.type === "Project" || context.type === "Applied")
				? contexts.reduce<NF.Value>(
						(inner, context) =>
							match(context)
								.with({ type: "Function" }, ({ icit, argument }) => NF.Constructors.App(inner, NF.Constructors.Deferred(argument), icit))
								.with({ type: "Applied" }, ({ icit, arg }) => NF.Constructors.App(inner, arg, icit))
								.with({ type: "Argument" }, ({ icit, func }) => NF.Constructors.App(func, inner, icit))
								.with({ type: "Project" }, ({ label }) => NF.Constructors.Proj(inner, label))
								.otherwise(() => value),
						request,
					)
				: value,
		)
		.otherwise(value => value);

export const origin = (value: NF.Value): { value: NF.Value; args: NF.Value[] } =>
	match(value)
		.with(NF.Patterns.Glued, ({ unfolded }) => origin(unfolded))
		.with(NF.Patterns.Neutral, ({ value }) => origin(value))
		.with(NF.Patterns.App, ({ func, arg }) => {
			const head = origin(func);
			return { value: head.value, args: [...head.args, arg] };
		})
		.otherwise(value => ({ value, args: [] }));

export const compare = (left: NF.Value, right: NF.Value): "equal" | "distinct" | "unknown" => {
	const a = origin(left).value;
	const b = origin(right).value;
	return match<[NF.Value, NF.Value], "equal" | "distinct" | "unknown">([a, b])
		.with([NF.Patterns.Foreign, NF.Patterns.Foreign], ([a, b]) => (a.variable.name === b.variable.name ? "equal" : "distinct"))
		.with([NF.Patterns.Atom, NF.Patterns.Atom], ([a, b]) => (a.value.value === b.value.value ? "equal" : "distinct"))
		.with([NF.Patterns.Foreign, NF.Patterns.Atom], [NF.Patterns.Atom, NF.Patterns.Foreign], () => "distinct")
		.with([NF.Patterns.Rigid, NF.Patterns.Rigid], ([a, b]) => (a.variable.lvl === b.variable.lvl ? "equal" : "unknown"))
		.otherwise(() => (a === b ? "equal" : "unknown"));
};

export const anonymous = (value: NF.Value): boolean =>
	match(origin(value).value)
		.with({ type: "Lit", value: { type: "Atom", value: "$anonymous" } }, () => true)
		.otherwise(() => false);

export const nominal = (value: NF.Value): boolean =>
	match(origin(value).value)
		.with({ type: "Var", variable: { type: "Foreign", identity: true } }, () => true)
		.otherwise(() => false);
export const sameArgument = (left: NF.Value, right: NF.Value): "equal" | "distinct" | "unknown" =>
	match<[NF.Value, NF.Value], "equal" | "distinct" | "unknown">([left, right])
		.with([NF.Patterns.Neutral, NF.Patterns.Neutral], ([a, b]) => sameArgument(a.value, b.value))
		.with([NF.Patterns.Glued, NF.Patterns.Glued], ([a, b]) => sameArgument(a.unfolded, b.unfolded))
		.with([NF.Patterns.Lit, NF.Patterns.Lit], ([a, b]) => (isEqual(a.value, b.value) ? "equal" : "distinct"))
		.with([NF.Patterns.App, NF.Patterns.App], ([a, b]) => (sameArgument(a.func, b.func) === "equal" ? sameArgument(a.arg, b.arg) : "unknown"))
		.otherwise(() => (left === right ? "equal" : "unknown"));
