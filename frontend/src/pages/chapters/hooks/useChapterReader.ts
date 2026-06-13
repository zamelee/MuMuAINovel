import { useState, useCallback, useEffect } from 'react';
import { message } from 'antd';
import type { RefObject } from 'react';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import type { FormInstance } from 'antd';
import type { Chapter } from '../../../types';

/**
 * useChapterReader
 *
 * Owns:
 *   - 阅读器 (ChapterReader 弹窗) 的 visible + readingChapter
 *   - 局部重写 (PartialRegenerateToolbar + PartialRegenerateModal) 的状态
 *   - 文本选中检测、滚动位置追踪
 *
 * 跨 hook 依赖:
 *   - isEditorOpen / isGenerating: 决定是否检测文本选中
 *   - contentTextAreaRef: 文本选中的载体
 *   - editorForm: 应用局部重写结果
 */
export interface UseChapterReaderDeps {
  isEditorOpen: boolean;
  isGenerating: boolean;
  contentTextAreaRef: RefObject<TextAreaRef>;
  editorForm: FormInstance;
}

export function useChapterReader(deps: UseChapterReaderDeps) {
  const { isEditorOpen, isGenerating, contentTextAreaRef, editorForm } = deps;

  // 阅读器状态
  const [readerVisible, setReaderVisible] = useState(false);
  const [readingChapter, setReadingChapter] = useState<Chapter | null>(null);

  // 局部重写状态
  const [partialRegenerateToolbarVisible, setPartialRegenerateToolbarVisible] = useState(false);
  const [partialRegenerateToolbarPosition, setPartialRegenerateToolbarPosition] = useState({ top: 0, left: 0 });
  const [selectedTextForRegenerate, setSelectedTextForRegenerate] = useState('');
  const [selectionStartPosition, setSelectionStartPosition] = useState(0);
  const [selectionEndPosition, setSelectionEndPosition] = useState(0);
  const [partialRegenerateModalVisible, setPartialRegenerateModalVisible] = useState(false);

  // 打开阅读器
  const handleOpenReader = (chapter: Chapter) => {
    setReadingChapter(chapter);
    setReaderVisible(true);
  };

  // 阅读器切换章节
  const handleReaderChapterChange = async (chapterId: string) => {
    try {
      const response = await fetch(`/api/chapters/${chapterId}`);
      if (!response.ok) throw new Error('获取章节失败');
      const newChapter = await response.json();
      setReadingChapter(newChapter);
    } catch {
      message.error('加载章节失败');
    }
  };

  // 打开局部重写弹窗
  const handleOpenPartialRegenerate = () => {
    setPartialRegenerateToolbarVisible(false);
    setPartialRegenerateModalVisible(true);
  };

  // 应用局部重写结果
  const handleApplyPartialRegenerate = (newText: string, startPos: number, endPos: number) => {
    const currentContent = editorForm.getFieldValue('content') || '';
    const newContent = currentContent.substring(0, startPos) + newText + currentContent.substring(endPos);
    editorForm.setFieldsValue({ content: newContent });
    setPartialRegenerateModalVisible(false);
    message.success('局部重写已应用');
  };

  // 处理文本选中 - 检测选中文本并显示浮动工具栏
  const handleTextSelection = useCallback(() => {
    if (!isEditorOpen || isGenerating) {
      setPartialRegenerateToolbarVisible(false);
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      setPartialRegenerateToolbarVisible(false);
      return;
    }

    const selectedText = selection.toString().trim();

    if (selectedText.length < 10) {
      setPartialRegenerateToolbarVisible(false);
      return;
    }

    const textArea = contentTextAreaRef.current?.resizableTextArea?.textArea;
    if (!textArea) {
      setPartialRegenerateToolbarVisible(false);
      return;
    }

    if (document.activeElement !== textArea) {
      setPartialRegenerateToolbarVisible(false);
      return;
    }

    const start = textArea.selectionStart;
    const end = textArea.selectionEnd;
    const textContent = textArea.value;
    const selectedInTextArea = textContent.substring(start, end);

    if (selectedInTextArea.trim().length < 10) {
      setPartialRegenerateToolbarVisible(false);
      return;
    }

    const rect = textArea.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(textArea);
    const lineHeight = parseFloat(computedStyle.lineHeight) || 24;
    const paddingTop = parseFloat(computedStyle.paddingTop) || 0;

    const textBeforeSelection = textContent.substring(0, start);
    const startLine = textBeforeSelection.split('\n').length - 1;

    const scrollTop = textArea.scrollTop;
    const visualTop = (startLine * lineHeight) + paddingTop - scrollTop;

    const toolbarTop = rect.top + visualTop - 45;
    const toolbarLeft = rect.right - 180;

    setSelectedTextForRegenerate(selectedInTextArea);
    setSelectionStartPosition(start);
    setSelectionEndPosition(end);

    let finalTop = toolbarTop;
    if (visualTop < 0) {
      finalTop = rect.top + 10;
    } else if (visualTop > textArea.clientHeight) {
      finalTop = rect.bottom - 50;
    }

    setPartialRegenerateToolbarPosition({
      top: Math.max(rect.top + 10, Math.min(finalTop, rect.bottom - 50)),
      left: Math.min(Math.max(rect.left + 20, toolbarLeft), window.innerWidth - 200),
    });
    setPartialRegenerateToolbarVisible(true);
  }, [isEditorOpen, isGenerating, contentTextAreaRef]);

  // 更新工具栏位置（不检测选中，只更新位置）
  const updateToolbarPosition = useCallback(() => {
    if (!partialRegenerateToolbarVisible || !selectedTextForRegenerate) return;

    const textArea = contentTextAreaRef.current?.resizableTextArea?.textArea;
    if (!textArea) return;

    const rect = textArea.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(textArea);
    const lineHeight = parseFloat(computedStyle.lineHeight) || 24;
    const paddingTop = parseFloat(computedStyle.paddingTop) || 0;

    const textContent = textArea.value;
    const textBeforeSelection = textContent.substring(0, selectionStartPosition);
    const startLine = textBeforeSelection.split('\n').length - 1;

    const scrollTop = textArea.scrollTop;
    const visualTop = (startLine * lineHeight) + paddingTop - scrollTop;

    const toolbarTop = rect.top + visualTop - 45;
    const toolbarLeft = rect.right - 180;

    let finalTop = toolbarTop;
    if (visualTop < 0) {
      finalTop = rect.top + 10;
    } else if (visualTop > textArea.clientHeight) {
      finalTop = rect.bottom - 50;
    }

    setPartialRegenerateToolbarPosition({
      top: Math.max(rect.top + 10, Math.min(finalTop, rect.bottom - 50)),
      left: Math.min(Math.max(rect.left + 20, toolbarLeft), window.innerWidth - 200),
    });
  }, [partialRegenerateToolbarVisible, selectedTextForRegenerate, selectionStartPosition, contentTextAreaRef]);

  // 监听选中事件
  useEffect(() => {
    if (!isEditorOpen) return;

    const textArea = contentTextAreaRef.current?.resizableTextArea?.textArea;
    if (!textArea) return;

    const handleMouseUp = () => {
      setTimeout(handleTextSelection, 50);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        setTimeout(handleTextSelection, 50);
      }
    };

    const handleScroll = () => {
      requestAnimationFrame(updateToolbarPosition);
    };

    textArea.addEventListener('mouseup', handleMouseUp);
    textArea.addEventListener('keyup', handleKeyUp);
    textArea.addEventListener('scroll', handleScroll);

    const modalBody = textArea.closest('.ant-modal-body');
    if (modalBody) {
      modalBody.addEventListener('scroll', handleScroll);
    }

    window.addEventListener('resize', handleScroll);

    return () => {
      textArea.removeEventListener('mouseup', handleMouseUp);
      textArea.removeEventListener('keyup', handleKeyUp);
      textArea.removeEventListener('scroll', handleScroll);
      if (modalBody) {
        modalBody.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('resize', handleScroll);
    };
  }, [isEditorOpen, handleTextSelection, updateToolbarPosition, contentTextAreaRef]);

  // 点击其他区域时隐藏工具栏
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      if (target.closest('[data-partial-regenerate-toolbar]')) {
        return;
      }

      if (target.tagName === 'TEXTAREA') {
        return;
      }

      if (target.closest('.ant-modal-content')) {
        return;
      }

      setPartialRegenerateToolbarVisible(false);
    };

    if (partialRegenerateToolbarVisible) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [partialRegenerateToolbarVisible]);

  return {
    // reader state
    readerVisible,
    setReaderVisible,
    readingChapter,
    setReadingChapter,
    handleOpenReader,
    handleReaderChapterChange,
    // partial regenerate state
    partialRegenerateToolbarVisible,
    setPartialRegenerateToolbarVisible,
    partialRegenerateToolbarPosition,
    setPartialRegenerateToolbarPosition,
    selectedTextForRegenerate,
    setSelectedTextForRegenerate,
    selectionStartPosition,
    setSelectionStartPosition,
    selectionEndPosition,
    setSelectionEndPosition,
    partialRegenerateModalVisible,
    setPartialRegenerateModalVisible,
    handleOpenPartialRegenerate,
    handleApplyPartialRegenerate,
  };
}
