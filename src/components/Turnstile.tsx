"use client";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

// Cloudflare Turnstile (renderização explícita). Aparência "interaction-only":
// o widget só aparece quando a Cloudflare precisa de interação, preservando o layout.

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window { turnstile?: TurnstileApi; __turnstileCarregando?: Promise<void> }
}

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function carregar(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  window.__turnstileCarregando ??= new Promise<void>((ok, falha) => {
    const s = document.createElement("script");
    s.src = SRC; s.async = true; s.defer = true;
    s.onload = () => ok(); s.onerror = () => falha(new Error("turnstile"));
    document.head.appendChild(s);
  });
  return window.__turnstileCarregando;
}

export type TurnstileHandle = { reset: () => void };

export default function Turnstile({ siteKey, onToken, onErro, ref }: {
  siteKey: string; onToken: (t: string | null) => void; onErro: () => void; ref?: Ref<TurnstileHandle>;
}) {
  const el = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const cb = useRef({ onToken, onErro });
  cb.current = { onToken, onErro };

  useImperativeHandle(ref, () => ({
    reset: () => { cb.current.onToken(null); if (id.current && window.turnstile) window.turnstile.reset(id.current); },
  }), []);

  useEffect(() => {
    let ativo = true;
    carregar().then(() => {
      if (!ativo || !el.current || !window.turnstile) return;
      id.current = window.turnstile.render(el.current, {
        sitekey: siteKey, theme: "dark", appearance: "interaction-only", language: "pt-br",
        callback: (t: string) => cb.current.onToken(t),
        "expired-callback": () => cb.current.onToken(null),
        "error-callback": () => { cb.current.onToken(null); cb.current.onErro(); },
      });
    }).catch(() => cb.current.onErro());
    return () => { ativo = false; if (id.current && window.turnstile) window.turnstile.remove(id.current); };
  }, [siteKey]);

  return <div ref={el} className="empty:hidden" />;
}
