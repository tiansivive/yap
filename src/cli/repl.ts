import Nearley from "nearley";
import Grammar from "@yap/src/grammar";

import * as Src from "@yap/src/index";
import * as EB from "@yap/elaboration";
import * as NF from "@yap/elaboration/normalization";
import * as GRAM from "@yap/gram";
import * as Pipeline from "@yap/pipeline";

import * as E from "fp-ts/lib/Either";
import * as F from "fp-ts/lib/function";
import * as R from "fp-ts/lib/Record";

import fs from "fs";
import vm from "vm";

import { resolve } from "path";

import { match } from "ts-pattern";
import { createInterface } from "readline";
import { defaultContext } from "@yap/shared/lib/constants";

import { options } from "@yap/shared/config/options";
import { mkInterface } from "../modules/loading";
import { update } from "@yap/utils";
import { encode, decode } from "../FFI/codecs";
import type * as MIR from "../lowering/mir";
import * as Pretty from "../lowering/pretty";
import { emit as emitJS } from "../Codegen/v2/js/emit";
import { print as printJS } from "../Codegen/v2/js/print";
import { emit as emitC } from "../Codegen/v2/c/emit";
import { print as printC } from "../Codegen/v2/c/print";
import { emit as emitErl } from "../Codegen/v2/erlang/emit";
import { print as printErl } from "../Codegen/v2/erlang/print";
import { VerificationServiceV2 } from "../verification/V2/service";
import { Build } from "../verification/solver/ivl/build";
import { Print as IVLPrint } from "../verification/solver/ivl/print";
import { Validity } from "../verification/validity";

export type ReplOpts = {
	codegen: boolean;
	target: "js" | "c" | "erlang";
	verify: boolean;
};

type DisplayOpts = {
	elaboration: boolean;
	nf: boolean;
	gram: boolean;
	mir: boolean;
	ivl: boolean;
};

type ReplState = {
	ctx: EB.Context;
	runtime: Pipeline.Runtime;
	display: DisplayOpts;
};

const computeArity = (fn: Function): number => {
	let arity = 0;
	let current = fn;

	while (typeof current === "function") {
		arity++;
		try {
			const dummy = Symbol("arity_check");
			const result = current(dummy);

			if (typeof result !== "function") {
				break;
			}
			current = result;
		} catch {
			break;
		}
	}

	return arity;
};

const initialState = (): ReplState => ({
	ctx: defaultContext,
	runtime: Pipeline.emptyRuntime(),
	display: { elaboration: false, nf: false, gram: false, mir: false, ivl: false },
});

