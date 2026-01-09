export *;

foreign print: String -> Unit;
foreign readLine: Unit -> String;
foreign stringToNum: String -> Num;


let Piece: Type
	= | #king Unit
	  | #queen Unit
	  | #rook Unit
	  | #bishop Unit;

let Square: Type
	= { file: Num, rank: Num };

let Placement: Type
	= { square: Square, piece: Piece };

let Board: Type
	= { [Placement]: Placement };

let emptyBoard: Board = [];


let diff: Num -> Num -> Num
	= \a b -> match a >= b
		| true  -> a - b
		| false -> b - a;

let max: Num -> Num -> Num
	= \a b -> match a >= b
		| true  -> a
		| false -> b;


let isDark: Square -> Bool
	= \sq -> ((sq.file + sq.rank) % 2) == 1;

let squareColor: Square -> String
	= \sq -> match ((sq.file + sq.rank) % 2)
		| 0 -> "light"
		| 1 -> "dark"
		| _ -> "light";

let sameColor: Square -> Square -> Bool
	= \a b -> isDark a == isDark b;


let sees: Piece -> Square -> Square -> Bool
	= \p from to ->
		let dx = diff from.file to.file;
		let dy = diff from.rank to.rank;
		match p
			| #rook _   -> (dx == 0 && dy > 0) || (dy == 0 && dx > 0)
			| #bishop _ -> dx == dy && dx > 0
			| #queen _  -> ((dx == 0 && dy > 0) || (dy == 0 && dx > 0)) || (dx == dy && dx > 0)
			| #king _   -> max dx dy == 1;


let minMovesRook: Square -> Square -> Num
	= \from to -> {
		let dx = diff from.file to.file;
		let dy = diff from.rank to.rank;
		match { dx, dy }
			| { 0, 0 } -> 0
			| { 0, _ } -> 1
			| { _, 0 } -> 1
			| { _, _ } -> 2;
	};

let minMovesBishop: Square -> Square -> Num
	= \from to -> {
		let dx = diff from.file to.file;
		let dy = diff from.rank to.rank;
		match { dx, dy }
			| { 0, 0 } -> 0
			| { _, _ } -> {
				match sameColor from to
					| false -> -1
					| true  -> match dx == dy
						| true  -> 1
						| false -> 2;
			};
	};

let minMovesQueen: Square -> Square -> Num
	= \from to -> {
		let dx = diff from.file to.file;
		let dy = diff from.rank to.rank;
		match { dx, dy }
			| { 0, 0 } -> 0
			| { 0, _ } -> 1
			| { _, 0 } -> 1
			| { _, _ } -> match dx == dy
				| true  -> 1
				| false -> 2;
	};

let minMovesKing: Square -> Square -> Num
	= \from to -> {
		let dx = diff from.file to.file;
		let dy = diff from.rank to.rank;
		return max dx dy;
	};

let minMoves: Piece -> Square -> Square -> Num
	= \p from to -> match p
		| #rook _   -> minMovesRook from to
		| #bishop _ -> minMovesBishop from to
		| #queen _  -> minMovesQueen from to
		| #king _   -> minMovesKing from to;


let a1: Square = { file: 1, rank: 1 };
let a2: Square = { file: 1, rank: 2 };
let c1: Square = { file: 3, rank: 1 };
let e1: Square = { file: 5, rank: 1 };
let e4: Square = { file: 5, rank: 4 };
let h6: Square = { file: 8, rank: 6 };


let askSeesQuestion: Unit -> Unit
	= \_ -> {
		let piece = #rook !;
		let from = a1;
		let target = e1;
		print "Question: From a1, does a rook see e1? (yes/no)";
		let answer = readLine !;
		let correct = sees piece from target;
		let expected = match correct
			| true  -> "yes"
			| false -> "no";
		match answer == expected
			| true  -> print "Correct!"
			| false -> {
				print "Wrong.";
				print ("Correct answer was: " <> expected);
			};
	};


let askColorQuestion: Unit -> Unit
	= \_ -> {
		let sq = e4;
		print "Question: Is e4 a dark or light square? (dark/light)";
		let answer = readLine !;
		let expected = squareColor sq;
		match answer == expected
			| true  -> print "Correct!"
			| false -> {
				print "Wrong.";
				print ("Correct answer was: " <> expected);
			};
	};


let askBishopDistanceQuestion: Unit -> Unit
	= \_ -> {
		let piece = #bishop !;
		let from = c1;
		let target = h6;
		print "Question: Least number of bishop moves from c1 to h6?";
		let answer = readLine !;
		let expected = minMoves piece from target;
		let n = stringToNum answer;
		match n == expected
			| true  -> print "Correct!"
			| false -> {
				let expStr = "" <> expected;
				print "Wrong.";
				print ("Correct answer was: " <> expStr);
			};
	};


let run = \(x:Unit) -> {
	print "Welcome to the Yap chess trainer (empty board).";
	askSeesQuestion !;
	askColorQuestion !;
	askBishopDistanceQuestion !;
};

