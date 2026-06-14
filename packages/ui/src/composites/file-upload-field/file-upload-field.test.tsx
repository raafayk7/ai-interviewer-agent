import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { FileUploadField } from "./file-upload-field.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(overrides: Partial<React.ComponentProps<typeof FileUploadField>> = {}) {
  const props: React.ComponentProps<typeof FileUploadField> = {
    id: "jd-file",
    label: "Job Description",
    file: null,
    onChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<FileUploadField {...props} />), onChange: props.onChange as ReturnType<typeof vi.fn> };
}

// ---------------------------------------------------------------------------
// FileUploadField — drop zone rendering
// ---------------------------------------------------------------------------

describe("FileUploadField — drop zone", () => {
  it("renders the label text", () => {
    setup();
    expect(screen.getByText("Job Description")).toBeInTheDocument();
  });

  it("renders the label as an HTML label element associated with the input", () => {
    setup({ id: "jd-file" });
    const label = screen.getByText("Job Description");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", "jd-file");
  });

  it("shows drop zone hint text when no file is selected", () => {
    setup();
    expect(screen.getByText(/drop a .pdf file here/i)).toBeInTheDocument();
  });

  it("renders the 'Choose file' button when no file is provided", () => {
    setup();
    expect(screen.getByRole("button", { name: /choose file/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// FileUploadField — file info when file is provided
// ---------------------------------------------------------------------------

describe("FileUploadField — with file", () => {
  function makeFile(name = "resume.pdf", sizeBytes = 51200) {
    const file = new File(["content"], name, { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: sizeBytes });
    return file;
  }

  it("shows the file name when a file is provided", () => {
    setup({ file: makeFile("resume.pdf") });
    expect(screen.getByText("resume.pdf")).toBeInTheDocument();
  });

  it("shows the file size in KB when a file is provided", () => {
    setup({ file: makeFile("resume.pdf", 51200) });
    // 51200 / 1024 = 50 KB
    expect(screen.getByText(/50 KB/)).toBeInTheDocument();
  });

  it("renders a 'Remove' button when a file is provided", () => {
    setup({ file: makeFile() });
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("calls onChange(null) when the Remove button is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FileUploadField
        id="cv-file"
        label="CV"
        file={makeFile()}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// FileUploadField — file input onChange
// ---------------------------------------------------------------------------

describe("FileUploadField — file input interaction", () => {
  it("calls onChange with the selected file when a file is chosen via input", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FileUploadField
        id="jd-file"
        label="Job Description"
        file={null}
        onChange={onChange}
      />,
    );
    const file = new File(["content"], "jd.pdf", { type: "application/pdf" });
    const input = document.getElementById("jd-file") as HTMLInputElement;
    await user.upload(input, file);
    expect(onChange).toHaveBeenCalledWith(file);
  });
});

// ---------------------------------------------------------------------------
// FileUploadField — error state
// ---------------------------------------------------------------------------

describe("FileUploadField — error display", () => {
  it("renders the error message when error prop is provided", () => {
    setup({ error: "File is required" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("File is required")).toBeInTheDocument();
  });

  it("does not render an alert when error prop is absent", () => {
    setup();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// FileUploadField — disabled state
// ---------------------------------------------------------------------------

describe("FileUploadField — disabled state", () => {
  it("disables the hidden file input when disabled prop is true", () => {
    setup({ disabled: true });
    const input = document.getElementById("jd-file") as HTMLInputElement;
    expect(input).toBeDisabled();
  });
});
