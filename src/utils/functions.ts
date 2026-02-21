



export function iife<Args extends any[], B>(...args: [...Args, (...args: Args) => B]): B {
    const fn = args.pop() as (...args: any[]) => any;
    return fn(...args);
}