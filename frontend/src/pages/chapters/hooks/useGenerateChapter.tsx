import { useState, useRef, useEffect } from 'react';
import { Modal, Form, message } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { projectApi, writingStyleApi, chapterApi } from '../../../services/api';
import { generateChapterBackground } from '../../../services/backgroundTaskService';
import { eventBus } from '../../../store/eventBus';
import type { Chapter, ChapterUpdate, ApiError, WritingStyle } from '../../../types';

export type StreamGenerateFn = (
  chapterId: string,
  onContent: (content: string) => void,
  styleId: number | undefined,
  targetWordCount: number,
  onProgress: (msg: string, val: number) => void,
  model: string | undefined,
  narrativePerspective: string | undefined,
  skillKey: string | undefined,
) => Promise<unknown>;

export interface UseGenerateChapterDeps {
  modal: ReturnType<typeof Modal.useModal>[0];
  currentProjectId: string | null;
  currentProjectTitle: string;
  chapters: Chapter[];
  sortedChapters: Chapter[];
  canGenerateChapter: (chapter: Chapter) => boolean;
  getGenerateDisabledReason: (chapter: Chapter) => string;
  refreshChapters: () => Promise<Chapter[] | undefined>;
  updateChapter: (id: string, values: ChapterUpdate) => Promise<unknown>;
  setCurrentChapter: (chapter: Chapter | null) => void;
  setCurrentProject: (project: unknown) => void;
  loadAnalysisTasks: (chapters?: Chapter[]) => Promise<void>;
  startChapterCountdown: (chapterId: string) => void;
  autoAnalysisEnabled: boolean;
  autoAnalysisDelay: number;
  isMobile: boolean;
  token: Record<string, any>;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  getCachedWordCount: () => number;
  streamGenerate: StreamGenerateFn;
}

