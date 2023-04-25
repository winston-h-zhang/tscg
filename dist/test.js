export class Foo {
    bar(x, callback) {
        return callback(callback(x));
    }
}
export const double = function (x) {
    return x + x;
};
export const foo = new Foo();
foo.bar(5, double);
//# sourceMappingURL=test.js.map