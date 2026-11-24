import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  backTo?: string;
  backLabel?: string;
  bordered?: boolean;
  className?: string;
}

export default function PageHeader({
  title,
  description,
  eyebrow,
  icon,
  actions,
  backTo,
  backLabel = "返回",
  bordered = false,
  className,
}: PageHeaderProps) {
  const navigate = useNavigate();

  return (
    <header
      className={cn(
        "flex flex-col gap-4 md:flex-row md:items-start md:justify-between",
        bordered && "border-b border-border/65 pb-5",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {backTo && (
          <button
            type="button"
            onClick={() => navigate(backTo)}
            className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-dim transition-colors hover:text-text"
          >
            <ArrowLeft size={14} />
            {backLabel}
          </button>
        )}
        <div className="flex items-start gap-3.5">
          {icon && (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm shadow-primary/5">
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/75">
                {eyebrow}
              </div>
            )}
            <h1 className="mt-0.5 text-2xl font-display font-bold tracking-tight text-text md:text-[30px]">
              {title}
            </h1>
            {description && (
              <p className="mt-1.5 max-w-3xl text-sm leading-6 text-dim">
                {description}
              </p>
            )}
          </div>
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
