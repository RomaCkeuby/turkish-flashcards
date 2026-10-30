import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="pageStack">
      <header>
        <p className="eyebrow">404</p>
        <h1>Страница не найдена</h1>
        <p className="lead">Такого маршрута в приложении пока нет.</p>
      </header>

      <Link className="primaryLink" to="/">
        Вернуться на главную
      </Link>
    </section>
  );
}
