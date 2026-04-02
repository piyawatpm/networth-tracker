"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImageViewerProps {
  images: string[];
  description: string;
}

export function ImageViewer({ images, description }: ImageViewerProps) {
  if (images.length === 0) return null;

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attachments</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {images.map((src, i) => (
            <img
              key={i}
              src={src}
              alt={`Attachment ${i + 1}`}
              className="w-full rounded-lg border border-border"
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
