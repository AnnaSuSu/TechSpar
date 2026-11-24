import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import DimensionScores from "./DimensionScores";
import type { DimensionScoreMap } from "./types";
import type { ChatMessage } from "../interview/types";
import { RESUME_DIMENSION_LABELS } from "./utils";

export default function ResumeReview({ dimensionScores, avgScore, review, messages }: {
  dimensionScores?: DimensionScoreMap | null;
  avgScore?: number | null;
  review?: string | null;
  messages: ChatMessage[];
}) {
  const [showTranscript, setShowTranscript] = useState(false);

  return (
    <>
      <DimensionScores
        dimensionScores={dimensionScores}
        avgScore={avgScore}
        labels={RESUME_DIMENSION_LABELS}
      />
      <Card className="mb-6">
        <CardContent className="p-5 md:p-8 leading-[1.8] text-[15px]">
          <div className="md-content">
            <ReactMarkdown>{review || ""}</ReactMarkdown>
          </div>
        </CardContent>
      </Card>

      {messages.length > 0 && (
        <div className="mb-6">
          <Button variant="outline" onClick={() => setShowTranscript(!showTranscript)} className="mr-3">
            {showTranscript ? "收起面试记录" : "查看面试记录"}
          </Button>
          {showTranscript && (
            <Card className="mt-4">
              <CardContent className="p-4 md:p-6 max-h-[500px] overflow-y-auto">
                {messages.map((msg, i) => (
                  <div key={i} className="py-2 border-b border-border text-sm leading-relaxed last:border-0">
                    <strong style={{ color: msg.role === "user" ? "var(--ai-glow)" : "var(--success)" }}>
                      {msg.role === "user" ? "你" : "面试官"}:
                    </strong>{" "}
                    {msg.content}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
