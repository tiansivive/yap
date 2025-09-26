const dbg = require("../bin/debug.js");

dbg.block(1);

const empty = dbg.mapL("Num")("Num")(x => x + 1)(dbg.empty);
const mapped = dbg.mapL("Num")("Num")(x => x + 1)(dbg.one);

console.log(JSON.stringify(dbg.empty, null, 2));
console.log(JSON.stringify(dbg.one, null, 2));

console.log(JSON.stringify(empty, null, 2));
console.log(JSON.stringify(mapped, null, 2));

const bar = dbg.main(x => x + 1);
