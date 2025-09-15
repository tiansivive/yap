import * as V2 from "@yap/elaboration/shared/monad.v2";

const foo = V2.Do(function* () {
	const ctx = yield* V2.ask();
	console.log(ctx);
	return ctx;
});
