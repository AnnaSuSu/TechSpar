import { useEffect, useState } from "react";
import { getGraphData } from "@/api/graph";
import { getTopics, type TopicsResponse } from "@/api/topics";
import { errorMessage } from "@/lib/errorMessage";
import { readGraphData } from "./graphUtils";
import type { GraphData } from "./types";

type GraphRequest = { topic: string; version: number };
type GraphResult =
  | { request: GraphRequest; data: GraphData; error: null }
  | { request: GraphRequest; data: null; error: string };

export function useGraphResources() {
  const [topics, setTopics] = useState<TopicsResponse>({});
  const [topicsError, setTopicsError] = useState<string | null>(null);
  const [topicsAttempt, setTopicsAttempt] = useState(0);
  const [request, setRequest] = useState<GraphRequest | null>(null);
  const [result, setResult] = useState<GraphResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    getTopics({ signal }).then((data) => {
      if (!signal.aborted) setTopics(data);
    }).catch((error: unknown) => {
      if (!signal.aborted) setTopicsError(errorMessage(error));
    });
    return () => controller.abort();
  }, [topicsAttempt]);

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    const { signal } = controller;
    getGraphData(request.topic, { signal }).then((data) => {
      if (!signal.aborted) setResult({ request, data: readGraphData(data), error: null });
    }).catch((error: unknown) => {
      if (!signal.aborted) setResult({ request, data: null, error: errorMessage(error) });
    });
    return () => controller.abort();
  }, [request]);

  const current = result?.request === request ? result : null;

  return {
    topics,
    topicsError,
    retryTopics: () => {
      setTopicsError(null);
      setTopicsAttempt((attempt) => attempt + 1);
    },
    selectedTopic: request?.topic ?? null,
    requestVersion: request?.version ?? 0,
    selectTopic: (topic: string) => setRequest((previous) => ({ topic, version: (previous?.version ?? 0) + 1 })),
    graphData: current?.data ?? null,
    graphError: current?.error ?? null,
    loading: request !== null && current === null,
  };
}
