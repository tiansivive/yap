const prepend = () => a => array => {
	let arr = !Array.isArray(array) ? Array.from(array) : array;
	return [a, ...arr];
};

let ArrayF = (() => {
	const rec = {};
	Object.defineProperty(rec, "map", {
		get: () => a => {
			return b => {
				return f => {
					return xs => {
						return (() => {
							const $x = xs;
							if (Array.isArray($x) && $x.length === 0) {
								return (() => {
									const rec = [];
									return rec;
								})();
							} else if (Array.isArray($x) && $x[0]) {
								const x = $x[0];
								const xs = $x.slice(1);
								return prepend(b)(f(x))(rec.map(a)(b)(f)(xs));
							}
						})();
					};
				};
			};
		},
	});
	return rec;
})();

const fn = ArrayF.map(null)(null)(a => a + 1);

console.log(fn([1, 2, 3, 4]));
