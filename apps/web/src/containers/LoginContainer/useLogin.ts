"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";

const LoginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password required"),
});
export type LoginFormValues = z.infer<typeof LoginSchema>;

export function useLogin() {
  const router = useRouter();
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: "", password: "" },
  });
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    const { error } = await authClient.signIn.email({
      email: values.email,
      password: values.password,
    });
    if (error) {
      const message =
        error.code === "INVALID_EMAIL_OR_PASSWORD"
          ? "Email or password is incorrect."
          : "Something went wrong. Try again in a moment.";
      setSubmitError(message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  });

  return { form, onSubmit, submitError, isSubmitting: form.formState.isSubmitting };
}
