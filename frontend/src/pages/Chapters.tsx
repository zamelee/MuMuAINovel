import { useState, useEffect } from 'react';
import { List, Button, Checkbox, Modal, Form, Input, Select, message, Empty, Space, Badge, Tag, InputNumber, Alert, Radio, Collapse, Popconfirm, Pagination, theme, Tooltip } from 'antd';
import { EditOutlined, FileTextOutlined, ThunderboltOutlined, LockOutlined, DownloadOutlined, SettingOutlined, FundOutlined, SyncOutlined, CloseCircleOutlined, RocketOutlined, StopOutlined, InfoCircleOutlined, CaretRightOutlined, DeleteOutlined, BookOutlined, FormOutlined, PlusOutlined, ReadOutlined } from '@ant-design/icons';
import { useStore } from '../store';
import { useChapterSync } from '../store/hooks';
import { projectApi } from '../services/api';
import ChapterAnalysis from '../components/ChapterAnalysis';
import ExpansionPlanEditor from '../components/ExpansionPlanEditor';
import { SSELoadingOverlay } from '../components/SSELoadingOverlay';
import ChapterReader from '../components/ChapterReader';
import PartialRegenerateToolbar from '../components/PartialRegenerateToolbar';
import PartialRegenerateModal from '../components/PartialRegenerateModal';
import { useChapterList } from './chapters/hooks/useChapterList';
import { useChapterAnalysis } from './chapters/hooks/useChapterAnalysis';
import { useChapterReader } from './chapters/hooks/useChapterReader';
import { useChapterCRUD } from './chapters/hooks/useChapterCRUD.tsx';
import { useGenerateChapter } from './chapters/hooks/useGenerateChapter.tsx';
import { useAutoAnalysis } from './chapters/hooks/useAutoAnalysis';
import type { StreamGenerateFn as UseGenerateChapterStreamFn } from './chapters/hooks/useGenerateChapter.tsx';

const { TextArea } = Input;

// localStorage 缓存键名
const WORD_COUNT_CACHE_KEY = 'chapter_default_word_count';
const DEFAULT_WORD_COUNT = 3000;

// 从 localStorage 读取缓存的字数
const getCachedWordCount = (): number => {
  try {
    const cached = localStorage.getItem(WORD_COUNT_CACHE_KEY);
    if (cached) {
      const value = parseInt(cached, 10);
      if (!isNaN(value) && value >= 500 && value <= 10000) {
        return value;
      }
    }
  } catch (error) {
    console.warn('读取字数缓存失败:', error);
  }
  return DEFAULT_WORD_COUNT;
};

// 保存字数到 localStorage
const setCachedWordCount = (value: number): void => {
  try {
    localStorage.setItem(WORD_COUNT_CACHE_KEY, String(value));
  } catch (error) {
    console.warn('保存字数缓存失败:', error);
  }
};

const CHAR_TOKEN_RATIO_CACHE_KEY = "chapter_char_token_ratio";
const QUICK_CHECK_STRATEGY_KEY = "quick_check_strategy";
const QUICK_CHECK_THRESHOLD_KEY = "quick_check_threshold";

