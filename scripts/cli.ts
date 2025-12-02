#!/usr/bin/env ts-node -T
import { Command } from "commander";

import { createInterface } from "readline";
import * as Compiler from "../src/compile";
import { interpret } from "../src/interpreter";

import * as EB from "@yap/elaboration";
import { getZ3Context, options, setZ3Context } from "@yap/shared/config/options";

import { defaultContext } from "@yap/shared/lib/constants";
import { init } from "z3-solver";

const program = new Command();

program
	.arguments("<filepath>")
	.option("-o, --outDir <output>", "Output directory")
	.option("--srcDir <source>", "Source directory")
	.option("--verbose", "Enable verbose output")
	.description("Compile a Yap file")
	.action((file, cmd) => {
		console.log(`Compiling Yap file: ${file}`);
		console.log("Options:", cmd);

		options.verbose = cmd.verbose || false;
		console.log("Verbose mode:", options.verbose);

		const opts: Compiler.Options = {
			outDir: cmd.outDir || Compiler.GlobalDefaults.outDir,
			baseUrl: cmd.srcDir || Compiler.GlobalDefaults.baseUrl,
		};

		const z3Ctx = getZ3Context();
		if (z3Ctx) {
			Compiler.compile(file, opts);
			return;
		}
		init().then(z3 => {
			z3.enableTrace("main");
			const z3Ctx = z3.Context("main");
			setZ3Context(z3Ctx);
			Compiler.compile(file, opts);
		});
	});

program
	.command("repl")
	.description("Start a Yap REPL")
	.option("--verbose", "Enable verbose output")
	.action(async cmd => {
		console.log("Yap REPL started. Type :exit to quit.");
		options.verbose = cmd.verbose || false;
		console.log("Verbose mode:", options.verbose);

		const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "λ> " });

		let z3Ctx = getZ3Context();
		if (!z3Ctx) {
			const z3 = await init();
			z3.enableTrace("main");
			z3Ctx = z3.Context("main");
			setZ3Context(z3Ctx);
		}

		let ctx: EB.Context = defaultContext;
		let buffer: string[] = [];

		const runCode = (input: string) => {
			try {
				ctx = interpret(input, ctx);
			} catch (err) {
				console.error("Error:", err);
			}
		};

		const executeBuffer = () => {
			if (buffer.length === 0) {
				return;
			}

			const code = buffer.join("\n");
			buffer = [];
			rl.setPrompt("λ> ");
			runCode(code);
		};

		rl.on("line", input => {
			const trimmed = input.trim();

			// Commands work anywhere
			if ([":exit", ":quit", ":q"].includes(trimmed)) {
				console.log("Goodbye!");
				return rl.close();
			}

			if (trimmed === ":show_js") {
				options.showJS = !options.showJS;
				return rl.prompt();
			}

			if ([":nf", ":normalize"].includes(input.split(" ")[0])) {
				const [_, ...rest] = input.split(" ");
				ctx = interpret(rest.join(" "), ctx, { nf: true });
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
	});

program.parse();
