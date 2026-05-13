export const unzip = <A, B>(xs: [A, B][]): [A[], B[]] => [xs.map(([a]) => a), xs.map(([, b]) => b)];
