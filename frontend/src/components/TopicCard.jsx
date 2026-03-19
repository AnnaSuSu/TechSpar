export default function TopicCard({ topicKey, name, icon, onClick, selected }) {
  return (
    <div
      className={`flex items-center gap-3 px-5 py-4 rounded-box cursor-pointer transition-all text-left
        border ${selected ? "border-accent bg-hover" : "border-border bg-card"}
        hover:border-accent hover:-translate-y-px`}
      onClick={onClick}
    >
      <div className="text-2xl w-10 h-10 flex items-center justify-center rounded-lg bg-hover">
        {icon || "📝"}
      </div>
      <div>
        <div className="text-[15px] font-medium text-text">{name}</div>
        <div className="text-xs text-dim mt-0.5">{topicKey}</div>
      </div>
    </div>
  );
}
