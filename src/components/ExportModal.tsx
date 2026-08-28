import React, { useEffect, useState } from 'react';
import { 
  X, 
  Download, 
  Film, 
  FileText, 
  Image as ImageIcon, 
  CheckCircle2, 
  RefreshCw, 
  Sparkles,
  Smartphone,
  Tv,
  Square,
  Video,
  Layers
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { VideoProject } from '../types';
import { exportProjectToMP4 } from '../utils/mp4Exporter';
import { clipShotNarration } from '../utils/narrationTrack';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: VideoProject;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose, project }) => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStageText, setExportStageText] = useState('准备就绪');
  const [exportedResult, setExportedResult] = useState<{
    url: string;
    filename: string;
    format: 'mp4' | 'webm';
    sizeMb?: string;
  } | null>(null);

  useEffect(() => {
    if (isOpen) return;
    setExportedResult((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    setIsExporting(false);
    setExportProgress(0);
    setExportStageText('准备就绪');
  }, [isOpen]);

  if (!isOpen) return null;

  const totalDuration = project.clips.reduce((acc, c) => acc + (c.duration || 3.5), 0);

  // Generate Video using true H.264 MP4 encoder
  const handleStartExportVideo = async () => {
    setIsExporting(true);
    setExportProgress(5);
    setExportStageText('正在初始化 H.264 编码器...');
    setExportedResult((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });

    try {
      const result = await exportProjectToMP4(project, (prog, stageText) => {
        setExportProgress(prog);
        setExportStageText(stageText);
      });

      const sizeMb = (result.blob.size / (1024 * 1024)).toFixed(2);

      setExportedResult({
        url: result.url,
        filename: result.filename,
        format: result.format,
        sizeMb
      });

      setIsExporting(false);
      setExportProgress(100);
      setExportStageText('导出成功！');

      // Trigger celebratory confetti
      confetti({
        particleCount: 90,
        spread: 75,
        origin: { y: 0.6 }
      });
    } catch (err: any) {
      console.error('Export failed:', err);
      setIsExporting(false);
      setExportStageText(`导出遇到问题: ${err?.message || '未知错误'}`);
    }
  };

  // Export SRT Subtitles
  const handleExportSRT = () => {
    let srtContent = '';
    let accTime = 0;

    project.clips.forEach((clip, index) => {
      const startSec = accTime;
      const endSec = accTime + (clip.duration || 3.5);
      accTime = endSec;

      const formatSRTTime = (sec: number) => {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = Math.floor(sec % 60);
        const ms = Math.floor((sec % 1) * 1000);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
      };

      srtContent += `${index + 1}\n`;
      srtContent += `${formatSRTTime(startSec)} --> ${formatSRTTime(endSec)}\n`;
      srtContent += `${clipShotNarration(clip)}\n`;
      if (clip.secondaryText) srtContent += `${clip.secondaryText}\n`;
      srtContent += `\n`;
    });

    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.title || 'subtitles'}.srt`;
    a.click();
  };

  return (
    <div 
      id="export-modal-overlay"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none"
    >
      <div className="bg-[#18181f] border border-[#2b2b38] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl space-y-0 text-xs text-zinc-200">
        {/* Modal Header */}
        <div className="p-4 border-b border-[#262634] flex items-center justify-between bg-[#14141a]">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span className="font-semibold text-sm text-zinc-100">导出 MP4 短视频与素材包</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4">
          {/* Summary Box */}
          <div className="p-3.5 bg-[#1f1f2a] border border-[#2c2c3c] rounded-xl flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="font-semibold text-xs text-zinc-100 block">{project.title}</span>
              <span className="text-[11px] text-zinc-400">
                {project.clips.length} 个分镜镜头 · 总时长约 {totalDuration.toFixed(1)} 秒
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-mono font-bold">
                MP4 (H.264)
              </span>
              <span className="px-2 py-1 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg text-xs font-mono font-semibold uppercase">
                {project.settings.aspectRatio}
              </span>
            </div>
          </div>

          {/* Social Platform Recommendations */}
          <div className="space-y-1.5">
            <span className="text-zinc-400 font-medium text-[11px]">目标社交媒体预设格式</span>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 bg-[#1a1a24] border border-[#262634] rounded-xl text-center space-y-0.5">
                <Smartphone className="w-4 h-4 text-amber-400 mx-auto" />
                <div className="font-semibold text-[11px] text-zinc-200">抖音 / TikTok</div>
                <div className="text-[9px] text-zinc-500">9:16 竖屏短视频</div>
              </div>
              <div className="p-2 bg-[#1a1a24] border border-[#262634] rounded-xl text-center space-y-0.5">
                <Tv className="w-4 h-4 text-sky-400 mx-auto" />
                <div className="font-semibold text-[11px] text-zinc-200">YouTube / B站</div>
                <div className="text-[9px] text-zinc-500">16:9 横屏中视频</div>
              </div>
              <div className="p-2 bg-[#1a1a24] border border-[#262634] rounded-xl text-center space-y-0.5">
                <Square className="w-4 h-4 text-rose-400 mx-auto" />
                <div className="font-semibold text-[11px] text-zinc-200">小红书 / Ins</div>
                <div className="text-[9px] text-zinc-500">1:1 / 4:5 瀑布流</div>
              </div>
            </div>
          </div>

          {/* Export Progress Bar */}
          {isExporting && (
            <div className="space-y-2.5 p-3.5 bg-[#1f1f2a] border border-amber-500/30 rounded-xl shadow-lg">
              <div className="flex items-center justify-between text-xs text-zinc-300">
                <span className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                  <span className="font-medium">{exportStageText}</span>
                </span>
                <span className="font-mono text-amber-400 font-bold">{exportProgress}%</span>
              </div>
              <div className="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden p-0.5 border border-zinc-700/60">
                <div 
                  className="h-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-400 rounded-full transition-all duration-150"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-zinc-400">
                <span>H.264 硬件编码加速中</span>
                <span>{project.settings.frameRate || 30} FPS / {project.settings.exportQuality || '1080p'}</span>
              </div>
            </div>
          )}

          {/* Export Success & Download Video */}
          {exportedResult && (
            <div className="p-4 bg-emerald-950/40 border border-emerald-500/40 rounded-xl space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  标准 MP4 (H.264) 视频渲染完毕！
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded">
                  大小约 {exportedResult.sizeMb} MB
                </span>
              </div>

              <a
                href={exportedResult.url}
                download={exportedResult.filename}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all text-xs cursor-pointer active:scale-98"
              >
                <Download className="w-4 h-4 stroke-[2.5]" />
                立即下载 {exportedResult.filename}
              </a>

              <div className="text-[10px] text-zinc-400 text-center leading-relaxed">
                全平台兼容：可直接导入剪映、微信视频号、抖音、快手、B站及各手机相册直接播放
              </div>
            </div>
          )}

          {/* Other Formats Buttons */}
          <div className="space-y-2 pt-1">
            <span className="text-zinc-400 font-medium text-[11px] block">其他素材格式导出</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleExportSRT}
                className="p-2.5 bg-[#1b1b24] hover:bg-[#242430] border border-[#2d2d3c] rounded-xl text-left flex items-center gap-2 cursor-pointer transition-colors"
              >
                <FileText className="w-4 h-4 text-amber-400" />
                <div>
                  <div className="font-semibold text-zinc-200">导出字幕 (.SRT)</div>
                  <div className="text-[10px] text-zinc-500">剪映/Premiere精准同步</div>
                </div>
              </button>

              <button
                onClick={() => {
                  project.clips.forEach((clip, idx) => {
                    if (clip.imageUrl) {
                      const a = document.createElement('a');
                      a.href = clip.imageUrl;
                      a.download = `shot_${idx + 1}_${project.title || 'clip'}.jpg`;
                      a.click();
                    }
                  });
                }}
                className="p-2.5 bg-[#1b1b24] hover:bg-[#242430] border border-[#2d2d3c] rounded-xl text-left flex items-center gap-2 cursor-pointer transition-colors"
              >
                <ImageIcon className="w-4 h-4 text-sky-400" />
                <div>
                  <div className="font-semibold text-zinc-200">分镜原画单帧图</div>
                  <div className="text-[10px] text-zinc-500">下载全部高清图</div>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-[#262634] bg-[#14141a] flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#22222c] hover:bg-[#2c2c38] text-zinc-300 rounded-xl transition-colors cursor-pointer"
          >
            返回编辑
          </button>

          <button
            onClick={handleStartExportVideo}
            disabled={isExporting}
            className="px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold rounded-xl flex items-center gap-1.5 shadow-lg shadow-amber-500/20 cursor-pointer disabled:opacity-50 transition-all active:scale-95"
          >
            {isExporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-black" /> : <Video className="w-3.5 h-3.5" />}
            {isExporting ? '正在渲染 MP4...' : exportedResult ? '重新渲染 MP4' : '开始渲染导出 MP4'}
          </button>
        </div>
      </div>
    </div>
  );
};

