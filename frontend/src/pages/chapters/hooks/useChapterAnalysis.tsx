import { useState, useRef, useCallback, useEffect } from 'react';
import { message, Tag } from 'antd';
import { SyncOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { chapterApi } from '../../../services/api';
import type { AnalysisTask, Chapter } from '../../../types';
import { useStore } from '../../../store';

/**
 * useChapterAnalysis
 *
 * Owns chapter analysis task state and polling:
 *   - analysisTasksMap: { chapterId -> AnalysisTask }
 *   - analysisVisible / analysisChapterId: 控制 ChapterAnalysis 弹窗
 *   - batchAnalyzingUnanalyzed: 一键分析 loading
 *   - loadAnalysisTasks / startPollingTask / pollActiveAnalysisTasks
 *   - renderAnalysisStatus: 渲染分析状态 Tag
 *
 * Inputs:
 *   - currentProjectId: caller-provided (zustand selector in caller)
 *   - chapters: internally read from useStore (auto reload on chapters.length change)
 */
export function useChapterAnalysis(
  currentProjectId: string | null | undefined,
) {
  const [analysisTasksMap, setAnalysisTasksMap] = useState<Record<string, AnalysisTask>>({});
  const [analysisVisible, setAnalysisVisible] = useState(false);
  const [analysisChapterId, setAnalysisChapterId] = useState<string | null>(null);
  const [batchAnalyzingUnanalyzed, setBatchAnalyzingUnanalyzed] = useState(false);

  // 内部读 store: chapters 变化时自动 reload analysis tasks
  // 用 length 而非整个 chapters 引用,避免每次 setState 触发不必要的 reload
  const chapters = useStore((state) => state.chapters);

  const analysisPollingIntervalRef = useRef<number | null>(null);
  const activeAnalysisPollingIdsRef = useRef<Set<string>>(new Set());

  // 清理轮询定时器
  useEffect(() => {
    return () => {
      if (analysisPollingIntervalRef.current) {
        clearInterval(analysisPollingIntervalRef.current);
        analysisPollingIntervalRef.current = null;
      }
    };
  }, []);

  // chapters 列表变化时自动 reload analysis tasks
  // 这样 loadAnalysisTasks 调用方不再必须传 chaptersToLoad (兼容旧调用方式)
  useEffect(() => {
    if (currentProjectId && chapters.length > 0) {
      void loadAnalysisTasks(chapters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, chapters.length]);

  const clearAnalysisPollingIfIdle = useCallback(() => {
    if (activeAnalysisPollingIdsRef.current.size === 0 && analysisPollingIntervalRef.current) {
      clearInterval(analysisPollingIntervalRef.current);
      analysisPollingIntervalRef.current = null;
    }
  }, []);

  const pollActiveAnalysisTasks = useCallback(async () => {
    if (!currentProjectId) return;

    const activeIds = Array.from(activeAnalysisPollingIdsRef.current);
    if (activeIds.length === 0) {
      clearAnalysisPollingIfIdle();
      return;
    }

    try {
      const response = await chapterApi.getBatchAnalysisStatuses(currentProjectId, activeIds);
      const tasksMap = response.items || {};

      setAnalysisTasksMap(prev => ({
        ...prev,
        ...tasksMap,
      }));

      activeIds.forEach((chapterId) => {
        const task = tasksMap[chapterId];
        if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'none' || task.status === 'cancelled') {
          activeAnalysisPollingIdsRef.current.delete(chapterId);

          if (task?.status === 'completed') {
            message.success('章节分析完成');
          } else if (task?.status === 'failed') {
            message.error(`章节分析失败: ${task.error_message || '未知错误'}`);
          }
        }
      });

      clearAnalysisPollingIfIdle();
    } catch (error) {
      console.error('批量轮询分析任务失败:', error);
    }
  }, [clearAnalysisPollingIfIdle, currentProjectId]);

  const ensureAnalysisPolling = useCallback(() => {
    if (analysisPollingIntervalRef.current) return;

    analysisPollingIntervalRef.current = window.setInterval(() => {
      void pollActiveAnalysisTasks();
    }, 2000);

    // 立即执行一次
    void pollActiveAnalysisTasks();
  }, [pollActiveAnalysisTasks]);

  // 加载所有章节的分析任务状态（批量接口，避免逐章请求风暴）
  // 接受可选的 chaptersToLoad 参数，解决 React 状态更新延迟导致的问题
  const loadAnalysisTasks = async (chaptersToLoad?: Chapter[]) => {
    // 优先用入参, fallback 到 store (调用方不一定传, 比如首次进入项目 / 弹窗关闭后的 reload)
    const targetChapters = chaptersToLoad ?? useStore.getState().chapters;
    if (!targetChapters || targetChapters.length === 0 || !currentProjectId) return;

    const chapterIds = targetChapters
      .filter(chapter => chapter.content && chapter.content.trim() !== '')
      .map(chapter => chapter.id);

    if (chapterIds.length === 0) {
      setAnalysisTasksMap({});
      activeAnalysisPollingIdsRef.current.clear();
      clearAnalysisPollingIfIdle();
      return;
    }

    try {
      const response = await chapterApi.getBatchAnalysisStatuses(currentProjectId, chapterIds);
      const tasksMap = response.items || {};
      setAnalysisTasksMap((prev) => ({ ...prev, ...tasksMap }));

      activeAnalysisPollingIdsRef.current.clear();
      Object.entries(tasksMap).forEach(([chapterId, task]) => {
        if (task?.status === 'pending' || task?.status === 'running') {
          activeAnalysisPollingIdsRef.current.add(chapterId);
        }
      });

      if (activeAnalysisPollingIdsRef.current.size > 0) {
        ensureAnalysisPolling();
      } else {
        clearAnalysisPollingIfIdle();
      }
    } catch (error) {
      console.error('批量加载分析任务状态失败:', error);
    }
  };

  // 启动单个章节的任务轮询（内部合并到批量轮询）
  const startPollingTask = (chapterId: string) => {
    activeAnalysisPollingIdsRef.current.add(chapterId);
    ensureAnalysisPolling();
  };

  const handleShowAnalysis = (chapterId: string) => {
    setAnalysisChapterId(chapterId);
    setAnalysisVisible(true);
  };

  // 一键按章节顺序分析未分析章节
  const handleBatchAnalyzeUnanalyzed = async () => {
    if (!currentProjectId) return;

    try {
      setBatchAnalyzingUnanalyzed(true);
      const result = await chapterApi.batchAnalyzeUnanalyzed(currentProjectId);

      if (result.total_started > 0) {
        setAnalysisTasksMap((prev) => ({
          ...prev,
          ...result.started_tasks,
        }));

        Object.keys(result.started_tasks).forEach((chapterId) => {
          startPollingTask(chapterId);
        });

        message.success(
          `已加入 ${result.total_started} 章顺序分析队列（跳过已分析 ${result.total_already_completed} 章，分析中/排队中 ${result.total_skipped_running} 章）`
        );
      } else {
        message.info('没有可启动分析的章节：当前章节要么无内容、要么已分析完成、要么正在分析中');
      }

      // 刷新一次状态，确保前端与后端一致
      await loadAnalysisTasks();
    } catch (error: unknown) {
      const err = error as Error;
      message.error(`一键分析失败：${err.message || '未知错误'}`);
    } finally {
      setBatchAnalyzingUnanalyzed(false);
    }
  };

  // 渲染分析状态标签
  const renderAnalysisStatus = (chapterId: string) => {
    const task = analysisTasksMap[chapterId];

    if (!task) {
      return null;
    }

    switch (task.status) {
      case 'pending':
        return (
          <Tag icon={<SyncOutlined spin />} color="processing">
            等待分析
          </Tag>
        );
      case 'running': {
        // 检查是否正在重试（后端会在error_message中包含"重试"信息）
        const isRetrying = task.error_message && task.error_message.includes('重试');
        return (
          <Tag
            icon={<SyncOutlined spin />}
            color={isRetrying ? "warning" : "processing"}
            title={task.error_message || undefined}
          >
            {isRetrying ? `重试中 ${task.progress}%` : `分析中 ${task.progress}%`}
          </Tag>
        );
      }
      case 'completed':
        return (
          <Tag icon={<CheckCircleOutlined />} color="success">
            已分析
          </Tag>
        );
      case 'failed':
        return (
          <Tag icon={<CloseCircleOutlined />} color="error" title={task.error_message || undefined}>
            分析失败
          </Tag>
        );
      default:
        return null;
    }
  };

  return {
    // state
    analysisTasksMap,
    setAnalysisTasksMap,
    analysisVisible,
    setAnalysisVisible,
    analysisChapterId,
    setAnalysisChapterId,
    batchAnalyzingUnanalyzed,
    // handlers
    loadAnalysisTasks,
    startPollingTask,
    handleShowAnalysis,
    handleBatchAnalyzeUnanalyzed,
    renderAnalysisStatus,
  };
}
