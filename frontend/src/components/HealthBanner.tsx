import { useState, useEffect } from 'react';
import { Alert, Button, Space, Tag, Popconfirm, message, List, Collapse, Spin, theme } from 'antd';
import {
  WarningOutlined,
  ToolOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import type { ProjectHealth, FillAnchorResult, BatchFillAnchorsResult } from '../types';

interface HealthBannerProps {
  projectId: string;
  onRefresh?: () => void;  // 补全后通知父组件刷新
}

export default function HealthBanner({ projectId, onRefresh }: HealthBannerProps) {
  const { token } = theme.useToken();
  const [health, setHealth] = useState<ProjectHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [filling, setFilling] = useState<string | null>(null); // 正在补全的 chapter id
  const [batchFilling, setBatchFilling] = useState(false);

  const fetchHealth = async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/projects/${projectId}/health`);
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      }
    } catch (e) {
      console.error('获取项目健康状态失败:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, [projectId]);

  if (loading) return null;
  if (!health || health.total_issues === 0) return null;

  // 单条补全锚点
  const fillOneAnchor = async (id: string) => {
    try {
      setFilling(id);
      const res = await fetch(`/api/chapters/${id}/fill-anchor`, { method: 'POST' });
      if (res.ok) {
        const result: FillAnchorResult = await res.json();
        if (result.skipped) {
          message.info(result.reason || '跳过');
        } else {
          message.success('锚点已补全');
        }
        fetchHealth();
        onRefresh?.();
      }
    } catch (e) {
      message.error('补全失败');
    } finally {
      setFilling(null);
    }
  };

  // 批量补全锚点
  const batchFillAnchors = async () => {
    try {
      setBatchFilling(true);
      const res = await fetch(`/api/chapters/project/${projectId}/fill-anchors`, { method: 'POST' });
      if (res.ok) {
        const result: BatchFillAnchorsResult = await res.json();
        message.success(`完成：${result.succeeded} 成功, ${result.failed} 失败, ${result.skipped} 跳过`);
        fetchHealth();
        onRefresh?.();
      }
    } catch (e) {
      message.error('批量补全失败');
    } finally {
      setBatchFilling(false);
    }
  };

  const issueItems = [
    ...(health.chapters_missing_anchor > 0 ? [{
      key: 'anchor',
      color: 'orange' as const,
      label: `章节缺锚点 (${health.chapters_missing_anchor})`,
      extra: health.chapters_missing_anchor > 0 && (
        <Popconfirm
          title={`为 ${health.chapters_missing_anchor} 个章节补全锚点？`}
          description="将调用AI自动生成，约消耗少量token"
          onConfirm={batchFillAnchors}
          okText="开始补全"
          cancelText="取消"
        >
          <Button size="small" type="link" loading={batchFilling} icon={<ToolOutlined />}>
            一键补全
          </Button>
        </Popconfirm>
      ),
      children: (
        <List
          size="small"
          dataSource={health.chapters_missing_anchor_ids}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button
                  key="fill"
                  size="small"
                  type="link"
                  loading={filling === item.id}
                  onClick={() => fillOneAnchor(item.id)}
                >
                  补全
                </Button>
              ]}
            >
              {item.title}
            </List.Item>
          )}
        />
      ),
    }] : []),
    ...(health.chapters_missing_analysis > 0 ? [{
      key: 'analysis_missing',
      color: 'red' as const,
      label: `章节缺分析 (${health.chapters_missing_analysis})`,
      children: (
        <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
          请在章节页面对以下章节手动触发分析：
          {health.chapters_missing_analysis_ids.map(ch => (
            <Tag key={ch.id} style={{ margin: '2px 4px' }}>{ch.title}</Tag>
          ))}
        </div>
      ),
    }] : []),
    ...(health.chapters_stale_analysis > 0 ? [{
      key: 'analysis_stale',
      color: 'orange' as const,
      label: `分析过期 (${health.chapters_stale_analysis})`,
      children: (
        <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
          以下章节已分析但缺少锚点合规评分，建议重新分析：
          {health.chapters_stale_analysis_ids.map(ch => (
            <Tag key={ch.id} style={{ margin: '2px 4px' }}>{ch.title}</Tag>
          ))}
        </div>
      ),
    }] : []),
  ];

  if (issueItems.length === 0) return null;

  return (
    <Alert
      type="warning"
      showIcon
      icon={<WarningOutlined />}
      message={
        <Space>
          <span>检测到 {health.total_issues} 项可补全的要素</span>
          <Button size="small" icon={<ReloadOutlined />} onClick={fetchHealth} type="text" />
        </Space>
      }
      description={
        <Collapse
          size="small"
          ghost
          items={issueItems.map(item => ({
            key: item.key,
            label: (
              <Space>
                <Tag color={item.color}>{item.label}</Tag>
                {item.extra}
              </Space>
            ),
            children: item.children,
          }))}
        />
      }
      style={{ marginBottom: 16 }}
    />
  );
}