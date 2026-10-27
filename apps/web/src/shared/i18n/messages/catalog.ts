/** Same keys as `T`, every leaf a plain string: `satisfies Catalog<typeof de>` rejects missing and excess keys. */
export type Catalog<T> = { [K in keyof T]: T[K] extends string ? string : Catalog<T[K]> };
