import { createContext, useContext, type ReactNode } from "react";

export interface PluginTestRpc {
  call(method: string, input: unknown): Promise<unknown>;
}

interface PluginTestRuntime {
  rpc: PluginTestRpc;
  settings: Record<string, string | boolean>;
}

const RuntimeContext = createContext<PluginTestRuntime | null>(null);

export function PluginTestRuntimeProvider({
  children,
  rpc,
  settings = {},
}: {
  children: ReactNode;
  rpc: PluginTestRpc;
  settings?: Record<string, string | boolean>;
}) {
  return (
    <RuntimeContext.Provider value={{ rpc, settings }}>
      {children}
    </RuntimeContext.Provider>
  );
}

function useRuntime(): PluginTestRuntime {
  const runtime = useContext(RuntimeContext);
  if (runtime === null) {
    throw new Error("PluginTestRuntimeProvider is missing");
  }
  return runtime;
}

export function useRpc<T>(): T {
  return useRuntime().rpc as T;
}

export function useSettings() {
  return { values: useRuntime().settings };
}

export function definePluginApp<T>(setup: T) {
  return { __bbPluginApp: true as const, setup };
}
