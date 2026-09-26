"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { useColorScheme } from "@/components/shell/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserDataProvider } from "@/components/user/user-context";
import { AuthDialogProvider } from "@/components/auth/auth-dialog";
import { stationDatasetQueryOptions } from "@/components/stations/use-station-dataset";

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
    void client.prefetchQuery(stationDatasetQueryOptions);
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
