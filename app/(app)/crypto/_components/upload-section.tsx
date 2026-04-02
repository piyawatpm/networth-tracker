"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/ui/blur-fade";
import { Upload } from "lucide-react";
import { parseAndComputeHoldings } from "@/lib/utils/crypto-csv";
import { fetchCryptoPrices } from "@/lib/utils/crypto-prices";

export function UploadSection({
  setCsvText,
  setCsvUploadedAt,
  setLivePrices,
}: {
  setCsvText: (text: string) => void;
  setCsvUploadedAt: (ts: number | null) => void;
  setLivePrices: React.Dispatch<React.SetStateAction<Record<string, number>>>;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      setUploadStatus("Reading file...");
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text && text.trim().length > 0) {
          setCsvText(text);
          setCsvUploadedAt(Date.now());
          const h = parseAndComputeHoldings(text);
          if (h.length > 0) {
            setUploadStatus(`Loaded ${h.length} holdings`);
            const tokens = h.map((holding) => holding.token);
            fetchCryptoPrices(tokens).then((prices) => {
              if (Object.keys(prices).length > 0) {
                setLivePrices(prices);
              }
            });
          } else {
            setUploadStatus("Could not parse holdings. Check CSV format.");
          }
        } else {
          setUploadStatus("File was empty");
        }
      };
      reader.onerror = () => {
        setUploadStatus("Error reading file");
      };
      reader.readAsText(file);
    },
    [setCsvText, setCsvUploadedAt, setLivePrices],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      if (e.target) e.target.value = "";
    },
    [handleFile],
  );

  return (
    <div className="space-y-8">
      <BlurFade delay={0}>
        <div>
          <p className="label-mono mb-2">CRYPTO PORTFOLIO</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Import your crypto data
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Upload a CSV export from your exchange to track holdings,
            allocations, and profit/loss.
          </p>
        </div>
      </BlurFade>

      <BlurFade delay={0.08}>
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "finance-card flex flex-col items-center justify-center gap-4 p-12 md:p-20 cursor-pointer border-2 border-dashed transition-colors",
            isDragOver
              ? "border-accent bg-accent/5"
              : "border-border/60 hover:border-muted-foreground/30",
          )}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
            <Upload className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">
              Drop your CSV file here, or click to browse
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Accepts .csv files from crypto exchanges
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,text/plain,application/vnd.ms-excel"
            onChange={onFileSelect}
            className="hidden"
          />
        </div>
        {uploadStatus && (
          <p className="text-xs text-muted-foreground text-center mt-2">{uploadStatus}</p>
        )}
      </BlurFade>
    </div>
  );
}
