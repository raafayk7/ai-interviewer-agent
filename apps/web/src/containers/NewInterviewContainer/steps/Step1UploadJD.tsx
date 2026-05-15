"use client";

import { FileUploadField } from "@repo/ui/composites/file-upload-field";

interface Props {
  file: File | null;
  onChange: (file: File | null) => void;
}

export function Step1UploadJD({ file, onChange }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Upload the job description PDF. Sift will extract the role requirements automatically.</p>
      <FileUploadField
        id="jd-file"
        label="Job description"
        accept=".pdf"
        file={file}
        onChange={onChange}
      />
    </div>
  );
}
