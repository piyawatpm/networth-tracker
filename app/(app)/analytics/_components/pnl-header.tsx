import { cn } from "@/lib/utils";

interface PnlHeaderProps {
  todayPnl: number;
  monthPnl: number;
  estimatedBalance: number;
  format: (amount: number) => string;
  symbol: string;
}

export function PnlHeader({
  todayPnl,
  monthPnl,
  estimatedBalance,
  format,
  symbol,
}: PnlHeaderProps) {
  return (
    <div className="finance-card px-3 py-4 sm:p-5">
      <div className="grid grid-cols-3 gap-4">
        {/* Today's PnL */}
        <div>
          <p className="label-mono mb-1">Today&apos;s PnL</p>
          <p
            className={cn(
              "text-lg sm:text-xl font-semibold font-mono tabular-nums",
              todayPnl > 0 && "text-income",
              todayPnl < 0 && "text-expense",
              todayPnl === 0 && "text-muted-foreground",
            )}
          >
            {todayPnl > 0 ? "+" : todayPnl < 0 ? "-" : ""}
            {format(Math.abs(todayPnl))}
          </p>
        </div>

        {/* This Month's PnL */}
        <div>
          <p className="label-mono mb-1">This Month</p>
          <p
            className={cn(
              "text-lg sm:text-xl font-semibold font-mono tabular-nums",
              monthPnl > 0 && "text-income",
              monthPnl < 0 && "text-expense",
              monthPnl === 0 && "text-muted-foreground",
            )}
          >
            {monthPnl > 0 ? "+" : monthPnl < 0 ? "-" : ""}
            {format(Math.abs(monthPnl))}
          </p>
        </div>

        {/* Estimated Balance */}
        <div>
          <p className="label-mono mb-1">Est. Balance</p>
          <p className="text-lg sm:text-xl font-semibold font-mono tabular-nums">
            {symbol}
            {format(estimatedBalance).replace(/^[^0-9]*/, "")}
          </p>
        </div>
      </div>
    </div>
  );
}
