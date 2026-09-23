"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserDataProvider } from "@/components/user/user-context";
import { AuthDialogProvider } from "@/components/auth/auth-dialog";

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000 },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <UserDataProvider>
        <AuthDialogProvider>
          <TooltipProvider delayDuration={250}>
            {children}
            <Toaster
              theme="dark"
              position="top-center"
              toastOptions={{
                style: {
                  background: "#161c23",
                  border: "1px solid rgb(238 242 246 / 0.1)",
                  color: "#eef2f6",
                },
              }}
            />
          </TooltipProvider>
        </AuthDialogProvider>
      </UserDataProvider>
    </QueryClientProvider>
  );
}
