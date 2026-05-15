"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@repo/ui/primitives/dialog";
import { Button } from "@repo/ui/primitives/button";
import { StepperHeader } from "@repo/ui/composites/stepper-header";
import { useNewInterview } from "./useNewInterview";
import { Step1UploadJD } from "./steps/Step1UploadJD";
import { Step2UploadCV } from "./steps/Step2UploadCV";
import { Step3Instructions } from "./steps/Step3Instructions";
import { Step4ReviewLaunch } from "./steps/Step4ReviewLaunch";

export function NewInterviewContainer() {
  const {
    stepIndex, steps,
    jdFile, setJdFile,
    cvFile, setCvFile,
    extracted,
    form,
    isUploading, isExtracting, isLaunching,
    error,
    next, back, close, launch,
  } = useNewInterview();

  const canNext =
    (stepIndex === 0 && !!jdFile) ||
    (stepIndex === 1 && !!cvFile && !isUploading) ||
    stepIndex === 2;

  const isLastStep = stepIndex === 3;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader className="gap-6">
          <DialogTitle>New interview</DialogTitle>
          <StepperHeader steps={steps} currentIndex={stepIndex} />
        </DialogHeader>

        <div className="min-h-[240px]">
          {stepIndex === 0 && <Step1UploadJD file={jdFile} onChange={setJdFile} />}
          {stepIndex === 1 && <Step2UploadCV file={cvFile} onChange={setCvFile} isUploading={isUploading} />}
          {stepIndex === 2 && <Step3Instructions form={form} />}
          {stepIndex === 3 && (
            <Step4ReviewLaunch
              extracted={extracted}
              isExtracting={isExtracting}
              isLaunching={isLaunching}
            />
          )}
          {error && <p className="mt-3 text-sm text-negative" role="alert">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={isUploading || isLaunching}>
            Cancel
          </Button>
          {stepIndex > 0 && !isLastStep && (
            <Button variant="ghost" onClick={back} disabled={isUploading}>
              Back
            </Button>
          )}
          {!isLastStep ? (
            <Button variant="primary" onClick={next} disabled={!canNext || isUploading}>
              {isUploading ? "Uploading…" : "Next"}
            </Button>
          ) : (
            <Button variant="primary" onClick={launch} disabled={isLaunching || isExtracting || !extracted}>
              {isLaunching ? "Launching…" : "Launch interview"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
