const { lstatSync } = require("fs");

// Prettier hard-errors when an explicitly passed path is a symbolic link
// (e.g. .claude/skills/* bridging into .cursor/skills/*). Format the real
// files; skip symlinks since their targets are formatted at the source.
module.exports = {
	"*": files => {
		const real = files.filter(file => !lstatSync(file).isSymbolicLink());
		if (real.length === 0) {
			return [];
		}
		const args = real.map(file => JSON.stringify(file)).join(" ");
		return [`prettier --ignore-unknown --write ${args}`];
	},
};
