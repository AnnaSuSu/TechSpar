import { useEffect, useState } from "react";
import { getReview } from "@/api/sessions";
import { errorMessage } from "@/lib/errorMessage";
import type { ReviewPayload, ReviewScore } from "./types";

type ReviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ReviewPayload };

export function useReviewData(sessionId: string, preloaded: ReviewPayload | null) {
  const [state, setState] = useState<ReviewState>(() =>
    preloaded ? { status: "ready", data: preloaded } : { status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (preloaded) return;
    const controller = new AbortController();
    const { signal } = controller;
    getReview(sessionId, { signal }).then((data) => {
      if (signal.aborted) return;
      // Older persisted reports may have score entries without a question ID.
      const scores = (data.scores ?? []).filter((score): score is ReviewScore & Record<string, unknown> =>
        typeof score.question_id === "number" || typeof score.question_id === "string");
      setState({ status: "ready", data: { ...data, scores } });
    }).catch((error: unknown) => {
      if (!signal.aborted) setState({ status: "error", message: errorMessage(error) });
    });

    return () => controller.abort();
  }, [sessionId, preloaded, attempt]);

  const retry = () => {
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  };

  return { state, retry };
}
