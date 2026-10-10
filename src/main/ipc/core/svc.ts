// Lazy service loader: the module is required on first call and cached.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function svc<T = any>(name: string): () => T {
  let cached: T | undefined;
  return () => (cached ??= require(`../../services/${name}`) as T);
}
