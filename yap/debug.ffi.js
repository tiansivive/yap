const print = str => console.log(JSON.stringify(str, null, 2));

const stringify = a => obj => JSON.stringify(obj, null, 2);

module.exports = { print, stringify };
