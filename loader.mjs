// Resolve Next-style extensionless relative imports ("./db") for plain Node,
// so the real lib modules can be exercised outside the Next runtime.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as presolve } from 'node:path';

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    const base = dirname(fileURLToPath(context.parentURL));
    for (const ext of ['.js', '.mjs', '/index.js']) {
      const p = presolve(base, specifier + ext);
      if (existsSync(p)) return next(pathToFileURL(p).href, context);
    }
  }
  return next(specifier, context);
}
