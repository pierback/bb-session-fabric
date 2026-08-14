// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import appDefinition, { SessionFabricPanel } from "./app.js";
import { ConnectionDetails } from "./connection-details.js";
import { connection } from "./test-support/fixtures.js";
import {
  PluginTestRuntimeProvider,
  type PluginTestRpc,
} from "./test-support/plugin-sdk-app.js";

afterEach(cleanup);

describe("Session Fabric app registration", () => {
  it("contributes one thread-panel action", () => {
    const registrations: unknown[] = [];
    appDefinition.setup({
      slots: {
        threadPanelAction(value: unknown) {
          registrations.push(value);
        },
      },
    } as never);

    expect(registrations).toMatchObject([
      { id: "session-fabric", title: "Session Fabric", icon: "Workflow" },
    ]);
  });
});

describe("ConnectionDetails", () => {
  it("keeps low-level identifiers hidden by default", () => {
    const html = renderToStaticMarkup(
      <ConnectionDetails
        connection={{ ...connection, bindingId: "binding-secret-technical" }}
        showTechnicalIdentifiers={false}
      />,
    );
    expect(html).toContain("Implement portable sessions");
    expect(html).toContain("Active authority");
    expect(html).not.toContain("binding-secret-technical");
  });

  it("shows audit identifiers when the operator enables them", () => {
    const html = renderToStaticMarkup(
      <ConnectionDetails connection={connection} showTechnicalIdentifiers />,
    );
    expect(html).toContain("Technical identifiers");
    expect(html).toContain("binding-1");
    expect(html).toContain("conversation-1");
  });
});

describe("SessionFabricPanel", () => {
  it.each(["prepared", "host_bound"] as const)(
    "offers to resume a %s adoption",
    async (adoptionStatus) => {
      const calls: string[] = [];
      const rpc: PluginTestRpc = {
        async call(method) {
          calls.push(method);
          if (method === "threadConnection") {
            return {
              connection: {
                ...connection,
                adoptionStatus,
                isActiveAuthority: false,
                mutationPolicy: "staged_read_only",
              },
            };
          }
          if (method === "connectThread") return { connection };
          throw new Error(`unexpected ${method}`);
        },
      };

      const view = render(
        <PluginTestRuntimeProvider rpc={rpc}>
          <SessionFabricPanel params={null} threadId={connection.threadId} />
        </PluginTestRuntimeProvider>,
      );

      fireEvent.click(
        await view.findByRole("button", { name: "Resume connection" }),
      );
      expect(await view.findByText("Active authority")).toBeTruthy();
      expect(calls).toEqual(["threadConnection", "connectThread"]);
      expect(
        view.queryByRole("button", { name: "Resume connection" }),
      ).toBeNull();
    },
  );

  it("discards a pending connection when the panel switches threads", async () => {
    let resolveOldConnection!: (value: {
      connection: typeof connection;
    }) => void;
    const oldConnection = new Promise<{ connection: typeof connection }>(
      (resolve) => {
        resolveOldConnection = resolve;
      },
    );
    const rpc: PluginTestRpc = {
      async call(method, input) {
        const { threadId } = input as { threadId: string };
        if (method === "threadConnection") return { connection: null };
        if (method === "connectThread" && threadId === "thread-old") {
          return oldConnection;
        }
        throw new Error(`unexpected ${method} for ${threadId}`);
      },
    };

    const view = render(
      <PluginTestRuntimeProvider rpc={rpc}>
        <SessionFabricPanel params={null} threadId="thread-old" />
      </PluginTestRuntimeProvider>,
    );

    const oldThreadButton = await view.findByRole("button", {
      name: "Connect thread",
    });
    fireEvent.click(oldThreadButton);
    expect(
      await view.findByRole("button", { name: "Connecting…" }),
    ).toHaveProperty("disabled", true);

    view.rerender(
      <PluginTestRuntimeProvider rpc={rpc}>
        <SessionFabricPanel params={null} threadId="thread-new" />
      </PluginTestRuntimeProvider>,
    );
    const newThreadButton = await view.findByRole("button", {
      name: "Connect thread",
    });
    expect(newThreadButton).toHaveProperty("disabled", false);

    await act(async () => {
      resolveOldConnection({
        connection: { ...connection, threadId: "thread-old" },
      });
      await oldConnection;
    });
    expect(view.queryByText("Implement portable sessions")).toBeNull();
    expect(newThreadButton).toHaveProperty("disabled", false);
  });
});
