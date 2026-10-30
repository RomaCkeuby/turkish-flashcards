import { lazy, Suspense, useEffect } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { BookOpen, House, Layers, Settings } from "lucide-react";

import { DashboardPage } from "./pages/DashboardPage";
import { NotFoundPage } from "./pages/NotFoundPage";
const CardDetailPage = lazy(() => import("./pages/CardDetailPage").then(module => ({ default: module.CardDetailPage })));
const DictionaryPage = lazy(() => import("./pages/DictionaryPage").then(module => ({ default: module.DictionaryPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then(module => ({ default: module.SettingsPage })));
const StudyPage = lazy(() => import("./pages/StudyPage").then(module => ({ default: module.StudyPage })));

const navItems = [
  { to: "/", label: "Главная", icon: House, end: true },
  { to: "/study", label: "Учёба", icon: Layers, end: false },
  { to: "/dictionary", label: "Словарь", icon: BookOpen, end: false },
  { to: "/settings", label: "Настройки", icon: Settings, end: false },
] as const;

export function App() {
  const location = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  return (
    <div className="appShell">
      <aside className="sidebar" aria-label="Основная навигация">
        <div className="brand">
          <span className="brandMark">TR</span>
          <div>
            <p className="brandTitle">Turkish Flashcards</p>
            <p className="brandSubtitle">Личные карточки</p>
          </div>
        </div>

        <nav className="navList">
          {navItems.map((item) => (
            <NavLink
              className={({ isActive }) => (isActive || (item.to === "/dictionary" && location.pathname.startsWith("/card/")) ? "navLink active" : "navLink")}
              end={item.end}
              key={item.to}
              to={item.to}
            >
              <item.icon size={19} aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <p className="sidebarFootnote">Личная коллекция<br />TR / RU</p>
      </aside>

      <main className="content">
        <Suspense fallback={<p className="statusMessage" role="status">Загружаем…</p>}>
        <Routes>
          <Route element={<DashboardPage />} path="/" />
          <Route element={<StudyPage />} path="/study" />
          <Route element={<DictionaryPage />} path="/dictionary" />
          <Route element={<CardDetailPage />} path="/card/:entryId" />
          <Route element={<SettingsPage />} path="/settings" />
          <Route element={<NotFoundPage />} path="*" />
        </Routes>
        </Suspense>
      </main>
    </div>
  );
}
