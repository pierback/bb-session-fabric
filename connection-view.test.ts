import { describe, expect, it } from "vitest";

import { formatConnection, projectConnection } from "./connection-view.js";
import { connection } from "./test-support/fixtures.js";

describe("connection view", () => {
  it("projects the public SDK result without exposing implementation types", () => {
    expect(projectConnection(connection as never)).toEqual(connection);
  });

  it("renders a concise operator status", () => {
    expect(formatConnection(connection, connection.threadId)).toContain(
      "State: idle · active authority · enabled",
    );
    expect(formatConnection(null, "thread-missing")).toBe(
      "Thread thread-missing is not connected to Session Fabric.\n",
    );
  });
});
