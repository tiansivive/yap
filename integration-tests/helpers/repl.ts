import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

export type ReplSnippet = {
	id: string;
	description: string;
	code: string;
};

export type ReplSnippetResult = {
	snippet: ReplSnippet;
	outputs: string[];
};

export type ReplRunResult = {
	stdout: string;
	stderr: string;
	results: ReplSnippetResult[];
	exitCode: number | null;
};

export type RunReplOptions = {
	timeoutMs?: number;
};

const repoRoot = path.resolve(__dirname, "..", "..");
const PNPM_CMD = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const DEFAULT_TIMEOUT_MS = 180_000;
const promptRegex = /^λ>/u;

export const runSnippetsThroughRepl = async (snippets: ReplSnippet[], options: RunReplOptions = {}): Promise<ReplRunResult> => {
	if (snippets.length === 0) {
		throw new Error("No tutorial snippets supplied");
	}

	const child = spawn(PNPM_CMD, ["yap", "repl"], {
		cwd: repoRoot,
		stdio: "pipe",
		env: { ...process.env, FORCE_COLOR: "0" },
	});

	let stdout = "";
	let stderr = "";
	const results: ReplSnippetResult[] = snippets.map(snippet => ({ snippet, outputs: [] }));
	let currentIndex = -1;

	const handleChunk = (chunk: Buffer, target: "stdout" | "stderr") => {
		const text = chunk.toString("utf8");
		if (target === "stdout") {
			stdout += text;
			text
				.split(/\r?\n/u)
				.map(line => line.trim())
				.filter(Boolean)
				.forEach(line => {
					if (promptRegex.test(line) || line.startsWith("Yap REPL started") || line.startsWith("Verbose mode:")) {
						return;
					}
					if (currentIndex >= 0 && line.includes("::")) {
						results[currentIndex].outputs.push(line);
					}
				});
			return;
		}
		stderr += text;
	};

	child.stdout?.on("data", chunk => handleChunk(chunk, "stdout"));
	child.stderr?.on("data", chunk => handleChunk(chunk, "stderr"));

	const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const timer = setTimeout(() => {
		child.kill("SIGTERM");
	}, timeout);

	const writeLine = (line: string) =>
		new Promise<void>((resolve, reject) => {
			if (!child.stdin) {
				reject(new Error("REPL stdin is not available"));
				return;
			}
			const ok = child.stdin.write(`${line}\n`);
			if (!ok) {
				child.stdin.once("drain", () => resolve());
				return;
			}
			resolve();
		});

	for (let i = 0; i < snippets.length; i += 1) {
		const snippet = snippets[i];
		currentIndex = i;
		const lines = snippet.code.split(/\r?\n/u);
		for (const line of lines) {
			const sanitized = line.replace(/\s+$/u, "");
			await writeLine(sanitized);
		}
		await writeLine("");
		await writeLine("");
	}

	await writeLine(":exit");
	child.stdin?.end();

	const closePromise = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>;
	const errorPromise = once(child, "error").then(args => {
		const [err] = args as [Error];
		throw err;
	});
	const [exitCode] = await Promise.race([closePromise, errorPromise]);
	clearTimeout(timer);

	return { stdout, stderr, results, exitCode };
};
