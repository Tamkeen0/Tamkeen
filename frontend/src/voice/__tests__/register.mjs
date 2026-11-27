// Lets Node's built-in test runner import the extensionless TypeScript
// imports used by the voice module (Vite "Bundler" resolution).
// Usage: node --experimental-strip-types --import ./frontend/src/voice/__tests__/register.mjs --test ...
import { register } from 'node:module';

register('./resolve-ts.mjs', import.meta.url);
