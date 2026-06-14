"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { uploadDocuments, extractDocuments } from "@/services/document.service";
import { createInterview, generatePlan } from "@/services/interview.service";
import type { FileRef, ExtractDocumentsResponse } from "@/types";

export const STEPS = ["Job description", "Candidate CV", "Instructions", "Review"] as const;

const InstructionsSchema = z
  .object({
    clientInstructions: z.string().max(4000),
    targetDurationMinutes: z.coerce.number().int().min(5).max(60),
    maxDurationMinutes: z.coerce.number().int().min(10).max(120),
  })
  .refine((v) => v.maxDurationMinutes >= v.targetDurationMinutes, {
    path: ["maxDurationMinutes"],
    message: "Max duration must be ≥ target duration",
  });
export type InstructionsFormValues = z.infer<typeof InstructionsSchema>;

interface UploadedRefs { jd: FileRef; cv: FileRef; }

export function useNewInterview() {
  const router = useRouter();
  const qc = useQueryClient();

  const [stepIndex, setStepIndex] = useState(0);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [uploadedRefs, setUploadedRefs] = useState<UploadedRefs | null>(null);
  const [extracted, setExtracted] = useState<ExtractDocumentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<InstructionsFormValues>({
    resolver: zodResolver(InstructionsSchema) as Resolver<InstructionsFormValues>,
    defaultValues: { clientInstructions: "", targetDurationMinutes: 15, maxDurationMinutes: 25 },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!jdFile || !cvFile) throw new Error("Both files required");
      const result = await uploadDocuments(jdFile, cvFile);
      if (!result.ok) throw result.error;
      return result.value;
    },
    onSuccess: (refs) => {
      setUploadedRefs({ jd: refs.jdRef, cv: refs.cvRef });
      setStepIndex(2);
    },
    onError: (err: { kind?: string; message?: string }) => {
      setError(err.kind === "NETWORK" ? "Connection lost. Try again." : (err.message ?? "Upload failed."));
    },
  });

  const extractMutation = useMutation({
    mutationFn: async () => {
      if (!uploadedRefs) throw new Error("Files not uploaded");
      const result = await extractDocuments(
        { key: uploadedRefs.jd.key, contentType: uploadedRefs.jd.contentType },
        { key: uploadedRefs.cv.key, contentType: uploadedRefs.cv.contentType },
      );
      if (!result.ok) throw result.error;
      return result.value;
    },
    onSuccess: (data) => setExtracted(data),
    onError: () => setError("Couldn't read your documents. Try uploading again."),
  });

  const launchMutation = useMutation({
    mutationFn: async (formValues: InstructionsFormValues) => {
      if (!uploadedRefs || !extracted) throw new Error("Wizard state incomplete");
      const created = await createInterview({
        jobDescription: extracted.jobDescription,
        candidateInfo: extracted.candidateInfo,
        clientInstructions: formValues.clientInstructions,
        scheduledAt: new Date().toISOString(),
        jdFileRef: uploadedRefs.jd,
        cvFileRef: uploadedRefs.cv,
      });
      if (!created.ok) throw created.error;
      const planned = await generatePlan(created.value.interviewId, {
        targetDurationMinutes: formValues.targetDurationMinutes,
        maxDurationMinutes: formValues.maxDurationMinutes,
      });
      if (!planned.ok) throw planned.error;
      return {
        interviewId: created.value.interviewId,
        candidateLink: planned.value.candidateLink,
      };
    },
    onSuccess: ({ interviewId, candidateLink }) => {
      qc.invalidateQueries({ queryKey: ["interviews"] });
      qc.setQueryData(["candidate-link", interviewId], candidateLink);
      router.push(`/interviews/${interviewId}`);
    },
    onError: (err: { kind?: string; message?: string }) =>
      setError(err.kind === "NETWORK" ? "Connection lost. Try again." : (err.message ?? "Couldn't launch interview.")),
  });

  function next() {
    setError(null);
    if (stepIndex === 0 && jdFile) setStepIndex(1);
    else if (stepIndex === 1 && cvFile && jdFile) uploadMutation.mutate();
    else if (stepIndex === 2) {
      form.handleSubmit(() => {
        setStepIndex(3);
        extractMutation.mutate();
      })();
    }
  }

  function back() {
    setError(null);
    setStepIndex((i) => Math.max(0, i - 1));
  }

  function close() {
    router.push("/dashboard");
  }

  function launch() {
    form.handleSubmit((values) => launchMutation.mutate(values))();
  }

  return {
    stepIndex,
    steps: STEPS,
    jdFile, setJdFile,
    cvFile, setCvFile,
    uploadedRefs,
    extracted,
    form,
    isUploading: uploadMutation.isPending,
    isExtracting: extractMutation.isPending,
    isLaunching: launchMutation.isPending,
    error,
    next, back, close, launch,
  };
}

export type NewInterviewForm = ReturnType<typeof useNewInterview>["form"];
