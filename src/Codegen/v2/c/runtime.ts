import fs from "fs";
import path from "path";

const SOURCE = "src/Codegen/v2/c/rt/yap_rt.h";

const source = (): string => {
	const candidates = [path.resolve(__dirname, "rt/yap_rt.h"), path.resolve(__dirname, "../../", SOURCE), path.resolve(process.cwd(), SOURCE)];
	const found = candidates.find(fs.existsSync);

	if (found === undefined) {
		throw new Error(`emit_c: runtime header not found (${candidates.join(", ")})`);
	}

	return found;
};

export const Runtime = {
	include: "rt/yap.h",
	copy: (outDir: string): void => {
		const dir = path.join(outDir, "rt");
		fs.mkdirSync(dir, { recursive: true });
		fs.copyFileSync(source(), path.join(dir, "yap.h"));
	},
} as const;
