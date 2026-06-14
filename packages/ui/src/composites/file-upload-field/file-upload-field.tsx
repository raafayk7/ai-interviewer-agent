"use client";

import * as React from "react";
import { Button } from "@repo/ui/primitives/button";
import { cn } from "@repo/ui/lib/cn";

export interface FileUploadFieldProps {
  id: string;
  label: string;
  accept?: string;
  file: File | null;
  onChange: (file: File | null) => void;
  error?: string;
  disabled?: boolean;
}

export function FileUploadField({ id, label, accept = ".pdf", file, onChange, error, disabled }: FileUploadFieldProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  function handleFiles(list: FileList | null) {
    onChange(list?.[0] ?? null);
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-input bg-card p-6 text-center transition-colors",
          dragOver && "border-primary bg-popover",
          disabled && "pointer-events-none opacity-50",
          error && "border-negative",
        )}
      >
        {file ? (
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm text-foreground">{file.name}</span>
            <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>Remove</Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Drop a {accept} file here, or</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
              Choose file
            </Button>
          </>
        )}
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
          disabled={disabled}
        />
      </div>
      {error && <p className="text-sm text-negative" role="alert">{error}</p>}
    </div>
  );
}
