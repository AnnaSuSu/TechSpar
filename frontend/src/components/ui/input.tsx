import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * `masked` 是给 API Key 这类密钥框用的:内容遮成圆点,但字段仍是普通 text。
 *
 * 不能用 type="password"——页面上只要有一个 password 框,Chrome 自带的密码
 * 管理器就会把紧邻的文本框认作用户名栏往里填邮箱,而它对 autocomplete="off"
 * 和各家 data-*-ignore 一概不理。真正的登录/改密码字段才该用 type="password"。
 */
type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { masked?: boolean };

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, autoComplete, masked, ...props }, ref) => {
    const ignoreManagers =
      autoComplete === undefined
        ? { "data-1p-ignore": true, "data-lpignore": "true", "data-bwignore": "true", "data-form-type": "other" }
        : {};
    return (
      <input
        type={type}
        autoComplete={autoComplete ?? (type === "password" ? "new-password" : "off")}
        {...ignoreManagers}
        className={cn(
          "flex h-9 w-full rounded-lg border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text shadow-sm transition-colors placeholder:text-dim/55 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50",
          masked && "input-masked",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
