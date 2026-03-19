import ReactMarkdown from "react-markdown";

export default function ChatBubble({ role, content }) {
  if (role === "user") {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[70%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-accent text-white text-[15px] leading-[1.7] whitespace-pre-wrap">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col animate-fade-in">
      <div className="h-px bg-border mb-6" />
      <div className="max-w-[720px] md:max-w-[720px] leading-[1.8] text-[15px] text-text">
        <div className="md-content">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
