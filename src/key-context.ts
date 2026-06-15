import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Holds the Lyfta API key for the current request. HTTP requests run inside
 * `keyContext.run(key, ...)`; stdio sets a process-wide default instead because
 * AsyncLocalStorage context does not survive the long-lived stdin listeners.
 */
export const keyContext = new AsyncLocalStorage<string>();

let defaultKey: string | undefined;

/** Set the process-wide fallback key (used by the stdio transport). */
export function setDefaultKey(key: string | undefined): void {
  defaultKey = key;
}

/** Resolve the active key: request-scoped first, then process default. */
export function getKey(): string {
  const key = keyContext.getStore() ?? defaultKey;
  if (!key) {
    throw new Error(
      "No Lyfta API key in context. HTTP: send 'Authorization: Bearer <key>'. stdio: set LYFTA_API_KEY.",
    );
  }
  return key;
}
