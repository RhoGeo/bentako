/**
 * BarcodeScannerModal — ZXing-powered continuous + single scan modal.
 *
 * Props:
 *   open: boolean
 *   mode: "continuous" | "single"
 *   context: "counter" | "items" | "product_form"
 *   onFound(barcode: string): void
 *   onAddNew(barcode: string): void
 *   onClose(): void
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Keyboard, ScanLine, PackagePlus, RotateCcw, Check, Zap } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { normalizeBarcode } from "@/components/lib/deviceId";
import { toast } from "sonner";

export default function BarcodeScannerModal({
  open,
  mode = "continuous",
  context = "counter",
  onFound,
  onLookup,
  toastOnScan = true,
  onNotFound,
  onAddNew,
  allowAddNew = true,
  onClose,
}) {
  const [manualMode, setManualMode] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [lastScanned, setLastScanned] = useState(null);
  const [notFoundBarcode, setNotFoundBarcode] = useState(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const controlsRef = useRef(null);
  const lastScanTime = useRef(0);
  const manualInputRef = useRef(null);

  const playBeep = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.06, ctx.currentTime);
      o.start();
      o.stop(ctx.currentTime + 0.08);
      setTimeout(() => ctx.close(), 120);
    } catch (_e) {}
  }, []);

  const handleScanResult = useCallback(
    async (barcode) => {
      const now = Date.now();
      const normalized = normalizeBarcode(barcode);
      if (!normalized) return;
      if (now - lastScanTime.current < 800) return; // debounce rapid re-scans
      lastScanTime.current = now;

      setLastScanned(normalized);
      setNotFoundBarcode(null);

      // Lookup gate (lets parent decide found vs not-found)
      if (typeof onLookup === "function") {
        const res = await onLookup(normalized);
        const found = typeof res === "boolean" ? res : !!res?.found;
        const handled = typeof res === "object" ? !!res?.handled : false;
        const label = typeof res === "object" ? res?.label : null;
        if (!found) {
          setNotFoundBarcode(normalized);
          onNotFound?.(normalized);
          return;
        }

        if (navigator.vibrate) navigator.vibrate(40);
        playBeep();
        if (toastOnScan) toast.success(label ? `Added: ${label}` : "Scanned", { duration: 900 });

        if (!handled) {
          await onFound?.(normalized);
        }

        if (mode === "single") {
          setTimeout(() => handleClose(), 300);
        }
        return;
      }

      // Default path
      if (navigator.vibrate) navigator.vibrate(40);
      playBeep();
      if (toastOnScan) toast.success("Scanned", { duration: 900 });
      await onFound?.(normalized);
      if (mode === "single") setTimeout(() => handleClose(), 300);
    },
    [mode, onFound, onLookup, onNotFound, playBeep, toastOnScan]
  );

  const stopScanner = useCallback(() => {
    if (controlsRef.current) {
      controlsRef.current.stop();
      controlsRef.current = null;
    }
    readerRef.current = null;
  }, []);

  const startScanner = useCallback(async () => {
    if (!videoRef.current) return;
    setCameraError(null);

    try {
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      // Prefer back camera
      const device = devices.find(
        (d) => d.label.toLowerCase().includes("back") || d.label.toLowerCase().includes("rear") || d.label.toLowerCase().includes("environment")
      ) || devices[devices.length - 1];

      const deviceId = device?.deviceId || undefined;

      const controls = await reader.decodeFromVideoDevice(
        deviceId,
        videoRef.current,
        async (result, err) => {
          if (result) {
            await handleScanResult(result.getText());
          }
          // Ignore scan errors — they fire every frame when no barcode is in view
        }
      );

      controlsRef.current = controls;

      // Check torch support
      const stream = videoRef.current?.srcObject;
      if (stream) {
        const track = stream.getVideoTracks?.()?.[0];
        const caps = track?.getCapabilities?.();
        if (caps?.torch) setTorchSupported(true);
      }

      setPermissionDenied(false);
    } catch (err) {
      if (err.name === "NotAllowedError" || err.message?.includes("Permission")) {
        setPermissionDenied(true);
      } else {
        setCameraError(err.message);
      }
      setManualMode(true);
    }
  }, [handleScanResult]);

  const toggleTorch = useCallback(async () => {
    if (!videoRef.current?.srcObject) return;
    const track = videoRef.current.srcObject.getVideoTracks?.()?.[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn((v) => !v);
    } catch (_e) {
      // torch not supported
    }
  }, [torchOn]);

  // Start/stop scanner when modal opens/closes
  useEffect(() => {
    if (open && !manualMode) {
      startScanner();
    } else {
      stopScanner();
    }
    return () => stopScanner();
  }, [open, manualMode]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setManualMode(false);
      setManualInput("");
      setLastScanned(null);
      setNotFoundBarcode(null);
      setTorchOn(false);
      setTorchSupported(false);
      setCameraError(null);
      stopScanner();
    }
  }, [open]);

  // Focus manual input when switching to manual mode
  useEffect(() => {
    if (manualMode && open) {
      setTimeout(() => manualInputRef.current?.focus(), 100);
    }
  }, [manualMode, open]);

  const handleManualSubmit = async () => {
    const normalized = normalizeBarcode(manualInput);
    if (!normalized) return;
    setManualInput("");
    await handleScanResult(normalized);
  };

  const handleAddNew = () => {
    const bc = notFoundBarcode;
    setNotFoundBarcode(null);
    onAddNew?.(bc);
  };

  const handleTryAgain = () => {
    setNotFoundBarcode(null);
    if (manualMode) manualInputRef.current?.focus();
  };

  const handleClose = () => {
    stopScanner();
    onClose?.();
  };

  /** Called by parent to signal a barcode was not found — shows the "not found" panel */
  // Parent calls onFound; if it determines not found, it should call this.
  // We expose a method via the notFoundBarcode pattern: parent just calls onFound,
  // and if no product matches, parent sets notFoundBarcode via a prop or we use a callback.
  // For simplicity: parent calls onFound → if no match → calls onNotFound(barcode).
  // We wire this by having Counter.handleScanFound set notFoundBarcode directly via ref.
  // Actually simpler: expose showNotFound from outside:

  if (!open) return null;

  const showCamera = !manualMode && !permissionDenied && !cameraError;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg w-full h-[100dvh] max-h-[100dvh] p-0 m-0 rounded-none flex flex-col bg-black [&>button]:hidden">
        {/* Top Bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-black/80 z-10">
          <Button variant="ghost" size="icon" onClick={handleClose} className="text-white hover:bg-white/20 touch-target">
            <X className="w-6 h-6" />
          </Button>
          <span className="text-white text-sm font-medium">
            {manualMode ? "Manual Entry" : mode === "continuous" ? "Scan Mode (continuous)" : "Scan Barcode"}
          </span>
          <div className="flex gap-1">
            {showCamera && torchSupported && (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTorch}
                className={`touch-target ${torchOn ? "text-amber-400" : "text-white"} hover:bg-white/20`}
              >
                <Zap className="w-5 h-5" />
              </Button>
            )}
          </div>
        </div>

        {/* Main Area */}
        <div className="flex-1 relative flex flex-col items-center justify-center overflow-hidden">
          {/* Camera view */}
          {showCamera && (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
              />
              {/* Scan frame overlay */}
              <div className="relative z-10 w-64 h-48 border-2 border-white/40 rounded-xl pointer-events-none">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-amber-400 rounded-tl-xl" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-amber-400 rounded-tr-xl" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-amber-400 rounded-bl-xl" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-amber-400 rounded-br-xl" />
                <div className="absolute top-1/2 left-2 right-2 h-0.5 bg-amber-400/60 animate-pulse" />
              </div>
              <p className="relative z-10 text-white/80 text-xs mt-4 bg-black/40 px-3 py-1 rounded-full">
                I-point ang camera sa barcode
              </p>
            </>
          )}

          {/* Permission denied */}
          {permissionDenied && (
            <div className="text-center px-8">
              <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4">
                <ScanLine className="w-8 h-8 text-white/60" />
              </div>
              <p className="text-white text-sm mb-2">Walang camera permission.</p>
              <p className="text-white/60 text-xs mb-6">I-on sa settings o manual input muna.</p>
            </div>
          )}

          {/* Camera error */}
          {cameraError && !permissionDenied && (
            <div className="text-center px-8">
              <p className="text-white/60 text-xs mb-2">{cameraError}</p>
            </div>
          )}

          {/* Manual mode */}
          {manualMode && (
            <div className="w-full px-6">
              <div className="bg-white/10 rounded-xl p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Keyboard className="w-5 h-5 text-white/60" />
                  <span className="text-white text-sm">Type barcode manually</span>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); handleManualSubmit(); }}>
                  <Input
                    ref={manualInputRef}
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    placeholder="Enter barcode..."
                    className="bg-white text-stone-900 text-lg h-14 text-center tracking-widest font-mono"
                    autoFocus
                    inputMode="text"
                    autoComplete="off"
                  />
                  <Button
                    type="submit"
                    className="w-full mt-3 h-12 bg-amber-500 hover:bg-amber-600 text-black font-semibold touch-target"
                    disabled={!manualInput.trim()}
                  >
                    <Check className="w-5 h-5 mr-2" /> Submit
                  </Button>
                </form>
              </div>
            </div>
          )}

          {/* Not-found panel (stays in scan flow) */}
          {notFoundBarcode && (
            <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-6 z-20 shadow-2xl">
              <div className="text-center mb-4">
                <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3">
                  <ScanLine className="w-6 h-6 text-amber-600" />
                </div>
                <p className="font-semibold text-stone-800">Barcode not found</p>
                <p className="text-sm text-stone-500 font-mono mt-1">{notFoundBarcode}</p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-12 touch-target" onClick={handleTryAgain}>
                  <RotateCcw className="w-4 h-4 mr-2" /> Try Again
                </Button>
                {onAddNew && allowAddNew && (
                  <Button className="flex-1 h-12 bg-blue-600 hover:bg-blue-700 text-white touch-target" onClick={handleAddNew}>
                    <PackagePlus className="w-4 h-4 mr-2" /> Add New Item
                  </Button>
                )}
              </div>
              {onAddNew && !allowAddNew && (
                <p className="mt-3 text-center text-xs text-stone-500">
                  Ask the Owner/Manager to add this item.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Bottom Bar */}
        <div className="bg-black/80 px-4 py-3 safe-bottom z-10">
          {lastScanned && (
            <div className="flex items-center gap-2 mb-3 bg-emerald-900/40 rounded-lg px-3 py-2">
              <Check className="w-4 h-4 text-emerald-400" />
              <span className="text-emerald-300 text-xs font-mono">{lastScanned}</span>
            </div>
          )}
          <div className="flex gap-3">
            {!manualMode && (
              <Button
                variant="outline"
                className="flex-1 h-12 border-white/30 text-white hover:bg-white/10 touch-target"
                onClick={() => setManualMode(true)}
              >
                <Keyboard className="w-4 h-4 mr-2" /> Manual
              </Button>
            )}
            {manualMode && !permissionDenied && (
              <Button
                variant="outline"
                className="flex-1 h-12 border-white/30 text-white hover:bg-white/10 touch-target"
                onClick={() => setManualMode(false)}
              >
                <ScanLine className="w-4 h-4 mr-2" /> Camera
              </Button>
            )}
            <Button
              className="flex-1 h-12 bg-white text-black hover:bg-stone-100 font-semibold touch-target"
              onClick={handleClose}
            >
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}