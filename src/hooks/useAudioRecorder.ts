import { useState, useRef, useCallback, useEffect } from "react";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - opus-media-recorder nao tem tipos
import OpusMediaRecorder from "opus-media-recorder";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - importar como URL para Vite
import encoderWorkerPath from "opus-media-recorder/encoderWorker.umd.js?url";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - importar como URL para Vite
import oggOpusWasmPath from "opus-media-recorder/OggOpusEncoder.wasm?url";

interface UseAudioRecorderOptions {
  maxDuration?: number; // limite em segundos (padrão: 300 = 5 min)
  onMaxDurationReached?: () => void;
}

interface UseAudioRecorderReturn {
  isRecording: boolean;
  isPaused: boolean;
  duration: number; // segundos
  audioBlob: Blob | null;
  audioUrl: string | null; // para preview
  error: string | null;
  volumeLevel: number; // 0-100 para indicador visual

  startRecording: () => Promise<void>;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  resetRecording: () => void;
}

export function useAudioRecorder(
  options: UseAudioRecorderOptions = {}
): UseAudioRecorderReturn {
  const { maxDuration = 300, onMaxDurationReached } = options;

  // Estados
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [volumeLevel, setVolumeLevel] = useState(0);

  // Refs para recursos que precisam de cleanup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mediaRecorderRef = useRef<any>(null); // OpusMediaRecorder ou MediaRecorder
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const volumeAnimationRef = useRef<number | null>(null);
  const isStoppedRef = useRef(false); // Flag para controlar o timer
  const isRecordingRef = useRef(false); // Ref para uso no animation frame
  const isPausedRef = useRef(false); // Ref para uso no animation frame
  const durationRef = useRef(0); // Ref para duracao (usado no onstop)

  // Função para calcular volume (usa refs para evitar closure stale)
  const updateVolumeLevel = useCallback(() => {
    if (!analyserRef.current || !isRecordingRef.current || isPausedRef.current) {
      return;
    }

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Calcular média do volume
    const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    const normalized = Math.min(100, Math.round((average / 128) * 100));
    setVolumeLevel(normalized);

    volumeAnimationRef.current = requestAnimationFrame(updateVolumeLevel);
  }, []);

  // Iniciar gravação
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setAudioBlob(null);
      setAudioUrl(null);
      chunksRef.current = [];

      // Solicitar permissão do microfone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Configurar AudioContext para análise de volume
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      // IMPORTANTE: Garantir que AudioContext esta ativo (Chrome suspende por padrao)
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      sourceRef.current = source;

      // Configurar MediaRecorder com OGG Opus via opus-media-recorder
      // Isso gera audio/ogg real que o WhatsApp reconhece como mensagem de voz
      const workerOptions = {
        encoderWorkerFactory: () => new Worker(encoderWorkerPath),
        OggOpusEncoderWasmPath: oggOpusWasmPath,
      };

      const mimeType = "audio/ogg; codecs=opus";
      const mediaRecorder = new OpusMediaRecorder(stream, { mimeType }, workerOptions);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        // OGG Opus tem metadados de duracao nativos, nao precisa de fix
        const blob = new Blob(chunksRef.current, { type: "audio/ogg; codecs=opus" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
      };

      mediaRecorder.start(100); // Coletar dados a cada 100ms
      setIsRecording(true);
      isRecordingRef.current = true;
      setIsPaused(false);
      isPausedRef.current = false;
      setDuration(0);
      durationRef.current = 0; // Reset ref
      isStoppedRef.current = false; // Reset flag

      // Iniciar timer
      timerRef.current = window.setInterval(() => {
        // Verificar flag antes de atualizar
        if (isStoppedRef.current) {
          if (timerRef.current) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return;
        }

        setDuration((prev) => {
          const newDuration = prev + 1;
          durationRef.current = newDuration; // Manter ref sincronizado
          if (newDuration >= maxDuration) {
            // Limite atingido
            isStoppedRef.current = true;
            if (mediaRecorderRef.current?.state === "recording") {
              mediaRecorderRef.current.stop();
              setIsRecording(false);
              onMaxDurationReached?.();
            }
            if (timerRef.current) {
              window.clearInterval(timerRef.current);
              timerRef.current = null;
            }
          }
          return newDuration;
        });
      }, 1000);

      // Iniciar análise de volume
      volumeAnimationRef.current = requestAnimationFrame(updateVolumeLevel);
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === "NotAllowedError") {
          setError(
            "Permissao de microfone negada. Habilite nas configuracoes do navegador."
          );
        } else if (err.name === "NotFoundError") {
          setError("Nenhum microfone encontrado.");
        } else {
          setError(`Erro ao iniciar gravacao: ${err.message}`);
        }
      }
    }
  }, [maxDuration, onMaxDurationReached, updateVolumeLevel]);

  // Parar gravação
  const stopRecording = useCallback(() => {
    // Setar flag PRIMEIRO para garantir que timer pare
    isStoppedRef.current = true;

    // Parar timer
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Parar análise de volume
    if (volumeAnimationRef.current) {
      cancelAnimationFrame(volumeAnimationRef.current);
      volumeAnimationRef.current = null;
    }

    // Parar MediaRecorder
    if (mediaRecorderRef.current?.state !== "inactive") {
      mediaRecorderRef.current?.stop();
    }

    setIsRecording(false);
    isRecordingRef.current = false;
    setIsPaused(false);
    isPausedRef.current = false;
    setVolumeLevel(0);

    // Limpar recursos de áudio
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current?.state !== "closed") {
      audioContextRef.current?.close();
      audioContextRef.current = null;
    }
  }, []);

  // Pausar gravação
  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      isPausedRef.current = true;

      // Pausar timer
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }

      // Pausar análise de volume
      if (volumeAnimationRef.current) {
        cancelAnimationFrame(volumeAnimationRef.current);
        volumeAnimationRef.current = null;
      }
      setVolumeLevel(0);
    }
  }, []);

  // Resumir gravação
  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      isPausedRef.current = false;
      isStoppedRef.current = false; // Reset flag ao resumir

      // Reiniciar timer
      timerRef.current = window.setInterval(() => {
        if (isStoppedRef.current) {
          if (timerRef.current) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return;
        }

        setDuration((prev) => {
          const newDuration = prev + 1;
          durationRef.current = newDuration; // Manter ref sincronizado
          if (newDuration >= maxDuration) {
            isStoppedRef.current = true;
            if (mediaRecorderRef.current?.state === "recording") {
              mediaRecorderRef.current.stop();
              setIsRecording(false);
              onMaxDurationReached?.();
            }
            if (timerRef.current) {
              window.clearInterval(timerRef.current);
              timerRef.current = null;
            }
          }
          return newDuration;
        });
      }, 1000);

      // Reiniciar análise de volume
      volumeAnimationRef.current = requestAnimationFrame(updateVolumeLevel);
    }
  }, [maxDuration, onMaxDurationReached, updateVolumeLevel]);

  // Resetar gravação
  const resetRecording = useCallback(() => {
    stopRecording();
    setDuration(0);
    setAudioBlob(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(null);
    setError(null);
    chunksRef.current = [];
  }, [audioUrl, stopRecording]);

  // Cleanup no unmount
  useEffect(() => {
    return () => {
      isStoppedRef.current = true;
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
      if (volumeAnimationRef.current) {
        cancelAnimationFrame(volumeAnimationRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current?.state !== "closed") {
        audioContextRef.current?.close();
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  return {
    isRecording,
    isPaused,
    duration,
    audioBlob,
    audioUrl,
    error,
    volumeLevel,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    resetRecording,
  };
}
