"use client";
import { CheckCircle2, Info, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { clsx } from "@/lib/format";
import { errMsg } from "@/lib/supabase";

type Tone = "success" | "error" | "info";
interface Toast { id: number; tone: Tone; text: string }

interface ToastApi {
  success: (text: string) => void;
  error: (e: unknown) => void;
  info: (text: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Tone, text: string) => {
    const id = ++seq;
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6500 : 3500);
  }, []);
  const api: ToastApi = {
    success: (t) => push("success", t),
    error: (e) => push("error", errMsg(e)),
    info: (t) => push("info", t),
  };
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-2xl px-4 py-3 text-[15px] shadow-lift animate-fade-up",
              t.tone === "success" && "bg-forest text-white",
              t.tone === "error" && "bg-red-600 text-white",
              t.tone === "info" && "bg-white text-forest",
            )}
            role={t.tone === "error" ? "alert" : "status"}
          >
            {t.tone === "success" && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-gold" />}
            {t.tone === "error" && <XCircle className="mt-0.5 h-5 w-5 shrink-0" />}
            {t.tone === "info" && <Info className="mt-0.5 h-5 w-5 shrink-0 text-leaf" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast outside ToastProvider");
  return c;
}
