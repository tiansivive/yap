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

export function repl() {
	const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "λ> " });

	let ctx: EB.Context = defaultContext;
	let buffer: string[] = [];

	const executeBuffer = () => {
		if (buffer.length === 0) {
			return;
		}

		const code = buffer.join("\n");
		buffer = [];
		rl.setPrompt("λ> ");
		ctx = run(code, ctx);
	};

	rl.on("line", input => {
		const trimmed = input.trim();

		try {
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
			rl.setPrompt("λ> ");
			return rl.prompt();
		}

		// Add line to buffer and continue
		buffer.push(input);
		rl.setPrompt("   ");
		rl.prompt();
	});

	// Ctrl+C: clear buffer and reset
	rl.on("SIGINT", () => {
		buffer = [];
		console.log("\n(Buffer cleared)");
		rl.setPrompt("λ> ");
		rl.prompt();
	});

	rl.prompt();
}

const run = (code: string, ctx: EB.Context) => {
	const script = parse(code);
	return interpret(script[0], ctx);
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

export const interpret = (stmt: Src.Statement, ctx: EB.Context) => {
	const either = match(stmt)
		.with({ type: "expression" }, s =>
			F.pipe(
				EB.Mod.expression(s, ctx),
				E.map(([tm, ty, us, zonker]) => {
					if (options.showElaboration) {
						console.log("\n------------ Elaboration ------------");
						console.log(EB.Display.Term(tm, ctx));
						console.log("-------------------------------------\n");
					}
					const nf = EB.NF.evaluate(ctx, tm);
					console.log(EB.NF.display(nf, ctx), "::", EB.NF.display(ty, ctx), "\n");
					return ctx;
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

	return F.pipe(
		either,
		E.fold(
			(err: EB.V2.Err) => {
				console.warn(EB.V2.display(err));
				return ctx;
			},
			next => next,
		),
	);
};
