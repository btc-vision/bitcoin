export function prop<T extends object>(object: T, name: string, f: () => T[keyof T]): void {
    Object.defineProperty(object, name, {
        configurable: true,
        enumerable: true,
        get(): unknown {
            const _value = f.call(this as T);
            (this as Record<string, unknown>)[name] = _value;
            return _value;
        },
        set(_value: unknown): void {
            Object.defineProperty(this, name, {
                configurable: true,
                enumerable: true,
                value: _value,
                writable: true,
            });
        },
    });
}

export function value<T>(f: () => T): () => T {
    let _value: T;
    return (): T => {
        if (_value !== undefined) return _value;
        _value = f();
        return _value;
    };
}
