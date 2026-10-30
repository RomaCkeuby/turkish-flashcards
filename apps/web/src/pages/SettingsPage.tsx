import { useEffect, useState } from "react";

import {
  applyUpdatePackage,
  checkUpdatePackage,
  fetchUpdateStatus,
  rollbackUpdatePackage,
  type UpdateStatus,
} from "../api";

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("ru-RU") : "ещё не выполнялась";
}

export function SettingsPage() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const loadStatus = (signal?: AbortSignal) =>
    fetchUpdateStatus(signal).then((data) => {
      setStatus(data);
      setMessage("");
      return data;
    });

  useEffect(() => {
    const controller = new AbortController();
    loadStatus(controller.signal).catch(() => setMessage("Не удалось прочитать статус обновлений."));
    return () => controller.abort();
  }, []);

  const runAction = async (action: () => Promise<unknown>, successMessage: string) => {
    setIsBusy(true);
    setMessage("");
    try {
      await action();
      await loadStatus();
      setMessage(successMessage);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Операция обновления не выполнена.");
    } finally {
      setIsBusy(false);
    }
  };

  const preview = status?.preview;

  return (
    <section className="pageStack">
      <header>
        <p className="eyebrow">Settings</p>
        <h1>Настройки</h1>
        <p className="lead">
          Коллекция и прогресс хранятся локально. Обновления применяются транзакцией и сохраняют историю карточек.
        </p>
      </header>

      <div className="emptyPanel settingsDetails">
        <div>
          <span>Начальная коллекция</span>
          <strong>250 слов · 500 карточек</strong>
        </div>
        <div>
          <span>Хранилище</span>
          <strong>Локальная SQLite-база</strong>
        </div>
        <div>
          <span>Автопроверка</span>
          <strong>{status?.autoCheckEnabled ? "раз в 7 дней" : "выключена"}</strong>
        </div>
      </div>

      <section className="emptyPanel updatePanel">
        <header>
          <p className="eyebrow">Updates</p>
          <h2>Обновление коллекции</h2>
        </header>

        {status?.packageAvailable ? (
          <>
            <div className="updateMeta">
              <div>
                <span>Пакет</span>
                <strong>{preview?.manifest.version}</strong>
              </div>
              <div>
                <span>Записей</span>
                <strong>{preview?.manifest.recordCount}</strong>
              </div>
              <div>
                <span>SHA-256</span>
                <code>{preview?.manifest.sha256.slice(0, 16)}…</code>
              </div>
            </div>

            <div className="placeholderGrid" aria-label="Предпросмотр обновления">
              <div className="metric">
                <span>Добавлено</span>
                <strong>{preview?.added ?? 0}</strong>
              </div>
              <div className="metric">
                <span>Изменено</span>
                <strong>{preview?.changed ?? 0}</strong>
              </div>
              <div className="metric">
                <span>Отключено</span>
                <strong>{preview?.disabled ?? 0}</strong>
              </div>
            </div>

            <div className="updateMeta">
              <div>
                <span>Источник</span>
                <strong>{preview?.manifest.source.name}</strong>
              </div>
              <div>
                <span>Последняя проверка</span>
                <strong>{formatDate(status?.lastCheckAt ?? null)}</strong>
              </div>
              <div>
                <span>Следующая проверка</span>
                <strong>{formatDate(status?.nextCheckAt ?? null)}</strong>
              </div>
            </div>

            <div className="previewList">
              {preview?.details.changed.length ? (
                <section>
                  <h3>Изменения</h3>
                  {preview.details.changed.map((item) => (
                    <div className="previewItem" key={item.after.turkish}>
                      <strong>{item.after.turkish}</strong>
                      <span>{item.fields.join(", ")}</span>
                      <p>
                        {item.before.russian} → {item.after.russian}
                      </p>
                    </div>
                  ))}
                </section>
              ) : null}
              {preview?.details.added.length ? (
                <section>
                  <h3>Новые слова</h3>
                  {preview.details.added.map((item) => (
                    <div className="previewItem" key={item.turkish}>
                      <strong>{item.turkish}</strong>
                      <span>{item.partOfSpeech}</span>
                      <p>{item.russian}</p>
                    </div>
                  ))}
                </section>
              ) : null}
              {preview?.details.disabled.length ? (
                <section>
                  <h3>Отключение</h3>
                  {preview.details.disabled.map((item) => (
                    <div className="previewItem" key={item.turkish}>
                      <strong>{item.turkish}</strong>
                      <p>{item.russian}</p>
                    </div>
                  ))}
                </section>
              ) : null}
            </div>
          </>
        ) : (
          <p className="statusMessage">Локальный пакет обновления ещё не создан.</p>
        )}

        <div className="updateActions">
          <button
            className="primaryButton"
            disabled={isBusy || !status?.packageAvailable}
            onClick={() => runAction(applyUpdatePackage, "Пакет применён. Прогресс карточек сохранён.")}
            type="button"
          >
            Применить пакет
          </button>
          <button
            className="secondaryButton"
            disabled={isBusy || !status?.canRollback}
            onClick={() => runAction(rollbackUpdatePackage, "Последнее обновление откачено.")}
            type="button"
          >
            Откатить
          </button>
          <button
            className="secondaryButton"
            disabled={isBusy}
            onClick={() => runAction(checkUpdatePackage, "Еженедельная проверка отмечена.")}
            type="button"
          >
            Проверить сейчас
          </button>
        </div>

        {status?.lastUpdate && (
          <p className="statusMessage">
            Последнее применение: {formatDate(status.lastUpdate.appliedAt)} · добавлено{" "}
            {status.lastUpdate.added}, изменено {status.lastUpdate.changed}, отключено{" "}
            {status.lastUpdate.disabled}.
          </p>
        )}
        {message && <p className="statusMessage">{message}</p>}
      </section>
    </section>
  );
}
