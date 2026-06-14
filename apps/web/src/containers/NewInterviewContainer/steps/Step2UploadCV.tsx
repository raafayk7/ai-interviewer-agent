"use client";

import { FileUploadField } from "@repo/ui/composites/file-upload-field";

interface Props {
  file: File | null;
  onChange: (file: File | null) => void;
  isUploading: boolean;
}

export function Step2UploadCV({ file, onChange, isUploading }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Upload the candidate&apos;s CV. Both files will be uploaded when you click Next.</p>
      <FileUploadField
        id="cv-file"
        label="Candidate CV"
        accept=".pdf"
        file={file}
        onChange={onChange}
        disabled={isUploading}
      />
      {isUploading && <p className="text-sm text-muted-foreground">Uploading documents…</p>}
    </div>
  );
}
