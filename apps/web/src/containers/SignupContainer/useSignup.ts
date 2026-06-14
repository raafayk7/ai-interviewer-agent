"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";

const SignupSchema = z
  .object({
    email: z.string().email("Enter a valid email"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
export type SignupFormValues = z.infer<typeof SignupSchema>;

export function useSignup() {
  const router = useRouter();
  const form = useForm<SignupFormValues>({
    resolver: zodResolver(SignupSchema),
    defaultValues: { email: "", password: "", confirmPassword: "" },
  });
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    const { error } = await authClient.signUp.email({
      email: values.email,
      password: values.password,
      name: values.email.split("@")[0]!,
    });
    if (error) {
      const message =
        error.code === "USER_ALREADY_EXISTS"
          ? "We couldn't create your account. If you already have one, sign in instead."
          : "Something went wrong. Try again in a moment.";
      setSubmitError(message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  });

  return { form, onSubmit, submitError, isSubmitting: form.formState.isSubmitting };
}
