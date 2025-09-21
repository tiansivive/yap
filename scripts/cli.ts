#!/usr/bin/env ts-node -T
import { Command } from "commander";

import { createInterface } from "readline";
import * as Compiler from "../src/compile";
import { interpret } from "../src/interpreter";

import * as EB from "@yap/elaboration";
import * as Lib from "@yap/shared/lib/primitives";
import { options } from "@yap/shared/config/options";

const program = new Command();

program
	.arguments("<filepath>")
	.option("-o, --outDir <output>", "Output directory")
	.option("--srcDir <source>", "Source directory")
	.description("Compile a Yap file")
	.action((file, cmd) => {
		console.log(`Compiling Yap file: ${file}`);
		console.log("Options:", cmd);

		const opts: Compiler.Options = {
			outDir: cmd.outDir || Compiler.GlobalDefaults.outDir,
			baseUrl: cmd.srcDir || Compiler.GlobalDefaults.baseUrl,
		};
		Compiler.compile(file, opts);
	});

program
	.command("repl")
	.description("Start a Yap REPL")
	.option("--verbose", "Enable verbose output")
	.action(cmd => {
		console.log("Yap REPL started. Type :exit to quit.");
		options.verbose = cmd.verbose || false;
		console.log("Verbose mode:", options.verbose);

		const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "λ> " });

		let ctx: EB.Context = {
			env: [],
			types: [],
			names: [],
			implicits: [],
			sigma: {},
			trace: [],
			imports: { ...Lib.Elaborated },
			zonker: {},
			ffi: Lib.PrimOps,
		};
		const runCode = (input: string) => {
			try {
				ctx = interpret(input, ctx);
			} catch (err) {
				console.error("Error:", err);
				rl.prompt();
			}
		};
		rl.on("line", input => {
			if ([":exit", ":quit", ":q"].includes(input.trim())) {
				console.log("Goodbye!");
				return rl.close();
			}

			if ([":nf", ":normalize"].includes(input.split(" ")[0])) {
				const [_, ...rest] = input.split(" ");
				ctx = interpret(rest.join(" "), ctx, { nf: true });
				return rl.prompt();
			}

			if (input.trim() === "") {
				return rl.prompt();
			}

			runCode(input);
			rl.prompt();
		});

		rl.prompt();
	});

program.parse();
