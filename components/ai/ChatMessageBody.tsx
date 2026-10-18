import { BookOpen, FileText, SquareTerminal } from 'lucide-react';
import React, { memo } from 'react';
import { useI18n } from '../../application/i18n/I18nProvider';
import type { ChatMessage } from '../../infrastructure/ai/types';
import { LazyMessageResponse } from '../ai-elements/LazyMessageResponse';
import AgentActivityGroup from './AgentActivityGroup';
import ThinkingBlock from './ThinkingBlock';
import { getAIPanelProfilerProps } from './aiPanelDiagnostics';

interface ChatMessageBodyProps {
  message: ChatMessage;
  isStreaming: boolean;
  hideAttachments: boolean;
  hideMarkdown: boolean;
  onOpenPreview: (src: string, name: string) => void;
}

const PLAIN_TEXT_CLASS = 'whitespace-pre-wrap break-words text-[13px] leading-[1.45]';

/** Completed message bodies retain their tree while a sibling streams. */
export const ChatMessageBody = memo(function ChatMessageBody({
  message,
  isStreaming,
  hideAttachments,
  hideMarkdown,
  onOpenPreview,
}: ChatMessageBodyProps) {
  const { t } = useI18n();
  const isUser = message.role === 'user';

  return (
    <>
      {!isUser && message.thinking && (
        <ThinkingBlock
          content={message.thinking}
          isStreaming={isStreaming && !message.content}
          durationMs={message.thinkingDurationMs}
        />
      )}

      {!isUser && (message.agentActivities?.length || message.usage) && (
        <AgentActivityGroup
          activities={message.agentActivities}
          usage={message.usage}
          isStreaming={isStreaming}
          t={t}
        />
      )}

      {isUser && !hideAttachments && (message.attachments ?? message.images)?.length && (
        <div className="flex gap-1.5 flex-wrap mb-1">
          {(message.attachments ?? message.images)!.map((att, i) => (
            !att.vaultNoteId && (att.contentUnavailable || !att.base64Data) ? (
              <div
                key={att.filename ? `${att.filename}-${i}` : `att-${message.id}-${i}`}
                className="inline-flex items-center gap-1.5 min-h-7 px-2 py-1 rounded-md bg-muted/20 border border-border/20 text-[11px] text-foreground/70"
                title={t('ai.chat.attachmentContentUnavailable')}
              >
                {att.terminalSelection
                  ? <SquareTerminal size={12} className="text-muted-foreground/60 shrink-0" />
                  : <FileText size={12} className="text-muted-foreground/60 shrink-0" />}
                <span className="truncate max-w-[150px]">{att.filename || (att.terminalSelection ? 'terminal selection' : 'file')}</span>
                <span className="text-muted-foreground">{t('ai.chat.attachmentContentUnavailable')}</span>
              </div>
            ) : att.terminalSelection ? (
              <div
                key={att.filename ? `${att.filename}-${i}` : `att-${message.id}-${i}`}
                className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md bg-muted/20 border border-border/20 text-[11px] text-foreground/70"
              >
                <SquareTerminal size={12} className="text-muted-foreground/60 shrink-0" />
                <span className="truncate max-w-[150px]">{att.filename || 'terminal selection'}</span>
              </div>
            ) : att.vaultNoteId ? (
              <div
                key={att.filename ? `${att.filename}-${i}` : `att-${message.id}-${i}`}
                className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md bg-muted/20 border border-border/20 text-[11px] text-foreground/70"
              >
                <BookOpen size={12} className="text-muted-foreground/60 shrink-0" />
                <span className="truncate max-w-[150px]">{att.vaultNoteTitle || att.filename || 'note'}</span>
              </div>
            ) : att.mediaType.startsWith('image/') ? (
              <img
                key={att.filename ? `${att.filename}-${i}` : `att-${message.id}-${i}`}
                src={`data:${att.mediaType};base64,${att.base64Data}`}
                alt={att.filename || 'image'}
                className="max-h-[120px] max-w-[200px] rounded-md object-contain border border-border/20 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => onOpenPreview(`data:${att.mediaType};base64,${att.base64Data}`, att.filename || 'image')}
              />
            ) : (
              <div
                key={att.filename ? `${att.filename}-${i}` : `att-${message.id}-${i}`}
                className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md bg-muted/20 border border-border/20 text-[11px] text-foreground/70"
              >
                <FileText size={12} className="text-muted-foreground/60 shrink-0" />
                <span className="truncate max-w-[120px]">{att.filename || 'file'}</span>
              </div>
            )
          ))}
        </div>
      )}

      {message.content && (
        isUser
          ? <div className={PLAIN_TEXT_CLASS}>{message.content}</div>
          : hideMarkdown
            ? <div className={PLAIN_TEXT_CLASS} data-ai-content="plain">{message.content}</div>
            : (
                <React.Profiler {...getAIPanelProfilerProps('AIChatPanel.Markdown')}>
                  <div data-ai-content="markdown">
                    <LazyMessageResponse deferUntilWarm isAnimating={isStreaming}>
                      {message.content}
                    </LazyMessageResponse>
                  </div>
                </React.Profiler>
              )
      )}
    </>
  );
});
