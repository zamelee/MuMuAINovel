import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Modal,
  Button,
  Slider,
  Radio,
  Space,
  Typography,
  Spin,
  message,
  theme,
  Drawer,
  Tag,
  Empty,
  Progress,
  Tooltip,
} from 'antd';
import {
  LeftOutlined,
  RightOutlined,
  SettingOutlined,
  FontSizeOutlined,
  BgColorsOutlined,
  CloseOutlined,
  ColumnHeightOutlined,
  ProfileOutlined,
  AimOutlined,
  TeamOutlined,
  OrderedListOutlined,
} from '@ant-design/icons';
import type { Chapter, ExpansionPlanData, AnalysisData } from '../types';

interface ReaderSettings {
  fontSize: number;
  theme: 'light' | 'sepia' | 'dark';
  lineHeight: number;
}

interface ChapterReaderProps {
  visible: boolean;
  chapter: Chapter;
  onClose: () => void;
  onChapterChange: (chapterId: string) => void;
}

interface NavigationInfo {
  previous: { id: string; chapter_number: number; title: string } | null;
  next: { id: string; chapter_number: number; title: string } | null;
  current: { id: string; chapter_number: number; title: string };
}

interface ReaderThemeStyle {
  bg: string;
  text: string;
  headerBg: string;
  panelBg: string;
  mutedBg: string;
  border: string;
}

type PlanData = Partial<ExpansionPlanData>;

interface ContextChapters {
  previous: Chapter | null;
  current: Chapter;
  next: Chapter | null;
}

const SETTINGS_STORAGE_KEY = 'chapter-reader-settings';

const loadSettings = (): ReaderSettings => {
  try {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn('加载阅读器设置失败:', e);
  }
  return {
    fontSize: 18,
    theme: 'light',
    lineHeight: 1.8,
  };
};

const saveSettings = (settings: ReaderSettings) => {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('保存阅读器设置失败:', e);
  }
};

const parsePlan = (chapter?: Chapter | null): PlanData | null => {
  if (!chapter?.expansion_plan) return null;
  try {
    const parsed = JSON.parse(chapter.expansion_plan);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    console.warn('解析章节规划失败:', e);
    return null;
  }
};

const compactText = (value?: string | null, fallback = '暂无主干信息') => {
  const text = value?.trim();
  return text && text.length > 0 ? text : fallback;
};

const fetchChapter = async (chapterId: string, signal?: AbortSignal): Promise<Chapter> => {
  const response = await fetch(`/api/chapters/${chapterId}`, { signal });
  if (!response.ok) throw new Error('获取章节详情失败');
  return response.json();
};

