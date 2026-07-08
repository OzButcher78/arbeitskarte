import { useEffect, useState, useCallback } from 'react';

/**
 * Lightweight detector for whether the current device exposes any video input
 * (built-in webcam, USB cam, tablet rear/front camera). Used to decide whether
 * to render the in-app camera button.
 *
 * - `enumerateDevices()` returns labels only after camera permission is granted
 *   once; we depend only on the count of `videoinput` entries, exposed
 *   regardless of permission state.
 * - `devicechange` fires when a USB cam is plugged in/out.
 */
export function useDeviceCameras() {
  const [hasCamera, setHasCamera] = useState(false);
  const [deviceCount, setDeviceCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setHasCamera(false);
        setDeviceCount(0);
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter((d) => d.kind === 'videoinput');
      setDeviceCount(videos.length);
      setHasCamera(videos.length > 0);
    } catch {
      setHasCamera(false);
      setDeviceCount(0);
    }
  }, []);

  useEffect(() => {
    refresh();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    md.addEventListener('devicechange', refresh);
    return () => md.removeEventListener('devicechange', refresh);
  }, [refresh]);

  return { hasCamera, deviceCount, refresh };
}
