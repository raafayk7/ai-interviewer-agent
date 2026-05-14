import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./card.js";

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

describe("Card — rendering", () => {
  it("renders a <div> element", () => {
    const { container } = render(<Card />);
    expect(container.querySelector("div")).toBeInTheDocument();
  });

  it("renders children", () => {
    render(<Card>Card body</Card>);
    expect(screen.getByText("Card body")).toBeInTheDocument();
  });
});

describe("Card — token classes", () => {
  it("applies bg-card class", () => {
    const { container } = render(<Card />);
    expect(container.querySelector("div")).toHaveClass("bg-card");
  });

  it("applies rounded-md class", () => {
    const { container } = render(<Card />);
    expect(container.querySelector("div")).toHaveClass("rounded-md");
  });

  it("applies text-card-foreground class", () => {
    const { container } = render(<Card />);
    expect(container.querySelector("div")).toHaveClass("text-card-foreground");
  });
});

describe("Card — className merging", () => {
  it("merges custom className with base classes", () => {
    const { container } = render(<Card className="my-card" />);
    const div = container.querySelector("div");
    expect(div).toHaveClass("my-card");
    expect(div).toHaveClass("bg-card");
  });
});

describe("Card — forwardRef", () => {
  it("ref.current is not null", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Card ref={ref} />);
    expect(ref.current).not.toBeNull();
  });

  it("ref.current is an HTMLDivElement", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Card ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it("ref points to the correct DOM node", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Card ref={ref} data-testid="card-root" />);
    expect(ref.current).toBe(screen.getByTestId("card-root"));
  });
});

describe("Card — displayName", () => {
  it("has the correct displayName", () => {
    expect(Card.displayName).toBe("Card");
  });
});

// ---------------------------------------------------------------------------
// CardHeader
// ---------------------------------------------------------------------------

describe("CardHeader — rendering", () => {
  it("renders a <div> element", () => {
    const { container } = render(<CardHeader />);
    expect(container.querySelector("div")).toBeInTheDocument();
  });

  it("renders children", () => {
    render(<CardHeader>Header content</CardHeader>);
    expect(screen.getByText("Header content")).toBeInTheDocument();
  });
});

describe("CardHeader — token classes", () => {
  it("applies p-6 class", () => {
    const { container } = render(<CardHeader />);
    expect(container.querySelector("div")).toHaveClass("p-6");
  });

  it("applies flex and flex-col classes", () => {
    const { container } = render(<CardHeader />);
    const div = container.querySelector("div");
    expect(div).toHaveClass("flex");
    expect(div).toHaveClass("flex-col");
  });
});

describe("CardHeader — className merging", () => {
  it("merges custom className with base classes", () => {
    const { container } = render(<CardHeader className="my-header" />);
    const div = container.querySelector("div");
    expect(div).toHaveClass("my-header");
    expect(div).toHaveClass("p-6");
  });
});

