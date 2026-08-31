import React, { useState, useRef, useCallback } from "react";
import { Send, Loader2, Paperclip, ImageIcon, Video, FileText, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AudioRecorder } from "@/components/chat/AudioRecorder";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSendMessage: (message: string) => Promise<void>;
  onSendAudio: (blob: Blob, options: { waveform: boolean; viewOnce: boolean; duration: number }) => Promise<void>;
  onMediaSelect: (e: React.ChangeEvent<HTMLInputElement>, type: "image" | "video" | "document") => void;
  isTest?: boolean;
  disabled?: boolean;
  isSending?: boolean;
  isSendingMedia?: boolean;
  hasZapiConversation?: boolean;
}

export const ChatInput = React.memo(function ChatInput({
  onSendMessage,
  onSendAudio,
  onMediaSelect,
  isTest = false,
  disabled = false,
  isSending = false,
  isSendingMedia = false,
  hasZapiConversation = false,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    if (!message.trim() || disabled || isSending) return;
    const msg = message.trim();
    setMessage("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    await onSendMessage(msg);
  }, [message, disabled, isSending, onSendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  }, []);

  const mediaDisabled = disabled || !hasZapiConversation || isSendingMedia || isTest;

  return (
    <>
      {/* Hidden file inputs for media upload */}
      <input
        ref={imageInputRef}
        type="file"
        className="hidden"
        accept=".jpg,.jpeg,.png,.gif,.webp"
        onChange={(e) => onMediaSelect(e, "image")}
      />
      <input
        ref={videoInputRef}
        type="file"
        className="hidden"
        accept=".mp4,.3gp"
        onChange={(e) => onMediaSelect(e, "video")}
      />
      <input
        ref={documentInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
        onChange={(e) => onMediaSelect(e, "document")}
      />
      {/* Audio Recorder - shown when recording */}
      {isRecordingAudio ? (
        <AudioRecorder
          onSend={onSendAudio}
          onCancel={() => setIsRecordingAudio(false)}
          disabled={isSendingMedia}
        />
      ) : (
        <div className="flex gap-2">
          {/* Attachment Button with Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 h-9 w-9"
                disabled={mediaDisabled}
              >
                {isSendingMedia ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Paperclip className="h-3.5 w-3.5" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                <ImageIcon className="mr-2 h-4 w-4" />
                Enviar imagem
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => videoInputRef.current?.click()}>
                <Video className="mr-2 h-4 w-4" />
                Enviar video
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => documentInputRef.current?.click()}>
                <FileText className="mr-2 h-4 w-4" />
                Enviar documento
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Microphone Button */}
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-9 w-9"
            disabled={mediaDisabled}
            onClick={() => setIsRecordingAudio(true)}
          >
            <Mic className="h-3.5 w-3.5" />
          </Button>

          <textarea
            ref={textareaRef}
            placeholder={isTest ? "Simular mensagem do lead..." : "Digite sua mensagem..."}
            value={message}
            onChange={handleChange}
            className={cn(
              "flex-1 text-xs rounded-lg px-3 py-2 border min-h-[36px] max-h-[120px] resize-none overflow-y-auto",
              "bg-background ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              isTest
                ? "bg-primary/10 border-primary/30 placeholder:text-primary/50"
                : "bg-background border-border"
            )}
            rows={1}
            disabled={disabled || isSending || isSendingMedia}
            onKeyDown={handleKeyDown}
          />
          <Button
            size="icon"
            className={cn(
              "shrink-0 rounded-lg h-9 w-9",
              isTest && "bg-primary hover:bg-primary/90"
            )}
            disabled={disabled || !message.trim() || isSending || isSendingMedia}
            onClick={handleSend}
          >
            {isSending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      )}
    </>
  );
});
