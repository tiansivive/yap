import Nearley from "nearley";
import Grammar from "@yap/src/grammar";

import * as Src from "@yap/src/index";
import * as EB from "@yap/elaboration";

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
import { lowerToMir } from "../lowering/lower";
import { interpret as mirInterpret, type Value } from "../lowering/interpret";
import * as Pretty from "../lowering/pretty";
import type { Declaration } from "../lowering/mir";
import { emit } from "../Codegen/v2/emit";
import { print as printJS } from "../Codegen/v2/print";

export type ReplOpts = { mir: boolean; codegen: boolean };

// Compute arity by recursively checking if function returns another function
const computeArity = (fn: Function): number => {
	let arity = 0;
	let current = fn;

	// Apply dummy arguments and check if result is still a function
	while (typeof current === "function") {
		arity++;
		try {
			// Use a unique symbol as dummy arg to avoid side effects
			const dummy = Symbol("arity_check");
			const result = current(dummy);

			if (typeof result !== "function") {
				break;
			}
			current = result;
		} catch {
			// If calling fails, assume we've reached the end
			break;
		}
	}

	return arity;
};

export function repl(opts: ReplOpts = { mir: false, codegen: false }) {
	const prompt = opts.codegen ? "js λ> " : opts.mir ? "mir λ> " : "λ> ";
	const rl = createInterface({ input: process.stdin, output: process.stdout, prompt });

	let ctx: EB.Context = defaultContext;
	let mirFfi: Record<string, (...args: any[]) => any> = {};
	let mirDeclarations: Map<string, Declaration> = new Map();
	let buffer: string[] = [];

	const executeBuffer = () => {
		if (buffer.length === 0) {
			return;
		}

		const code = buffer.join("\n");
		buffer = [];
		rl.setPrompt(prompt);
		ctx = run(code, ctx, opts, mirFfi, mirDeclarations);
	};

	rl.on("line", input => {
		const trimmed = input.trim();

		try {
			if (trimmed.startsWith(":help")) {
				console.log("Available commands:");
				console.log("  :help               Show this help message");
				console.log("  :exit, :quit, :q    Exit the REPL");
				console.log("  :load <filepath>    Load a Yap module from the specified file");
				console.log("  :set elaboration    Toggle showing elaboration results");
				console.log("  :implicits          Show current implicit arguments in context");
				console.log("");
				console.log("To enter multi-line input, just continue typing. Submit with an empty line. (sorry about that)");
				return rl.prompt();
			}
			// Commands work anywhere
			if ([":exit", ":quit", ":q"].includes(trimmed)) {
				console.log("Goodbye!");
				return rl.close();
			}

			if (trimmed.startsWith(":set")) {
				const [, option] = trimmed.split(" ");
				if (option === "elaboration") {
					options.showElaboration = !options.showElaboration;
					console.log(`Show elaboration: ${options.showElaboration}`);
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
					const foreign = ffi.right;
					return { ...acc, [name]: foreign };
				}, {});

				const FFIfile = filepath.replace(".yap", ".ffi.js");
				const FFIpath = resolve(process.cwd(), FFIfile);

				let ffiExports: EB.Context["ffi"] = {};
				if (fs.existsSync(FFIpath)) {
					const code = fs.readFileSync(FFIpath, "utf-8");
					const sandbox = {
						module: { exports: {} },
						exports: {},
						console: console, // Pass through the real console
					};
					vm.createContext(sandbox);
					vm.runInContext(code, sandbox);

					const rawExports = sandbox.module.exports;
					ffiExports = Object.fromEntries(
						Object.entries(rawExports).map(([name, fn]) => {
							const f = fn as any;
							const arity = typeof fn === "function" ? computeArity(fn as Function) : 0;
							return [
								name,
								{
									arity,
									compute: (...vals: EB.NF.Value[]) => {
										// Handle curried functions by applying arguments one at a time
										let result = f;
										const encodedVals = vals.map(encode);

										for (const arg of encodedVals) {
											if (typeof result !== "function") {
												throw new Error(`FFI ${name}: attempted to apply argument to non-function value`);
											}
											result = result(arg);
										}

										return decode(result);
									},
								},
							];
						}),
					);

					console.log(`Loaded FFI: ${FFIfile}`);
				}

				if (opts.mir && fs.existsSync(FFIpath)) {
					const rawExports = (() => {
						const code = fs.readFileSync(FFIpath, "utf-8");
						const sandbox = { module: { exports: {} }, exports: {}, console };
						vm.createContext(sandbox);
						vm.runInContext(code, sandbox);
						return sandbox.module.exports as Record<string, Function>;
					})();
					for (const [name, fn] of Object.entries(rawExports)) {
						mirFfi[name] = fn as (...args: any[]) => any;
						const arity = typeof fn === "function" ? computeArity(fn as Function) : 0;
						mirDeclarations.set(name, { name, arity, source: "ffi" });
					}
				}

				console.log(`Loaded module: ${filepath}`);
				ctx = F.pipe(
					ctx,
					update("imports", imps => ({ ...imps, ...R.fromEntries(imports), ...foreigns, ...letdecs })),
					update("ffi", ffi => ({ ...ffi, ...ffiExports })),
				);
				return rl.prompt();
			}

			if ([":implicits"].includes(trimmed)) {
				console.log("\nImplicits:");
				ctx.implicits.forEach(([tm, ty], i) => {
					console.log(`\n  [${i}]:`);
					console.log(`	Term: ${EB.Display.Term(tm, ctx)}`);
					console.log(`	Type: ${EB.NF.display(ty, ctx)}`);
				});
				console.log("");
				return rl.prompt();
			}

			// Empty line: execute buffered code if any
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

		// Add line to buffer and continue
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

const run = (code: string, ctx: EB.Context, opts: ReplOpts, mirFfi: Record<string, (...args: any[]) => any>, mirDeclarations: Map<string, Declaration>) => {
	const script = parse(code);
	return opts.mir ? interpretMIR(script[0], ctx, mirFfi, mirDeclarations, opts) : interpretNbE(script[0], ctx);
};

export const parse = (code: string) => {
	const g = Grammar;
	g.ParserStart = "Script";
	const parser = new Nearley.Parser(Nearley.Grammar.fromCompiled(Grammar));

	const sanitized = code.trim().endsWith(";") ? code : `${code};`;
	const data = parser.feed(sanitized);
	if (data.results.length !== 1) {
		console.error("Failed to parse statement");

		fs.writeFileSync(resolve(process.cwd(), "./.logs/error.json"), JSON.stringify(data.results, null, 2));

		throw new Error("Error while parsing statement. Check error.json for more information");
	}

	const { script }: Src.Script = data.results[0];
	if (script.length !== 1) {
		throw new Error("Expected a single statement");
	}
	return script;
};

const foldResult = (ctx: EB.Context, either: E.Either<EB.V2.Err, EB.Context>): EB.Context =>
	F.pipe(
		either,
		E.fold(
			(err: EB.V2.Err) => {
				console.warn(EB.V2.display(err));
				return ctx;
			},
			next => next,
		),
	);

const displayValue = (v: Value): string => {
	if (typeof v === "object" && v !== null && "__funcref" in v) {
		return `<function ${v.__funcref}>`;
	}

	if (typeof v === "object" && v !== null) {
		return JSON.stringify(v);
	}

	if (typeof v === "string") {
		return `"${v}"`;
	}
	return String(v);
};

export const interpretNbE = (stmt: Src.Statement, ctx: EB.Context): EB.Context => {
	const either = match(stmt)
		.with({ type: "expression" }, s =>
			F.pipe(
				EB.Mod.expression(s, ctx),
				E.map(([tm, ty, us, next]) => {
					if (options.showElaboration) {
						console.log("\n------------ Elaboration ------------");
						console.log(EB.Display.Term(tm, next));
						console.log("-------------------------------------\n");
					}
					const nf = EB.NF.evaluate(next, tm);
					console.log(EB.NF.display(nf, next), "::", EB.NF.display(ty, next), "\n");
					return next;
				}),
			),
		)
		.with({ type: "let" }, s => {
			const [name, result] = EB.Mod.letdec(s, ctx);
			return E.Functor.map(result, ([[tm, ty, us], next]) => next);
		})
		.with({ type: "using" }, s => EB.Mod.using(s, ctx))
		.otherwise(() => {
			throw new Error("Unsupported statement");
		});

	return foldResult(ctx, either);
};

const evalMIR =
	(ffi: Record<string, (...args: any[]) => any>) =>
	(mod: ReturnType<typeof lowerToMir>): Value =>
		mirInterpret(mod, ffi);

const evalCodegen =
	(ffi: Record<string, (...args: any[]) => any>) =>
	(mod: ReturnType<typeof lowerToMir>): unknown => {
		const program = emit(mod);
		const code = printJS(program);
		if (options.showElaboration) {
			console.log("\n------------- JS Output -------------");
			console.log(code);
			console.log("-------------------------------------\n");
		}
		const ffiNames = Object.keys(ffi);
		const ffiValues = Object.values(ffi);
		return new Function(...ffiNames, code)(...ffiValues);
	};

export const interpretMIR = (
	stmt: Src.Statement,
	ctx: EB.Context,
	ffi: Record<string, (...args: any[]) => any>,
	declarations: Map<string, Declaration>,
	opts: ReplOpts,
): EB.Context => {
	const evaluate = opts.codegen ? evalCodegen(ffi) : evalMIR(ffi);

	const either = match(stmt)
		.with({ type: "expression" }, s =>
			F.pipe(
				EB.Mod.expression(s, ctx),
				E.map(([tm, ty, us, next]) => {
					if (options.showElaboration) {
						console.log("\n------------ Elaboration ------------");
						console.log(EB.Display.Term(tm, next));
						console.log("-------------------------------------\n");
					}
					const mod = lowerToMir(tm, declarations);
					if (options.showElaboration) {
						console.log("\n--------------- MIR -----------------");
						console.log(Pretty.display.module(mod));
						console.log("-------------------------------------\n");
					}
					const result = evaluate(mod);
					console.log(displayValue(result as Value), "::", EB.NF.display(ty, next), "\n");
					return next;
				}),
			),
		)
		.with({ type: "let" }, s => {
			const [name, result] = EB.Mod.letdec(s, ctx);
			return E.Functor.map(result, ([[tm, ty, us], next]) => next);
		})
		.with({ type: "using" }, s => EB.Mod.using(s, ctx))
		.otherwise(() => {
			throw new Error("Unsupported statement");
		});

	return foldResult(ctx, either);
};

export const interpret = (stmt: Src.Statement, ctx: EB.Context) => interpretNbE(stmt, ctx);
