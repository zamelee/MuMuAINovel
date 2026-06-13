// Z.5/Z.3/Z.4: 章节上下文注入字段可配置
import { useEffect, useState } from 'react';
import { Card, Switch, Button, Space, Typography, Spin, Alert, message, Row, Col, Tag, Popconfirm, Divider, theme } from 'antd';
import { ReloadOutlined, SaveOutlined, ThunderboltOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { settingsApi } from '../services/api';
import type { ChapterContextKey } from '../types';

const { Title, Text } = Typography;

interface FieldMeta {
  key: ChapterContextKey;
  label: string;
  description: string;
  tag?: string;  // 批次标签: Z.5 / Z.3 / Z.4
}

const FIELD_METAS: FieldMeta[] = [
  {
    key: 'scene_state',
    label: '场景状态',
    description: '注入上一章结尾的场景信息 (地点/在场角色), 防止场景断裂',
  },
  {
    key: 'outline_pruning_warning',
    label: '大纲冲突预警',
    description: '当本章大纲与上章场景冲突时, 注入 Agent 修剪建议',
  },
  {
    key: 'foreshadow_logger_only',
    label: '伏笔自动处理',
    description: '在 logger 中自动检测过期伏笔 (dry_run), 不注入 prompt',
  },
  {
    key: 'prev_content_tail',
    label: '上一章末尾 500 字',
    description: '注入上一章最后 500 字, 衔接文风',
  },
  {
    key: 'prev_end_anchor',
    label: '上一章结束锚点',
    description: '注入上一章设定的结束锚点, 强制本章承接',
  },
  {
    key: 'prev_summary',
    label: '上一章摘要',
    description: '注入上一章的 chapter_summary 记忆',
  },
  {
    key: 'recent_chapters',
    label: '最近章节脉络',
    description: '注入最近 10 章的分析摘要/大纲/生成摘要 + 情节点 + 场景 + 评分',
  },
  {
    key: 'emotion_curve',
    label: '情感曲线',
    description: '单章视角: 上一章情感参考. 跨章视角: 情感趋势 (近N章). 防止情感断裂',
    tag: 'Z.3',
  },
  {
    key: 'character_state',
    label: '角色状态轨迹',
    description: '单章视角: 上一章角色状态变化. 跨章视角: 全角色轨迹 (近N章). 防止角色性格漂移',
    tag: 'Z.4',
  },
];

export default function ChapterContextSettings() {
  const { token } = theme.useToken();
  const [enabled, setEnabled] = useState<Record<string, boolean> | null>(null);
  const [allKnownKeys, setAllKnownKeys] = useState<ChapterContextKey[]>([]);
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const resp = await settingsApi.getChapterContextEnabled();
      setEnabled(resp.enabled);
      setAllKnownKeys(resp.all_known_keys);
      setIsDefault(resp.is_default);
      setDirty(false);
    } catch (e: any) {
      message.error('加载章节上下文配置失败: ' + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSwitchChange = (key: string, value: boolean) => {
    if (!enabled) return;
    setEnabled({ ...enabled, [key]: value });
    setDirty(true);
  };

  const handleResetToDefaults = () => {
    // 全部设为 True (跟后端 DEFAULT_ENABLED 一致)
    if (!allKnownKeys.length) return;
    const reset: Record<string, boolean> = {};
    allKnownKeys.forEach((k) => (reset[k] = true));
    setEnabled(reset);
    setDirty(true);
  };

  const handleSave = async () => {
    if (!enabled) return;
    setSaving(true);
    try {
      await settingsApi.updateChapterContextEnabled({ enabled: enabled as Record<ChapterContextKey, boolean> });
      message.success('已保存, 下次章节生成立即生效');
      setDirty(false);
      // 保存后 is_default 应变 false (除非服务端 merge 后还是全默认)
      // 简单起见, 直接重新 load 拿最新 is_default
      await loadData();
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.message || String(e);
      message.error('保存失败: ' + detail);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !enabled) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card
        style={{
          background: `linear-gradient(135deg, ${token.colorPrimary}08 0%, ${token.colorPrimaryBg} 100%)`,
          border: `1px solid ${token.colorPrimaryBorder}`,
        }}
      >
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Title level={4} style={{ margin: 0 }}>
            <ThunderboltOutlined style={{ marginRight: 8, color: token.colorPrimary }} />
            章节上下文注入配置
          </Title>
          <Text type="secondary">
            控制 LLM 生成章节时, 自动注入哪些 "上一章相关" 的上下文. 默认全开, 关闭后该字段不进入 prompt.
          </Text>
        </Space>
      </Card>

      {isDefault && (
        <Alert
          message="当前使用默认配置 (全部启用). 任何修改都会保存为个人偏好."
          type="info"
          showIcon
        />
      )}

      {!isDefault && !dirty && (
        <Alert
          message="已使用个人偏好配置"
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
        />
      )}

      <Row gutter={[16, 16]}>
        {FIELD_METAS.map((meta) => {
          const isKnown = allKnownKeys.includes(meta.key);
          const value = isKnown ? enabled[meta.key] : undefined;
          return (
            <Col xs={24} md={12} key={meta.key}>
              <Card size="small" hoverable>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Space>
                      <Text strong>{meta.label}</Text>
                      {meta.tag && <Tag color="blue" style={{ marginLeft: 4 }}>{meta.tag}</Tag>}
                    </Space>
                    <Switch
                      checked={!!value}
                      disabled={!isKnown}
                      onChange={(v) => handleSwitchChange(meta.key, v)}
                    />
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {meta.description}
                  </Text>
                  {!isKnown && (
                    <Text type="warning" style={{ fontSize: 11 }}>
                      ⚠ 后端未识别此字段 (key={meta.key})
                    </Text>
                  )}
                </Space>
              </Card>
            </Col>
          );
        })}
      </Row>

      <Divider style={{ margin: '8px 0' }} />

      <Space>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          disabled={!dirty}
          onClick={handleSave}
        >
          保存配置
        </Button>
        <Popconfirm
          title="确定恢复默认?"
          description="全部字段重置为 True (后端 DEFAULT_ENABLED)"
          onConfirm={handleResetToDefaults}
          okText="确定"
          cancelText="取消"
        >
          <Button icon={<ReloadOutlined />}>恢复默认</Button>
        </Popconfirm>
        {dirty && (
          <Text type="warning" style={{ marginLeft: 8 }}>
            有未保存的修改
          </Text>
        )}
      </Space>
    </Space>
  );
}
