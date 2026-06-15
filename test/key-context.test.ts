import { describe, it, expect, beforeEach } from "vitest";
import { keyContext, getKey, setDefaultKey } from "../src/key-context.js";

describe("key-context", () => {
  beforeEach(() => setDefaultKey(undefined));

  it("returns the ALS store key inside run()", () => {
    keyContext.run("req-key", () => expect(getKey()).toBe("req-key"));
  });

  it("falls back to the default key outside run()", () => {
    setDefaultKey("default-key");
    expect(getKey()).toBe("default-key");
  });

  it("prefers ALS store over default", () => {
    setDefaultKey("default-key");
    keyContext.run("req-key", () => expect(getKey()).toBe("req-key"));
  });

  it("throws when no key is available", () => {
    expect(() => getKey()).toThrow(/No Lyfta API key/);
  });
});
