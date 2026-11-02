import { useId, useState } from "react";
import { Modal } from "./Modal";
import { readServerSite, saveServerSite, serverSiteUrl } from "../serverSite";

export function ServerConnection({ route, onClose }: { route: string; onClose: () => void }) {
  const [address, setAddress] = useState(readServerSite);
  const [error, setError] = useState("");
  const hintId = useId();
  return <Modal title="Подключение к серверу на ПК" onClose={onClose} className="serverConnection">
    <form className="serverConnectionForm" onSubmit={event => {
      event.preventDefault();
      try {
        const destination = serverSiteUrl(address, route);
        saveServerSite(address);
        window.location.assign(destination);
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Проверьте адрес сервера."); }
    }}>
      <p className="statusMessage" id={hintId}>На этом сайте доступна свободная тренировка. Личная база и прогресс открываются по адресу запущенного сервера на ПК.</p>
      <label className="statusFilter"><span>Адрес сервера</span><input type="url" required value={address} onChange={event => { setAddress(event.target.value); setError(""); }} placeholder="https://…trycloudflare.com" aria-describedby={hintId} autoComplete="url" /></label>
      <p className="statusMessage">На другом устройстве используйте ссылку сервера в интернете. Адрес localhost работает только на самом ПК. При запросе входа используйте логин и пароль сервера.</p>
      {error && <p className="errorMessage" role="alert">{error}</p>}
      <div className="updateActions"><button type="button" className="secondaryButton" onClick={onClose}>Остаться в свободной тренировке</button><button type="submit" className="primaryButton">Открыть сервер</button></div>
    </form>
  </Modal>;
}
