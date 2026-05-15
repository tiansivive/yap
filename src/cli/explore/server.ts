import http from "http";
import fs from "fs";
import path from "path";

import { run, type DeBruijnMode, type ParserRule, type VCFormat } from "./pipeline";

type Options = { port: number };

const STATIC = path.join(__dirname, "static");
const SYNTAX = path.resolve(__dirname, "../../../tooling/syntax-highlighting");

const MIME: Record<string, string> = {
	".html": "text/html",
	".js": "application/javascript",
	".css": "text/css",
};

const serveFile = (res: http.ServerResponse, filePath: string) => {
	if (!fs.existsSync(filePath)) {
		res.writeHead(404);
		return res.end("Not found");
	}
	const ext = path.extname(filePath);
	const mime = MIME[ext] ?? "text/plain";
	res.writeHead(200, { "Content-Type": mime });
	res.end(fs.readFileSync(filePath, "utf-8"));
};

const collect = (req: http.IncomingMessage): Promise<string> =>
	new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks).toString()));
		req.on("error", reject);
	});

const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
	const url = req.url ?? "/";

	if (req.method === "GET") {
		if (url === "/" || url === "/index.html") {
			return serveFile(res, path.join(STATIC, "index.html"));
		}

		if (url.startsWith("/syntax/")) {
			return serveFile(res, path.join(SYNTAX, url.slice(8)));
		}
		return serveFile(res, path.join(STATIC, url));
	}

	if (req.method === "POST" && url === "/run") {
		const body = JSON.parse(await collect(req));
		const source: string = body.source ?? "";
		const deBruijn: DeBruijnMode = body.deBruijn ?? "off";
		const parserRule: ParserRule = body.parserRule ?? "Ann";
		const rawJson: boolean = body.rawJson ?? false;
		const vcFormat: VCFormat = body.vcFormat ?? "pretty";

		const result = await run(source, { deBruijn, parserRule, rawJson, vcFormat });

		res.writeHead(200, { "Content-Type": "application/json" });
		return res.end(JSON.stringify(result));
	}

	res.writeHead(404);
	res.end("Not found");
};

export const start = (opts: Options) => {
	const server = http.createServer((req, res) => {
		handle(req, res).catch(err => {
			console.error(err);
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ errors: [String(err)] }));
		});
	});

	server.listen(opts.port, () => {
		console.log(`Pipeline Explorer: http://localhost:${opts.port}`);
	});
};
