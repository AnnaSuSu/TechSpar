import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import "./copilot/styles.css";

import DetailView from "./copilot/DetailView";
import ListView from "./copilot/ListView";
import RealtimePhase from "./copilot/RealtimePhase";
import DesktopRequired from "./copilot/DesktopRequired";
import { isDesktopApp } from "@/lib/desktop";

export default function Copilot() {
  const navigate = useNavigate();

  const readParams = useCallback(() => {
    const sp = new URLSearchParams(window.location.search);
    return {
      view: sp.get("view") || "list",
      prep: sp.get("prep") || null,
    };
  }, []);

  const [state, setState] = useState(readParams);

  useEffect(() => {
    const onPop = () => setState(readParams());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [readParams]);

  const go = useCallback((view, prepId) => {
    const params = new URLSearchParams();
    if (view && view !== "list") params.set("view", view);
    if (prepId) params.set("prep", prepId);
    const qs = params.toString();
    const url = `/copilot${qs ? `?${qs}` : ""}`;
    navigate(url, { replace: true });
    setState({ view: view || "list", prep: prepId || null });
  }, [navigate]);

  const goList = useCallback(() => go("list", null), [go]);
  const goNew = useCallback(() => go("new", null), [go]);
  const goDetail = useCallback((prepId) => go("detail", prepId), [go]);
  const goRealtime = useCallback((prepId) => go("realtime", prepId), [go]);

  if (!isDesktopApp()) return <DesktopRequired />;

  switch (state.view) {
    case "list":
      return <ListView onNew={goNew} onSelect={goDetail} />;
    case "new":
      return <DetailView prepId={null} onBack={goList} onStartInterview={(id) => goRealtime(id)} />;
    case "detail":
      return <DetailView prepId={state.prep} onBack={goList} onStartInterview={(id) => goRealtime(id)} />;
    case "realtime":
      return <RealtimePhase prepId={state.prep} onBack={goList} />;
    default:
      return <ListView onNew={goNew} onSelect={goDetail} />;
  }
}
