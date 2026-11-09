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
  const [attempt, setAttempt] = useState(0);
  const [stats, setStats] = useState(emptyStats);
  const [status, setStatus] = useState<"error" | "loading" | "ready">("loading");
  const reviewDirection = stats.directions?.["tr-ru"].due ? "tr-ru" : "ru-tr";
  const newDirection = stats.directions?.["tr-ru"].newAvailable ? "tr-ru" : "ru-tr";

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");

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
  }, [attempt]);

  const metric = (value: number) => status === "ready" ? value : "—";

  return (
    <section className="pageStack">
      <header>
        <p className="eyebrow">Dashboard</p>
        <h1>Главная</h1>
        <p className="lead">
          Личная коллекция для занятий на турецком и русском языках.
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
          <strong>{metric(stats.entries)}</strong>
        </div>
        <div className="metric">
          <span>Карточек</span>
          <strong>{metric(stats.cards)}</strong>
        </div>
        <div className="metric">
          <span>Изучено</span>
          <strong>{metric(stats.reviewed)}</strong>
        </div>
      </div>

      <div className="placeholderGrid" aria-label="Учебная очередь">
        <div className="metric">
          <span>К повторению</span>
          <strong>{metric(stats.queue.due)}</strong>
        </div>
        <div className="metric">
          <span>Новых сегодня</span>
          <strong>{metric(stats.queue.newUsedToday)}</strong>
        </div>
        <div className="metric">
          <span>Ответов сегодня</span>
          <strong>{metric(stats.queue.reviewedToday)}</strong>
        </div>
      </div>

      <div className="studySummary" aria-label="Статистика дня">
        <div>
          <span>Верных ответов</span>
          <strong>{metric(stats.queue.correctToday)}</strong>
        </div>
        <div>
          <span>Точность</span>
          <strong>
            {stats.queue.accuracyToday === null ? "—" : `${stats.queue.accuracyToday}%`}
          </strong>
        </div>
        <div>
          <span>Осталось новых в базе</span>
          <strong>{metric(stats.queue.newTotal)}</strong>
        </div>
      </div>

      {status === "loading" && <p className="statusMessage">Читаем локальную базу…</p>}
      {status === "error" && (
        <div className="serverConnectionForm" role="alert"><p className="statusMessage errorMessage">Не удалось подключиться к серверу. Проверьте, что ПК включён и открыт адрес сервера. Коллекция пока не загружена.</p><button className="secondaryButton" type="button" onClick={() => setAttempt(value => value + 1)}><RotateCcw size={17} />Повторить подключение</button></div>
      )}
    </section>
  );
}
