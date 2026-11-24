import { Component, type ReactNode } from "react";
import { Link } from "react-router-dom";
import ErrorState from "@/components/ErrorState";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";

interface ErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string;
  fallbackCompact?: boolean;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(errorMessage(error, "未知错误")) };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className={cn(
        "flex flex-1 items-center justify-center px-4 py-8",
        !this.props.fallbackCompact && "min-h-[60vh]",
      )}>
        <ErrorState
          title="出了点问题"
          message={errorMessage(error, "未知错误")}
          compact={this.props.fallbackCompact}
          className="w-full max-w-lg"
          onRetry={this.reset}
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/" onClick={this.reset}>返回首页</Link>
            </Button>
          }
        />
      </div>
    );
  }
}
