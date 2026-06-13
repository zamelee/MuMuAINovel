import { useState, useRef, useEffect } from 'react';
import { chapterApi } from '../../../services/api';

/**
 * useAutoAnalysis
 *
 * 章节生成后自动分析的倒计时与触发:
 *   - autoAnalysisEnabled: 用户开关 (localStorage 持久化)
 *   - autoAnalysisDelay: 倒计时秒数 (localStorage 持久化)
 *   - chapterCountdowns: { chapterId -> 剩余秒数 }
 *   - countdownIntervalsRef: { chapterId -> interval handle }
 *
 * 方法:
 *   - cancelChapterCountdown(chapterId): 取消倒计时
 *   - startChapterCountdown(chapterId): 启动倒计时, 归零后调 startAnalysis API
 *   - clearAllCountdowns(): 用户关闭开关时调用
 *
 * 跨 hook 依赖:
 *   - startPollingTask: 倒计时归零后启动轮询 (从 useChapterAnalysis 传入)
 */
export interface UseAutoAnalysisDeps {
  startPollingTask: (chapterId: string) => void;
}

export function useAutoAnalysis(deps: UseAutoAnalysisDeps) {
  const { startPollingTask } = deps;

  const [autoAnalysisEnabled, setAutoAnalysisEnabled] = useState(() => {
    try { return localStorage.getItem('auto_analysis_enabled') !== 'false'; }
    catch { return true; }
  });
  const [autoAnalysisDelay, setAutoAnalysisDelay] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem('auto_analysis_delay') || '30');
      return v >= 10 && v <= 120 ? v : 30;
    } catch { return 30; }
  });
  const [chapterCountdowns, setChapterCountdowns] = useState<Record<string, number>>({});
  const countdownIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // 清理所有 interval (组件卸载时)
  useEffect(() => {
    return () => {
      Object.values(countdownIntervalsRef.current).forEach(clearInterval);
      countdownIntervalsRef.current = {};
    };
  }, []);

  const clearAllCountdowns = () => {
    setChapterCountdowns({});
    Object.values(countdownIntervalsRef.current).forEach(clearInterval);
    countdownIntervalsRef.current = {};
  };

  const cancelChapterCountdown = (chapterId: string) => {
    if (countdownIntervalsRef.current[chapterId]) {
      clearInterval(countdownIntervalsRef.current[chapterId]);
      delete countdownIntervalsRef.current[chapterId];
    }
    setChapterCountdowns(prev => { const next = { ...prev }; delete next[chapterId]; return next; });
    // 注意：analysisTasksMap 不再需要在这里清理本地 pending task ——
    // 因为我们不在倒计时开始时把 task 写进 analysisTasksMap。
    // 后端那个 pending task 由 30 分钟孤儿清理回收。
  };

  const startChapterCountdown = (chapterId: string) => {
    cancelChapterCountdown(chapterId);
    setChapterCountdowns(prev => ({ ...prev, [chapterId]: autoAnalysisDelay }));
    countdownIntervalsRef.current[chapterId] = setInterval(() => {
      setChapterCountdowns(prev => {
        const current = prev[chapterId];
        if (current === undefined || current <= 1) {
          clearInterval(countdownIntervalsRef.current[chapterId]);
          delete countdownIntervalsRef.current[chapterId];
          chapterApi.startAnalysis(chapterId).then(() => startPollingTask(chapterId)).catch(() => {});
          const next = { ...prev }; delete next[chapterId]; return next;
        }
        return { ...prev, [chapterId]: current - 1 };
      });
    }, 1000);
  };

  return {
    // state
    autoAnalysisEnabled, setAutoAnalysisEnabled,
    autoAnalysisDelay, setAutoAnalysisDelay,
    chapterCountdowns, setChapterCountdowns,
    // methods
    clearAllCountdowns,
    cancelChapterCountdown,
    startChapterCountdown,
  };
}
