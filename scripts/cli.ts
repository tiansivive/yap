#!/usr/bin/env ts-node -T
import { Command } from "commander";

import { createInterface } from "readline";
import * as Compiler from "../src/QTT/compile";
import { interpret } from "../src/QTT/interpreter";

import * as EB from "@qtt/elaboration";
import * as Lib from "@qtt/shared/lib/primitives";

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
	.action(() => {
		console.log("Yap REPL started. Type :exit to quit.");
		const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "λ> " });

		let ctx: EB.Context = {
			env: [],
			types: [],
			names: [],
			implicits: [],
			trace: [],
			imports: { ...Lib.Elaborated },
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

			if (input.trim() === "") {
				return rl.prompt();
			}

			runCode(input);
			rl.prompt();
		});

		rl.prompt();
	});

program.parse();
