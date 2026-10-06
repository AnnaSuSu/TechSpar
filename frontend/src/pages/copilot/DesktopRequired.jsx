import { Download, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function DesktopRequired() {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-lg rounded-3xl border border-border bg-card p-8 text-center space-y-5">
        <Monitor className="mx-auto text-primary" size={36} />
        <h1 className="text-2xl font-semibold">在桌面端使用面试 Copilot</h1>
        <p className="text-sm leading-7 text-dim">下载桌面端，完成面试准备并开启实时回答提示。授权麦克风和系统音频后，即可分别识别你和对方的发言。</p>
        <Button asChild variant="gradient" size="lg" className="rounded-2xl"><a href="https://github.com/AnnaSuSu/TechSpar/releases/latest" target="_blank" rel="noreferrer"><Download size={16} className="mr-2" />下载桌面端</a></Button>
        <p className="text-xs leading-5 text-dim">前往下载页面，选择适合你电脑的安装包。</p>
      </div>
    </div>
  );
}
