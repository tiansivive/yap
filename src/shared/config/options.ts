export const options = {
	verbose: false,
	showJS: false,
	showElaboration: false,
	/**
	 * Fuel cap for an NbE drive; exceeding it throws. Entry points set it from `YAP_MAX_STEPS`.
	 *
	 * The cap counts steps. A loop that allocates on every step can exhaust the heap before reaching
	 * it, and that failure names no term. A lower cap trades headroom for a diagnostic that names the
	 * divergent term.
	 */
	maxSteps: 10_000_000,
};
