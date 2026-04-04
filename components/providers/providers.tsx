"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { DataProvider } from "./data-provider";
import { CurrencyProvider } from "./currency-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <DataProvider>
        <CurrencyProvider>
          <TooltipProvider delay={200}>
            {children}
          </TooltipProvider>
        </CurrencyProvider>
      </DataProvider>
    </ThemeProvider>
  );
}
