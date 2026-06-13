import { useState } from 'react';
import { Modal, Form, Input, InputNumber, Select, Descriptions, Tag, Card, Alert, Space, message } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { projectApi, chapterApi } from '../../../services/api';
import type { Chapter, ChapterUpdate, ExpansionPlanData } from '../../../types';

export interface UseChapterCRUDDeps {
  modal: ReturnType<typeof Modal.useModal>[0];
  chapters: Chapter[];
  currentProjectId: string;
  refreshChapters: () => Promise<unknown>;
  updateChapter: (id: string, values: ChapterUpdate) => Promise<unknown>;
  setCurrentProject: (project: unknown) => void;
  isMobile: boolean;
  token: { colorError: string; colorWarningBg: string; colorWarningBorder: string; borderRadius: number; colorPrimary: string; colorTextSecondary: string; colorFillQuaternary: string };
  getStatusText: (status: string) => string;
  outlines: Array<{ id: string; order_index: number; title: string }>;
}

export function useChapterCRUD(deps: UseChapterCRUDDeps) {
  const {
    modal, chapters, currentProjectId,
    refreshChapters, updateChapter, setCurrentProject,
    isMobile, token, getStatusText, outlines,
  } = deps;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [planEditorVisible, setPlanEditorVisible] = useState(false);
  const [editingPlanChapter, setEditingPlanChapter] = useState<Chapter | null>(null);
  const [manualCreateForm] = Form.useForm();

  const handleOpenModal = (id: string) => {
    const chapter = chapters.find(c => c.id === id);
    if (chapter) {
      form.setFieldsValue(chapter);
      setEditingId(id);
      setIsModalOpen(true);
    }
  };

  const handleSubmit = async (values: ChapterUpdate) => {
    if (!editingId) return;
    try {
      await updateChapter(editingId, values);
      await refreshChapters();
      message.success('章节更新成功');
      setIsModalOpen(false);
      form.resetFields();
    } catch {
      message.error('操作失败');
    }
  };

  const handleDeleteChapter = async (chapterId: string) => {
    try {
      await chapterApi.deleteChapter(chapterId);
      await refreshChapters();
      if (currentProjectId) {
        const updatedProject = await projectApi.getProject(currentProjectId);
        setCurrentProject(updatedProject);
      }
      message.success('章节删除成功');
    } catch (error: unknown) {
      const err = error as Error;
      message.error('删除章节失败：' + (err.message || '未知错误'));
    }
  };

  const handleOpenPlanEditor = (chapter: Chapter) => {
    setEditingPlanChapter(chapter);
    setPlanEditorVisible(true);
  };

  const handleSavePlan = async (planData: ExpansionPlanData) => {
    if (!editingPlanChapter) return;
    try {
      const response = await fetch(`/api/chapters/${editingPlanChapter.id}/expansion-plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(planData),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || '更新失败');
      }
      await refreshChapters();
      message.success('规划信息更新成功');
      setPlanEditorVisible(false);
      setEditingPlanChapter(null);
    } catch (error: unknown) {
      const err = error as Error;
      message.error('保存规划失败：' + (err.message || '未知错误'));
      throw error;
    }
  };

  const showManualCreateChapterModal = () => {
    if (!currentProjectId) return;
    const nextChapterNumber = chapters.length > 0
      ? Math.max(...chapters.map(c => c.chapter_number)) + 1
      : 1;
    modal.confirm({
      title: '手动创建章节',
      width: 600,
      centered: true,
      content: (
        <Form
          form={manualCreateForm}
          layout="vertical"
          initialValues={{ chapter_number: nextChapterNumber, status: 'draft' }}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            label="章节序号"
            name="chapter_number"
            rules={[{ required: true, message: '请输入章节序号' }]}
            tooltip="建议按顺序创建章节，确保内容连贯性"
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder="自动计算的下一个序号" />
          </Form.Item>
          <Form.Item
            label="章节标题"
            name="title"
            rules={[{ required: true, message: '请输入标题' }]}
          >
            <Input placeholder="例如：第一章 初遇" />
          </Form.Item>
          <Form.Item
            label="关联大纲"
            name="outline_id"
            rules={[{ required: true, message: '请选择关联的大纲' }]}
            tooltip="one-to-many模式下，章节必须关联到大纲"
          >
            <Select placeholder="请选择所属大纲">
              {[...outlines]
                .sort((a, b) => a.order_index - b.order_index)
                .map(outline => (
                  <Select.Option key={outline.id} value={outline.id}>
                    第{outline.order_index}卷：{outline.title}
                  </Select.Option>
                ))}
            </Select>
          </Form.Item>
          <Form.Item
            label="章节摘要（可选）"
            name="summary"
            tooltip="简要描述本章的主要内容和情节发展"
          >
            <Input.TextArea rows={4} placeholder="简要描述本章内容..." />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select>
              <Select.Option value="draft">草稿</Select.Option>
              <Select.Option value="pending">待处理</Select.Option>
              <Select.Option value="writing">创作中</Select.Option>
              <Select.Option value="completed">已完成</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      ),
      okText: '创建',
      cancelText: '取消',
      onOk: async () => {
        const values = await manualCreateForm.validateFields();
        const conflictChapter = chapters.find(
          ch => ch.chapter_number === values.chapter_number
        );
        if (conflictChapter) {
          modal.confirm({
            title: '章节序号冲突',
            icon: <InfoCircleOutlined style={{ color: token.colorError }} />,
            width: 500,
            centered: true,
            content: (
              <div>
                <p style={{ marginBottom: 12 }}>
                  第 <strong>{values.chapter_number}</strong> 章已存在：
                </p>
                <div style={{
                  padding: 12,
                  background: token.colorWarningBg,
                  borderRadius: token.borderRadius,
                  border: `1px solid ${token.colorWarningBorder}`,
                  marginBottom: 12
                }}>
                  <div><strong>标题：</strong>{conflictChapter.title}</div>
                  <div><strong>状态：</strong>{getStatusText(conflictChapter.status)}</div>
                  <div><strong>字数：</strong>{conflictChapter.word_count || 0}字</div>
                  {conflictChapter.outline_title && (
                    <div><strong>所属大纲：</strong>{conflictChapter.outline_title}</div>
                  )}
                </div>
                <p style={{ color: token.colorError, marginBottom: 8 }}>
                  ⚠️ 是否删除旧章节并创建新章节？
                </p>
                <p style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 0 }}>
                  删除后将无法恢复，章节内容和分析结果都将被删除。
                </p>
              </div>
            ),
            okText: '删除并创建',
            okButtonProps: { danger: true },
            cancelText: '取消',
            onOk: async () => {
              try {
                await handleDeleteChapter(conflictChapter.id);
                await new Promise(resolve => setTimeout(resolve, 300));
                await chapterApi.createChapter({
                  project_id: currentProjectId,
                  ...values
                });
                message.success('已删除旧章节并创建新章节');
                await refreshChapters();
                const updatedProject = await projectApi.getProject(currentProjectId);
                setCurrentProject(updatedProject);
                manualCreateForm.resetFields();
              } catch (error: unknown) {
                const err = error as Error;
                message.error('操作失败：' + (err.message || '未知错误'));
                throw error;
              }
            }
          });
          return Promise.reject();
        }
        try {
          await chapterApi.createChapter({
            project_id: currentProjectId,
            ...values
          });
          message.success('章节创建成功');
          await refreshChapters();
          const updatedProject = await projectApi.getProject(currentProjectId);
          setCurrentProject(updatedProject);
          manualCreateForm.resetFields();
        } catch (error: unknown) {
          const err = error as Error;
          message.error('创建失败：' + (err.message || '未知错误'));
          throw error;
        }
      }
    });
  };

  const showExpansionPlanModal = (chapter: Chapter) => {
    if (!chapter.expansion_plan) return;
    try {
      const planData: ExpansionPlanData = JSON.parse(chapter.expansion_plan);
      modal.info({
        title: (
          <Space style={{ flexWrap: 'wrap' }}>
            <InfoCircleOutlined style={{ color: token.colorPrimary }} />
            <span style={{ wordBreak: 'break-word' }}>第{chapter.chapter_number}章：{chapter.title}</span>
            <Tag color="blue">展开规划</Tag>
          </Space>
        ),
        width: 720,
        centered: true,
        content: (
          <div style={{ marginTop: 16 }}>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="章节标题">
                <strong style={{
                  wordBreak: 'break-word',
                  whiteSpace: 'normal',
                  overflowWrap: 'break-word'
                }}>
                  {chapter.title}
                </strong>
              </Descriptions.Item>
              <Descriptions.Item label="情感基调">
                <Tag
                  color="blue"
                  style={{
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    height: 'auto',
                    lineHeight: '1.5',
                    padding: '4px 8px'
                  }}
                >
                  {planData.emotional_tone}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="冲突类型">
                <Tag
                  color="orange"
                  style={{
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    height: 'auto',
                    lineHeight: '1.5',
                    padding: '4px 8px'
                  }}
                >
                  {planData.conflict_type}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="预估字数">
                <Tag color="green">{planData.estimated_words}字</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="叙事目标">
                <span style={{
                  wordBreak: 'break-word',
                  whiteSpace: 'normal',
                  overflowWrap: 'break-word'
                }}>
                  {planData.narrative_goal}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="关键事件">
                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                  {planData.key_events.map((event, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '4px 0',
                        wordBreak: 'break-word',
                        whiteSpace: 'normal',
                        overflowWrap: 'break-word'
                      }}
                    >
                      <Tag color="purple" style={{ flexShrink: 0 }}>{idx + 1}</Tag>{' '}
                      <span style={{
                        wordBreak: 'break-word',
                        whiteSpace: 'normal',
                        overflowWrap: 'break-word'
                      }}>
                        {event}
                      </span>
                    </div>
                  ))}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="涉及角色">
                <Space wrap style={{ maxWidth: '100%' }}>
                  {planData.character_focus.map((char, idx) => (
                    <Tag
                      key={idx}
                      color="cyan"
                      style={{
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        height: 'auto',
                        lineHeight: '1.5'
                      }}
                    >
                      {char}
                    </Tag>
                  ))}
                </Space>
              </Descriptions.Item>
              {planData.scenes && planData.scenes.length > 0 && (
                <Descriptions.Item label="场景规划">
                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                    {planData.scenes.map((scene, idx) => (
                      <Card
                        key={idx}
                        size="small"
                        style={{
                          backgroundColor: token.colorFillQuaternary,
                          maxWidth: '100%',
                          overflow: 'hidden'
                        }}
                      >
                        <div style={{
                          marginBottom: 4,
                          wordBreak: 'break-word',
                          whiteSpace: 'normal',
                          overflowWrap: 'break-word'
                        }}>
                          <strong>📍 地点：</strong>
                          <span style={{
                            wordBreak: 'break-word',
                            whiteSpace: 'normal',
                            overflowWrap: 'break-word'
                          }}>
                            {scene.location}
                          </span>
                        </div>
                        <div style={{ marginBottom: 4 }}>
                          <strong>👥 角色：</strong>
                          <Space
                            size="small"
                            wrap
                            style={{
                              marginLeft: isMobile ? 0 : 8,
                              marginTop: isMobile ? 4 : 0,
                              display: isMobile ? 'flex' : 'inline-flex'
                            }}
                          >
                            {scene.characters.map((char, charIdx) => (
                              <Tag
                                key={charIdx}
                                style={{
                                  whiteSpace: 'normal',
                                  wordBreak: 'break-word',
                                  height: 'auto'
                                }}
                              >
                                {char}
                              </Tag>
                            ))}
                          </Space>
                        </div>
                        <div style={{
                          wordBreak: 'break-word',
                          whiteSpace: 'normal',
                          overflowWrap: 'break-word'
                        }}>
                          <strong>🎯 目的：</strong>
                          <span style={{
                            wordBreak: 'break-word',
                            whiteSpace: 'normal',
                            overflowWrap: 'break-word'
                          }}>
                            {scene.purpose}
                          </span>
                        </div>
                      </Card>
                    ))}
                  </Space>
                </Descriptions.Item>
              )}
            </Descriptions>
            <Alert
              message="提示"
              description="这些是AI在大纲展开时生成的规划信息，可以作为创作章节内容时的参考。"
              type="info"
              showIcon
              style={{ marginTop: 16 }}
            />
          </div>
        ),
        okText: '关闭',
      });
    } catch (error) {
      console.error('解析展开规划失败:', error);
      message.error('展开规划数据格式错误');
    }
  };

  return {
    isModalOpen, setIsModalOpen,
    editingId, setEditingId,
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
  };
}
