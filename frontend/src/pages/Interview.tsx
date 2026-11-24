import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import BatchInterviewView from "./interview/BatchInterviewView";
import LiveChatInterviewView from "./interview/LiveChatInterviewView";
import { useInterviewBootstrap, useInterviewSession } from "./interview/useInterviewSession";
import type { InterviewInitData } from "./interview/types";

interface InterviewRouteProps {
  sessionId: string;
  routeData: InterviewInitData | null;
}

function InterviewContent({ data }: { data: InterviewInitData }) {
  const session = useInterviewSession(data);

  return data.mode === "topic_drill" || data.mode === "jd_prep"
    ? <BatchInterviewView session={session} />
    : <LiveChatInterviewView session={session} />;
}

function InterviewRoute({ sessionId, routeData }: InterviewRouteProps) {
  const navigate = useNavigate();
  const { data, error } = useInterviewBootstrap(sessionId, routeData);

  if (data) return <InterviewContent data={data} />;

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
      {error ? (
        <>
          <div role="alert" className="text-[15px] text-red">{error}</div>
          <Button variant="outline" onClick={() => navigate("/history")}>返回历史记录</Button>
        </>
      ) : (
        <>
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-32 w-full max-w-[720px]" />
          <Skeleton className="h-32 w-full max-w-[720px]" />
        </>
      )}
    </div>
  );
}

export default function Interview() {
  const { sessionId } = useParams<"sessionId">();
  const location = useLocation();
  const routeData: InterviewInitData | null = location.state;

  if (!sessionId) return null;

  const matchedRouteData: InterviewInitData | null =
    routeData && (routeData.session_id == null || routeData.session_id === sessionId)
      ? { ...routeData, session_id: sessionId }
      : null;

  return (
    <InterviewRoute
      key={`${sessionId}:${location.key}`}
      sessionId={sessionId}
      routeData={matchedRouteData}
    />
  );
}
