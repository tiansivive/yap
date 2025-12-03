#!/usr/bin/env ts-node -T
import { Command } from "commander";

import { createInterface } from "readline";
import * as Compiler from "../src/compile";
import { interpret } from "../src/cli/interpreter";

import * as EB from "@yap/elaboration";
import { getZ3Context, options, setZ3Context } from "@yap/shared/config/options";

import { defaultContext } from "@yap/shared/lib/constants";
import { init } from "z3-solver";
import { repl } from "../src/cli/repl";

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

		let z3Ctx = getZ3Context();
		if (!z3Ctx) {
			const z3 = await init();
			z3.enableTrace("main");
			z3Ctx = z3.Context("main");
			setZ3Context(z3Ctx);
		}

		repl();
	});

program.parse();