export function useGenerateChapter(deps: UseGenerateChapterDeps) {
  const {
    modal, currentProjectId, currentProjectTitle,
    chapters, sortedChapters,
    canGenerateChapter, getGenerateDisabledReason,
    refreshChapters, updateChapter,
    setCurrentChapter, setCurrentProject,
    loadAnalysisTasks,
    startChapterCountdown,
    autoAnalysisEnabled, autoAnalysisDelay,
    token,
    editingId, setEditingId,
    getCachedWordCount,
    streamGenerate,
  } = deps;

  // ===== 编辑器 Modal 状态 =====
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorForm] = Form.useForm();
  const editorContent = Form.useWatch('content', editorForm);
  const contentTextAreaRef = useRef<TextAreaRef>(null);
  const [isContinuing, setIsContinuing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // ===== 写作风格 / 目标字数 =====
  const [writingStyles, setWritingStyles] = useState<WritingStyle[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<number | undefined>();
  const [targetWordCount, setTargetWordCount] = useState<number>(3000);

  // ===== 模型 / Skill =====
  const [availableModels, setAvailableModels] = useState<Array<{ value: string, label: string }>>([]);
  const [selectedModel, setSelectedModel] = useState<string | undefined>();
  const [batchSelectedModel, setBatchSelectedModel] = useState<string | undefined>();
  const [batchSelectedSkillKey, setBatchSelectedSkillKey] = useState<string | undefined>();
  const [availableSkills, setAvailableSkills] = useState<Array<{ template_key: string; template_name: string; description: string; category: string }>>([]);
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | undefined>();
  const [temporaryNarrativePerspective, setTemporaryNarrativePerspective] = useState<string | undefined>();

  // ===== 单章节生成进度 =====
  const [singleChapterProgress, setSingleChapterProgress] = useState(0);
  const [singleChapterProgressMessage, setSingleChapterProgressMessage] = useState('');

  // ===== 字元比 =====
  const [charTokenRatio, setCharTokenRatio] = useState<number>(1.5);

  // ===== 初步检测 (quick check) =====
  const [quickCheckResult, setQuickCheckResult] = useState<{ anchor_score?: number | null; boundary_ok?: boolean; summary?: string } | null>(null);
  const [quickCheckStrategy, setQuickCheckStrategy] = useState<string>('A+B');
  const [quickCheckThreshold, setQuickCheckThreshold] = useState<number>(0.7);
  const [recheckingAnchor, setRecheckingAnchor] = useState(false);

  // ===== 批量生成 =====
  const [batchGenerateVisible, setBatchGenerateVisible] = useState(false);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchTaskId, setBatchTaskId] = useState<string | null>(null);
  const [batchForm] = Form.useForm();
  const [batchProgress, setBatchProgress] = useState<{
    status: string;
    total: number;
    completed: number;
    current_chapter_number: number | null;
    estimated_time_minutes?: number;
  } | null>(null);
  const batchPollingIntervalRef = useRef<number | null>(null);

  // ===== 清理批量轮询 =====
  useEffect(() => {
    return () => {
      if (batchPollingIntervalRef.current) {
        clearInterval(batchPollingIntervalRef.current);
        batchPollingIntervalRef.current = null;
      }
    };
  }, []);

  // ===== 工具方法 =====
  const getNarrativePerspectiveText = (perspective?: string): string => {
    const texts: Record<string, string> = {
      'first_person': '第一人称（我）',
      'third_person': '第三人称（他/她）',
      'omniscient': '全知视角',
      '第一人称': '第一人称（我）',
      '第三人称': '第三人称（他/她）',
      '全知视角': '全知视角',
    };
    return texts[perspective || ''] || '第三人称（默认）';
  };

  const showBrowserNotification = (title: string, body: string, type: 'success' | 'error' | 'info' = 'info') => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      const icon = type === 'success' ? '/logo.svg' : type === 'error' ? '/favicon.ico' : '/logo.svg';
      const notification = new Notification(title, {
        body, icon, badge: '/favicon.ico',
        tag: 'batch-generation', requireInteraction: false, silent: false,
      });
      notification.onclick = () => { window.focus(); notification.close(); };
      setTimeout(() => notification.close(), 5000);
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') showBrowserNotification(title, body, type);
      });
    }
  };

  // ===== 加载 / 写入 =====
  const loadWritingStyles = async () => {
    if (!currentProjectId) return;
    try {
      const response = await writingStyleApi.getProjectStyles(currentProjectId);
      setWritingStyles(response.styles);
      const defaultStyle = response.styles.find(s => s.is_default);
      if (defaultStyle) setSelectedStyleId(defaultStyle.id);
    } catch (error) {
      console.error('加载写作风格失败:', error);
      message.error('加载写作风格失败');
    }
  };

  const loadAvailableSkills = async () => {
    try {
      const response = await fetch('/api/skills/list');
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) setAvailableSkills(data);
      }
    } catch (error) {
      console.error('加载 Skill 列表失败:', error);
    }
  };

  const loadAvailableModels = async (): Promise<string | null> => {
    try {
      const settingsResponse = await fetch('/api/settings');
      if (settingsResponse.ok) {
        const settings = await settingsResponse.json();
        const { api_key, api_base_url, api_provider } = settings;
        if (api_base_url) {
          try {
            const modelsResponse = await fetch(
              `/api/settings/models?api_key=${encodeURIComponent(api_key || '')}&api_base_url=${encodeURIComponent(api_base_url)}&provider=${api_provider}`
            );
            if (modelsResponse.ok) {
              const data = await modelsResponse.json();
              if (data.models && data.models.length > 0) {
                setAvailableModels(data.models);
                setSelectedModel(settings.llm_model);
                return settings.llm_model;
              }
            }
          } catch {
            console.log('获取模型列表失败，将使用默认模型');
          }
        }
      }
    } catch (error) {
      console.error('加载可用模型失败:', error);
    }
    return null;
  };

  // ===== 编辑器 / 单章节生成 =====
  const handleOpenEditor = (id: string) => {
    const chapter = chapters.find(c => c.id === id);
    if (chapter) {
      setCurrentChapter(chapter);
      editorForm.setFieldsValue({ title: chapter.title, content: chapter.content });
      setEditingId(id);
      setQuickCheckResult(null);
      setTemporaryNarrativePerspective(undefined);
      setSelectedSkillKey(undefined);
      setIsEditorOpen(true);
      loadAvailableModels();
      loadAvailableSkills();
      chapterApi.getAnchorScore(id).then(res => {
        if (res.anchor_compliance_score != null) {
          setQuickCheckResult(prev => ({ ...prev, anchor_score: res.anchor_compliance_score }));
        }
      }).catch(() => {});
    }
  };

  const handleRecheckAnchor = async () => {
    if (!editingId) return;
    setRecheckingAnchor(true);
    try {
      const result = await chapterApi.checkAnchor(editingId, { strategy: quickCheckStrategy, threshold: quickCheckThreshold });
      if (result.compliance_score != null) {
        setQuickCheckResult(prev => ({
          ...prev,
          anchor_score: result.compliance_score,
          summary: result.suggestion || prev?.summary || ''
        }));
        message.success('锚点检测完成，得分: ' + result.compliance_score + '/10');
      }
    } catch {
      message.error('重新检测失败');
    } finally {
      setRecheckingAnchor(false);
    }
  };

  const handleEditorSubmit = async (values: ChapterUpdate) => {
    if (!editingId || !currentProjectId) return;
    try {
      await updateChapter(editingId, values);
      const updatedProject = await projectApi.getProject(currentProjectId);
      setCurrentProject(updatedProject);
      message.success('章节保存成功');
      setIsEditorOpen(false);
    } catch {
      message.error('保存失败');
    }
  };

  // SSE 流式生成
  const handleGenerate = async () => {
    if (!editingId) return;
    try {
      setIsContinuing(true);
      setIsGenerating(true);
      setSingleChapterProgress(0);
      setSingleChapterProgressMessage('准备开始生成...');

      const result = await streamGenerate(
        editingId,
        (content) => {
          editorForm.setFieldsValue({ content });
          if (contentTextAreaRef.current) {
            const textArea = contentTextAreaRef.current.resizableTextArea?.textArea;
            if (textArea) textArea.scrollTop = textArea.scrollHeight;
          }
        },
        selectedStyleId,
        targetWordCount,
        (progressMsg, progressValue) => {
          setSingleChapterProgress(progressValue);
          setSingleChapterProgressMessage(progressMsg);
        },
        selectedModel,
        temporaryNarrativePerspective,
        selectedSkillKey
      );

      if (result && autoAnalysisEnabled) {
        message.success('AI创作成功！' + autoAnalysisDelay + '秒后自动开始分析');
        startChapterCountdown(editingId);
      } else {
        message.success('AI创作成功！');
      }
    } catch (error) {
      const apiError = error as ApiError;
      message.error('AI创作失败：' + (apiError.response?.data?.detail || apiError.message || '未知错误'));
    } finally {
      setIsContinuing(false);
      setIsGenerating(false);
      setSingleChapterProgress(0);
      setSingleChapterProgressMessage('');
    }
  };

  const showGenerateModal = (chapter: Chapter) => {
    const previousChapters = chapters.filter(
      c => c.chapter_number < chapter.chapter_number
    ).sort((a, b) => a.chapter_number - b.chapter_number);

    const selectedStyle = writingStyles.find(s => s.id === selectedStyleId);

    const instance = modal.confirm({
      title: 'AI创作章节内容',
      width: 700,
      centered: true,
      content: (
        <div style={{ marginTop: 16 }}>
          <p>AI将根据以下信息创作本章内容：</p>
          <ul>
            <li>章节大纲和要求</li>
            <li>项目的世界观设定</li>
            <li>相关角色信息</li>
            <li><strong>前面已完成章节的内容（确保剧情连贯）</strong></li>
            {selectedStyle && <li><strong>写作风格：{selectedStyle.name}</strong></li>}
            <li><strong>目标字数：{targetWordCount}字</strong></li>
          </ul>
          {previousChapters.length > 0 && (
            <div style={{
              marginTop: 16,
              padding: 12,
              background: token.colorInfoBg,
              borderRadius: token.borderRadius,
              border: `1px solid ${token.colorInfoBorder}`
            }}>
              <div style={{ marginBottom: 8, fontWeight: 500, color: token.colorPrimary }}>
                📚 将引用的前置章节（共{previousChapters.length}章）：
              </div>
              <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                {previousChapters.map(ch => (
                  <div key={ch.id} style={{ padding: '4px 0', fontSize: 13 }}>
                    ✓ 第{ch.chapter_number}章：{ch.title} ({ch.word_count || 0}字)
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextSecondary }}>
                💡 AI会参考这些章节内容，确保情节连贯、角色状态一致
              </div>
            </div>
          )}
          <p style={{ color: token.colorError, marginTop: 16, marginBottom: 0 }}>
            ⚠️ 注意：此操作将覆盖当前章节内容
          </p>
        </div>
      ),
      okText: '开始创作',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        instance.update({
          okButtonProps: { danger: true, loading: true },
          cancelButtonProps: { disabled: true },
          closable: false, maskClosable: false, keyboard: false,
        });
        try {
          if (!selectedStyleId) {
            message.error('请先选择写作风格');
            instance.update({
              okButtonProps: { danger: true, loading: false },
              cancelButtonProps: { disabled: false },
              closable: true, maskClosable: true, keyboard: true,
            });
            return;
          }
          await handleGenerate();
          instance.destroy();
        } catch {
          instance.update({
            okButtonProps: { danger: true, loading: false },
            cancelButtonProps: { disabled: false },
            closable: true, maskClosable: true, keyboard: true,
          });
        }
      },
      onCancel: () => {
        if (isGenerating) {
          message.warning('AI正在创作中，请等待完成');
          return false;
        }
      },
    });
  };

  // ===== 后台生成 =====
  const handleBackgroundGenerate = async () => {
    if (!editingId) return;
    if (!selectedStyleId) {
      message.error('请先选择写作风格');
      return;
    }
    try {
      await generateChapterBackground(
        editingId,
        {
          style_id: selectedStyleId,
          target_word_count: targetWordCount,
          model: selectedModel,
          narrative_perspective: temporaryNarrativePerspective,
        },
        () => {},
        async (_) => {
          message.success('后台章节生成完成！');
          await refreshChapters();
          if (currentProjectId) {
            projectApi.getProject(currentProjectId).then(setCurrentProject).catch(console.error);
          }
          await loadAnalysisTasks();
        },
        (error) => {
          message.error('后台生成失败: ' + error);
        }
      );
      message.info('章节生成任务已提交，可在右下角任务面板查看进度');
      eventBus.emit('background-task-created');
    } catch {
      message.error('创建后台任务失败');
    }
  };

  // ===== 批量生成 =====
  const handleBatchGenerate = async (values: {
    startChapterNumber: number;
    count: number;
    enableAnalysis: boolean;
    styleId?: number;
    targetWordCount?: number;
    model?: string;
  }) => {
    if (!currentProjectId) return;

    const styleId = values.styleId || selectedStyleId;
    const wordCount = values.targetWordCount || targetWordCount;
    const model = batchSelectedModel;

    if (!styleId) {
      message.error('请选择写作风格');
      return;
    }

    try {
      setBatchGenerating(true);
      setBatchGenerateVisible(false);

      const requestBody: {
        start_chapter_number: number;
        count: number;
        enable_analysis: boolean;
        style_id: number;
        target_word_count: number;
        model?: string;
        skill_key?: string;
      } = {
        start_chapter_number: values.startChapterNumber,
        count: values.count,
        enable_analysis: true,
        style_id: styleId,
        target_word_count: wordCount,
      };
      if (model) requestBody.model = model;
      if (batchSelectedSkillKey) requestBody.skill_key = batchSelectedSkillKey;

      const response = await fetch(`/api/chapters/project/${currentProjectId}/batch-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || '创建批量生成任务失败');
      }

      const result = await response.json();
      setBatchTaskId(result.batch_id);
      setBatchProgress({
        status: 'running',
        total: result.chapters_to_generate.length,
        completed: 0,
        current_chapter_number: values.startChapterNumber,
        estimated_time_minutes: result.estimated_time_minutes,
      });

      message.success(`批量生成任务已创建，预计需要 ${result.estimated_time_minutes} 分钟，可在右下角任务面板查看进度`);
      eventBus.emit('background-task-created');
      showBrowserNotification(
        '批量生成已启动',
        `开始生成 ${result.chapters_to_generate.length} 章，预计需要 ${result.estimated_time_minutes} 分钟`,
        'info'
      );
      startBatchPolling(result.batch_id);
    } catch (error: unknown) {
      const err = error as Error;
      message.error('创建批量生成任务失败：' + (err.message || '未知错误'));
      setBatchGenerating(false);
      setBatchGenerateVisible(false);
    }
  };

  const startBatchPolling = (taskId: string) => {
    if (batchPollingIntervalRef.current) {
      clearInterval(batchPollingIntervalRef.current);
    }
    const poll = async () => {
      try {
        const response = await fetch(`/api/chapters/batch-generate/${taskId}/status`);
        if (!response.ok) return;
        const status = await response.json();
        setBatchProgress({
          status: status.status,
          total: status.total,
          completed: status.completed,
          current_chapter_number: status.current_chapter_number,
        });
        if (status.completed > 0) {
          const latestChapters = await refreshChapters();
          await loadAnalysisTasks(latestChapters);
          if (currentProjectId) {
            const updatedProject = await projectApi.getProject(currentProjectId);
            setCurrentProject(updatedProject);
          }
        }
        if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
          if (batchPollingIntervalRef.current) {
            clearInterval(batchPollingIntervalRef.current);
            batchPollingIntervalRef.current = null;
          }
          setBatchGenerating(false);
          const finalChapters = await refreshChapters();
          await loadAnalysisTasks(finalChapters);
          if (currentProjectId) {
            const updatedProject = await projectApi.getProject(currentProjectId);
            setCurrentProject(updatedProject);
          }
          if (status.status === 'completed') {
            message.success(`批量生成完成！成功生成 ${status.completed} 章`);
            showBrowserNotification(
              '批量生成完成',
              `《${currentProjectTitle}》成功生成 ${status.completed} 章节`,
              'success'
            );
          } else if (status.status === 'failed') {
            message.error(`批量生成失败：${status.error_message || '未知错误'}`);
            showBrowserNotification('批量生成失败', status.error_message || '未知错误', 'error');
          } else if (status.status === 'cancelled') {
            message.warning('批量生成已取消');
          }
          setTimeout(() => {
            setBatchGenerateVisible(false);
            setBatchTaskId(null);
            setBatchProgress(null);
          }, 2000);
        }
      } catch (error) {
        console.error('轮询批量生成状态失败:', error);
      }
    };
    poll();
    batchPollingIntervalRef.current = window.setInterval(poll, 2000);
  };

  const handleCancelBatchGenerate = async () => {
    if (!batchTaskId) return;
    try {
      const response = await fetch(`/api/chapters/batch-generate/${batchTaskId}/cancel`, { method: 'POST' });
      if (!response.ok) throw new Error('取消失败');
      message.success('批量生成已取消');
      await refreshChapters();
      await loadAnalysisTasks();
      if (currentProjectId) {
        const updatedProject = await projectApi.getProject(currentProjectId);
        setCurrentProject(updatedProject);
      }
    } catch (error: unknown) {
      const err = error as Error;
      message.error('取消失败：' + (err.message || '未知错误'));
    }
  };

  const handleOpenBatchGenerate = async () => {
    const firstIncompleteChapter = sortedChapters.find(
      ch => !ch.content || ch.content.trim() === ''
    );
    if (!firstIncompleteChapter) {
      message.info('所有章节都已生成内容');
      return;
    }
    if (!canGenerateChapter(firstIncompleteChapter)) {
      const reason = getGenerateDisabledReason(firstIncompleteChapter);
      message.warning(reason);
      return;
    }
    const defaultModel = await loadAvailableModels();
    loadAvailableSkills();
    setBatchSelectedModel(defaultModel || undefined);
    batchForm.setFieldsValue({
      startChapterNumber: firstIncompleteChapter.chapter_number,
      count: 5,
      enableAnalysis: false,
      styleId: selectedStyleId,
      targetWordCount: getCachedWordCount(),
    });
    setBatchGenerateVisible(true);
  };

  const checkAndRestoreBatchTask = async () => {
    if (!currentProjectId) return;
    try {
      const response = await fetch(`/api/chapters/project/${currentProjectId}/batch-generate/active`);
      if (!response.ok) return;
      const data = await response.json();
      if (data.has_active_task && data.task) {
        const task = data.task;
        setBatchTaskId(task.batch_id);
        setBatchProgress({
          status: task.status,
          total: task.total,
          completed: task.completed,
          current_chapter_number: task.current_chapter_number,
        });
        setBatchGenerating(true);
        startBatchPolling(task.batch_id);
        message.info('检测到未完成的批量生成任务，请查看任务列表');
      }
    } catch (error) {
      console.error('检查批量生成任务失败:', error);
    }
  };

  return {
    // editor state
    isEditorOpen, setIsEditorOpen,
    editorForm,
    editorContent,
    contentTextAreaRef,
    isContinuing, setIsContinuing,
    isGenerating, setIsGenerating,
    // style / word count
    writingStyles, setWritingStyles,
    selectedStyleId, setSelectedStyleId,
    targetWordCount, setTargetWordCount,
    // model / skill
    availableModels, setAvailableModels,
    selectedModel, setSelectedModel,
    batchSelectedModel, setBatchSelectedModel,
    batchSelectedSkillKey, setBatchSelectedSkillKey,
    availableSkills, setAvailableSkills,
    selectedSkillKey, setSelectedSkillKey,
    temporaryNarrativePerspective, setTemporaryNarrativePerspective,
    // progress
    singleChapterProgress, setSingleChapterProgress,
    singleChapterProgressMessage, setSingleChapterProgressMessage,
    // char ratio
    charTokenRatio, setCharTokenRatio,
    // quick check
    quickCheckResult, setQuickCheckResult,
    quickCheckStrategy, setQuickCheckStrategy,
    quickCheckThreshold, setQuickCheckThreshold,
    recheckingAnchor, setRecheckingAnchor,
    // batch generate
    batchGenerateVisible, setBatchGenerateVisible,
    batchGenerating, setBatchGenerating,
    batchTaskId, setBatchTaskId,
    batchForm,
    batchProgress, setBatchProgress,
    batchPollingIntervalRef,
    // handlers
    getNarrativePerspectiveText,
    loadWritingStyles,
    loadAvailableModels,
    loadAvailableSkills,
    handleOpenEditor,
    handleEditorSubmit,
    handleRecheckAnchor,
    handleGenerate,
    showGenerateModal,
    handleBackgroundGenerate,
    handleBatchGenerate,
    startBatchPolling,
    handleCancelBatchGenerate,
    handleOpenBatchGenerate,
    checkAndRestoreBatchTask,
  };
}
