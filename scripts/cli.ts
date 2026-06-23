#!/usr/bin/env node
import { Command } from "commander";

import * as Compiler from "../src/compile";
import { options } from "@yap/shared/config/options";
import { repl } from "../src/cli/repl";
import { start as startExplorer } from "../src/cli/explore";
import { Build } from "../src/verification/solver/ivl/build";

const program = new Command();

program
	.arguments("<filepath>")
	.option("-o, --outDir <output>", "Output directory", Compiler.GlobalDefaults.outDir)
	.option("--srcDir <source>", "Source directory", Compiler.GlobalDefaults.baseUrl)
	.option("-t, --target <target>", "Codegen target: js, c, or erlang", "js")
	.option("--no-gram", "Skip .gram file output")
	.option("--no-mir", "Skip .mir file output")
	.option("--verbose", "Enable verbose output")
	.description("Compile a Yap file")
	.action((file, cmd) => {
		console.log(`Compiling Yap file: ${file}`);

		options.verbose = cmd.verbose || false;

		const target = cmd.target as Compiler.Target;
		if (!["js", "c", "erlang"].includes(target)) {
			console.error(`Unknown target: ${target}. Use 'js', 'c', or 'erlang'.`);
			process.exit(1);
		}

		const opts: Partial<Compiler.Options> = {
			outDir: cmd.outDir,
			baseUrl: cmd.srcDir,
			target,
			emitGram: cmd.gram !== false,
			emitMir: cmd.mir !== false,
		};

		Compiler.compile(file, opts);
	});

program
	.command("repl")
	.description("Start a Yap REPL")
	.option("--verbose", "Enable verbose output")
	.option("--codegen", "Use codegen instead of MIR interpreter")
	.option("-t, --target <target>", "Codegen target: js, c, or erlang (requires --codegen)", "js")
	.option("--no-verify", "Skip verification")
	.action(cmd => {
		console.log("Yap REPL started. Type :help for commands, :exit to quit.");
		options.verbose = cmd.verbose || false;

		const target = cmd.target as "js" | "c" | "erlang";
		if (!["js", "c", "erlang"].includes(target)) {
			console.error(`Unknown target: ${target}. Use 'js', 'c', or 'erlang'.`);
			process.exit(1);
		}

		const codegen = cmd.codegen || false;
		if (target !== "js" && !codegen) {
			console.error(`--target=${target} requires --codegen`);
			process.exit(1);
		}

		if (codegen) {
			console.log(`Codegen mode active (target: ${target})`);
		} else {
			console.log("MIR interpreter mode active");
		}

		if (cmd.verify === false) {
			console.log("Verification disabled");
		}

		repl({ codegen, target, verify: cmd.verify !== false });
	});

program
	.command("explore")
	.description("Open pipeline explorer dashboard")
	.option("-p, --port <number>", "port", "3333")
	.option("--ivl-no-simplify", "Disable IVL algebraic simplification")
	.action(cmd => {
		if (cmd.ivlNoSimplify) {
			Build.simplify = false;
		}
		startExplorer({ port: parseInt(cmd.port) });
	});

program.parse();
