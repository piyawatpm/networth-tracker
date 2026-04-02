"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { ImagePlus, X } from "lucide-react";

interface ImageUploadProps {
  images: string[];
  onChange: (images: string[]) => void;
  maxImages?: number;
}

export function ImageUpload({ images, onChange, maxImages = 3 }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;

    const remaining = maxImages - images.length;
    const toProcess = Array.from(files).slice(0, remaining);

    for (const file of toProcess) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 500 * 1024) continue;

      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        onChange([...images, result]);
      };
      reader.readAsDataURL(file);
    }

    if (inputRef.current) inputRef.current.value = "";
  }

  function handleRemove(index: number) {
    onChange(images.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {images.map((src, i) => (
          <div key={i} className="relative group">
            <img
              src={src}
              alt={`Attachment ${i + 1}`}
              className="h-12 w-12 rounded-md object-cover border border-border"
            />
            <button
              type="button"
              onClick={() => handleRemove(i)}
              className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-background flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
      </div>
      {images.length < maxImages && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          className="text-xs"
        >
          <ImagePlus className="h-3.5 w-3.5 mr-1" />
          Add Image
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
