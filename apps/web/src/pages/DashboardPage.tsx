import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, RotateCcw } from "lucide-react";

import { fetchStats, type Stats } from "../api";

const emptyStats: Stats = {
  cards: 0,
  entries: 0,
  queue: {
    accuracyToday: null,
    correctToday: 0,
    due: 0,
    isDoneToday: false,
    newAvailable: 0,
    newTotal: 0,
    newUsedToday: 0,
    reviewedToday: 0,
  },
  reviewed: 0,
};

export function DashboardPage() {
  const [stats, setStats] = useState(emptyStats);
  const [status, setStatus] = useState<"error" | "loading" | "ready">("loading");
  const reviewDirection = stats.directions?.["tr-ru"].due ? "tr-ru" : "ru-tr";
  const newDirection = stats.directions?.["tr-ru"].newAvailable ? "tr-ru" : "ru-tr";

  useEffect(() => {
    const controller = new AbortController();

    fetchStats(controller.signal)
      .then((data) => {
        setStats(data);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name !== "AbortError") {
          setStatus("error");
        }
      });

    return () => controller.abort();
  }, []);

  return (
    <section className="pageStack">
      <header>
        <p className="eyebrow">Dashboard</p>
        <h1>Главная</h1>
        <p className="lead">
          Локальная коллекция готова к занятиям на турецком и русском языках.
        </p>
      </header>

      {status === "ready" && <section className="nextLesson" aria-label="Следующее занятие">
        <div>
          <h2>{stats.queue.due > 0 ? "Пора повторить слова" : stats.queue.newAvailable > 0 ? "Время для новых слов" : "Всё повторено"}</h2>
          <p>{stats.queue.due > 0
            ? `Сейчас к повторению: ${stats.queue.due}. Начните с них, чтобы закрепить изученное.`
            : stats.queue.newAvailable > 0 ? "Повторений пока нет. Можно пополнить запас турецких слов."
            : "Повторения появятся, когда подойдёт их время. А пока можно добавить слова в словарь."}</p>
        </div>
        <div className="lessonActions">
          {stats.queue.due > 0 && <Link className="primaryLink" to={`/study?mode=review&direction=${reviewDirection}`}><RotateCcw size={18} />Начать повторение<ArrowRight size={18} /></Link>}
          {stats.queue.newAvailable > 0 && <Link className={stats.queue.due > 0 ? "secondaryButton" : "primaryLink"} to={`/study?mode=new&direction=${newDirection}`}><BookOpen size={18} />Учить новые</Link>}
          {stats.queue.due === 0 && stats.queue.newAvailable === 0 && <Link className="primaryLink" to="/dictionary">Открыть словарь<ArrowRight size={18} /></Link>}
        </div>
      </section>}

      <div className="placeholderGrid" aria-label="Показатели коллекции">
        <div className="metric">
          <span>Слов</span>
          <strong>{stats.entries}</strong>
        </div>
        <div className="metric">
          <span>Карточек</span>
          <strong>{stats.cards}</strong>
        </div>
        <div className="metric">
          <span>Изучено</span>
          <strong>{stats.reviewed}</strong>
        </div>
      </div>

      <div className="placeholderGrid" aria-label="Учебная очередь">
        <div className="metric">
          <span>К повторению</span>
          <strong>{stats.queue.due}</strong>
        </div>
        <div className="metric">
          <span>Новых сегодня</span>
          <strong>{stats.queue.newUsedToday}</strong>
        </div>
        <div className="metric">
          <span>Ответов сегодня</span>
          <strong>{stats.queue.reviewedToday}</strong>
        </div>
      </div>

      <div className="studySummary" aria-label="Статистика дня">
        <div>
          <span>Верных ответов</span>
          <strong>{stats.queue.correctToday}</strong>
        </div>
        <div>
          <span>Точность</span>
          <strong>
            {stats.queue.accuracyToday === null ? "—" : `${stats.queue.accuracyToday}%`}
          </strong>
        </div>
        <div>
          <span>Осталось новых в базе</span>
          <strong>{stats.queue.newTotal}</strong>
        </div>
      </div>

      {status === "loading" && <p className="statusMessage">Читаем локальную базу…</p>}
      {status === "error" && (
        <p className="statusMessage errorMessage">
          Сервер базы данных недоступен. Запустите приложение командой pnpm dev.
        </p>
      )}
    </section>
  );
}
