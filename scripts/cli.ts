#!/usr/bin/env ts-node -T
import { Command } from "commander";

import { createInterface } from "readline";
import * as Compiler from "../src/QTT/compile";

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
		// console.log('Yap REPL started. Type :exit to quit.');
		// const rl = createInterface({ input: process.stdin, output: process.stdout });
		// const runCode = (input) => {
		//     try {
		//         const jsCode = compile(input, { singleExpr: true });
		//         console.log(eval(jsCode)); // Dangerous but fine for local dev
		//     } catch (err) {
		//         console.error('Error:', err);
		//     }
		// };
		// rl.on('line', (input) => {
		//     if (input.trim() === 'exit') {
		//         rl.close();
		//     } else {
		//         runCode(input);
		//     }
		// });
	});

program.parse();
