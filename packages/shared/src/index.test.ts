import test from "node:test";
import assert from "node:assert/strict";
import { isValidRole } from "./index";

test("isValidRole validates supported roles", () => {
  assert.equal(isValidRole("owner"), true);
  assert.equal(isValidRole("front_desk"), true);
  assert.equal(isValidRole("unknown"), false);
});
