/**
 * Regression test for issue #402 — prevent browser tool schema from bloating.
 *
 * Asserts that the canonical (en) toolDef.browser.description + actionDesc
 * stay under a tight budget, that actionDesc still encodes the per-action
 * param contract, and that the [ref] staleness warning is preserved.
 *
 * If you intentionally expand these fields, update the threshold and write
 * the reason into the commit message.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnBrowserDef() {
  const path = resolve(__dirname, "../desktop/src/locales/en.json");
  return JSON.parse(readFileSync(path, "utf8")).toolDef.browser;
}

describe("browser tool schema size (#402)", () => {
  it("keeps en description + actionDesc under 700 chars", () => {
    const def = loadEnBrowserDef();
    const total = def.description.length + def.actionDesc.length;
    expect(total).toBeLessThan(700);
  });

  it("encodes the action→param contract in actionDesc", () => {
    const def = loadEnBrowserDef();
    for (const action of ["navigate", "click", "type", "scroll", "select", "key", "evaluate"]) {
      expect(def.actionDesc).toContain(action);
    }
  });

  it("keeps the stale-ref warning in description", () => {
    const def = loadEnBrowserDef();
    expect(def.description).toMatch(/ref/i);
  });
});
