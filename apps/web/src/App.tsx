import { lazy, Suspense, useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, House, Layers, Settings } from "lucide-react";

import { DashboardPage } from "./pages/DashboardPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { initialAppMode, type AppMode } from "./appMode";
import { PublicDeckProvider } from "./publicDeck";
import { TwoPositionSwitch } from "./components/TwoPositionSwitch";
import { StudyStatsHost } from "./components/StudyStats";
import { ServerConnection } from "./components/ServerConnection";
const GuestRoutes = lazy(() => import("./pages/GuestPages").then(module => ({ default: module.GuestRoutes })));
const CardDetailPage = lazy(() => import("./pages/CardDetailPage").then(module => ({ default: module.CardDetailPage })));
const DictionaryPage = lazy(() => import("./pages/DictionaryPage").then(module => ({ default: module.DictionaryPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then(module => ({ default: module.SettingsPage })));
const StudyPage = lazy(() => import("./pages/StudyPage").then(module => ({ default: module.StudyPage })));
const CloudAccount = lazy(() => import("./cloud/CloudAccount").then(module => ({ default: module.CloudAccount })));

const navItems = [
  { to: "/", label: "Главная", icon: House, end: true },
  { to: "/study", label: "Учёба", icon: Layers, end: false },
  { to: "/dictionary", label: "Словарь", icon: BookOpen, end: false },
  { to: "/settings", label: "Настройки", icon: Settings, end: false },
] as const;

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const isStudy = /^\/study\/?$/.test(location.pathname);
  const [serverConnectionOpen, setServerConnectionOpen] = useState(false);
  const [statsHost, setStatsHost] = useState<HTMLDivElement | null>(null);
  const cloudBuild = import.meta.env.VITE_APP_MODE === "cloud";
  const [mode, setMode] = useState<AppMode>(() => initialAppMode(import.meta.env.VITE_STATIC_SITE === "1", import.meta.env.VITE_APP_MODE));
  const switchMode = (next: AppMode) => {
    if (next === "local" && import.meta.env.VITE_STATIC_SITE === "1") { setServerConnectionOpen(true); return; }
    if (next !== mode) { setMode(next); navigate(isStudy ? `${location.pathname}${location.search}` : "/"); }
  };
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  useEffect(() => {
    if (!isStudy) return;
    document.documentElement.classList.add("studyDocument");
    return () => document.documentElement.classList.remove("studyDocument");
  }, [isStudy]);
  return (
    <div className={`appShell${isStudy ? " studyShell" : ""}`}>
      <aside className="sidebar" aria-label="Основная навигация">
        <div className="brand">
          <span className="brandMark">TR</span>
          <div>
            <p className="brandTitle">Turkish Flashcards</p>
            <p className="brandSubtitle">{mode === "guest" ? "Базовая подборка" : "Личные карточки"}</p>
          </div>
        </div>

        <nav className="navList">
          {navItems.map((item) => (
            <NavLink
              className={({ isActive }) => (isActive || (item.to === "/dictionary" && location.pathname.startsWith("/card/")) ? "navLink active" : "navLink")}
              end={item.end}
              key={item.to}
              aria-label={item.label}
              title={item.label}
              to={item.to}
            >
              <item.icon size={19} aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <p className="sidebarFootnote">{mode === "guest" ? "Свободная тренировка" : cloudBuild ? "Облачная коллекция" : "Серверная коллекция"}<br />TR / RU</p>
      </aside>

      <main className="content">
        <div className="appModeBar">
          <TwoPositionSwitch label={cloudBuild ? "Режим приложения: аккаунт" : "Режим приложения: сервер на ПК"} left="Свободная" right={cloudBuild ? "Аккаунт" : "На ПК"} checked={mode !== "guest"} onChange={checked => switchMode(checked ? cloudBuild ? "cloud" : "local" : "guest")} />
          {isStudy ? <div className="studyHeaderStats" ref={setStatsHost} /> : <p>{mode === "guest" ? "Работает без домашнего сервера · без записи в аккаунт" : cloudBuild ? "Облачный пилот · личный прогресс" : "Личная коллекция и прогресс · требуется доступный сервер"}</p>}
        </div>
        <StudyStatsHost.Provider value={statsHost}><Suspense fallback={<p className="statusMessage" role="status">Загружаем…</p>}>
        {mode === "guest" ? <PublicDeckProvider><GuestRoutes /></PublicDeckProvider> : cloudBuild ?
        <CloudAccount><Routes>
          <Route element={<DashboardPage />} path="/" />
          <Route element={<DashboardPage />} path="/auth/callback" />
          <Route element={<StudyPage readOnly />} path="/study" />
          <Route element={<DictionaryPage readOnly />} path="/dictionary" />
          <Route element={<p className="statusMessage">В пилоте доступны занятия и чтение словаря. Редактор и обновления будут подключены перед переносом личной базы.</p>} path="/settings" />
          <Route element={<NotFoundPage />} path="*" />
        </Routes></CloudAccount> :
        <Routes>
          <Route element={<DashboardPage />} path="/" />
          <Route element={<StudyPage />} path="/study" />
          <Route element={<DictionaryPage />} path="/dictionary" />
          <Route element={<CardDetailPage />} path="/card/:entryId" />
          <Route element={<SettingsPage />} path="/settings" />
          <Route element={<NotFoundPage />} path="*" />
        </Routes>
        }
        </Suspense></StudyStatsHost.Provider>
      </main>
      {!cloudBuild && serverConnectionOpen && <ServerConnection route={isStudy ? `${location.pathname}${location.search}` : "/"} onClose={() => setServerConnectionOpen(false)} />}
    </div>
  );
}
