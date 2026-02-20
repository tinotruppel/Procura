import { Button } from "@/components/ui/button";
import { AttachedFile } from "@/lib/llm-types";
import { formatFileSize, getFileIcon } from "@/lib/chat/export";
import { Send, X, Square, Paperclip } from "lucide-react";

interface ChatInputProps {
    input: string;
    isLoading: boolean;
    pendingImages: string[];
    pendingFiles: AttachedFile[];
    pendingIntervention: string[];
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    onPaste: (e: React.ClipboardEvent) => void;
    onSend: () => void;
    onStop: () => void;
    onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onRemoveImage: (idx: number) => void;
    onRemoveFile: (idx: number) => void;
}

export function ChatInput({
    input,
    isLoading,
    pendingImages,
    pendingFiles,
    pendingIntervention,
    textareaRef,
    fileInputRef,
    onInputChange,
    onKeyDown,
    onPaste,
    onSend,
    onStop,
    onFileInput,
    onRemoveImage,
    onRemoveFile,
}: ChatInputProps) {
    return (
        <>
            {/* Pending Intervention Indicator */}
            {isLoading && pendingIntervention.length > 0 && (
                <div className="mx-4 mb-2 flex items-center gap-2 text-muted-foreground text-sm">
                    <span className="px-2 py-0.5 bg-primary/20 text-primary text-xs rounded-full">
                        Intervention queued{pendingIntervention.length > 1 ? ` (${pendingIntervention.length})` : ""}
                    </span>
                </div>
            )}

            {/* Input - sticky at bottom */}
            <div className="flex-shrink-0 p-4 border-t bg-background">
                {/* Pending Images Preview */}
                {pendingImages.length > 0 && (
                    <div className="flex gap-2 mb-2 flex-wrap">
                        {pendingImages.map((img, idx) => (
                            <div key={idx} className="relative group">
                                <img
                                    src={img}
                                    alt={`Pending ${idx + 1}`}
                                    className="w-16 h-16 object-cover rounded-md border"
                                />
                                <button
                                    onClick={() => onRemoveImage(idx)}
                                    className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Pending Files Preview */}
                {pendingFiles.length > 0 && (
                    <div className="flex gap-2 mb-2 flex-wrap">
                        {pendingFiles.map((file, idx) => (
                            <div key={idx} className="relative group flex items-center gap-2 bg-secondary/50 rounded-md px-3 py-2 border">
                                <span className="text-lg">{getFileIcon(file.mimeType)}</span>
                                <div className="flex flex-col">
                                    <span className="text-xs font-medium truncate max-w-[120px]" title={file.fileName}>
                                        {file.fileName}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                        {formatFileSize(file.fileSize)}
                                    </span>
                                </div>
                                <button
                                    onClick={() => onRemoveFile(idx)}
                                    className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex gap-2 items-end">
                    {/* Hidden file input for attachment button */}
                    <input
                        type="file"
                        ref={fileInputRef as React.RefObject<HTMLInputElement>}
                        onChange={onFileInput}
                        accept="image/*,application/pdf,.txt,.md,.json,.csv,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.h,.hpp,.go,.rs,.rb,.php,.swift,.kt,.scala,.sh,.bash,.zsh,.yaml,.yml,.toml,.ini,.cfg,.conf,.log,.sql"
                        multiple
                        className="hidden"
                    />
                    {/* Attachment button */}
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        className="h-10 px-3"
                        aria-label="Attach files"
                    >
                        <Paperclip className="h-4 w-4" />
                    </Button>
                    <textarea
                        ref={textareaRef as React.RefObject<HTMLTextAreaElement>}
                        placeholder={isLoading ? "Intervene..." : "Message..."}
                        value={input}
                        onChange={onInputChange}
                        onKeyDown={onKeyDown}
                        onPaste={onPaste}
                        rows={1}
                        className="flex-1 min-h-[40px] max-h-[72px] px-3 py-2 text-sm rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                    />
                    {isLoading ? (
                        <Button onClick={onStop} className="h-10 bg-red-500 hover:bg-red-600 text-white" aria-label="Stop response">
                            <Square className="h-4 w-4" />
                        </Button>
                    ) : (
                        <Button onClick={onSend} disabled={!input.trim() && pendingImages.length === 0 && pendingFiles.length === 0} className="h-10" aria-label="Send message">
                            <Send className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            </div>
        </>
    );
}
