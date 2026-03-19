import { Component } from "react";
import { Link } from "react-router-dom";

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center p-10 md:p-15 gap-4 min-h-[60vh]">
        <div className="text-2xl font-bold text-text">出了点问题</div>
        <div className="text-sm text-dim max-w-[400px] text-center break-words">
          {this.state.error?.message || "未知错误"}
        </div>
        <button
          className="mt-2 px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium"
          onClick={() => this.setState({ error: null })}
        >
          重试
        </button>
        <Link to="/" className="text-sm text-accent-light">返回首页</Link>
      </div>
    );
  }
}
