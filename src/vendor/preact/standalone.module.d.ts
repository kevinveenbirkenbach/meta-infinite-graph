// nocheck: prefix-folder  tsc resolves the bundle's types only from a sibling of the same name.
export function html(strings: TemplateStringsArray, ...values: unknown[]): any;
export function render(vnode: unknown, parent: Element | DocumentFragment): void;
export function useState<T>(initial: T): [T, (next: T) => void];
