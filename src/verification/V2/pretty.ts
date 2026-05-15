import * as PP from "@yap/shared/pretty";
import { getZ3Context } from "@yap/shared/config/options";
import type { Expr } from "z3-solver";

export type DisplayOpts = { deBruijn?: boolean };

export const display = (expr: Expr, opts: DisplayOpts = {}): string => {
	const Z3 = getZ3Context();

	if (!Z3) {
		return expr.sexpr();
	}

	const doc = (e: Expr, scope: string[]): PP.Doc => {
		if (Z3.isVar(e)) {
			const idx = Z3.getVarIndex(e);
			const resolved = idx < scope.length ? scope[scope.length - 1 - idx] : null;

			if (opts.deBruijn) {
				return resolved ? `${resolved}#${idx}` : `:var ${idx}`;
			}
			return resolved ?? `:var ${idx}`;
		}

		if (Z3.isQuantifier(e)) {
			const q = e as ReturnType<typeof Z3.ForAll>;
			const kind = q.is_forall() ? "forall" : q.is_exists() ? "exists" : "lambda";
			const names = Array.from({ length: q.num_vars() }, (_, i) => String(q.var_name(i)));
			const vars: PP.Doc[] = names.map((name, i) => PP.group(["(", name, " ", String(q.var_sort(i).name()), ")"]));
			const bindings = PP.group(["(", ...PP.intersperse(" ", vars), ")"]);
			const inner = [...scope, ...names];
			const body = doc(q.body(), inner);
			return PP.group(["(", kind, " ", bindings, " ", PP.nest(2, PP.group([body])), ")"]);
		}

		if (Z3.isApp(e)) {
			const n = e.numArgs();

			if (n === 0) {
				return String(e.decl().name());
			}

			const head = String(e.decl().name());
			const args = Array.from({ length: n }, (_, i) => doc(e.arg(i), scope));
			const [first, ...rest] = args;

			return rest.length === 0
				? PP.group(["(", head, " ", first, ")"])
				: PP.group([
						"(",
						head,
						" ",
						first,
						PP.nest(
							2,
							rest.map(a => [PP.line, a]),
						),
						")",
					]);
		}

		return e.sexpr();
	};

	return PP.render(doc(expr, []));
};

export const sexpr = (expr: Expr): string => expr.sexpr();
