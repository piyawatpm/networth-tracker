"use client";

import type { ReactNode } from "react";
import { CurrencyProvider } from "./currency-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <CurrencyProvider>
      <TooltipProvider delay={200}>
        {children}
      </TooltipProvider>
    </CurrencyProvider>
  );
}