export default function ChapterReader({
  visible,
  chapter,
  onClose,
  onChapterChange,
}: ChapterReaderProps) {
  const { token } = theme.useToken();

  const [settings, setSettings] = useState<ReaderSettings>(loadSettings);
  const [navigation, setNavigation] = useState<NavigationInfo | null>(null);
  const [contextChapters, setContextChapters] = useState<ContextChapters>({
    previous: null,
    current: chapter,
    next: null,
  });
  const [loading, setLoading] = useState(false);
  const [contextLoading, setContextLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);

  const isMobile = viewportWidth <= 900;

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!visible || !chapter?.id) return;

    setAnalysisData(null);
    const controller = new AbortController();
    setLoading(true);

    fetch(`/api/chapters/${chapter.id}/navigation`, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error('获取导航失败');
        return res.json();
      })
      .then(data => {
        setNavigation(data);
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        console.error('获取章节导航信息失败:', err);
        message.error('获取章节导航信息失败');
      })
      .finally(() => setLoading(false));

    // 获取分析数据
    fetch(`/api/chapters/${chapter.id}/analysis`, { signal: controller.signal })
      .then(res => {
        if (!res.ok) return null;
        return res.json();
      })
      .then(data => {
        if (data) setAnalysisData(data.analysis || data);
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
      });

    return () => controller.abort();
  }, [visible, chapter?.id]);

  useEffect(() => {
    if (!visible) return;

    const controller = new AbortController();
    const loadContext = async () => {
      setContextLoading(true);
      try {
        const [previous, next] = await Promise.all([
          navigation?.previous
            ? fetchChapter(navigation.previous.id, controller.signal).catch(() => null)
            : Promise.resolve(null),
          navigation?.next
            ? fetchChapter(navigation.next.id, controller.signal).catch(() => null)
            : Promise.resolve(null),
        ]);

        setContextChapters({
          previous,
          current: chapter,
          next,
        });
      } finally {
        if (!controller.signal.aborted) {
          setContextLoading(false);
        }
      }
    };

    loadContext();
    return () => controller.abort();
  }, [visible, chapter, navigation?.previous, navigation?.next]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const handlePrevious = useCallback(() => {
    if (navigation?.previous) {
      setLoading(true);
      onChapterChange(navigation.previous.id);
    }
  }, [navigation?.previous, onChapterChange]);

  const handleNext = useCallback(() => {
    if (navigation?.next) {
      setLoading(true);
      onChapterChange(navigation.next.id);
    }
  }, [navigation?.next, onChapterChange]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!visible) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case 'ArrowLeft':
          handlePrevious();
          break;
        case 'ArrowRight':
          handleNext();
          break;
        case 'Escape':
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, handlePrevious, handleNext, onClose]);

  useEffect(() => {
    if (chapter?.id) {
      setLoading(false);
      setLeftDrawerOpen(false);
      setRightDrawerOpen(false);
      const scrollContainer = document.querySelector('.reader-scroll-container');
      if (scrollContainer) {
        scrollContainer.scrollTop = 0;
      }
    }
  }, [chapter?.id]);

  const themeStyles: Record<ReaderSettings['theme'], ReaderThemeStyle> = {
    light: {
      bg: token.colorBgContainer,
      text: token.colorText,
      headerBg: token.colorBgElevated,
      panelBg: token.colorBgContainer,
      mutedBg: token.colorFillQuaternary,
      border: token.colorBorderSecondary,
    },
    sepia: {
      bg: `color-mix(in srgb, ${token.colorWarningBg} 72%, ${token.colorBgContainer} 28%)`,
      text: `color-mix(in srgb, ${token.colorText} 85%, ${token.colorTextSecondary} 15%)`,
      headerBg: `color-mix(in srgb, ${token.colorWarningBg} 58%, ${token.colorBgElevated} 42%)`,
      panelBg: `color-mix(in srgb, ${token.colorWarningBg} 38%, ${token.colorBgContainer} 62%)`,
      mutedBg: `color-mix(in srgb, ${token.colorWarningBg} 55%, transparent 45%)`,
      border: `color-mix(in srgb, ${token.colorWarningBorder} 65%, ${token.colorBorder} 35%)`,
    },
    dark: {
      bg: `color-mix(in srgb, ${token.colorTextBase} 92%, ${token.colorBgContainer} 8%)`,
      text: `color-mix(in srgb, ${token.colorTextLightSolid} 82%, ${token.colorTextSecondary} 18%)`,
      headerBg: `color-mix(in srgb, ${token.colorTextBase} 84%, ${token.colorBgElevated} 16%)`,
      panelBg: `color-mix(in srgb, ${token.colorTextBase} 86%, ${token.colorBgContainer} 14%)`,
      mutedBg: `color-mix(in srgb, ${token.colorTextBase} 78%, ${token.colorFill} 22%)`,
      border: `color-mix(in srgb, ${token.colorTextBase} 60%, ${token.colorBorder} 40%)`,
    },
  };
  const currentTheme = themeStyles[settings.theme];

  const currentPlan = useMemo(() => parsePlan(chapter), [chapter]);
  const wordProgress = currentPlan?.estimated_words
    ? Math.min(Math.round(((chapter.word_count || 0) / currentPlan.estimated_words) * 100), 160)
    : null;

  const updateSettings = (key: keyof ReaderSettings, value: number | string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const renderContextPanel = () => (
    <div style={{ height: '100%', overflowY: 'auto', padding: 16 }}>
      <SectionTitle icon={<ProfileOutlined />} title="前后章节预览" />
      <Spin spinning={contextLoading}>
        <ChapterBrief
          label="上一章"
          chapter={contextChapters.previous}
          plan={parsePlan(contextChapters.previous)}
          emptyText="暂无上一章"
          currentTheme={currentTheme}
          showEndAnchor
          muted
        />
        <ChapterBrief
          label="下一章"
          chapter={contextChapters.next}
          plan={parsePlan(contextChapters.next)}
          emptyText="暂无下一章"
          currentTheme={currentTheme}
          muted
        />
      </Spin>
    </div>
  );

  const renderPlanPanel = () => (
    <div style={{ height: '100%', overflowY: 'auto', padding: 16 }}>
      <SectionTitle icon={<AimOutlined />} title="本章验收" />
      <PlanPanel
        chapter={chapter}
        plan={currentPlan}
        wordProgress={wordProgress}
        currentTheme={currentTheme}
        analysis={analysisData}
      />
    </div>
  );

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={null}
      width="100%"
      style={{
        maxWidth: '100vw',
        top: 0,
        margin: 0,
        padding: 0,
        height: '100vh',
        overflow: 'hidden',
      }}
      styles={{
        content: {
          height: '100vh',
          borderRadius: 0,
          boxShadow: 'none',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
        body: {
          flex: 1,
          padding: 0,
          background: currentTheme.bg,
          overflow: 'hidden',
          height: '100%',
          scrollbarWidth: 'thin',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
      closable={false}
      maskClosable={false}
    >
      <div style={{
        flex: 'none',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: isMobile ? '10px 12px' : '12px 20px',
        borderBottom: `1px solid ${currentTheme.border}`,
        background: currentTheme.headerBg,
        zIndex: 10,
      }}>
        <Button
          type="text"
          icon={<CloseOutlined />}
          onClick={onClose}
          style={{ color: currentTheme.text }}
        >
          {!isMobile && '关闭'}
        </Button>

        <Typography.Title
          level={5}
          style={{
            flex: 1,
            margin: 0,
            color: currentTheme.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'center',
            fontSize: isMobile ? 14 : 16,
          }}
        >
          第{chapter.chapter_number}章：{chapter.title}
        </Typography.Title>

        <Space size={8}>
          {isMobile && (
            <>
              <Tooltip title="前后章节预览">
                <Button
                  size="small"
                  icon={<ProfileOutlined />}
                  onClick={() => setLeftDrawerOpen(true)}
                  aria-label="前后章节预览"
                />
              </Tooltip>
              <Tooltip title="本章验收">
                <Button
                  size="small"
                  icon={<AimOutlined />}
                  onClick={() => setRightDrawerOpen(true)}
                  aria-label="本章验收"
                />
              </Tooltip>
            </>
          )}
          <Button
            type={showSettings ? 'primary' : 'text'}
            icon={<SettingOutlined />}
            onClick={() => setShowSettings(!showSettings)}
            style={{ color: showSettings ? undefined : currentTheme.text }}
            title="阅读设置"
          />
        </Space>
      </div>

      {showSettings && (
        <div style={{
          padding: isMobile ? '12px 16px' : '16px 24px',
          borderBottom: `1px solid ${currentTheme.border}`,
          background: currentTheme.headerBg,
        }}>
          <Space
            direction={isMobile ? 'vertical' : 'horizontal'}
            size="large"
            style={{ width: '100%' }}
            wrap
          >
            <div style={{ minWidth: isMobile ? '100%' : 200 }}>
              <Space style={{ marginBottom: 8, color: currentTheme.text }}>
                <FontSizeOutlined />
                <span>字体大小: {settings.fontSize}px</span>
              </Space>
              <Slider
                min={14}
                max={28}
                value={settings.fontSize}
                onChange={v => updateSettings('fontSize', v)}
                style={{ margin: '8px 0' }}
              />
            </div>

            <div style={{ minWidth: isMobile ? '100%' : 200 }}>
              <Space style={{ marginBottom: 8, color: currentTheme.text }}>
                <ColumnHeightOutlined />
                <span>行高: {settings.lineHeight}</span>
              </Space>
              <Slider
                min={1.4}
                max={2.5}
                step={0.1}
                value={settings.lineHeight}
                onChange={v => updateSettings('lineHeight', v)}
                style={{ margin: '8px 0' }}
              />
            </div>

            <div>
              <Space style={{ marginBottom: 8, color: currentTheme.text }}>
                <BgColorsOutlined />
                <span>主题</span>
              </Space>
              <div>
                <Radio.Group
                  value={settings.theme}
                  onChange={e => updateSettings('theme', e.target.value)}
                  buttonStyle="solid"
                  size={isMobile ? 'small' : 'middle'}
                >
                  <Radio.Button value="light">日间</Radio.Button>
                  <Radio.Button value="sepia">护眼</Radio.Button>
                  <Radio.Button value="dark">夜间</Radio.Button>
                </Radio.Group>
              </div>
            </div>
          </Space>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: currentTheme.bg }}>
        {!isMobile && (
          <aside style={{
            width: 320,
            flex: '0 0 320px',
            borderRight: `1px solid ${currentTheme.border}`,
            background: currentTheme.panelBg,
            color: currentTheme.text,
          }}>
            {renderContextPanel()}
          </aside>
        )}

        <div
          className="reader-scroll-container"
          style={{
            flex: 1,
            overflowY: 'auto',
            position: 'relative',
            scrollBehavior: 'smooth',
          }}
        >
          <Spin spinning={loading} tip="加载中...">
            <div
              style={{
                maxWidth: isMobile ? 1000 : 840,
                margin: '0 auto',
                padding: isMobile ? '24px 16px 40px' : '40px 44px',
                minHeight: '100%',
                fontSize: settings.fontSize,
                lineHeight: settings.lineHeight,
                color: currentTheme.text,
                whiteSpace: 'pre-wrap',
                textAlign: 'justify',
                wordBreak: 'break-word',
                overflowWrap: 'break-word',
              }}
            >
              {chapter.content ? (
                chapter.content.split('\n').map((paragraph, index) => (
                  paragraph.trim() ? (
                    <p
                      key={index}
                      style={{
                        textIndent: '2em',
                        margin: 0,
                        marginBottom: '0.8em',
                      }}
                    >
                      {paragraph}
                    </p>
                  ) : (
                    <br key={index} />
                  )
                ))
              ) : (
                <div style={{
                  textAlign: 'center',
                  padding: '60px 20px',
                  color: currentTheme.text,
                  opacity: 0.6,
                }}>
                  暂无内容
                </div>
              )}
            </div>
          </Spin>
        </div>

        {!isMobile && (
          <aside style={{
            width: 360,
            flex: '0 0 360px',
            borderLeft: `1px solid ${currentTheme.border}`,
            background: currentTheme.panelBg,
            color: currentTheme.text,
          }}>
            {renderPlanPanel()}
          </aside>
        )}
      </div>

      <div style={{
        flex: 'none',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: isMobile ? '12px 16px' : '16px 24px',
        borderTop: `1px solid ${currentTheme.border}`,
        background: currentTheme.headerBg,
        zIndex: 100,
      }}>
        <Button
          type="primary"
          icon={<LeftOutlined />}
          disabled={!navigation?.previous || loading}
          onClick={handlePrevious}
          size={isMobile ? 'middle' : 'large'}
        >
          {!isMobile && '上一章'}
        </Button>

        <div style={{
          minWidth: 0,
          textAlign: 'center',
          color: currentTheme.text,
          fontSize: isMobile ? 12 : 14,
        }}>
          <div>{chapter.word_count || 0} 字</div>
          {navigation && (
            <div style={{
              maxWidth: isMobile ? 220 : 680,
              fontSize: isMobile ? 10 : 12,
              opacity: 0.7,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {navigation.previous ? `上一章：${navigation.previous.title}` : '已是第一章'}
              {' | '}
              {navigation.next ? `下一章：${navigation.next.title}` : '已是最后一章'}
            </div>
          )}
        </div>

        <Button
          type="primary"
          disabled={!navigation?.next || loading}
          onClick={handleNext}
          size={isMobile ? 'middle' : 'large'}
        >
          {!isMobile && '下一章'}
          <RightOutlined />
        </Button>
      </div>

      <Drawer
        title="前后章节预览"
        placement="left"
        width="88%"
        open={leftDrawerOpen}
        onClose={() => setLeftDrawerOpen(false)}
        styles={{ body: { padding: 0, background: currentTheme.panelBg } }}
      >
        {renderContextPanel()}
      </Drawer>

      <Drawer
        title="本章验收"
        placement="right"
        width="88%"
        open={rightDrawerOpen}
        onClose={() => setRightDrawerOpen(false)}
        styles={{ body: { padding: 0, background: currentTheme.panelBg } }}
      >
        {renderPlanPanel()}
      </Drawer>
    </Modal>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <Space style={{ marginBottom: 12, fontSize: 15, fontWeight: 700 }}>
      {icon}
      <span>{title}</span>
    </Space>
  );
}

function ChapterBrief({
  label,
  chapter,
  plan,
  emptyText,
  currentTheme,
  active,
  muted,
  showEndAnchor,
}: {
  label: string;
  chapter: Chapter | null;
  plan: PlanData | null;
  emptyText: string;
  currentTheme: ReaderThemeStyle;
  active?: boolean;
  showEndAnchor?: boolean;
  muted?: boolean;
}) {
  if (!chapter) {
    return (
      <div style={{
        padding: 14,
        marginBottom: 12,
        border: `1px dashed ${currentTheme.border}`,
        borderRadius: 8,
        color: currentTheme.text,
        opacity: 0.55,
      }}>
        {emptyText}
      </div>
    );
  }

  const keyEvents = plan?.key_events || [];

  return (
    <div style={{
      padding: 14,
      marginBottom: 12,
      border: `1px solid ${active ? '#1677ff' : currentTheme.border}`,
      borderRadius: 8,
      background: active ? 'rgba(22, 119, 255, 0.08)' : currentTheme.mutedBg,
      opacity: muted ? 0.86 : 1,
    }}>
      <Space style={{ marginBottom: 8 }} wrap>
        <Tag color={active ? 'blue' : 'default'}>{label}</Tag>
        <span style={{ fontSize: 12, opacity: 0.72 }}>{chapter.word_count || 0} 字</span>
      </Space>
      <div style={{ fontWeight: 700, marginBottom: 8, lineHeight: 1.45 }}>
        第{chapter.chapter_number}章：{chapter.title}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.65, opacity: 0.84 }}>
        {compactText(chapter.summary || plan?.narrative_goal)}
      </div>
      {keyEvents.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {keyEvents.slice(0, 3).map((event, index) => (
            <div key={index} style={{
              display: 'flex',
              gap: 6,
              fontSize: 12,
              lineHeight: 1.55,
              opacity: 0.78,
              marginTop: 4,
            }}>
              <span style={{ fontWeight: 700 }}>{index + 1}.</span>
              <span>{event}</span>
            </div>
          ))}
          {keyEvents.length > 3 && (
            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.56 }}>
              还有 {keyEvents.length - 3} 个关键事件
            </div>
          )}
        </div>
      )}
      {showEndAnchor && chapter.end_anchor && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#1677ff", lineHeight: 1.5 }}>
          🔚 {chapter.end_anchor}
        </div>
      )}
    </div>
  );
}

