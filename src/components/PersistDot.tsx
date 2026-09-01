import React, { useEffect, useState } from 'react';
import { getPersistSnapshot, PersistSnapshot, subscribePersistStatus } from '../utils/projectPersist';

const LABEL: Record<PersistSnapshot['status'], string> = {
  idle: '尚未写入磁盘',
  saving: '正在写入磁盘',
  saved: '已写入磁盘',
  error: '磁盘写入失败'
};

export const PersistDot: React.FC = () => {
  const [snapshot, setSnapshot] = useState<PersistSnapshot>(() => getPersistSnapshot());

  useEffect(() => subscribePersistStatus(setSnapshot), []);

  const color =
    snapshot.status === 'saved'
      ? 'bg-emerald-400'
      : snapshot.status === 'saving'
        ? 'bg-amber-400 animate-pulse'
        : snapshot.status === 'error'
          ? 'bg-rose-400'
          : 'bg-zinc-500';

  return (
    <div
      id="persist-dot"
      className="w-10 h-6 rounded-lg flex items-center justify-center"
      title={snapshot.error ? `${LABEL[snapshot.status]}：${snapshot.error}` : LABEL[snapshot.status]}
    >
      <span className={`w-2 h-2 rounded-full ${color}`} />
    </div>
  );
};
