const prepend = a => array => {
	return [a, ...array];
};

module.exports = { prepend };
