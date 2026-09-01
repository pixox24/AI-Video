import React, { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    const ok = window.confirm('会先把当前磁盘稿备份为「上一份」，再回到示例工程。确定？');
    if (!ok) return;
    void fetch('/api/project/stash', { method: 'POST' }).catch(() => undefined).finally(() => {
      try {
        sessionStorage.setItem('ai_video_reset_to_sample', '1');
        localStorage.removeItem('ai_video_current_project');
      } catch {
        // ignore
      }
      this.setState({ hasError: false, error: null, errorInfo: null });
      window.location.reload();
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full bg-[#0a0a0f] text-zinc-200 flex items-center justify-center p-6 select-none font-sans">
          <div className="max-w-md w-full bg-[#131318] border border-[#262632] rounded-2xl p-6 shadow-2xl space-y-5 text-center">
            <div className="w-12 h-12 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-rose-500/10">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-base font-bold text-zinc-100">画面渲染遇到了一个小问题</h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {this.state.error?.message || '组件渲染过程中发生异常，系统已保护您的本地项目数据。'}
              </p>
            </div>

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={this.handleReload}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-all shadow-md shadow-amber-500/20 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                重新加载（保留工程）
              </button>

              <button
                onClick={this.handleReset}
                className="px-4 py-2 bg-[#20202a] hover:bg-[#2a2a38] text-zinc-300 text-xs rounded-xl flex items-center gap-1.5 transition-all border border-[#2e2e3e] cursor-pointer"
              >
                <Home className="w-3.5 h-3.5" />
                备份并回到示例
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
