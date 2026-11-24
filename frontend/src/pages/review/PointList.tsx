function getPointText(item: unknown) {
  if (item && typeof item === "object" && "point" in item && typeof item.point === "string" && item.point) {
    return item.point;
  }
  return JSON.stringify(item);
}

export default function PointList({ title, items, tone = "red" }: {
  title: string;
  items?: unknown[];
  tone?: "red" | "green" | "blue";
}) {
  if (!items?.length) return null;
  const boxClass = tone === "green"
    ? "bg-green/8 border-green/20"
    : tone === "blue"
      ? "bg-blue-500/8 border-blue-500/20"
      : "bg-red/8 border-red/20";

  return (
    <div className="mb-6">
      <div className="text-base font-semibold mb-3 text-text">{title}</div>
      <div className="flex flex-col gap-1.5">
        {items.map((item, i) => (
          <div key={i} className={`px-3 py-2 rounded-lg text-[13px] text-text border animate-fade-in ${boxClass}`}>
            {typeof item === "string" ? item : getPointText(item)}
          </div>
        ))}
      </div>
    </div>
  );
}
