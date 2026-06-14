import { z } from "zod";

export const RecommendationSchema = z.enum(["advance", "hold", "reject"]);
export type Recommendation = z.infer<typeof RecommendationSchema>;
