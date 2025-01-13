import { readFileSync } from "fs";
import { resolve } from "path";

// Utility to "import" custom files
export function load(filePath: string): string {
	return readFileSync(resolve(process.cwd(), filePath), "utf-8");
}
