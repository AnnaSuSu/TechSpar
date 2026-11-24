import AfdianIcon from "@/components/AfdianIcon";
import { Card, CardContent } from "@/components/ui/card";

export default function SponsorCard() {
  return (
    <Card className="overflow-hidden border-border/40 bg-card/40">
      <CardContent className="p-5 md:p-7">
        <div className="flex items-center gap-2 mb-1">
          <AfdianIcon size={16} className="text-primary" />
          <h2 className="text-[15px] font-semibold">支持这个项目</h2>
        </div>
        <p className="mb-4 text-[13px] leading-relaxed text-dim">
          TechSpar 社区版支持自行部署；官方网站和官方桌面端提供统一的平台服务与套餐。
          你的支持会用于模型推理、服务器和持续开发。
          <br />
          如果它帮到了你，去爱发电赞助一点，对我意义很大。
        </p>
        <a
          href="https://ifdian.net/a/techspar"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-[13px] font-medium transition-colors hover:border-primary/40 hover:text-primary"
        >
          <AfdianIcon size={15} className="text-primary" />
          去爱发电赞助
        </a>
      </CardContent>
    </Card>
  );
}