export function repl(opts: ReplOpts = { codegen: false, target: "js", verify: true }) {
	const prompt = opts.codegen ? `${opts.target} λ> ` : "λ> ";
	const rl = createInterface({ input: process.stdin, output: process.stdout, prompt });

	let state = initialState();
	let buffer: string[] = [];

	Build.simplify = true;

	const executeBuffer = () => {
		if (buffer.length === 0) {
			return;
		}

		const code = buffer.join("\n");
		buffer = [];
		rl.setPrompt(prompt);
		state = run(code, state, opts);
	};

	rl.on("line", input => {
		const trimmed = input.trim();

		try {
			if (trimmed.startsWith(":help")) {
				console.log("Available commands:");
				console.log("  :help               Show this help message");
				console.log("  :exit, :quit, :q    Exit the REPL");
				console.log("  :load <filepath>    Load a Yap module from the specified file");
				console.log("  :set elaboration    Toggle showing elaboration output");
				console.log("  :set nf             Toggle showing the normal form (via NbE)");
				console.log("  :set gram           Toggle showing GRAM output");
				console.log("  :set mir            Toggle showing MIR output");
				console.log("  :set ivl            Toggle showing IVL verification output");
				console.log("  :implicits          Show current implicit arguments in context");
				console.log("");
				console.log("To enter multi-line input, continue typing. Submit with an empty line.");
				return rl.prompt();
			}

			if ([":exit", ":quit", ":q"].includes(trimmed)) {
				console.log("Goodbye!");
				return rl.close();
			}

			if (trimmed.startsWith(":set")) {
				const [, option] = trimmed.split(" ");
				if (option === "elaboration") {
					state.display.elaboration = !state.display.elaboration;
					console.log(`Show elaboration: ${state.display.elaboration}`);
				} else if (option === "nf") {
					state.display.nf = !state.display.nf;
					console.log(`Show normal form: ${state.display.nf}`);
				} else if (option === "gram") {
					state.display.gram = !state.display.gram;
					console.log(`Show GRAM: ${state.display.gram}`);
				} else if (option === "mir") {
					state.display.mir = !state.display.mir;
					console.log(`Show MIR: ${state.display.mir}`);
				} else if (option === "ivl") {
					state.display.ivl = !state.display.ivl;
					console.log(`Show IVL: ${state.display.ivl}`);
				} else {
					console.log(`Unknown option: ${option}`);
				}
				return rl.prompt();
			}

			if (trimmed.startsWith(":load")) {
				const [, filepath] = trimmed.split(" ");
				const absPath = resolve(process.cwd(), filepath);
				if (!fs.existsSync(absPath)) {
					console.error(`File not found: ${absPath}`);
					return rl.prompt();
				}

				const iface = mkInterface(absPath);
				const imports = Object.values(iface.imports).flatMap(([errs, defs]) => defs);
				const letdecs = iface.letdecs.reduce<EB.Context["imports"]>((acc, [name, result]) => {
					if (E.isLeft(result)) {
						console.warn(`Error in module ${filepath} for let ${name}: ${result.left}`);
						EB.V2.display(result.left);
						return acc;
					}
					const [tm, ty, us] = result.right;
					return { ...acc, [name]: [tm, ty, us] };
				}, {});

				const foreigns = iface.foreign.reduce<EB.Context["imports"]>((acc, [name, ffi]) => {
					if (E.isLeft(ffi)) {
						console.warn(`Error in module ${filepath} for foreign ${name}: ${ffi.left}`);
						EB.V2.display(ffi.left);
						return acc;
					}
					return { ...acc, [name]: ffi.right };
				}, {});

				const FFIfile = filepath.replace(".yap", ".ffi.js");
				const FFIpath = resolve(process.cwd(), FFIfile);

				let ffiExports: EB.Context["ffi"] = {};
				if (fs.existsSync(FFIpath)) {
					const code = fs.readFileSync(FFIpath, "utf-8");
					const sandbox = { module: { exports: {} }, exports: {}, console };
					vm.createContext(sandbox);
					vm.runInContext(code, sandbox);

					const rawExports = sandbox.module.exports as Record<string, Function>;
					ffiExports = Object.fromEntries(
						Object.entries(rawExports).map(([name, fn]) => {
							const arity = typeof fn === "function" ? computeArity(fn) : 0;
							return [
								name,
								{
									arity,
									compute: (...vals: NF.Value[]) => {
										let result: unknown = fn;
										const encodedVals = vals.map(encode);
										for (const arg of encodedVals) {
											if (typeof result !== "function") {
												throw new Error(`FFI ${name}: attempted to apply argument to non-function value`);
											}
											result = (result as Function)(arg);
										}
										return decode(result);
									},
								},
							];
						}),
					);

					for (const [name, fn] of Object.entries(rawExports)) {
						state.runtime.ffi[name] = fn as (...args: unknown[]) => unknown;
					}

					console.log(`Loaded FFI: ${FFIfile}`);
				}

				console.log(`Loaded module: ${filepath}`);
				state.ctx = F.pipe(
					state.ctx,
					update("imports", imps => ({ ...imps, ...R.fromEntries(imports), ...foreigns, ...letdecs })),
					update("ffi", ffi => ({ ...ffi, ...ffiExports })),
				);
				return rl.prompt();
			}

			if ([":implicits"].includes(trimmed)) {
				console.log("\nImplicits:");
				state.ctx.implicits.forEach(([tm, ty], i) => {
					console.log(`\n  [${i}]:`);
					console.log(`	Term: ${EB.Display.Term(tm, state.ctx)}`);
					console.log(`	Type: ${NF.display(ty, state.ctx)}`);
				});
				console.log("");
				return rl.prompt();
			}

			if (trimmed === "") {
				if (buffer.length > 0) {
					executeBuffer();
				}
				return rl.prompt();
			}
		} catch (err) {
			console.error("Error:", err);
			buffer = [];
			rl.setPrompt(prompt);
			return rl.prompt();
		}

		buffer.push(input);
		rl.setPrompt("   ");
		return rl.prompt();
	});

	rl.on("SIGINT", () => {
		buffer = [];
		console.log("\n(Buffer cleared)");
		rl.setPrompt(prompt);
		rl.prompt();
	});

	rl.prompt();
}

const run = (code: string, state: ReplState, opts: ReplOpts): ReplState => {
	const script = parse(code);
	return interpret(script[0], state, opts);
};