function PlanPanel({
  chapter,
  plan,
  wordProgress,
  currentTheme,
  analysis,
}: {
  chapter: Chapter;
  plan: PlanData | null;
  wordProgress: number | null;
  currentTheme: ReaderThemeStyle;
  analysis?: AnalysisData | null;
}) {
  if (!plan && !chapter.summary) {
    return <Empty description="暂无本章规划" style={{ paddingTop: 48 }} />;
  }

  const keyEvents = plan?.key_events || [];
  const characters = plan?.character_focus || [];
  const scenes = plan?.scenes || [];
  const scores = analysis ? {
    overall: analysis.overall_quality_score,
    pacing: analysis.pacing_score,
    engagement: analysis.engagement_score,
    coherence: analysis.coherence_score,
    anchor: analysis.anchor_compliance_score,
  } : null;

  const scoreColor = (v?: number) => {
    if (v == null) return '#888';
    if (v >= 7) return '#52c41a';
    if (v >= 5) return '#faad14';
    return '#ff4d4f';
  };

  return (
    <Space direction="vertical" size={6} style={{ width: '100%' }}>
      {/* 分析评分 - 紧凑一行 */}
      {scores && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '2px 10px',
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid ' + currentTheme.border,
          background: currentTheme.mutedBg,
          fontSize: 12,
        }}>
          {scores.overall != null && <span>总评 <b style={{color: scoreColor(scores.overall)}}>{scores.overall}</b></span>}
          {scores.pacing != null && <span>节奏 <b style={{color: scoreColor(scores.pacing)}}>{scores.pacing}</b></span>}
          {scores.engagement != null && <span>吸引 <b style={{color: scoreColor(scores.engagement)}}>{scores.engagement}</b></span>}
          {scores.coherence != null && <span>连贯 <b style={{color: scoreColor(scores.coherence)}}>{scores.coherence}</b></span>}
          {scores.anchor != null && <span>锚点 <b style={{color: scoreColor(scores.anchor)}}>{scores.anchor}</b></span>}
        </div>
      )}

      <InfoBlock title="本章主干" currentTheme={currentTheme}>
        <div style={{ lineHeight: 1.7 }}>
          {compactText(chapter.summary || plan?.narrative_goal)}
        </div>
      </InfoBlock>

      {plan?.narrative_goal && (
        <InfoBlock title="叙事目标" icon={<AimOutlined />} currentTheme={currentTheme}>
          <div style={{ lineHeight: 1.7 }}>{plan.narrative_goal}</div>
        </InfoBlock>
      )}

      <InfoBlock title="字数控制" currentTheme={currentTheme}>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <div>
            实际 {chapter.word_count || 0} 字
            {plan?.estimated_words ? ' / 预计 ' + plan.estimated_words + ' 字' : ''}
          </div>
          {wordProgress !== null && (
            <Progress
              percent={wordProgress}
              size="small"
              status={wordProgress > 125 ? 'exception' : 'normal'}
              showInfo={false}
            />
          )}
        </Space>
      </InfoBlock>

      {keyEvents.length > 0 && (
        <InfoBlock title="关键事件" icon={<OrderedListOutlined />} currentTheme={currentTheme}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            {keyEvents.map((event, index) => (
              <div key={index} style={{ display: 'flex', gap: 8, lineHeight: 1.6 }}>
                <Tag color="purple" style={{ margin: 0 }}>#{index + 1}</Tag>
                <span>{event}</span>
              </div>
            ))}
          </Space>
        </InfoBlock>
      )}

      {/* 结束锚点 */}
      {chapter.end_anchor ? (
        <InfoBlock title="结束锚点" icon={<span>🔚</span>} currentTheme={currentTheme}>
          <div style={{ fontSize: 12, color: '#1677ff', lineHeight: 1.6 }}>
            {chapter.end_anchor}
          </div>
        </InfoBlock>
      ) : (
        <div style={{
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px dashed ' + currentTheme.border,
          fontSize: 12,
          opacity: 0.65,
        }}>
          🔚 结束锚点（未设置）
        </div>
      )}

      {(characters.length > 0 || plan?.emotional_tone || plan?.conflict_type) && (
        <InfoBlock title="控制要点" icon={<TeamOutlined />} currentTheme={currentTheme}>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            {characters.length > 0 && (
              <Space wrap size={4}>
                {characters.map(character => (
                  <Tag key={character} color="cyan">{character}</Tag>
                ))}
              </Space>
            )}
            {plan?.emotional_tone && <MetaLine label="情绪" value={plan.emotional_tone} />}
            {plan?.conflict_type && <MetaLine label="冲突" value={plan.conflict_type} />}
          </Space>
        </InfoBlock>
      )}

      {scenes.length > 0 && (
        <InfoBlock title="场景规划" currentTheme={currentTheme}>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            {scenes.map((scene, index) => (
              <div key={index} style={{
                padding: 8,
                borderRadius: 6,
                border: '1px solid ' + currentTheme.border,
              }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>场景 {index + 1}</div>
                {'location' in scene && scene.location && <MetaLine label="地点" value={scene.location} />}
                {'purpose' in scene && scene.purpose && <MetaLine label="目的" value={scene.purpose} />}
              </div>
            ))}
          </Space>
        </InfoBlock>
      )}
    </Space>
  );
}

function InfoBlock({
  title,
  icon,
  currentTheme,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  currentTheme: ReaderThemeStyle;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      padding: 10,
      borderRadius: 6,
      border: `1px solid ${currentTheme.border}`,
      background: currentTheme.mutedBg,
    }}>
      <Space style={{ marginBottom: 6, fontWeight: 700 }}>
        {icon}
        <span>{title}</span>
      </Space>
      <div style={{ fontSize: 13, opacity: 0.86 }}>{children}</div>
    </div>
  );
}

function MetaLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', gap: 8, lineHeight: 1.5 }}>
      <span style={{ opacity: 0.58, flex: '0 0 42px' }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