const setCachedCharTokenRatio = (value: number): void => {
  try { localStorage.setItem(CHAR_TOKEN_RATIO_CACHE_KEY, String(value)); }
  catch (error) { console.warn("setCachedCharTokenRatio failed:", error); }
};
export default function Chapters() {
  const { currentProject, chapters, outlines, setCurrentChapter, setCurrentProject } = useStore();
  const [modal, contextHolder] = Modal.useModal();
  const { token } = theme.useToken();
  // editingId 跨 useChapterCRUD 与 useGenerateChapter 共享（main 持有 state, 两 hook 接收 setter）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'draft': 'default',
      'pending': 'warning',
      'writing': 'processing',
      'completed': 'success',
    };
    return colors[status] || 'default';
  };

  const getStatusText = (status: string) => {
    const texts: Record<string, string> = {
      'draft': '草稿',
      'pending': '待处理',
      'writing': '创作中',
      'completed': '已完成',
    };
    return texts[status] || status;
  };

  // ===== Phase 3a hooks =====
  // useChapterAnalysis 必须在 useChapterList 之前（list 需要 analysisTasksMap）
  const {
    analysisTasksMap,
    analysisVisible,
    setAnalysisVisible,
    analysisChapterId,
    setAnalysisChapterId,
    batchAnalyzingUnanalyzed,
    loadAnalysisTasks,
    startPollingTask,
    handleShowAnalysis,
    handleBatchAnalyzeUnanalyzed,
    renderAnalysisStatus,
  } = useChapterAnalysis(currentProject?.id);

  // useChapterList: 章节排序/过滤/分页 + 生成门控
  const {
    chapterSearchKeyword, setChapterSearchKeyword,
    chapterPage, setChapterPage,
    chapterPageSize, setChapterPageSize,
    sortedChapters,
    filteredSortedChapters,
    pagedSortedChapters,
    pagedGroupedChapters,
    batchAnalyzableChapterCount,
    canGenerateChapter,
    getGenerateDisabledReason,
  } = useChapterList(chapters, analysisTasksMap, currentProject?.outline_mode);


  // ===== Phase 3b hooks =====

  // useChapterSync (来自 store) — 抽取 refreshChapters/updateChapter/generateChapterContentStream
  const {
    refreshChapters,
    updateChapter,
    generateChapterContentStream
  } = useChapterSync();

  // useChapterCRUD: 小 modal + 删除 + 手动创建 + 规划编辑器 + 展开规划查看
  const {
    isModalOpen, setIsModalOpen,
    form,
    planEditorVisible, setPlanEditorVisible,
    editingPlanChapter, setEditingPlanChapter,
    handleOpenModal,
    handleSubmit,
    handleDeleteChapter,
    handleOpenPlanEditor,
    handleSavePlan,
    showManualCreateChapterModal,
    showExpansionPlanModal,
  } = useChapterCRUD({
    modal,
    chapters,
    currentProjectId: currentProject?.id ?? '',
    refreshChapters: refreshChapters as () => Promise<unknown>,
    updateChapter,
    setCurrentProject: setCurrentProject as (project: unknown) => void,
    isMobile,
    token,
    getStatusText,
    outlines,
  });

  // useAutoAnalysis: 自动分析开关 + 倒计时
  const {
    autoAnalysisEnabled, setAutoAnalysisEnabled,
    autoAnalysisDelay, setAutoAnalysisDelay,
    chapterCountdowns,
    clearAllCountdowns,
    cancelChapterCountdown,
    startChapterCountdown,
  } = useAutoAnalysis({ startPollingTask });


  // useGenerateChapter: 编辑器 + 单章节 AI + 初步检测 + 批量生成
  const {
    isEditorOpen, setIsEditorOpen,
    editorForm,
    editorContent,
    contentTextAreaRef,
    isContinuing,
    isGenerating,
    writingStyles,
    selectedStyleId, setSelectedStyleId,
    targetWordCount, setTargetWordCount,
    availableModels,
    selectedModel, setSelectedModel,
    batchSelectedModel, setBatchSelectedModel,
    batchSelectedSkillKey, setBatchSelectedSkillKey,
    availableSkills,
    selectedSkillKey, setSelectedSkillKey,
    temporaryNarrativePerspective, setTemporaryNarrativePerspective,
    singleChapterProgress,
    singleChapterProgressMessage,
    charTokenRatio, setCharTokenRatio,
    quickCheckResult,
    quickCheckStrategy, setQuickCheckStrategy,
    quickCheckThreshold, setQuickCheckThreshold,
    recheckingAnchor,
    batchGenerateVisible, setBatchGenerateVisible,
    batchGenerating,
    batchForm,
    batchProgress,
    getNarrativePerspectiveText,
    loadWritingStyles,
    handleOpenEditor,
    handleEditorSubmit,
    handleRecheckAnchor,
    showGenerateModal,
    handleBackgroundGenerate,
    handleBatchGenerate,
    handleCancelBatchGenerate,
    handleOpenBatchGenerate,
    checkAndRestoreBatchTask,
  } = useGenerateChapter({
    modal,
    currentProjectId: currentProject?.id ?? null,
    currentProjectTitle: currentProject?.title ?? '',
    chapters,
    sortedChapters,
    canGenerateChapter,
    getGenerateDisabledReason,
    refreshChapters,
    updateChapter,
    setCurrentChapter,
    setCurrentProject: setCurrentProject as (project: unknown) => void,
    loadAnalysisTasks,
    isMobile,
    startChapterCountdown,
    autoAnalysisEnabled: true,
    autoAnalysisDelay: 30,
    token,
    editingId,
    setEditingId,
    getCachedWordCount,
    streamGenerate: generateChapterContentStream as UseGenerateChapterStreamFn,
  });
  // useChapterReader: 阅读器 + 局部重写（依赖 isEditorOpen/isGenerating/contentTextAreaRef/editorForm）
  const {
    readerVisible, setReaderVisible,
    readingChapter, setReadingChapter,
    partialRegenerateToolbarVisible,
    partialRegenerateToolbarPosition,
    selectedTextForRegenerate,
    selectionStartPosition,
    selectionEndPosition,
    partialRegenerateModalVisible, setPartialRegenerateModalVisible,
    handleOpenReader,
    handleReaderChapterChange,
    handleOpenPartialRegenerate,
    handleApplyPartialRegenerate,
  } = useChapterReader({
    isEditorOpen,
    isGenerating,
    contentTextAreaRef,
    editorForm,
  });

  useEffect(() => {
    if (currentProject?.id) {
      refreshChapters();
      loadWritingStyles();
      loadAnalysisTasks();
      checkAndRestoreBatchTask();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id]);


  const handleExport = () => {
    if (chapters.length === 0) {
      message.warning('当前项目没有章节，无法导出');
      return;
    }

    if (!currentProject) {
      message.warning('当前项目未加载，无法导出');
      return;
    }

    modal.confirm({
      title: '导出项目章节',
      content: `确定要将《${currentProject?.title}》的所有章节导出为TXT文件吗？`,
      centered: true,
      okText: '确定导出',
      cancelText: '取消',
      onOk: () => {
        try {
          projectApi.exportProject(currentProject?.id);
          message.success('开始下载导出文件');
        } catch {
          message.error('导出失败，请重试');
        }
      },
    });
  };



  // 一键按章节顺序分析未分析章节


  // 手动创建章节(仅one-to-many模式)

  // 打开阅读器

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {contextHolder}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        backgroundColor: token.colorBgContainer,
        padding: isMobile ? '12px 0' : '16px 0',
        marginBottom: isMobile ? 12 : 16,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        gap: isMobile ? 12 : 0,
        justifyContent: 'space-between',
        alignItems: isMobile ? 'stretch' : 'center'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 24 }}>
            <BookOutlined style={{ marginRight: 8 }} />
            章节管理
          </h2>
          <Tag
            color={currentProject?.outline_mode === 'one-to-one' ? 'blue' : 'green'}
            style={{ width: 'fit-content' }}
          >
            {currentProject?.outline_mode === 'one-to-one'
              ? '传统模式：章节由大纲管理，请在大纲页面操作'
              : '细化模式：章节可在大纲页面展开'}
          </Tag>
        </div>
        <Space direction={isMobile ? 'vertical' : 'horizontal'} style={{ width: isMobile ? '100%' : 'auto' }}>
          <Input.Search
            allowClear
            placeholder="搜索章节（序号/标题/大纲）"
            value={chapterSearchKeyword}
            onChange={(e) => setChapterSearchKeyword(e.target.value)}
            style={{ width: isMobile ? '100%' : 280 }}
          />
          {currentProject?.outline_mode === 'one-to-many' && (
            <Button
              icon={<PlusOutlined />}
              onClick={showManualCreateChapterModal}
              block={isMobile}
              size={isMobile ? 'middle' : 'middle'}
            >
              手动创建
            </Button>
          )}
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={handleBatchAnalyzeUnanalyzed}
            loading={batchAnalyzingUnanalyzed}
            disabled={chapters.length === 0 || batchAnalyzableChapterCount === 0}
            block={isMobile}
            size={isMobile ? 'middle' : 'middle'}
            style={{ background: token.colorWarning, borderColor: token.colorWarning }}
            title={batchAnalyzableChapterCount === 0 ? '暂无可一键分析章节' : `可一键分析 ${batchAnalyzableChapterCount} 章`}
          >
            一键分析{batchAnalyzableChapterCount > 0 ? ` (${batchAnalyzableChapterCount})` : ''}
          </Button>
          <Button
            type="primary"
            icon={<RocketOutlined />}
            onClick={handleOpenBatchGenerate}
            disabled={chapters.length === 0 || batchGenerating}
            loading={batchGenerating}
            block={isMobile}
            size={isMobile ? 'middle' : 'middle'}
            style={batchGenerating ? {} : { background: token.colorInfo, borderColor: token.colorInfo }}
          >
            {batchGenerating ? '生成中...' : '批量生成'}
          </Button>
          <Button
            type="default"
            icon={<DownloadOutlined />}
            onClick={handleExport}
            disabled={chapters.length === 0}
            block={isMobile}
            size={isMobile ? 'middle' : 'middle'}
          >
            导出为TXT
          </Button>
        </Space>
      </div>


      {/* 自动分析设置 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '6px 0',
        marginBottom: 8,
        borderBottom: '1px solid ' + token.colorBorderSecondary,
        flexWrap: 'wrap'
      }}>
        <Checkbox
          checked={autoAnalysisEnabled}
          onChange={e => {
            const val = e.target.checked;
            setAutoAnalysisEnabled(val);
            localStorage.setItem('auto_analysis_enabled', String(val));
            if (!val) { clearAllCountdowns(); }
          }}
        >
          启用章节生成后自动分析
        </Checkbox>
        {autoAnalysisEnabled && (
          <>
            <span style={{ fontSize: 13, color: token.colorTextSecondary }}>倒计时</span>
            <InputNumber
              min={10} max={120} step={5}
              value={autoAnalysisDelay}
              onChange={v => {
                const val = v ?? 30;
                setAutoAnalysisDelay(val);
                localStorage.setItem('auto_analysis_delay', String(val));
              }}
              size='small'
              style={{ width: 70 }}
              addonAfter="秒"
            />
          </>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {chapters.length === 0 ? (
          <Empty description="还没有章节，开始创作吧！" />
        ) : filteredSortedChapters.length === 0 ? (
          <Empty description="未找到匹配章节" />
        ) : currentProject?.outline_mode === 'one-to-one' ? (
          // one-to-one 模式：直接显示扁平列表
          <List
            dataSource={pagedSortedChapters}
            renderItem={(item) => (
              <List.Item
                id={`chapter-item-${item.id}`}
                style={{
                  padding: '16px',
                  marginBottom: 16,
                  background: token.colorBgContainer,
                  borderRadius: token.borderRadius,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  flexDirection: isMobile ? 'column' : 'row',
                  alignItems: isMobile ? 'flex-start' : 'center',
                }}
                actions={isMobile ? undefined : [
                  <Button
                    type="text"
                    icon={<ReadOutlined />}
                    onClick={() => handleOpenReader(item)}
                    disabled={!item.content || item.content.trim() === ''}
                    title={!item.content || item.content.trim() === '' ? '暂无内容' : '沉浸式阅读'}
                  >
                    阅读
                  </Button>,
                  <Button
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => handleOpenEditor(item.id)}
                  >
                    编辑
                  </Button>,
                  (() => {
                    const task = analysisTasksMap[item.id];
                    const countdown = chapterCountdowns[item.id];
                    const isAnalyzing = task?.status === 'running';
                    const hasContent = item.content && item.content.trim() !== '';
                    const isCountingDown = countdown !== undefined && countdown > 0;

                    return (
                      <Tooltip title={isCountingDown ? `点击取消自动分析 (${countdown}s 后开始)` : (!hasContent ? '请先生成章节内容' : isAnalyzing ? '分析进行中，请稍候...' : '')}>
                      <Button
                        type="text"
                        icon={isAnalyzing ? <SyncOutlined spin /> : isCountingDown ? <CloseCircleOutlined /> : <FundOutlined />}
                        onClick={() => {
                          if (isCountingDown) { cancelChapterCountdown(item.id); }
                          else { handleShowAnalysis(item.id); }
                        }}
                        disabled={!hasContent || (isAnalyzing && !isCountingDown)}
                        loading={isAnalyzing && !isCountingDown}
                        style={isCountingDown ? { color: token.colorWarning, fontWeight: 'bold' } : undefined}
                      >
                      {isCountingDown ? `${countdown}s 后取消` : (isAnalyzing ? '分析中' : '分析')}
                      </Button>
                      </Tooltip>
                    );
                  })(),
                  <Button
                    type="text"
                    icon={<SettingOutlined />}
                    onClick={() => handleOpenModal(item.id)}
                  >
                    修改
                  </Button>,
                ]}
              >
                <div style={{ width: '100%' }}>
                  <List.Item.Meta
                    avatar={!isMobile && <FileTextOutlined style={{ fontSize: 32, color: token.colorPrimary }} />}
                    title={
                      <div style={{
                        display: 'flex',
                        flexDirection: isMobile ? 'column' : 'row',
                        alignItems: isMobile ? 'flex-start' : 'center',
                        gap: isMobile ? 6 : 12,
                        width: '100%'
                      }}>
                        <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 500, flexShrink: 0 }}>
                          第{item.chapter_number}章：{item.title}
                        </span>
                        <Space wrap size={isMobile ? 4 : 8}>
                          <Tag color={getStatusColor(item.status)}>{getStatusText(item.status)}</Tag>
                          <Badge count={`${item.word_count || 0}字`} style={{ backgroundColor: token.colorSuccess }} />
                          {renderAnalysisStatus(item.id)}
                          {!canGenerateChapter(item) && (
                            <Tag icon={<LockOutlined />} color="warning" title={getGenerateDisabledReason(item)}>
                              需前置章节
                            </Tag>
                          )}
                        </Space>
                      </div>
                    }
                    description={
                      item.content ? (
                        <div style={{ marginTop: 8, color: token.colorTextSecondary, lineHeight: 1.6, fontSize: isMobile ? 12 : 14 }}>
                          {item.content.substring(0, isMobile ? 80 : 150)}
                          {item.content.length > (isMobile ? 80 : 150) && '...'}
                        </div>
                      ) : (
                        <span style={{ color: token.colorTextTertiary, fontSize: isMobile ? 12 : 14 }}>暂无内容</span>
                      )
                    }
                  />

                  {isMobile && (
                    <Space style={{ marginTop: 12, width: '100%', justifyContent: 'flex-end' }} wrap>
                      <Button
                        type="text"
                        icon={<ReadOutlined />}
                        onClick={() => handleOpenReader(item)}
                        size="small"
                        disabled={!item.content || item.content.trim() === ''}
                        title={!item.content || item.content.trim() === '' ? '暂无内容' : '阅读'}
                      />
                      <Button
                        type="text"
                        icon={<EditOutlined />}
                        onClick={() => handleOpenEditor(item.id)}
                        size="small"
                        title="编辑"
                      />
                      {(() => {
                        const task = analysisTasksMap[item.id];
const countdown = chapterCountdowns[item.id];
const isAnalyzing = task?.status === 'running';
const hasContent = item.content && item.content.trim() !== '';
const isCountingDown = countdown !== undefined && countdown > 0;

return (
  <Tooltip title={isCountingDown ? `点击取消自动分析 (${countdown}s 后开始)` : (!hasContent ? '请先生成章节内容' : isAnalyzing ? '分析中' : '')}>
  <Button
    type="text"
    icon={isAnalyzing ? <SyncOutlined spin /> : isCountingDown ? <CloseCircleOutlined /> : <FundOutlined />}
    onClick={() => {
      if (isCountingDown) { cancelChapterCountdown(item.id); }
      else { handleShowAnalysis(item.id); }
    }}
    size="small"
    disabled={!hasContent || (isAnalyzing && !isCountingDown)}
    loading={isAnalyzing && !isCountingDown}
    style={isCountingDown ? { color: token.colorWarning, fontWeight: 'bold' } : undefined}
  >
  {isCountingDown ? `${countdown}s 取消` : ''}
  </Button>
  </Tooltip>
);
                      })()}
                      <Button
                        type="text"
                        icon={<SettingOutlined />}
                        onClick={() => handleOpenModal(item.id)}
                        size="small"
                        title="修改"
                      />
                    </Space>
                  )}
                </div>
              </List.Item>
            )}
          />
        ) : (
          // one-to-many 模式：按大纲分组显示
          <Collapse
            bordered={false}
            defaultActiveKey={pagedGroupedChapters.length > 0 ? ['0'] : []}
            destroyInactivePanel
            expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
            style={{ background: 'transparent' }}
          >
            {pagedGroupedChapters.map((group, groupIndex) => (
              <Collapse.Panel
                key={groupIndex.toString()}
                header={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Tag color={group.outlineId ? 'blue' : 'default'} style={{ margin: 0 }}>
                      {group.outlineId ? `📖 大纲 ${group.outlineOrder}` : '📝 未分类'}
                    </Tag>
                    <span style={{ fontWeight: 600, fontSize: 16 }}>
                      {group.outlineTitle}
                    </span>
                    <Badge
                      count={`${group.chapters.length} 章`}
                      style={{ backgroundColor: token.colorSuccess }}
                    />
                    <Badge
                      count={`${group.chapters.reduce((sum, ch) => sum + (ch.word_count || 0), 0)} 字`}
                      style={{ backgroundColor: token.colorPrimary }}
                    />
                  </div>
                }
                style={{
                  marginBottom: 16,
                  background: token.colorBgContainer,
                  borderRadius: token.borderRadius,
                  border: `1px solid ${token.colorBorderSecondary}`,
                }}
              >
                <List
                  dataSource={group.chapters}
                  renderItem={(item) => (
                    <List.Item
                      id={`chapter-item-${item.id}`}
                      style={{
                        padding: '16px 0',
                        borderRadius: 8,
                        transition: 'background 0.3s ease',
                        flexDirection: isMobile ? 'column' : 'row',
                        alignItems: isMobile ? 'flex-start' : 'center',
                      }}
                      actions={isMobile ? undefined : [
                        <Button
                          type="text"
                          icon={<ReadOutlined />}
                          onClick={() => handleOpenReader(item)}
                          disabled={!item.content || item.content.trim() === ''}
                          title={!item.content || item.content.trim() === '' ? '暂无内容' : '沉浸式阅读'}
                        >
                          阅读
                        </Button>,
                        <Button
                          type="text"
                          icon={<EditOutlined />}
                          onClick={() => handleOpenEditor(item.id)}
                        >
                          编辑
                        </Button>,
                        (() => {
                          const task = analysisTasksMap[item.id];
const countdown = chapterCountdowns[item.id];
const isAnalyzing = task?.status === 'running';
const hasContent = item.content && item.content.trim() !== '';
const isCountingDown = countdown !== undefined && countdown > 0;

return (
  <Tooltip title={isCountingDown ? `点击取消自动分析 (${countdown}s 后开始)` : (!hasContent ? '请先生成章节内容' : isAnalyzing ? '分析进行中，请稍候...' : '')}>
  <Button
    type="text"
    icon={isAnalyzing ? <SyncOutlined spin /> : isCountingDown ? <CloseCircleOutlined /> : <FundOutlined />}
    onClick={() => {
      if (isCountingDown) { cancelChapterCountdown(item.id); }
      else { handleShowAnalysis(item.id); }
    }}
    disabled={!hasContent || (isAnalyzing && !isCountingDown)}
    loading={isAnalyzing && !isCountingDown}
    style={isCountingDown ? { color: token.colorWarning, fontWeight: 'bold' } : undefined}
  >
  {isCountingDown ? `${countdown}s 后取消` : (isAnalyzing ? '分析中' : '分析')}
  </Button>
  </Tooltip>
);
                        })(),
                        <Button
                          type="text"
                          icon={<SettingOutlined />}
                          onClick={() => handleOpenModal(item.id)}
                        >
                          修改
                        </Button>,
                        // 只在 one-to-many 模式下显示删除按钮
                        ...(currentProject?.outline_mode === 'one-to-many' ? [
                          <Popconfirm
                            title="确定删除这个章节吗？"
                            description="删除后将无法恢复，章节内容和分析结果都将被删除。"
                            onConfirm={() => handleDeleteChapter(item.id)}
                            okText="确定删除"
                            cancelText="取消"
                            okButtonProps={{ danger: true }}
                          >
                            <Button
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                            >
                              删除
                            </Button>
                          </Popconfirm>
                        ] : []),
                      ]}
                    >
                      <div style={{ width: '100%' }}>
                        <List.Item.Meta
                          avatar={!isMobile && <FileTextOutlined style={{ fontSize: 32, color: token.colorPrimary }} />}
                          title={
                            <div style={{
                              display: 'flex',
                              flexDirection: isMobile ? 'column' : 'row',
                              alignItems: isMobile ? 'flex-start' : 'center',
                              gap: isMobile ? 6 : 12,
                              width: '100%'
                            }}>
                              <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 500, flexShrink: 0 }}>
                                第{item.chapter_number}章：{item.title}
                              </span>
                              <Space wrap size={isMobile ? 4 : 8}>
                                <Tag color={getStatusColor(item.status)}>{getStatusText(item.status)}</Tag>
                                <Badge count={`${item.word_count || 0}字`} style={{ backgroundColor: token.colorSuccess }} />
                                {renderAnalysisStatus(item.id)}
                                {!canGenerateChapter(item) && (
                                  <Tag icon={<LockOutlined />} color="warning" title={getGenerateDisabledReason(item)}>
                                    需前置章节
                                  </Tag>
                                )}
                                <Space size={4}>
                                  {item.expansion_plan && (
                                    <InfoCircleOutlined
                                      title="查看展开详情"
                                      style={{ color: token.colorPrimary, cursor: 'pointer', fontSize: 16 }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        showExpansionPlanModal(item);
                                      }}
                                    />
                                  )}
                                  <FormOutlined
                                    title={item.expansion_plan ? "编辑规划信息" : "创建规划信息"}
                                    style={{ color: token.colorSuccess, cursor: 'pointer', fontSize: 16 }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenPlanEditor(item);
                                    }}
                                  />
                                </Space>
                              </Space>
                            </div>
                          }
                          description={
                            item.content ? (
                              <div style={{ marginTop: 8, color: token.colorTextSecondary, lineHeight: 1.6, fontSize: isMobile ? 12 : 14 }}>
                                {item.content.substring(0, isMobile ? 80 : 150)}
                                {item.content.length > (isMobile ? 80 : 150) && '...'}
                              </div>
                            ) : (
                              <span style={{ color: token.colorTextTertiary, fontSize: isMobile ? 12 : 14 }}>暂无内容</span>
                            )
                          }
                        />

                        {isMobile && (
                          <Space style={{ marginTop: 12, width: '100%', justifyContent: 'flex-end' }} wrap>
                            <Button
                              type="text"
                              icon={<ReadOutlined />}
                              onClick={() => handleOpenReader(item)}
                              size="small"
                              disabled={!item.content || item.content.trim() === ''}
                              title={!item.content || item.content.trim() === '' ? '暂无内容' : '阅读'}
                            />
                            <Button
                              type="text"
                              icon={<EditOutlined />}
                              onClick={() => handleOpenEditor(item.id)}
                              size="small"
                              title="编辑"
                            />
                            {(() => {
                              const task = analysisTasksMap[item.id];
const countdown = chapterCountdowns[item.id];
const isAnalyzing = task?.status === 'running';
const hasContent = item.content && item.content.trim() !== '';
const isCountingDown = countdown !== undefined && countdown > 0;

return (
  <Tooltip title={isCountingDown ? `点击取消自动分析 (${countdown}s 后开始)` : (!hasContent ? '请先生成章节内容' : isAnalyzing ? '分析中' : '')}>
  <Button
    type="text"
    icon={isAnalyzing ? <SyncOutlined spin /> : isCountingDown ? <CloseCircleOutlined /> : <FundOutlined />}
    onClick={() => {
      if (isCountingDown) { cancelChapterCountdown(item.id); }
      else { handleShowAnalysis(item.id); }
    }}
    size="small"
    disabled={!hasContent || (isAnalyzing && !isCountingDown)}
    loading={isAnalyzing && !isCountingDown}
    style={isCountingDown ? { color: token.colorWarning, fontWeight: 'bold' } : undefined}
  >
  {isCountingDown ? `${countdown}s 取消` : ''}
  </Button>
  </Tooltip>
);
                            })()}
                            <Button
                              type="text"
                              icon={<SettingOutlined />}
                              onClick={() => handleOpenModal(item.id)}
                              size="small"
                              title="修改"
                            />
                            {/* 只在 one-to-many 模式下显示删除按钮 */}
                            {currentProject?.outline_mode === 'one-to-many' && (
                              <Popconfirm
                                title="确定删除？"
                                description="删除后无法恢复"
                                onConfirm={() => handleDeleteChapter(item.id)}
                                okText="删除"
                                cancelText="取消"
                                okButtonProps={{ danger: true }}
                              >
                                <Button
                                  type="text"
                                  danger
                                  icon={<DeleteOutlined />}
                                  size="small"
                                  title="删除章节"
                                />
                              </Popconfirm>
                            )}
                          </Space>
                        )}
                      </div>
                    </List.Item>
                  )}
                />
              </Collapse.Panel>
            ))}
          </Collapse>
        )}
      </div>

      {filteredSortedChapters.length > 0 && (
        <div style={{ paddingTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <Pagination
            current={chapterPage}
            pageSize={chapterPageSize}
            total={filteredSortedChapters.length}
            showSizeChanger
            pageSizeOptions={['10', '20', '50', '100']}
            onChange={(page, size) => {
              setChapterPage(page);
              if (size !== chapterPageSize) {
                setChapterPageSize(size);
                setChapterPage(1);
              }
            }}
            showTotal={(total) => `共 ${total} 条`}
            size={isMobile ? 'small' : 'default'}
          />
        </div>
      )}

      <Modal
        title={editingId ? '编辑章节信息' : '添加章节'}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        footer={null}
        centered
        width={isMobile ? 'calc(100vw - 32px)' : 520}
        style={isMobile ? {
          maxWidth: 'calc(100vw - 32px)',
          margin: '0 auto',
          padding: '0 16px'
        } : undefined}
        styles={{
          body: {
            maxHeight: isMobile ? 'calc(100vh - 200px)' : 'calc(80vh - 110px)',
            overflowY: 'auto'
          }
        }}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            label="章节标题"
            name="title"
            tooltip={
              currentProject?.outline_mode === 'one-to-one'
                ? "章节标题由大纲管理，请在大纲页面修改"
                : "一对多模式下可以修改章节标题"
            }
            rules={
              currentProject?.outline_mode === 'one-to-many'
                ? [{ required: true, message: '请输入章节标题' }]
                : undefined
            }
          >
            <Input
              placeholder="输入章节标题"
              disabled={currentProject?.outline_mode === 'one-to-one'}
            />
          </Form.Item>

          <Form.Item
            label="章节序号"
            name="chapter_number"
            tooltip="章节序号不允许修改，请删除对应大纲，重新生成"
          >
            <Input type="number" placeholder="章节排序序号" disabled />
          </Form.Item>

          <Form.Item label="状态" name="status">
            <Select placeholder="选择状态">
              <Select.Option value="draft">草稿</Select.Option>
              <Select.Option value="pending">待处理</Select.Option>
              <Select.Option value="writing">创作中</Select.Option>
              <Select.Option value="completed">已完成</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item>
            <Space style={{ float: 'right' }}>
              <Button onClick={() => setIsModalOpen(false)}>取消</Button>
              <Button type="primary" htmlType="submit">
                更新
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑章节内容"
        open={isEditorOpen}
        onCancel={() => {
          if (isGenerating) {
            message.warning('AI正在创作中，请等待完成后再关闭');
            return;
          }
          setIsEditorOpen(false);
        }}
        closable={!isGenerating}
        maskClosable={false}
        keyboard={!isGenerating}
        width={isMobile ? 'calc(100vw - 32px)' : '85%'}
        centered
        style={isMobile ? {
          maxWidth: 'calc(100vw - 32px)',
          margin: '0 auto',
          padding: '0 16px'
        } : undefined}
        styles={{
          body: {
            maxHeight: isMobile ? 'calc(100vh - 200px)' : 'calc(100vh - 110px)',
            overflowY: 'auto',
            padding: isMobile ? '16px 12px' : '8px'
          }
        }}
        footer={null}
      >
        <Form form={editorForm} layout="vertical" onFinish={handleEditorSubmit}>
          {/* 章节标题和AI创作按钮 */}
          <Form.Item
            label="章节标题"
            tooltip="（1-1模式请在大纲修改，1-N模式请使用修改按钮编辑）"
            style={{ marginBottom: isMobile ? 16 : 12 }}
          >
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="title" noStyle>
                <Input disabled style={{ flex: 1 }} />
              </Form.Item>
              {editingId && (() => {
                const currentChapter = chapters.find(c => c.id === editingId);
                const canGenerate = currentChapter ? canGenerateChapter(currentChapter) : false;
                const disabledReason = currentChapter ? getGenerateDisabledReason(currentChapter) : '';

                return (
                  <>
                  <Button
                    type="primary"
                    icon={canGenerate ? <ThunderboltOutlined /> : <LockOutlined />}
                    onClick={() => currentChapter && showGenerateModal(currentChapter)}
                    loading={isContinuing}
                    disabled={!canGenerate}
                    danger={!canGenerate}
                    style={{ fontWeight: 'bold' }}
                    title={!canGenerate ? disabledReason : '根据大纲和前置章节内容创作（流式）'}
                  >
                    {isMobile ? 'AI' : 'AI创作'}
                  </Button>
                  <Button
                    icon={<RocketOutlined />}
                    onClick={handleBackgroundGenerate}
                    disabled={!canGenerate || isContinuing}
                    style={{ fontWeight: 'bold' }}
                    title={!canGenerate ? disabledReason : '后台生成：关闭浏览器也不影响，完成后自动保存'}
                  >
                    {isMobile ? '后台' : '后台生成'}
                  </Button>
                  </>
                );
              })()}
            </Space.Compact>
          </Form.Item>


          {/* 第一行：写作风格 + 叙事角度 */}
          <div style={{
            display: isMobile ? 'block' : 'flex',
            gap: isMobile ? 0 : 16,
            marginBottom: isMobile ? 0 : 12
          }}>
            <Form.Item
              label="写作风格"
              tooltip="选择AI创作时使用的写作风格"
              required
              style={{ flex: 1, marginBottom: isMobile ? 16 : 0 }}
            >
              <Select
                placeholder="请选择写作风格"
                value={selectedStyleId}
                onChange={setSelectedStyleId}
                disabled={isGenerating}
                status={!selectedStyleId ? 'error' : undefined}
              >
                {writingStyles.map(style => (
                  <Select.Option key={style.id} value={style.id}>
                    {style.name}{style.is_default && ' (默认)'}
                  </Select.Option>
                ))}
              </Select>
              {!selectedStyleId && (
                <div style={{ color: token.colorError, fontSize: 12, marginTop: 4 }}>请选择写作风格</div>
              )}
            </Form.Item>

            <Form.Item
              label="叙事角度"
              tooltip="第一人称(我)代入感强；第三人称(他/她)更客观；全知视角洞悉一切"
              style={{ flex: 1, marginBottom: isMobile ? 16 : 0 }}
            >
              <Select
                placeholder={`项目默认: ${getNarrativePerspectiveText(currentProject?.narrative_perspective)}`}
                value={temporaryNarrativePerspective}
                onChange={setTemporaryNarrativePerspective}
                allowClear
                disabled={isGenerating}
              >
                <Select.Option value="第一人称">第一人称(我)</Select.Option>
                <Select.Option value="第三人称">第三人称(他/她)</Select.Option>
                <Select.Option value="全知视角">全知视角</Select.Option>
              </Select>
              {temporaryNarrativePerspective && (
                <div style={{ color: token.colorSuccess, fontSize: 12, marginTop: 4 }}>
                  ✓ {getNarrativePerspectiveText(temporaryNarrativePerspective)}
                </div>
              )}
            </Form.Item>
          </div>

          {/* 第二行：目标字数 + AI模型 + Skill */}
          <div style={{
            display: isMobile ? 'block' : 'flex',
            gap: isMobile ? 0 : 16,
            marginBottom: isMobile ? 16 : 12
          }}>
            <Form.Item
              label="应用 Skill"
              tooltip="选择一个 Skill 工作流指导 AI 创作，不选则使用标准创作流程"
              style={{ flex: 1, marginBottom: isMobile ? 16 : 0 }}
            >
              <Select
                placeholder="不使用 Skill（标准创作）"
                value={selectedSkillKey}
                onChange={setSelectedSkillKey}
                allowClear
                disabled={isGenerating}
                showSearch
                optionFilterProp="label"
              >
                {availableSkills.map(skill => (
                  <Select.Option key={skill.template_key} value={skill.template_key} label={skill.template_name}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>{skill.template_name}</span>
                      <Tag style={{ fontSize: 11, lineHeight: '18px', padding: '0 4px' }}>{skill.category}</Tag>
                    </div>
                  </Select.Option>
                ))}
              </Select>
              {selectedSkillKey && (() => {
                const skill = availableSkills.find(s => s.template_key === selectedSkillKey);
                return skill ? (
                  <div style={{ color: token.colorSuccess, fontSize: 12, marginTop: 4 }}>
                    ✓ {skill.description}
                  </div>
                ) : null;
              })()}
            </Form.Item>

            <Form.Item
              label="目标字数"
              tooltip="AI生成章节时的目标字数，实际可能略有偏差（修改后会自动记住）"
              style={{ flex: 1, marginBottom: isMobile ? 16 : 0 }}
            >
              <InputNumber
                min={500}
                max={10000}
                step={100}
                value={targetWordCount}
                onChange={(value) => {
                  const newValue = value || DEFAULT_WORD_COUNT;
                  setTargetWordCount(newValue);
                  setCachedWordCount(newValue);
                }}
                disabled={isGenerating}
                style={{ width: '100%' }}
                formatter={(value) => `${value} 字`}
                parser={(value) => parseInt(value?.replace(' 字', '') || '0', 10) as unknown as 500}
              />
            </Form.Item>

            <Form.Item
              label="字元比"
              tooltip="1个中文字≈几个token，用于估算max_tokens。默认1.5，越大模型生成空间越充裕"
              style={{ flex: 1, marginBottom: isMobile ? 16 : 0 }}
            >
              <InputNumber
                min={1.0}
                max={5.0}
                step={0.1}
                value={charTokenRatio}
                onChange={(v) => {
                  const val = v ?? 1.5;
                  setCharTokenRatio(val);
                  setCachedCharTokenRatio(val);
                }}
                disabled={isGenerating}
                style={{ width: '100%' }}
              />
            </Form.Item>

            <Form.Item
              label="AI模型"
              tooltip="选择用于生成章节内容的AI模型，不选择则使用默认模型"
              style={{ flex: 1, marginBottom: isMobile ? 16 : 0 }}
            >
              <Select
                placeholder={selectedModel ? `默认: ${availableModels.find(m => m.value === selectedModel)?.label || selectedModel}` : "使用默认模型"}
                value={selectedModel}
                onChange={setSelectedModel}
                allowClear
                disabled={isGenerating}
                showSearch
                optionFilterProp="label"
              >
                {availableModels.map(model => (
                  <Select.Option key={model.value} value={model.value} label={model.label}>
                    {model.label}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </div>

          <Form.Item label="章节内容" name="content">
            <TextArea
              ref={contentTextAreaRef}
              rows={isMobile ? 12 : 20}
              placeholder="开始写作..."
              style={{ fontFamily: 'monospace', fontSize: isMobile ? 12 : 14 }}
              disabled={isGenerating}
            />
          </Form.Item>

          {/* 局部重写浮动工具栏 */}
          <div data-partial-regenerate-toolbar>
            <PartialRegenerateToolbar
              visible={partialRegenerateToolbarVisible && !isGenerating}
              position={partialRegenerateToolbarPosition}
              selectedText={selectedTextForRegenerate}
              onRegenerate={handleOpenPartialRegenerate}
            />
          </div>

          <Form.Item style={{ marginBottom: 0 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              padding: '10px 0',
              borderTop: '1px solid ' + token.colorBorderSecondary
            }}>
              {/* 当前字数 */}
              <span style={{ fontSize: 13, color: token.colorTextSecondary, whiteSpace: 'nowrap' }}>
                当前字数: <strong>{editorContent?.length || 0}</strong>
              </span>

              {/* 初步检测 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: token.colorTextSecondary, whiteSpace: 'nowrap', fontWeight: 500 }}>初步检测</span>
                  <Radio.Group
                    size="small"
                    value={quickCheckStrategy}
                    onChange={(e) => {
                      const v = e.target.value;
                      setQuickCheckStrategy(v);
                      localStorage.setItem(QUICK_CHECK_STRATEGY_KEY, v);
                    }}
                    optionType="button"
                    buttonStyle="solid"
                  >
                    <Tooltip title="jieba分词关键词匹配：锚点文本分词后在章节末尾500字中匹配关键词。速度快，但无法识别同义词替换">
                      <Radio.Button value="A">A</Radio.Button>
                    </Tooltip>
                    <Tooltip title="MiniLM语义向量相似度：用embedding模型将锚点与文末编码为向量，计算余弦相似度。能识别同义表达，首次加载模型需数秒">
                      <Radio.Button value="B">B</Radio.Button>
                    </Tooltip>
                    <Tooltip title="A+B 综合策略：先用jieba快速打分，分数≥阈值则直接返回；低于阈值时自动启用embedding兜底。兼顾速度与准确度（推荐）">
                      <Radio.Button value="A+B">A+B</Radio.Button>
                    </Tooltip>
                  </Radio.Group>
                <span style={{ fontSize: 12, color: token.colorTextSecondary, marginLeft: 4 }}>阈值</span>
                <InputNumber
                  size="small"
                  min={0.3}
                  max={1.0}
                  step={0.05}
                  value={quickCheckThreshold}
                  onChange={(v) => {
                    const val = v ?? 0.7;
                    setQuickCheckThreshold(val);
                    localStorage.setItem(QUICK_CHECK_THRESHOLD_KEY, String(val));
                  }}
                  style={{ width: 65 }}
                  placeholder="0.7"
                />
                <Button
                  size="small"
                  icon={<ThunderboltOutlined />}
                  loading={recheckingAnchor}
                  onClick={handleRecheckAnchor}
                  title="重新锚点评分"
                />
                {quickCheckResult?.anchor_score != null && (
                  <Tag color={quickCheckResult.anchor_score >= 7 ? 'green' : quickCheckResult.anchor_score >= 4 ? 'orange' : 'red'}
                    style={{ marginLeft: 0 }}>
                    锚点评估分数: {quickCheckResult.anchor_score}/10
                  </Tag>
                )}
              </div>

              {/* 操作按钮 */}
              <Space>
                <Button
                  onClick={() => {
                    if (isGenerating) {
                      message.warning('AI正在创作中，请等待完成后再关闭');
                      return;
                    }
                    setIsEditorOpen(false);
                  }}
                  disabled={isGenerating}
                  size="small"
                >
                  取消
                </Button>
                <Button
                  type="primary"
                  htmlType="submit"
                  disabled={isGenerating}
                  size="small"
                >
                  保存章节
                </Button>
              </Space>
            </div>
          </Form.Item>
        </Form>
      </Modal>

      {analysisChapterId && (
        <ChapterAnalysis
          chapterId={analysisChapterId}
          visible={analysisVisible}
          onClose={() => {
            setAnalysisVisible(false);

            // 刷新章节列表以显示最新内容
            refreshChapters();

            // 刷新项目信息以更新字数统计
            if (currentProject) {
              projectApi.getProject(currentProject?.id)
                .then(updatedProject => {
                  setCurrentProject(updatedProject);
                })
                .catch(error => {
                  console.error('刷新项目信息失败:', error);
                });
            }

            // 延迟500ms后批量刷新分析状态，避免单章接口高频调用
            setTimeout(() => {
              loadAnalysisTasks();
            }, 500);

            setAnalysisChapterId(null);
          }}
        />
      )}

      {/* 批量生成对话框 */}
      <Modal
        title={
          <Space>
            <RocketOutlined style={{ color: token.colorInfo }} />
            <span>批量生成章节内容</span>
          </Space>
        }
        open={batchGenerateVisible}
        onCancel={() => {
          if (batchGenerating) {
            modal.confirm({
              title: '确认取消',
              content: '批量生成正在进行中，确定要取消吗？',
              okText: '确定取消',
              cancelText: '继续生成',
              centered: true,
              onOk: () => {
                handleCancelBatchGenerate();
                setBatchGenerateVisible(false);
              },
            });
          } else {
            setBatchGenerateVisible(false);
          }
        }}
        footer={!batchGenerating ? (
          <Space style={{ width: '100%', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button onClick={() => setBatchGenerateVisible(false)}>
              取消
            </Button>
            <Button type="primary" icon={<RocketOutlined />} onClick={() => batchForm.submit()}>
              开始批量生成
            </Button>
          </Space>
        ) : null}
        width={isMobile ? 'calc(100vw - 32px)' : 700}
        centered
        closable={!batchGenerating}
        maskClosable={!batchGenerating}
        style={isMobile ? {
          maxWidth: 'calc(100vw - 32px)',
          margin: '0 auto',
          padding: '0 16px'
        } : undefined}
        styles={{
          body: {
            maxHeight: isMobile ? 'calc(100vh - 200px)' : 'calc(100vh - 260px)',
            overflowY: 'auto',
            overflowX: 'hidden'
          }
        }}
      >
        {!batchGenerating ? (
          <Form
            form={batchForm}
            layout="vertical"
            onFinish={handleBatchGenerate}
            initialValues={{
              startChapterNumber: sortedChapters.find(ch => !ch.content || ch.content.trim() === '')?.chapter_number || 1,
              count: 5,
              enableAnalysis: true,
              styleId: selectedStyleId,
              targetWordCount: getCachedWordCount(),
              model: selectedModel,
            }}
          >
            <Alert
              message="批量生成说明：严格按序生成 | 统一风格字数 | 任一失败则终止"
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />

            {/* 第一行：起始章节 + 生成数量 */}
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 0 : 16 }}>
              <Form.Item
                label="起始章节"
                name="startChapterNumber"
                rules={[{ required: true, message: '请选择' }]}
                style={{ flex: 1, marginBottom: 12 }}
              >
                <Select placeholder="选择起始章节">
                  {sortedChapters
                    .filter(ch => !ch.content || ch.content.trim() === '')
                    .filter(ch => canGenerateChapter(ch))
                    .map(ch => (
                      <Select.Option key={ch.id} value={ch.chapter_number}>
                        第{ch.chapter_number}章：{ch.title}
                      </Select.Option>
                    ))}
                </Select>
              </Form.Item>

              <Form.Item
                label="生成数量"
                name="count"
                rules={[{ required: true, message: '请选择' }]}
                style={{ marginBottom: 12 }}
              >
                <Radio.Group buttonStyle="solid" size={isMobile ? 'small' : 'middle'}>
                  <Radio.Button value={5}>5章</Radio.Button>
                  <Radio.Button value={10}>10章</Radio.Button>
                  <Radio.Button value={15}>15章</Radio.Button>
                  <Radio.Button value={20}>20章</Radio.Button>
                </Radio.Group>
              </Form.Item>
            </div>

            {/* 第二行：写作风格 + 目标字数 */}
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 0 : 16 }}>
              <Form.Item
                label="写作风格"
                name="styleId"
                rules={[{ required: true, message: '请选择' }]}
                style={{ flex: 1, marginBottom: 12 }}
              >
                <Select placeholder="请选择写作风格" showSearch optionFilterProp="children">
                  {writingStyles.map(style => (
                    <Select.Option key={style.id} value={style.id}>
                      {style.name}{style.is_default && ' (默认)'}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                label="目标字数"
                name="targetWordCount"
                rules={[{ required: true, message: '请设置' }]}
                tooltip="修改后自动记住"
                style={{ flex: 1, marginBottom: 12 }}
              >
                <InputNumber
                  min={500}
                  max={10000}
                  step={100}
                  style={{ width: '100%' }}
                  formatter={(value) => `${value} 字`}
                  parser={(value) => parseInt(value?.replace(' 字', '') || '0', 10) as unknown as 500}
                  onChange={(value) => {
                    if (value) {
                      setCachedWordCount(value);
                    }
                  }}
                />
              </Form.Item>
            </div>

            {/* 第三行：AI模型 + Skill */}
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 0 : 16 }}>
              <Form.Item
                label="AI模型"
                tooltip="不选则使用默认模型"
                style={{ flex: 1, marginBottom: 12 }}
              >
                <Select
                  placeholder={batchSelectedModel ? `默认: ${availableModels.find(m => m.value === batchSelectedModel)?.label || batchSelectedModel}` : "使用默认模型"}
                  value={batchSelectedModel}
                  onChange={setBatchSelectedModel}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                >
                  {availableModels.map(model => (
                    <Select.Option key={model.value} value={model.value} label={model.label}>
                      {model.label}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                label="应用 Skill"
                tooltip="选择一个 Skill 工作流指导批量创作，不选则使用标准创作流程"
                style={{ flex: 1, marginBottom: 12 }}
              >
                <Select
                  placeholder="不使用 Skill（标准创作）"
                  value={batchSelectedSkillKey}
                  onChange={setBatchSelectedSkillKey}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                >
                  {availableSkills.map(skill => (
                    <Select.Option key={skill.template_key} value={skill.template_key} label={skill.template_name}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{skill.template_name}</span>
                        <Tag style={{ fontSize: 11, lineHeight: '18px', padding: '0 4px' }}>{skill.category}</Tag>
                      </div>
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </div>

            {/* 同步分析（固定开启） */}
            <Form.Item
              label="同步分析"
              name="enableAnalysis"
              tooltip="必须开启，确保剧情连贯"
              style={{ marginBottom: 12 }}
            >
              <Radio.Group disabled>
                <Radio value={true}>
                  <span style={{ fontSize: 12, color: token.colorSuccess }}>✓ 自动更新角色状态</span>
                </Radio>
              </Radio.Group>
            </Form.Item>
          </Form>
        ) : (
          <div>
            <Alert
              message="温馨提示"
              description={
                <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                  <li>批量生成需要一定时间，可以切换到其他页面</li>
                  <li>关闭页面后重新打开，会自动恢复任务进度</li>
                  <li>可以随时点击"取消任务"按钮中止生成</li>
                  {batchProgress?.estimated_time_minutes && batchProgress.completed === 0 && (
                    <li>⏱️ 预计耗时：约 {batchProgress.estimated_time_minutes} 分钟</li>
                  )}
                </ul>
              }
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />

            <div style={{ textAlign: 'center' }}>
              <Button
                danger
                icon={<StopOutlined />}
                onClick={() => {
                  modal.confirm({
                    title: '确认取消',
                    content: '确定要取消批量生成吗？已生成的章节将保留。',
                    okText: '确定取消',
                    cancelText: '继续生成',
                    okButtonProps: { danger: true },
                    onOk: handleCancelBatchGenerate,
                  });
                }}
              >
                取消任务
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* 单章节生成进度显示 */}
      <SSELoadingOverlay
        loading={isGenerating}
        progress={singleChapterProgress}
        message={singleChapterProgressMessage}
      />

      {/* 章节阅读器 */}
      {readingChapter && (
        <ChapterReader
          visible={readerVisible}
          chapter={readingChapter}
          onClose={() => {
            setReaderVisible(false);
            setReadingChapter(null);
          }}
          onChapterChange={handleReaderChapterChange}
        />
      )}

      {/* 局部重写弹窗 */}
      {editingId && (
        <PartialRegenerateModal
          visible={partialRegenerateModalVisible}
          chapterId={editingId}
          selectedText={selectedTextForRegenerate}
          startPosition={selectionStartPosition}
          endPosition={selectionEndPosition}
          styleId={selectedStyleId}
          onClose={() => setPartialRegenerateModalVisible(false)}
          onApply={handleApplyPartialRegenerate}
        />
      )}

      {/* 规划编辑器 */}
      {editingPlanChapter && currentProject && (() => {
        let parsedPlanData = null;
        try {
          if (editingPlanChapter.expansion_plan) {
            parsedPlanData = JSON.parse(editingPlanChapter.expansion_plan);
          }
        } catch (error) {
          console.error('解析规划数据失败:', error);
        }

        return (
          <ExpansionPlanEditor
            visible={planEditorVisible}
            planData={parsedPlanData}
            chapterSummary={editingPlanChapter.summary || null}
            projectId={currentProject?.id}
            onSave={handleSavePlan}
            onCancel={() => {
              setPlanEditorVisible(false);
              setEditingPlanChapter(null);
            }}
          />
        );
      })()}
    </div>
  );
}