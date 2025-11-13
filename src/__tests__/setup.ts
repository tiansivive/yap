import { expect } from "vitest";

/**
 * Recursively removes specified keys from an object.
 * Used by the snapshot serializer to strip non-deterministic or verbose keys.
 */
export function stripKeys(obj: any, keysToRemove: string[]): any {
	if (obj === null || obj === undefined) {
		return obj;
	}

	if (typeof obj !== "object") {
		return obj;
	}

	if (Array.isArray(obj)) {
		return obj.map(item => stripKeys(item, keysToRemove));
	}

	const out: Record<string, any> = {};
	for (const k of Object.keys(obj)) {
		if (keysToRemove.includes(k)) {
			continue;
		}
		out[k] = stripKeys(obj[k], keysToRemove);
	}
	return out;
}

/**
 * Keys to remove from all snapshots.
 * Add any non-deterministic or verbose keys here.
 */
const KEYS_TO_STRIP: string[] = [
	// Add keys you want to exclude from snapshots, e.g.:
	"ffi",
	"imports",
	"location",
	"trace",
];

/**
 * Snapshot serializer that removes specified keys from all snapshots.
 * This runs automatically for all snapshot tests in the elaboration suite.
 */
expect.addSnapshotSerializer({
	serialize(val, config, indentation, depth, refs, printer) {
		const stripped = stripKeys(val, KEYS_TO_STRIP);
		return printer(stripped, config, indentation, depth, refs);
	},

	test: (val: any) => !!val && typeof val === "object" && !Array.isArray(val) && Object.keys(val).some(k => KEYS_TO_STRIP.includes(k)),
});