export const parse = (code: string) => {
	const g = Grammar;
	g.ParserStart = "Script";
	const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(Grammar));

	const sanitized = code.trim().endsWith(";") ? code : `${code};`;
	const data = parser.feed(sanitized);
	if (data.results.length !== 1) {
		console.error("Failed to parse statement");
		const logsDir = resolve(process.cwd(), "./.logs");

		if (!fs.existsSync(logsDir)) {
			fs.mkdirSync(logsDir, { recursive: true });
		}
		fs.writeFileSync(resolve(logsDir, "error.json"), JSON.stringify(data.results, null, 2));
		throw new Error("Error while parsing statement. Check error.json for more information");
	}

	const { script }: Src.Script = data.results[0];

	if (script.length !== 1) {
		throw new Error("Expected a single statement");
	}
	return script;
};

const displayValue = (v: Pipeline.Value): string => {
	if (typeof v === "object" && v !== null && "__funcref" in v) {
		return `<function ${(v as { __funcref: string }).__funcref}>`;
	}

	if (typeof v === "object" && v !== null) {
		return JSON.stringify(v);
	}

	if (typeof v === "string") {
		return `"${v}"`;
	}
	return String(v);
};

const runVerification = (tm: EB.Term, ty: NF.Value, ctx: EB.Context, display: DisplayOpts): void => {
	try {
		const svc = VerificationServiceV2();
		const [{ result }] = svc.check(tm, ty)(ctx);

		if (E.isRight(result)) {
			const vc = result.right.vc;

			if (display.ivl) {
				console.log("\n-------------- IVL VC ---------------");
				console.log(IVLPrint.formula(vc));
				console.log("-------------------------------------\n");
			}

			const validity = Validity.check(vc);

			match(validity)
				.with({ tag: "valid" }, () => {
					console.log("✓ Verified\n");
				})
				.with({ tag: "invalid" }, () => {
					console.log("✗ Verification failed");
					console.log("");
				})
				.with({ tag: "unknown" }, ({ reason }) => {
					console.log(`? Verification inconclusive: ${reason}\n`);
				})
				.exhaustive();
		} else {
			console.warn("Verification error:", EB.V2.display(result.left));
		}
	} catch (err) {
		console.warn("Verification failed:", err instanceof Error ? err.message : String(err));
	}
};

const evalCodegenJS = (mod: MIR.Module, ffi: Record<string, (...args: unknown[]) => unknown>): unknown => {
	const program = emitJS(mod);
	const code = printJS(program);
	const ffiNames = Object.keys(ffi);
	const ffiValues = Object.values(ffi);
	return new Function(...ffiNames, code)(...ffiValues);
};

const evalCodegenC = (mod: MIR.Module): null => {
	const raw = emitC(mod);
	const code = printC(raw);
	console.log("\n------------- C Output --------------");
	console.log(code);
	console.log("-------------------------------------\n");
	return null;
};

const evalCodegenErlang = (mod: MIR.Module): null => {
	const ast = emitErl(mod);
	const code = printErl(ast);
	console.log("\n---------- Core Erlang Output --------");
	console.log(code);
	console.log("--------------------------------------\n");
	return null;
};

