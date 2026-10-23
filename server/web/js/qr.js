import { h, iconButton } from './ui.js';

// Scanning a QR code in the browser, with the camera and the built-in BarcodeDetector (Chrome on Android,
// ChromeOS, macOS). Elsewhere the button is hidden: the phone's camera app opens invitation links directly.

export const canScan = () => 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

export async function qrScanner(onText) {
  let stream;
  let stopped = false;
  const video = h('video', { playsinline: true, muted: true, autoplay: true });
  const box = h(
    'div',
    { class: 'scanner', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Scanner un QR code' },
    video,
    h('div', { class: 'scanner-frame', 'aria-hidden': 'true' }),
    h('p', {}, 'Vise le QR code d’invitation'),
    iconButton('close', 'Fermer', () => stop()),
  );
  function stop() {
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
    box.remove();
  }
  document.body.append(box);
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    stop();
    return onText('');
  }
  video.srcObject = stream;
  const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
  const tick = async () => {
    if (stopped) return;
    try {
      const [code] = await detector.detect(video);
      if (code?.rawValue) {
        stop();
        return onText(code.rawValue);
      }
    } catch {
      /* frame not ready */
    }
    setTimeout(tick, 250);
  };
  video.addEventListener('loadeddata', tick, { once: true });
}
