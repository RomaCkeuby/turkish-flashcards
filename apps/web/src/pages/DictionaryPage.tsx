import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Download, Plus, SlidersHorizontal } from "lucide-react";
import { Modal } from "../components/Modal";
import { CardInspector } from "../components/CardInspector";
import { useMediaQuery } from "../components/useMediaQuery";
import { OnlineWordSearch } from "./OnlineWordSearch";

import {
  applyDictionaryImport,
  createEntry,
  fetchEntries,
  fetchEntryFilters,
  prepareDictionaryImport,
  type DictionaryImportPreview,
  type DictionaryEntry,
  type EntryFilterOptions,
} from "../api";

type StatusFilter = "ACTIVE" | "ARCHIVED" | "DISABLED" | "ALL";

const statusFilterOptions: { label: string; value: StatusFilter }[] = [
  { label: "Все", value: "ALL" },
  { label: "Активные", value: "ACTIVE" },
  { label: "Отключённые", value: "DISABLED" },
  { label: "Архив", value: "ARCHIVED" },
];

const statusLabels: Record<DictionaryEntry["status"], string> = {
  ACTIVE: "Активна",
  ARCHIVED: "Архив",
  DISABLED: "Отключена",
};
const pageSize = 20;

export function DictionaryPage() {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  const category = params.get("category") ?? "";
  const partOfSpeech = params.get("partOfSpeech") ?? "";
  const tag = params.get("tag") ?? "";
  const statusParam = params.get("status") as StatusFilter | null;
  const statusFilter = statusFilterOptions.some(option => option.value === statusParam) ? statusParam! : "ALL";
  const rawPage = Number(params.get("page"));
  const page = Number.isInteger(rawPage) && rawPage >= 0 ? Math.min(rawPage, 500) : 0;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const isWide = useMediaQuery("(min-width: 1100px)");
  const [createMessage, setCreateMessage] = useState("");
  const [filterOptions, setFilterOptions] = useState<EntryFilterOptions>({
    categories: [],
    partsOfSpeech: [],
    tags: [],
  });
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [importLimit, setImportLimit] = useState(50);
  const [importMessage, setImportMessage] = useState("");
  const [importPreview, setImportPreview] = useState<DictionaryImportPreview | null>(null);
  const [importQuery, setImportQuery] = useState("");
  const [isImportBusy, setIsImportBusy] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [status, setStatus] = useState<"error" | "loading" | "ready">("loading");
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchEntryFilters(controller.signal)
      .then(setFilterOptions)
      .catch(() => {
        setFilterOptions({ categories: [], partsOfSpeech: [], tags: [] });
      });

    return () => controller.abort();
  }, [refreshTick]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setStatus("loading");
      fetchEntries(
        search,
        {
          category: category || undefined,
          limit: pageSize,
          offset: page * pageSize,
          partOfSpeech: partOfSpeech || undefined,
          status: statusFilter === "ALL" ? undefined : statusFilter,
          tag: tag || undefined,
        },
        controller.signal,
      )
        .then((data) => {
          setEntries(data.entries);
          setTotal(data.total);
          setStatus("ready");
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name !== "AbortError") {
            setStatus("error");
          }
        });
    }, 150);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [category, page, partOfSpeech, refreshTick, search, statusFilter, tag]);

  const updateParam = (key: string, value: string) => {
    setSelectedId(null);
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== "page") next.delete("page");
      return next;
    }, { replace: true });
  };
  const setSearch = (value: string) => updateParam("search", value);
  const setCategory = (value: string) => updateParam("category", value);
  const setPartOfSpeech = (value: string) => updateParam("partOfSpeech", value);
  const setTag = (value: string) => updateParam("tag", value);
  const setStatusFilter = (value: string) => updateParam("status", value === "ALL" ? "" : value);
  const setPage = (value: number | ((current: number) => number)) => {
    const next = typeof value === "function" ? value(page) : value;
    updateParam("page", next ? String(next) : "");
  };
  const selectedEntry = entries.find(entry => entry.id === selectedId) ?? (isWide ? entries[0] : undefined);
  const filterCount = [category, partOfSpeech, tag, statusFilter === "ALL" ? "" : statusFilter].filter(Boolean).length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const addEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setIsCreating(true);
    setCreateMessage("");
    try {
      const detail = await createEntry({
        category: String(form.get("category") ?? ""),
        exampleRussian: String(form.get("exampleRussian") ?? ""),
        exampleTurkish: String(form.get("exampleTurkish") ?? ""),
        partOfSpeech: String(form.get("partOfSpeech") ?? ""),
        russian: String(form.get("russian") ?? ""),
        tags: String(form.get("tags") ?? "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        turkish: String(form.get("turkish") ?? ""),
      });
      setIsCreateOpen(false);
      navigate(`/card/${detail.effective.id}`);
    } catch {
      setCreateMessage("Не удалось добавить карточку.");
    } finally {
      setIsCreating(false);
    }
  };

  const previewImport = async () => {
    setIsImportBusy(true);
    setImportPreview(null);
    setImportMessage("");
    try {
      const data = await prepareDictionaryImport({
        limit: importLimit,
        query: importQuery.trim() || undefined,
      });
      setImportPreview(data);
      setImportMessage(
        data.preview.added > 0
          ? `Подготовлено новых слов: ${data.preview.added}.`
          : "Подходящих новых слов по этому запросу не найдено.",
      );
    } catch {
      setImportMessage("Не удалось подготовить импорт слов.");
    } finally {
      setIsImportBusy(false);
    }
  };

  const applyImport = async () => {
    setIsImportBusy(true);
    setImportMessage("");
    try {
      const preview = await applyDictionaryImport();
      setImportPreview(null);
      setIsImportOpen(false);
      setPage(0);
      setRefreshTick((value) => value + 1);
      setImportMessage(`Добавлено слов: ${preview.added}. Пользовательские правки сохранены.`);
    } catch {
      setImportMessage("Не удалось применить импорт слов.");
    } finally {
      setIsImportBusy(false);
    }
  };

  return (
    <section className="pageStack dictionaryPage">
      <header className="pageHeading">
        <h1>Словарь</h1>
        <span className="pageSubtitle">{status === "ready" ? `${total} слов` : "Личная коллекция"}</span>
      </header>

      <div className="dictionaryToolbar">
        <label className="searchField">
          <input
            aria-label="Поиск"
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder="Турецкое или русское слово"
            type="search"
            value={search}
          />
        </label>
        <details className="filterDisclosure dictionaryFilters">
          <summary><SlidersHorizontal size={17} />Фильтры{filterCount > 0 && <span className="filterCount">{filterCount}</span>}</summary>
          <div className="filterFields">
        <label className="statusFilter">
          <span>Статус</span>
          <select
            onChange={(event) => {
              setStatusFilter(event.target.value as StatusFilter);
            }}
            value={statusFilter}
          >
            {statusFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="statusFilter">
          <span>Категория</span>
          <select
            onChange={(event) => {
              setCategory(event.target.value);
            }}
            value={category}
          >
            <option value="">Все</option>
            {filterOptions.categories.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="statusFilter">
          <span>Часть речи</span>
          <select
            onChange={(event) => {
              setPartOfSpeech(event.target.value);
            }}
            value={partOfSpeech}
          >
            <option value="">Все</option>
            {filterOptions.partsOfSpeech.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="statusFilter">
          <span>Тег</span>
          <select
            onChange={(event) => {
              setTag(event.target.value);
            }}
            value={tag}
          >
            <option value="">Все</option>
            {filterOptions.tags.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
          {filterCount > 0 && <button className="textButton" type="button" onClick={() => { setSelectedId(null); setParams(search ? { search } : {}, { replace: true }); }}>Сбросить фильтры</button>}
          </div>
        </details>
        <button className="primaryButton toolbarAction" aria-label="Добавить слово" title="Добавить слово" onClick={() => setIsCreateOpen(true)} type="button">
          <Plus size={19} /><span className="buttonText">Добавить слово</span>
        </button>
        <button
          className="secondaryButton toolbarAction"
          aria-label="Добавить слова из локальной подборки"
          title="Добавить слова из локальной подборки"
          onClick={() => {
            setImportMessage("");
            setImportPreview(null);
            setImportQuery(search);
            setIsImportOpen(true);
          }}
          type="button"
        >
          <Download size={18} /><span className="buttonText">Из подборки</span>
        </button>
      </div>

      {importMessage && !isImportOpen && <p className="statusMessage">{importMessage}</p>}

      {isCreateOpen && (
        <Modal title="Добавить слово" busy={isCreating} onClose={() => setIsCreateOpen(false)}>
            <form className="quickCreateForm" onSubmit={addEntry}>
              <div className="quickCreateGrid">
                <label>
                  <span>Турецкое слово</span>
                  <input name="turkish" required />
                </label>
                <label>
                  <span>Русский перевод</span>
                  <input name="russian" required />
                </label>
                <label>
                  <span>Часть речи</span>
                  <input defaultValue="слово" name="partOfSpeech" />
                </label>
                <label>
                  <span>Категория</span>
                  <input defaultValue="Пользовательские" name="category" />
                </label>
                <label>
                  <span>Теги</span>
                  <input name="tags" placeholder="A1, работа, любимое" />
                </label>
                <label>
                  <span>Пример</span>
                  <input name="exampleTurkish" />
                </label>
                <label className="wideField">
                  <span>Перевод примера</span>
                  <input name="exampleRussian" />
                </label>
              </div>
              <button className="primaryButton" disabled={isCreating} type="submit">
                Добавить
              </button>
              {createMessage && <p className="statusMessage errorMessage">{createMessage}</p>}
            </form>
        </Modal>
      )}

      {isImportOpen && (
        <Modal title="Добавить из локальной подборки" busy={isImportBusy} onClose={() => setIsImportOpen(false)} className="importWordsPanel">
            <p className="statusMessage">Готовые слова из сохранённой подборки Kaikki и Tatoeba. Подключение к интернету не требуется.</p>

            <div className="quickCreateForm">
              <div className="quickCreateGrid">
                <label>
                  <span>Количество</span>
                  <select
                    disabled={isImportBusy}
                    onChange={(event) => { setImportLimit(Number(event.target.value)); setImportPreview(null); setImportMessage(""); }}
                    value={importLimit}
                  >
                    {[50, 100, 250, 500].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="wideField">
                  <span>Запрос</span>
                  <input
                    disabled={isImportBusy}
                    onChange={(event) => { setImportQuery(event.target.value); setImportPreview(null); setImportMessage(""); }}
                    placeholder="например: работа, ev, глагол"
                    value={importQuery}
                  />
                </label>
              </div>

              <div className="updateActions">
                <button className="secondaryButton" disabled={isImportBusy} onClick={previewImport} type="button">
                  Предпросмотр
                </button>
                <button
                  className="primaryButton"
                  disabled={isImportBusy || !importPreview || importPreview.preview.added === 0}
                  onClick={applyImport}
                  type="button"
                >
                  Применить
                </button>
              </div>

              {importPreview && (
                <>
                  <div className="placeholderGrid" aria-label="Предпросмотр импорта слов">
                    <div className="metric">
                      <span>Добавится</span>
                      <strong>{importPreview.preview.added}</strong>
                    </div>
                    <div className="metric">
                      <span>Изменится</span>
                      <strong>{importPreview.preview.changed}</strong>
                    </div>
                    <div className="metric">
                      <span>Отключится</span>
                      <strong>{importPreview.preview.disabled}</strong>
                    </div>
                  </div>

                  <div className="previewList compactPreviewList">
                    {importPreview.preview.details.added.slice(0, 12).map((item) => (
                      <div className="previewItem" key={item.turkish}>
                        <strong>{item.turkish}</strong>
                        <span>{item.partOfSpeech}</span>
                        <p>{item.russian}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {importMessage && <p className="statusMessage">{importMessage}</p>}
            </div>
        </Modal>
      )}

      {status === "loading" && <p className="statusMessage">Загружаем словарь…</p>}
      {status === "error" && (
        <p className="statusMessage errorMessage">Не удалось прочитать локальную базу.</p>
      )}
      {status === "ready" && entries.length === 0 && (
        <div>
          <p>В личной коллекции по этому запросу ничего не найдено.</p>
          {search.trim().length >= 2 && search.trim().length <= 100 && (
            <OnlineWordSearch key={search.trim()} query={search.trim()} />
          )}
        </div>
      )}
      {entries.length > 0 && (
        <div className="dictionaryWorkspace">
        <div className="dictionaryList">
          <div className="dictionaryTableWrap">
            <table className="dictionaryTable">
              <thead>
                <tr>
                  <th>Турецкий</th>
                  <th>Русский</th>
                  <th className="desktopColumn">Категория</th>
                  <th className="desktopColumn">Статус</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className={selectedEntry?.id === entry.id ? "selectedRow" : ""}>
                    <td>
                      <button className="wordButton" type="button" aria-pressed={selectedEntry?.id === entry.id} onClick={() => setSelectedId(entry.id)}>{entry.turkish}</button>
                      <span>{entry.partOfSpeech}</span>
                    </td>
                    <td>{entry.russian}</td>
                    <td className="desktopColumn">{entry.category}</td>
                    <td className="desktopColumn">
                      <span className={`statusPill status${entry.status}`}>{statusLabels[entry.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="paginationBar" aria-label="Страницы словаря">
            <button
              className="secondaryButton"
              disabled={page === 0 || status === "loading"}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              type="button"
            >
              ‹ Назад
            </button>
            <span>
              Страница {page + 1} из {totalPages}
            </span>
            <button
              className="secondaryButton"
              disabled={page + 1 >= totalPages || status === "loading"}
              onClick={() => setPage((current) => current + 1)}
              type="button"
            >
              Вперёд ›
            </button>
          </div>
        </div>
        {isWide && selectedEntry && <aside className="cardInspector" aria-label="Просмотр карточки"><CardInspector entryId={selectedEntry.id} /></aside>}
        </div>
      )}
      {!isWide && selectedEntry && <Modal title="Карточка" className="inspectorModal" onClose={() => setSelectedId(null)}><CardInspector entryId={selectedEntry.id} /></Modal>}
    </section>
  );
}
