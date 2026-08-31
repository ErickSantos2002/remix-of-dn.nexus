import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Square, Send, X, Play } from 'lucide-react';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { toast } from 'sonner';

interface AudioRecorderProps {
  onSend: (audioBlob: Blob, options: { waveform: boolean; viewOnce: boolean; duration: number }) => void;
  onCancel: () => void;
  disabled?: boolean;
}

export function AudioRecorder({ onSend, onCancel, disabled }: AudioRecorderProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animationTick, setAnimationTick] = useState(0);

  const {
    isRecording,
    duration,
    audioBlob,
    audioUrl,
    error,
    volumeLevel,
    startRecording,
    stopRecording,
    resetRecording,
  } = useAudioRecorder({
    maxDuration: 300,
    onMaxDurationReached: () => {
      toast.info("Limite de 5 minutos atingido. Gravacao finalizada.");
    },
  });

  // Animate waves during recording
  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => setAnimationTick(n => n + 1), 100);
    return () => clearInterval(interval);
  }, [isRecording]);

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Generate audio levels array from volumeLevel
  const getAudioLevels = () => {
    // volumeLevel tipicamente varia de 0-50, amplificar para resposta visual
    // Multiplicar por 3 para que volume 30 resulte em ~0.9
    const amplifiedVolume = Math.min(1, (volumeLevel / 100) * 3);

    return Array.from({ length: 16 }, (_, i) => {
      // Onda que se move com o tempo e varia por posicao
      const wave = Math.sin(i * 0.5 + animationTick * 0.3) * 0.25;
      // Altura minima + variacao baseada no volume
      const baseHeight = 0.15 + amplifiedVolume * 0.7;
      const height = baseHeight + wave * amplifiedVolume;
      return Math.max(0.1, Math.min(1, height));
    });
  };

  // Handle send
  const handleSend = () => {
    if (audioBlob) {
      onSend(audioBlob, { waveform: true, viewOnce: false, duration });
      resetRecording();
    }
  };

  // Handle cancel
  const handleCancel = () => {
    resetRecording();
    onCancel();
  };

  // Handle play/pause preview
  const handlePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  // Auto-start recording when component mounts
  useEffect(() => {
    startRecording();
  }, []);

  // Show error if any
  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  const audioLevels = getAudioLevels();

  return (
    <div className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg border border-border">
      {/* Cancel button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-primary"
        onClick={handleCancel}
        disabled={disabled}
      >
        <X className="h-4 w-4" />
      </Button>

      {/* Recording indicator / Audio levels */}
      <div className="flex-1 flex items-center gap-2">
        {isRecording ? (
          <>
            <div className="h-3 w-3 rounded-full bg-destructive animate-pulse" />
            <div className="flex items-center gap-0.5 h-6">
              {audioLevels.map((level, i) => (
                <div
                  key={i}
                  className="w-1 bg-primary rounded-full transition-all duration-75"
                  style={{ height: `${Math.max(4, level * 24)}px` }}
                />
              ))}
            </div>
          </>
        ) : audioBlob && audioUrl ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handlePlayPause}
            >
              {isPlaying ? (
                <Square className="h-3 w-3 fill-current" />
              ) : (
                <Play className="h-3 w-3 fill-current" />
              )}
            </Button>
            <Mic className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Audio gravado</span>
            <audio
              ref={audioRef}
              src={audioUrl}
              onEnded={() => setIsPlaying(false)}
              className="hidden"
            />
          </div>
        ) : null}

        <span className="font-mono text-sm text-muted-foreground ml-auto">
          {formatTime(duration)}
        </span>
      </div>

      {/* Stop / Send button */}
      {isRecording ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive"
          onClick={stopRecording}
          disabled={disabled}
        >
          <Square className="h-4 w-4 fill-current" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-primary"
          onClick={handleSend}
          disabled={disabled || !audioBlob}
        >
          <Send className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
