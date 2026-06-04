import { test } from "node:test";
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { registerSSEClient, removeSSEClient, broadcastSSEEvent } from "./clients";

// A minimal ServerResponse stand-in that just records what was written.
function fakeRes(): { res: ServerResponse; writes: string[] } {
  const writes: string[] = [];
  const res = { write: (chunk: string) => { writes.push(chunk); return true; } } as unknown as ServerResponse;
  return { res, writes };
}

test("broadcastSSEEvent only reaches clients of the originating tenant (F-1)", () => {
  const a = fakeRes();
  const b = fakeRes();
  const idA = registerSSEClient(a.res, "tenant-A");
  const idB = registerSSEClient(b.res, "tenant-B");

  try {
    broadcastSSEEvent("tenant-A", { type: "sr_updated", data: { id: "sr-1" } });

    assert.equal(a.writes.length, 1, "tenant-A client should receive its own event");
    assert.match(a.writes[0], /sr_updated/);
    assert.equal(b.writes.length, 0, "tenant-B client must NOT receive tenant-A's event");
  } finally {
    removeSSEClient(idA);
    removeSSEClient(idB);
  }
});

test("broadcastSSEEvent delivers to every client of the same tenant", () => {
  const a1 = fakeRes();
  const a2 = fakeRes();
  const other = fakeRes();
  const id1 = registerSSEClient(a1.res, "tenant-A");
  const id2 = registerSSEClient(a2.res, "tenant-A");
  const id3 = registerSSEClient(other.res, "tenant-C");

  try {
    broadcastSSEEvent("tenant-A", { type: "checkin_event", data: { roomNumber: "204" } });

    assert.equal(a1.writes.length, 1);
    assert.equal(a2.writes.length, 1);
    assert.equal(other.writes.length, 0, "unrelated tenant must not receive the event");
  } finally {
    removeSSEClient(id1);
    removeSSEClient(id2);
    removeSSEClient(id3);
  }
});
