import { describe, expect, it } from "vitest";
import { encodeMessage, parseMessage, PROTOCOL_VERSION, type ClientMessage } from "../src/net/index.ts";

describe("net messages", () => {
  it("round-trips through JSON", () => {
    const m: ClientMessage = { type: "hello", protocol: PROTOCOL_VERSION, name: "Ann" };
    expect(parseMessage<ClientMessage>(encodeMessage(m))).toEqual(m);
  });

  it("rejects frames that are not messages", () => {
    for (const bad of ["", "nope", "[]", "null", "42", '{"kind":"hello"}', '{"type":1}']) {
      expect(parseMessage(bad)).toBeUndefined();
    }
  });
});
