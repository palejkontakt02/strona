import { pickMime } from './VideoRecorder';

/**
 * Za duży film z galerii przekodowany w telefonie do limitu pliku w możliwie wysokiej jakości:
 * odtwarzanie do płótna (do 1080p) i ponowny zapis z bitrate dobranym do długości.
 * Trwa mniej więcej tyle, ile film. Zwraca null, gdy przeglądarka tego nie umie.
 */
export async function shrinkVideo(file: File, maxBytes: number, onProgress: (p: number) => void): Promise<File | null> {
  if (typeof MediaRecorder === 'undefined' || !('captureStream' in HTMLCanvasElement.prototype)) return null;
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error('nie można odczytać filmu'));
    });
    const dur = video.duration;
    if (!Number.isFinite(dur) || dur <= 0) return null;
    // budżet bitów na sekundę (zapas 8% na kontener i dźwięk), maks. 12 Mb/s
    const vbr = Math.min(12_000_000, Math.floor((maxBytes * 8 * 0.92) / dur) - 128_000);
    if (vbr < 1_200_000) throw new Error(`film jest za długi (${Math.round(dur)} s) — przytnij go do samej serii`);
    const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((video.videoWidth * scale) / 2) * 2;
    canvas.height = Math.round((video.videoHeight * scale) / 2) * 2;
    const g = canvas.getContext('2d')!;
    const stream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(30);
    // dźwięk przez Web Audio (bez wyprowadzania na głośnik)
    let ac: AudioContext | null = null;
    try {
      ac = new AudioContext();
      const dest = ac.createMediaStreamDestination();
      ac.createMediaElementSource(video).connect(dest);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch {
      video.muted = true;
    }
    const mimeType = pickMime();
    const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: vbr, audioBitsPerSecond: 128_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((res) => (rec.onstop = () => res()));
    let raf = 0;
    const draw = () => {
      g.drawImage(video, 0, 0, canvas.width, canvas.height);
      onProgress(Math.min(1, video.currentTime / dur));
      if (!video.ended) raf = requestAnimationFrame(draw);
    };
    rec.start(1000);
    await video.play();
    draw();
    await new Promise<void>((res) => (video.onended = () => res()));
    cancelAnimationFrame(raf);
    rec.stop();
    await done;
    void ac?.close();
    const type = (rec.mimeType || mimeType || 'video/mp4').split(';')[0];
    const blob = new Blob(chunks, { type });
    onProgress(1);
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + (type.includes('webm') ? '.webm' : '.mp4'), { type });
  } finally {
    URL.revokeObjectURL(url);
  }
}