describe("CardHeader — forwardRef", () => {
  it("ref.current is not null", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<CardHeader ref={ref} />);
    expect(ref.current).not.toBeNull();
  });

  it("ref.current is an HTMLDivElement", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<CardHeader ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

describe("CardHeader — displayName", () => {
  it("has the correct displayName", () => {
    expect(CardHeader.displayName).toBe("CardHeader");
  });
});

// ---------------------------------------------------------------------------
// CardTitle
// ---------------------------------------------------------------------------

describe("CardTitle — rendering", () => {
  it("renders a <div> element", () => {
    const { container } = render(<CardTitle />);
    expect(container.querySelector("div")).toBeInTheDocument();
  });

  it("renders children", () => {
    render(<CardTitle>Interview Results</CardTitle>);
    expect(screen.getByText("Interview Results")).toBeInTheDocument();
  });
});

describe("CardTitle — token classes", () => {
  it("applies font-heading class", () => {
    const { container } = render(<CardTitle />);
    expect(container.querySelector("div")).toHaveClass("font-heading");
  });

  it("applies font-semibold and text-lg classes", () => {
    const { container } = render(<CardTitle />);
    const div = container.querySelector("div");
    expect(div).toHaveClass("font-semibold");
    expect(div).toHaveClass("text-lg");
  });
});

describe("CardTitle — className merging", () => {
  it("merges custom className with base classes", () => {
    const { container } = render(<CardTitle className="my-title" />);
    const div = container.querySelector("div");
    expect(div).toHaveClass("my-title");
    expect(div).toHaveClass("font-heading");
  });
});

describe("CardTitle — forwardRef", () => {
  it("ref.current is not null", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<CardTitle ref={ref} />);
    expect(ref.current).not.toBeNull();
  });

  it("ref.current is an HTMLDivElement", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<CardTitle ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

describe("CardTitle — displayName", () => {
  it("has the correct displayName", () => {
    expect(CardTitle.displayName).toBe("CardTitle");
  });
});

// ---------------------------------------------------------------------------
// CardDescription
// ---------------------------------------------------------------------------

describe("CardDescription — rendering", () => {
  it("renders a <div> element", () => {
    const { container } = render(<CardDescription />);
    expect(container.querySelector("div")).toBeInTheDocument();
  });

  it("renders children", () => {
    render(<CardDescription>3 questions · 45 min</CardDescription>);
    expect(screen.getByText("3 questions · 45 min")).toBeInTheDocument();
  });
});

describe("CardDescription — token classes", () => {
  it("applies text-muted-foreground class", () => {
    const { container } = render(<CardDescription />);
    expect(container.querySelector("div")).toHaveClass("text-muted-foreground");
  });

  it("applies text-sm class", () => {
    const { container } = render(<CardDescription />);
    expect(container.querySelector("div")).toHaveClass("text-sm");
  });
});

describe("CardDescription — className merging", () => {
  it("merges custom className with base classes", () => {
    const { container } = render(<CardDescription className="my-desc" />);
    const div = container.querySelector("div");
    expect(div).toHaveClass("my-desc");
    expect(div).toHaveClass("text-muted-foreground");
  });
});

describe("CardDescription — forwardRef", () => {
  it("ref.current is not null", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<CardDescription ref={ref} />);
    expect(ref.current).not.toBeNull();
  });

  it("ref.current is an HTMLDivElement", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<CardDescription ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

describe("CardDescription — displayName", () => {
  it("has the correct displayName", () => {
    expect(CardDescription.displayName).toBe("CardDescription");
  });
});

// ---------------------------------------------------------------------------
// CardContent
// ---------------------------------------------------------------------------

describe("CardContent — rendering", () => {
  it("renders a <div> element", () => {
    const { container } = render(<CardContent />);
    expect(container.querySelector("div")).toBeInTheDocument();
  });

  it("renders children", () => {
    render(<CardContent>Main content</CardContent>);
    expect(screen.getByText("Main content")).toBeInTheDocument();
  });
});

describe("CardContent — token classes", () => {
  it("applies p-6 class", () => {
    const { container } = render(<CardContent />);
    expect(container.querySelector("div")).toHaveClass("p-6");
  });

  it("applies pt-0 class", () => {
    const { container } = render(<CardContent />);
    expect(container.querySelector("div")).toHaveClass("pt-0");
  });
});

describe("CardContent — className merging", () => {
  it("merges custom className with base classes", () => {
    const { container } = render(<CardContent className="my-content" />);
    const div = container.querySelector("div");
    expect(div).toHaveClass("my-content");
    expect(div).toHaveClass("p-6");
  });
});

describe("CardContent — forwardRef", () => {
  it("ref.current is not null", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<CardContent ref={ref} />);
    expect(ref.current).not.toBeNull();
  });

  it("ref.current is an HTMLDivElement", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<CardContent ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

describe("CardContent — displayName", () => {
  it("has the correct displayName", () => {
    expect(CardContent.displayName).toBe("CardContent");
  });
});

// ---------------------------------------------------------------------------
// CardFooter
// ---------------------------------------------------------------------------

describe("CardFooter — rendering", () => {
  it("renders a <div> element", () => {
    const { container } = render(<CardFooter />);
    expect(container.querySelector("div")).toBeInTheDocument();
  });

  it("renders children", () => {
    render(<CardFooter>Footer actions</CardFooter>);
    expect(screen.getByText("Footer actions")).toBeInTheDocument();
  });
});

describe("CardFooter — token classes", () => {
  it("applies flex class", () => {
    const { container } = render(<CardFooter />);
    expect(container.querySelector("div")).toHaveClass("flex");
  });

  it("applies items-center class", () => {
    const { container } = render(<CardFooter />);
    expect(container.querySelector("div")).toHaveClass("items-center");
  });

  it("applies p-6 and pt-0 classes", () => {
    const { container } = render(<CardFooter />);
    const div = container.querySelector("div");
    expect(div).toHaveClass("p-6");
    expect(div).toHaveClass("pt-0");
  });
});

describe("CardFooter — className merging", () => {
  it("merges custom className with base classes", () => {
    const { container } = render(<CardFooter className="my-footer" />);
    const div = container.querySelector("div");
    expect(div).toHaveClass("my-footer");
    expect(div).toHaveClass("flex");
  });
});

describe("CardFooter — forwardRef", () => {
  it("ref.current is not null", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<CardFooter ref={ref} />);
    expect(ref.current).not.toBeNull();
  });

  it("ref.current is an HTMLDivElement", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<CardFooter ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

describe("CardFooter — displayName", () => {
  it("has the correct displayName", () => {
    expect(CardFooter.displayName).toBe("CardFooter");
  });
});
