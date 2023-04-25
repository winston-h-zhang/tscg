export class Foo {
    bar(x: number, callback: (x: number) => number): number {
        return callback(callback(x));
    }
}

export const double = function(x: number) {
    return x + x;
}

export const foo = new Foo();
foo.bar(5, double);