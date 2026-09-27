"use client";

import { useEffect, useRef } from "react";

type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
};

export function useQrScanner(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
  onDecode: (text: string) => void,
) {
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active || typeof window === "undefined") return;

    let cancelled = false;
    // BarcodeDetector is a browser API not in lib.dom yet (Safari/Chrome only).
    let detector: { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } | null = null;

    if ("BarcodeDetector" in window) {
      try {
        const BarcodeDetector =
          (window as Window & { BarcodeDetector: BarcodeDetectorConstructor })
            .BarcodeDetector;
        detector = new BarcodeDetector({
          formats: ["qr_code"],
        });
      } catch {
        // not supported
      }
    }

    const tick = async () => {
      if (cancelled) return;
      if (!videoRef.current || !detector) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const video = videoRef.current;
      if (video.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      try {
        const barcodes = await detector.detect(video);
        if (barcodes.length > 0 && !cancelled) {
          onDecode(barcodes[0].rawValue);
          return;
        }
      } catch {
        // expected
      }

      if (!cancelled) rafRef.current = requestAnimationFrame(tick);
    };

    if (!navigator.mediaDevices?.getUserMedia) return;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: "environment", width: { ideal: 640 } },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [active, videoRef, onDecode]);
}
