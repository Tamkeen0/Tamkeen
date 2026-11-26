// Resolve hook: "./x" -> "./x.ts" or "./x/index.ts" when the bare path does not exist.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (!relative || /\.[cm]?[jt]s$/.test(specifier) || !['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(err?.code)) throw err;
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      try {
        return await next(candidate, context);
      } catch {
        /* try next */
      }
    }
    throw err;
  }
}
