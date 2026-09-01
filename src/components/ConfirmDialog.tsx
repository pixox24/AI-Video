import React from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  detail: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  detail,
  confirmLabel = '继续',
  cancelLabel = '取消',
  onConfirm,
  onCancel
}) => {
  if (!open) return null;

  return (
    <div
      id="confirm-dialog"
      className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md bg-[#131318] border border-[#2a2a36] rounded-2xl p-5 shadow-2xl space-y-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-1.5">
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <p className="text-xs text-zinc-400 leading-relaxed">{detail}</p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-xl text-xs text-zinc-300 bg-[#20202a] border border-[#2e2e3e] cursor-pointer hover:bg-[#2a2a38]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            id="confirm-dialog-ok"
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold text-black bg-amber-500 hover:bg-amber-400 cursor-pointer"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
