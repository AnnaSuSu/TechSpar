import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PageContainerSize = "narrow" | "default" | "wide" | "full";

const SIZE_CLASSES: Record<PageContainerSize, string> = {
  narrow: "max-w-3xl px-4 py-6 md:px-6 md:py-9",
  default: "max-w-[1180px] px-4 py-6 md:px-7 md:py-8 xl:px-8",
  wide: "max-w-[1600px] px-4 py-6 md:px-7 md:py-8 xl:px-10 2xl:px-12",
  full: "px-4 py-5 md:px-6 md:py-6",
};

export interface PageContainerProps {
  size?: PageContainerSize;
  className?: string;
  children: ReactNode;
}

export default function PageContainer({
  size = "default",
  className,
  children,
}: PageContainerProps) {
  return (
    <div className={cn("flex-1 w-full mx-auto", SIZE_CLASSES[size], className)}>
      {children}
    </div>
  );
}