const interpret = (stmt: Src.Statement, state: ReplState, opts: ReplOpts): ReplState =>
	match(stmt)
		.with({ type: "expression" }, s => {
			const elaborated = EB.Mod.expression(s, state.ctx);
			if (E.isLeft(elaborated)) {
				console.warn(EB.V2.display(elaborated.left));
				return state;
			}

			const [tm, ty, _us, next, _debug] = elaborated.right;

			if (state.display.elaboration) {
				console.log("\n------------ Elaboration ------------");
				console.log(EB.Display.Term(tm, next));
				console.log("-------------------------------------\n");
			}

			if (state.display.nf) {
				const normal = NF.quote(next, next.env.length, NF.evaluate(next, tm));
				console.log("\n--------------- NF ------------------");
				console.log(EB.Display.Term(normal, next));
				console.log("-------------------------------------\n");
			}

			if (opts.verify) {
				runVerification(tm, ty, next, state.display);
			}

			const compiled = Pipeline.lowerTermWithContext(tm, next);
			if (E.isLeft(compiled)) {
				console.error(compiled.left);
				return { ...state, ctx: next };
			}

			const { graph, mod } = compiled.right;

			if (state.display.gram) {
				console.log("\n-------------- GRAM -----------------");
				console.log(GRAM.display(graph));
				console.log("-------------------------------------\n");
			}

			if (state.display.mir) {
				console.log("\n--------------- MIR -----------------");
				console.log(Pretty.display.module(mod));
				console.log("-------------------------------------\n");
			}

			try {
				const result = opts.codegen
					? match(opts.target)
							.with("js", () => evalCodegenJS(mod, state.runtime.ffi))
							.with("c", () => evalCodegenC(mod))
							.with("erlang", () => evalCodegenErlang(mod))
							.exhaustive()
					: Pipeline.run(mod, state.runtime);

				if (opts.target === "js" || !opts.codegen) {
					console.log(displayValue(result as Pipeline.Value), "::", NF.display(ty, next), "\n");
				}
			} catch (err) {
				console.error("Runtime error:", err instanceof Error ? err.message : String(err));
			}

			return { ...state, ctx: next };
		})
		.with({ type: "let" }, s => {
			const [name, result] = EB.Mod.letdec(s, state.ctx);
			if (E.isLeft(result)) {
				console.warn(EB.V2.display(result.left));
				return state;
			}

			const [[tm, ty, _us], next] = result.right;

			if (state.display.elaboration) {
				console.log("\n------------ Elaboration ------------");
				console.log(`let ${name} = ${EB.Display.Term(tm, next)}`);
				console.log(`  : ${NF.display(ty, next)}`);
				console.log("-------------------------------------\n");
			}

			if (state.display.nf) {
				const normal = NF.quote(next, next.env.length, NF.evaluate(next, tm));
				console.log("\n--------------- NF ------------------");
				console.log(`let ${name} = ${EB.Display.Term(normal, next)}`);
				console.log("-------------------------------------\n");
			}

			if (opts.verify) {
				runVerification(tm, ty, next, state.display);
			}

			const compiled = Pipeline.lowerTermWithContext(tm, next, { parentBinders: [name] });
			if (E.isLeft(compiled)) {
				console.error(compiled.left);
				return { ...state, ctx: next };
			}

			const { graph, mod } = compiled.right;

			if (state.display.gram) {
				console.log("\n-------------- GRAM -----------------");
				console.log(GRAM.display(graph));
				console.log("-------------------------------------\n");
			}

			if (state.display.mir) {
				console.log("\n--------------- MIR -----------------");
				console.log(Pretty.display.module(mod));
				console.log("-------------------------------------\n");
			}

			const newFunctions = new Map(state.runtime.functions);
			for (const fn of mod.functions) {
				newFunctions.set(fn.name, fn);
			}

			const newGlobals = new Map(state.runtime.globals);

			try {
				const value = Pipeline.run(mod, state.runtime);
				newGlobals.set(name, value);
			} catch (err) {
				console.error("Runtime error:", err instanceof Error ? err.message : String(err));
				return { ...state, ctx: next, runtime: { ...state.runtime, functions: newFunctions } };
			}

			console.log(`${name} : ${NF.display(ty, next)}\n`);

			return { ...state, ctx: next, runtime: { ...state.runtime, functions: newFunctions, globals: newGlobals } };
		})
		.with({ type: "using" }, s => {
			const result = EB.Mod.using(s, state.ctx);
			if (E.isLeft(result)) {
				console.warn(EB.V2.display(result.left));
				return state;
			}
			console.log("(using registered)\n");
			return { ...state, ctx: result.right };
		})
		.with({ type: "foreign" }, s => {
			const result = F.pipe(
				E.tryCatch(
					() => EB.check(s.annotation, NF.Type)(state.ctx),
					e => (e instanceof Error ? e.message : String(e)),
				),
				E.chain(([{ result: r }]) => (E.isLeft(r) ? E.left(EB.V2.display(r.left)) : E.right(r.right))),
				E.map(([tm]) => {
					const nf = NF.evaluate(state.ctx, tm);
					const v = EB.Constructors.Var({ type: "Foreign", name: s.variable });
					const ar = NF.arity(state.ctx, nf);
					const compute = (...args: NF.Value[]) => {
						const ext = NF.Constructors.External(s.variable, ar, compute, args);
						return NF.Constructors.Neutral(ext);
					};
					const c1: EB.Context = { ...state.ctx, imports: { ...state.ctx.imports, [s.variable]: [v, nf, []] } };
					return { ...c1, ffi: { ...c1.ffi, [s.variable]: { arity: ar, compute } } };
				}),
			);

			if (E.isLeft(result)) {
				console.warn(result.left);
				return state;
			}

			console.log(`foreign ${s.variable} : ... (arity ${result.right.ffi[s.variable].arity})\n`);
			return { ...state, ctx: result.right };
		})
		.otherwise(() => {
			console.error("Unsupported statement type");
			return state;
		});
