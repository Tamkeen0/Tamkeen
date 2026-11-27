import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { UiError } from './errors';
import type { ScanImage } from './scanPdf';

const MAX_IMAGE_EDGE = 2200;
const JPEG_QUALITY = 0.86;
const THUMBNAIL_EDGE = 160;
type CameraPhase = 'idle' | 'opening' | 'live';
export type CapturedImage = ScanImage & { thumbnail?: Blob };

function releaseTracks(stream: MediaStream) {
  stream.getTracks().forEach(track => track.stop());
}

function cameraError(error: unknown) {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Camera access was denied. Allow access in your browser settings, or upload a PDF.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'No available camera was found. Connect a camera, or upload a PDF.';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'The camera could not start. Close other apps using it and try again, or upload a PDF.';
    default:
      return 'The camera could not start. Try again, or upload a PDF.';
  }
}

async function makeThumbnail(source: HTMLCanvasElement) {
  const thumbnail = document.createElement('canvas');
  const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(source.width, source.height));
  thumbnail.width = Math.max(1, Math.round(source.width * scale));
  thumbnail.height = Math.max(1, Math.round(source.height * scale));
  try {
    const context = thumbnail.getContext('2d', { alpha: false });
    if (!context) return;
    context.drawImage(source, 0, 0, thumbnail.width, thumbnail.height);
    return await new Promise<Blob | undefined>(resolve => thumbnail.toBlob(blob => resolve(blob ?? undefined), 'image/jpeg', .74));
  } catch {
    return undefined;
  } finally {
    thumbnail.width = 0;
    thumbnail.height = 0;
  }
}

async function captureJpeg(video: HTMLVideoElement): Promise<CapturedImage> {
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error();
    context.drawImage(video, 0, 0, width, height);
    const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!jpeg?.size || jpeg.type !== 'image/jpeg') throw new Error();
    return { jpeg, width, height, thumbnail: await makeThumbnail(canvas) };
  } catch {
    throw new UiError('The photo could not be captured. Try again, or upload a PDF.');
  } finally {
    // Release the full-resolution pixel buffer as soon as encoding finishes.
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function useExamCamera(visible: boolean) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const requestId = useRef(0);
  const [phase, setPhase] = useState<CameraPhase>('idle');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();

  const release = useCallback(() => {
    // A permission prompt may resolve after closing the scanner.
    requestId.current += 1;
    if (stream.current) {
      releaseTracks(stream.current);
      stream.current = null;
    }
    if (video.current?.srcObject) video.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    release();
    setPhase('idle');
    setReady(false);
  }, [release]);

  const start = useCallback(async () => {
    stop();
    setError(undefined);
    if (!window.isSecureContext) {
      setError('Camera access requires HTTPS or localhost. You can still upload a PDF.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not support camera access. Use the PDF upload instead.');
      return;
    }

    const id = requestId.current;
    setPhase('opening');
    try {
      const opened = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      });
      const player = video.current;
      if (id !== requestId.current || !player) {
        releaseTracks(opened);
        return;
      }
      if (!opened.getVideoTracks().some(track => track.readyState === 'live')) {
        releaseTracks(opened);
        throw new DOMException('Camera unavailable', 'NotFoundError');
      }

      stream.current = opened;
      opened.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
        if (id !== requestId.current) return;
        stop();
        setError('The camera disconnected. Open it again, or upload a PDF.');
      }, { once: true }));
      player.srcObject = opened;
      await player.play();
      if (id === requestId.current) {
        setPhase('live');
        setReady(player.readyState >= 2 && Boolean(player.videoWidth && player.videoHeight));
      }
    } catch (failure) {
      if (id !== requestId.current) return;
      stop();
      setError(cameraError(failure));
    }
  }, [stop]);

  useLayoutEffect(() => {
    if (!visible) stop();
  }, [visible, stop]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) stop();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', stop);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', stop);
      release();
    };
  }, [release, stop]);

  async function capture() {
    const player = video.current;
    if (!player || player.readyState < 2 || !player.videoWidth || !player.videoHeight) {
      throw new UiError('The camera is still getting ready. Wait for the preview and try again.');
    }
    const id = requestId.current;
    const image = await captureJpeg(player);
    if (id !== requestId.current) return;
    stop();
    return image;
  }

  function markReady() {
    const player = video.current;
    if (stream.current && player && player.readyState >= 2 && player.videoWidth && player.videoHeight) setReady(true);
  }

  return { video, phase, ready, error, start, stop, capture, markReady };
}
