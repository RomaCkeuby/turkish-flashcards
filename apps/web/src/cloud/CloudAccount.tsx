import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { cloud } from "./client";
import { clearPersonalStorage } from "./personalStorage";
import { clearPendingMemory, reconcilePendingReview } from "./api";
import { setCloudIdentity } from "./identity";

export function CloudAccount({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<"login" | "signup" | "recover" | "password">("login");
  const identity = useRef<string | null | undefined>(undefined);
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    const { data } = cloud.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      generation.current++;
      const nextId = next?.user.id ?? null;
      setCloudIdentity(nextId);
      // First load may resume the same user's pending request after a network interruption.
      try {
        const previousId = sessionStorage.getItem("turkish-flashcards.cloud.identity");
        if ((identity.current !== undefined && identity.current !== nextId) || (previousId && previousId !== nextId)) { clearPersonalStorage(); clearPendingMemory(); }
        if (nextId) sessionStorage.setItem("turkish-flashcards.cloud.identity", nextId);
        else sessionStorage.removeItem("turkish-flashcards.cloud.identity");
      } catch { /* The app still works when browser storage is unavailable. */ }
      identity.current = nextId;
      if (event === "PASSWORD_RECOVERY") setAction("password");
      setSession(next); setLoading(false);
    });
    // A failed initial session read must not leave the loading view forever.
    const started = generation.current;
    cloud.auth.getSession().then(({ error }) => {
      if (active && error && started === generation.current) { setMessage("Не удалось проверить вход. Обновите страницу."); setLoading(false); }
    }).catch(() => { if (active) { setMessage("Облако недоступно. Проверьте подключение."); setLoading(false); } });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const redirectTo = `${location.origin}${import.meta.env.BASE_URL}auth/callback`;
    try {
      if (action === "password") {
        const { error } = await cloud.auth.updateUser({ password });
        if (error) throw error;
        setAction("login"); setMessage("Пароль обновлён.");
      } else if (action === "recover") {
        const { error } = await cloud.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        setMessage("Если адрес зарегистрирован, на него отправлена ссылка восстановления. Откройте её в этом браузере.");
      } else if (action === "signup") {
        const { error } = await cloud.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        setMessage("Проверьте почту и подтвердите адрес. Во время закрытого пилота регистрация доступна по приглашению.");
      } else {
        const { error } = await cloud.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch { setMessage(action === "login" ? "Не удалось войти. Проверьте email, пароль и подтверждение адреса." : "Не удалось выполнить запрос. Проверьте сеть; в пилоте регистрация может быть закрыта."); }
    finally { setBusy(false); }
  };
  const logout = async () => {
    setBusy(true); setMessage("");
    try {
      const { error } = await cloud.auth.signOut();
      if (error) throw error;
      clearPersonalStorage();
    } catch { setMessage("Не удалось выйти. Проверьте подключение и повторите."); }
    finally { setBusy(false); }
  };
  if (loading) return <p role="status">Проверяем вход…</p>;
  if (session && action !== "password") return <div key={session.user.id}>
    <div className="cloudAccountBar"><span>{session.user.email}</span><button className="textButton" disabled={busy} onClick={() => void logout()}>Выйти</button></div>
    {message && <p role="alert">{message}</p>}<PendingReviewGate>{children}</PendingReviewGate>
  </div>;
  return <section className="pageStack cloudAuth"><h1>{action === "password" ? "Новый пароль" : action === "recover" ? "Восстановление доступа" : action === "signup" ? "Регистрация" : "Вход в аккаунт"}</h1>
    <form className="pageStack" onSubmit={submit}>
      {action !== "password" && <label>Email<input name="email" type="email" required autoComplete="email" disabled={busy} /></label>}
      {action !== "recover" && <label>Пароль<input name="password" type="password" required minLength={action === "login" ? 1 : 12} autoComplete={action === "login" ? "current-password" : "new-password"} disabled={busy} /></label>}
      <button className="primaryButton" disabled={busy}>{busy ? "Подождите…" : action === "login" ? "Войти" : "Продолжить"}</button>
    </form>
    {message && <p role="status">{message}</p>}
    <div className="updateActions">{([['login','Вход'],['signup','Регистрация'],['recover','Забыли пароль?']] as const).filter(([value]) => value !== action).map(([value,label]) =>
      <button className="textButton" key={value} disabled={busy} onClick={() => { setAction(value); setMessage(""); }}>{label}</button>)}</div>
  </section>;
}

function PendingReviewGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setStatus("loading");
    reconcilePendingReview().then(() => { if (active) setStatus("ready"); }).catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, [attempt]);
  if (status === "loading") return <p role="status">Проверяем сохранение последнего ответа…</p>;
  if (status === "error") return <div className="pageStack"><p role="alert">Не удалось подтвердить последний ответ. Проверьте подключение.</p><button className="secondaryButton" onClick={() => setAttempt(value => value + 1)}>Повторить проверку</button></div>;
  return children;
}
