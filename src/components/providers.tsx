"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { useColorScheme } from "@/components/shell/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserDataProvider } from "@/components/user/user-context";
import { AuthDialogProvider } from "@/components/auth/auth-dialog";
import { stationDatasetQueryOptions } from "@/components/stations/use-station-dataset";
import { engineOfPath } from "@/lib/planner-routes";
import { usePlanner } from "@/lib/store";

function ThemedToaster() {
  const scheme = useColorScheme();
  return <Toaster theme={scheme} position="top-center" />;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000 },
        },
      }),
  );
  useEffect(() => {
    // En /v1 y /v2 manda la ruta; en otras páginas, el último motor usado.
    const engine = engineOfPath(window.location.pathname) ?? usePlanner.getState().engineChoice;
    void client.prefetchQuery(stationDatasetQueryOptions(engine));
  }, [client]);
  return (
    <QueryClientProvider client={client}>
      <UserDataProvider>
        <AuthDialogProvider>
          <TooltipProvider delayDuration={250}>
            {children}
            <ThemedToaster />
          </TooltipProvider>
        </AuthDialogProvider>
      </UserDataProvider>
    </QueryClientProvider>
  );
}
