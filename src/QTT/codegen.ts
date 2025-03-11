import { match } from "ts-pattern";
import { globalModules } from "./modules";

import * as EB from "@qtt/elaboration";
import { Literal } from "./shared/literals";

import * as R from "@qtt/shared/rows";

export const codegen = (env: string[], term: EB.Term): string => {
	return match(term)
		.with({ type: "Lit" }, ({ value }) => {
			return match(value)
				.with({ type: "String" }, s => `"${s.value}"`)
				.with({ type: "Num" }, n => `${n.value}`)
				.with({ type: "Bool" }, b => `${b.value}`)
				.with({ type: "unit" }, () => `"unit"`)
				.with({ type: "Atom" }, ({ value }) => `"${value}"`)
				.exhaustive();
		})
		.with({ type: "Var", variable: { type: "Free" } }, { type: "Var", variable: { type: "Foreign" } }, ({ variable }) => {
			return variable.name;
		})
		.with({ type: "Var", variable: { type: "Bound" } }, ({ variable }) => {
			return env[variable.index];
		})
		.with({ type: "Var" }, v => {
			throw new Error("Could not compile Variable: " + JSON.stringify(v));
		})
		.with({ type: "Abs", binding: { type: "Mu" } }, mu => {
			return codegen([mu.binding.source, ...env], mu.body);
		})
		.with({ type: "Abs" }, abs => {
			const extended = [abs.binding.variable, ...env];
			const body = codegen(extended, abs.body);
			return `(${abs.binding.variable}) => {
                return ${body};
            }`;
		})
		.with(
			{
				type: "App",
				func: { type: "Lit", value: { type: "Atom", value: "Struct" } },
				arg: { type: "Row" },
			},
			({ func, arg }) => {
				return `{ ${codegen(env, arg)} }`;
			},
		)
		.with(
			{
				type: "App",
				func: { type: "Lit", value: { type: "Atom", value: "Schema" } },
				arg: { type: "Row" },
			},
			({ func, arg }) => {
				return `{ ${codegen(env, arg)} }`;
			},
		)
		.with(
			{
				type: "App",
				func: { type: "Lit", value: { type: "Atom", value: "Variant" } },
				arg: { type: "Row" },
			},
			({ func, arg }) => {
				return `/* variant */{ ${codegen(env, arg)} }`;
			},
		)
		.with({ type: "App" }, app => {
			const fn = codegen(env, app.func);
			const arg = codegen(env, app.arg);

			return `${fn}(${arg})`;
		})
		.with({ type: "Block" }, block => {
			const [, stmts] = block.statements.reduce(
				([env, code], stmt) => {
					const code_ = (code += " " + Statement.codegen(env, stmt) + ";");
					const env_ = stmt.type === "Let" ? [stmt.variable, ...env] : env;
					return [env_, code_];
				},
				[env, ""],
			);
			const ret = codegen(env, block.return);
			return `((_ => { ${stmts} return ${ret}; })())`;
		})
		.with({ type: "Annotation" }, ann => {
			return codegen(env, ann.term);
		})
		.with({ type: "Proj" }, proj => {
			const label = Number.isNaN(parseInt(proj.label)) ? `"${proj.label}"` : proj.label;
			return `${codegen(env, proj.term)}[${label}]`;
		})
		.with({ type: "Inj" }, inj => {
			const obj = codegen(env, inj.term);
			const val = codegen(env, inj.value);
			return `{ ...${obj}, ${inj.label}: ${val} }`;
		})
		.with({ type: "Row" }, ({ row }) => {
			const gen = (r: EB.Row, code: string) => {
				if (r.type === "empty") {
					return code;
				}

				if (r.type === "variable") {
					throw new Error("Cannot compile rows with variable: " + JSON.stringify(row));
				}

				const pair = `${r.label}: ${codegen(env, r.value)},`;
				return gen(r.row, code + pair);
			};

			return gen(row, "");
		})
		.with({ type: "Match" }, patMatch => {
			const scrutinee = codegen(env, patMatch.scrutinee);
			const alts = patMatch.alternatives.map(alt => Alternative.codegen(env, alt, "$x")).join(" else ");
			return `(() => {
                const $x = ${scrutinee};
                ${alts}
            })()`;
		})
		.otherwise(_ => {
			throw new Error("Code gen not yet implemented");
		});
};

export const Lit = {
	codegen: (lit: Literal) => {
		return match(lit)
			.with({ type: "String" }, s => `"${s.value}"`)
			.with({ type: "Num" }, n => `${n.value}`)
			.with({ type: "Bool" }, b => `${b.value}`)
			.with({ type: "unit" }, () => `"unit"`)
			.with({ type: "Atom" }, ({ value }) => `"${value}"`)
			.exhaustive();
	},
};

type Path = string;
type Name = string;
export const Patterns = {
	codegen: (env: string[], pat: EB.Pattern, scrutinee: string): [string[], [Path, Name][]] => {
		switch (pat.type) {
			case "Lit":
				return [[`(${scrutinee}) === ${Lit.codegen(pat.value)}`], []];
			case "Variant":
				const [variant, bs] = Patterns.codegen(env, { type: "Row", row: pat.row }, scrutinee);
				return [[`(${variant.join(" || ")})`], bs];
			case "Struct":
				const [struct, bs2] = Patterns.codegen(env, { type: "Row", row: pat.row }, scrutinee);
				return [[`(${struct.join(" && ")})`], bs2];
			case "Row":
				if (pat.row.type === "empty") {
					return [[], []];
				}

				if (pat.row.type === "variable") {
					return [[], []];
				}

				const label = Number.isNaN(parseInt(pat.row.label)) ? `"${pat.row.label}"` : pat.row.label;
				const [v, bs3] = Patterns.codegen(env, pat.row.value, `${scrutinee}[${label}]`);
				const [r, bs4] = Patterns.codegen(env, { type: "Row", row: pat.row.row }, scrutinee);

				return [[...v, ...r], bs3.concat(bs4)];

			case "Var":
				throw new Error("Var patterns not implemented yet");
			case "Wildcard":
				return [[`${scrutinee} !== undefined`], []];
			case "Binder":
				return [[scrutinee], [[scrutinee, pat.value]]];

			default:
				throw new Error("Pattern codegen not implemented yet");
		}
	},
};

export const Alternative = {
	codegen: (env: string[], alt: EB.Alternative, scrutinee: string): string => {
		const [pat, bs] = Patterns.codegen(env, alt.pattern, scrutinee);
		const extended = bs.map(([path, name]) => name);
		extended.reverse();
		const body = codegen([...extended, ...env], alt.term);
		const bindings = bs.map(([path, name]) => `const ${name} = ${path}`);
		const defs = bindings.length > 0 ? bindings.join("; ") + ";" : "";
		return `if (${pat.join(" && ")}) { ${defs} return ${body}; }`;
	},
};

export const Statement = {
	codegen: (env: string[], stmt: EB.Statement): string => {
		return match(stmt)
			.with({ type: "Expression" }, ({ value }) => codegen(env, value))
			.with({ type: "Let" }, ({ variable, value }) => {
				const val = codegen([variable, ...env], value);
				return `const ${variable} = ${val}`;
			})
			.with({ type: "Using" }, _ => "")
			.otherwise(() => {
				throw new Error("Statement codegen not implemented yet");
			});
	},
};
