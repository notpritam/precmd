// ABOUTME: Tests for the minimal glob matcher.
// ABOUTME: Verifies * vs ** segment semantics and prefix globs.
import { expect, test } from "vitest";
import { globMatch } from "./glob";

test("** crosses path segments", () => {
  expect(globMatch("**/checkout/**", "src/checkout/pay.ts")).toBe(true);
  expect(globMatch("**/checkout/**", "src/home/pay.ts")).toBe(false);
});

test("* stays within a single segment", () => {
  expect(globMatch("src/*.ts", "src/a.ts")).toBe(true);
  expect(globMatch("src/*.ts", "src/a/b.ts")).toBe(false);
});

test("prefix glob with trailing **", () => {
  expect(globMatch("**/payment*/**", "src/paymentApi/x.ts")).toBe(true);
});

test("filename keyword globs match case-insensitively", () => {
  expect(globMatch("**/*checkout*", "src/hooks/useChurnCheckout.ts")).toBe(true);
  expect(globMatch("**/*payment*", "src/lib/paymentUtils.ts")).toBe(true);
  expect(globMatch("**/*checkout*", "src/home/list.ts")).toBe(false);
});
