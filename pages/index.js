import { useState, useEffect, useRef } from "react";
import { DEFAULT_TARIFF, calcAtteso, detectZona } from "../lib/tariff";

const APP_PASSWORD = "DeMatteo2026"; // <-- cambia qui la password

const TIPO_OPTIONS = [
  { value: "", label: "—" },
  { value: "ritardo", label: "Ritardo" },
  { value: "annullata", label: "Annullata / rimborsata" },
  { value: "giacenza", label: "Giacenza" },
  { value: "piano_non_eseguita", label: "Piano non eseguita" },
  { value: "piano_non_richiesta", label: "Piano non richiesta da noi" },
];
const tipoLabel = (v) => TIPO_OPTIONS.find((o) => o.value === v)?.label || "—";

const fmt = (n) => (Math.round((n || 0) * 1000) / 1000).toFixed(3).replace(".", ",");
const fmt2 = (n) => (Math.round((n || 0) * 100) / 100).toFixed(2).replace(".", ",");
const fmtKg = (n) => (n === null || n === undefined ? "—" : `${n} kg`);

function isoWeek(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  const target = new Date(d.valueOf());
  const dayNr = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + (firstThursday.getUTCDay() + 6) % 7) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function newRowId() {
  return "r" + Date.now() + Math.random().toString(36).slice(2, 6);
}

export default function Home() {
  const [unlocked, setUnlocked] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState("");

  const [activeTab, setActiveTab] = useState("nuova");
  const [tariff, setTariff] = useState(DEFAULT_TARIFF);
  const [invoices, setInvoices] = useState([]);
  const [resolved, setResolved] = useState({});
  const [loadingApp, setLoadingApp] = useState(true);

  const [fNumero, setFNumero] = useState("");
  const [fData, setFData] = useState("");
  const [draftRows, setDraftRows] = useState([]);
  const [pesoBatch, setPesoBatch] = useState(null); // {done, total, running}
  const [mostraRisolte, setMostraRisolte] = useState(false);
  const [expandedIds, setExpandedIds] = useState({});
  function toggleExpand(id) {
    setExpandedIds((e) => ({ ...e, [id]: !e[id] }));
  }
  const [manualOpenId, setManualOpenId] = useState(null);
  const [manualQuery, setManualQuery] = useState("");
  const verifyStopRef = useRef(false);
  const [unparsedLines, setUnparsedLines] = useState([]);
  const [status, setStatus] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [numeroErr, setNumeroErr] = useState(false);
  const [dataErr, setDataErr] = useState(false);
  const fileInputRef = useRef(null);
  const numeroRef = useRef(null);

  const [manRow, setManRow] = useState({ sped: "", cap: "", zona: "Italia", peso: "", fatturato: "" });

  const [tariffDraft, setTariffDraft] = useState(null);
  const [tariffSaved, setTariffSaved] = useState(false);

  const [emailInvoiceId, setEmailInvoiceId] = useState("__all__");
  const [emailText, setEmailText] = useState("");
  const [emailSubject, setEmailSubject] = useState("");

  const [pesi, setPesi] = useState([]);
  const [pesiSearch, setPesiSearch] = useState("");
  const [pesiEdits, setPesiEdits] = useState({}); // codice||descrizione -> valore in modifica
  const [pesiSavingKey, setPesiSavingKey] = useState(null);
  const [newProd, setNewProd] = useState({ codice: "", descrizione: "", categoria: "", peso: "" });

  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);

  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }

  useEffect(() => {
    if (localStorage.getItem("dm_brt_unlocked") === "yes") setUnlocked(true);
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    (async () => {
      try {
        const [tRes, iRes, rRes, pRes] = await Promise.all([
          fetch("/api/tariffario").then((r) => r.json()),
          fetch("/api/invoices").then((r) => r.json()),
          fetch("/api/resolved").then((r) => r.json()),
          fetch("/api/pesi").then((r) => r.json()),
        ]);
        if (tRes.tariff) { setTariff(tRes.tariff); setTariffDraft(tRes.tariff); }
        if (iRes.invoices) setInvoices(iRes.invoices);
        if (rRes.resolved) setResolved(rRes.resolved);
        if (pRes.listino) setPesi(pRes.listino);
      } catch (e) {
        showToast("Errore nel caricare i dati salvati");
      }
      setLoadingApp(false);
    })();
  }, [unlocked]);

  function tryUnlock() {
    if (pwInput === APP_PASSWORD) {
      localStorage.setItem("dm_brt_unlocked", "yes");
      setUnlocked(true);
    } else {
      setPwError("Password errata, riprova.");
    }
  }

  function calcRow(sped, riferimento, nominativo, cap, peso, fatturato, pianoAmount) {
    const zona = detectZona(cap);
    const atteso = calcAtteso(peso, zona, tariff);
    const diff = (parseFloat(fatturato) || 0) - atteso;
    return {
      id: newRowId(), sped, riferimento: riferimento || "", nominativo: nominativo || "",
      cap, zona, peso: parseFloat(peso) || 0, fatturato: parseFloat(fatturato) || 0,
      atteso, diff, flag: diff >= 0.5, pianoAmount: pianoAmount || null,
      tipo: "", nota: "", pesoReale: null, prodottoListino: null, pesoStato: "idle",
    };
  }

  async function handleFile(file) {
    if (!file) return;
    setDraftRows([]);
    setUnparsedLines([]);
    setReviewing(true);
    setStatus("loading");
    verifyStopRef.current = false;
    try {
      const res = await fetch("/api/parse-invoice", { method: "POST", body: file });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.header) { setFNumero(data.header.numero); setFData(data.header.data); }
      const rows = (data.rows || []).map((r) =>
        calcRow(r.sped, r.riferimento, r.nominativo, r.cap, r.peso, r.fatturato, r.pianoAmount)
      );
      setDraftRows(rows);
      setUnparsedLines(data.unparsed || []);
      setStatus(`ok:${rows.length}:${(data.unparsed || []).length}`);
      verificaTuttiIPesi(rows); // parte da sola in background, non blocca l'interfaccia
    } catch (e) {
      setStatus("error");
    }
  }

  function applyPesoReale(rowId, pesoReale, prodottoListino, manuale, dettaglio) {
    setDraftRows((rows) => rows.map((r) => {
      if (r.id !== rowId) return r;
      const attesoReale = calcAtteso(pesoReale, r.zona, tariff);
      const diffReale = r.fatturato - attesoReale;
      return {
        ...r,
        pesoReale, prodottoListino, pesoManuale: !!manuale, pesoStato: "trovato",
        prodottiDettaglio: dettaglio || null,
        pesoDichiarato: r.pesoDichiarato ?? r.peso,
        attesoDichiarato: r.attesoDichiarato ?? r.atteso,
        atteso: attesoReale, diff: diffReale, flag: diffReale >= 0.5,
      };
    }));
  }

  async function verificaPeso(rowId, nominativo) {
    setDraftRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, pesoStato: "loading" } : r)));
    if (!nominativo) {
      setDraftRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, pesoStato: "nontrovato" } : r)));
      return;
    }
    try {
      const res = await fetch("/api/woo/find-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nominativo, dataSpedizione: fData }),
      });
      const data = await res.json();
      const ordine = (data.risultati || [])[0];
      const prodotti = ordine ? ordine.prodotti.filter((p) => p.pesoTrovato) : [];
      if (!prodotti.length) {
        setDraftRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, pesoStato: "nontrovato" } : r)));
        return;
      }
      // Una spedizione BRT corrisponde a un ordine: sommiamo il peso di tutti i pezzi
      // (un ordine può avere più materassi/accessori spediti insieme nello stesso collo).
      const pesoTotale = prodotti.reduce((s, p) => s + (p.pesoReale || 0) * (p.quantita || 1), 0);
      const label = prodotti.length === 1 ? prodotti[0].prodottoListino : `${prodotti.length} prodotti — ${fmt2(pesoTotale)} kg totali`;
      applyPesoReale(rowId, pesoTotale, label, false, prodotti);
    } catch (e) {
      setDraftRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, pesoStato: "nontrovato" } : r)));
    }
  }

  const CONCORRENZA_VERIFICA = 4;
  async function verificaTuttiIPesi(rows, listaCustom) {
    const lista = listaCustom || rows.filter((r) => r.nominativo);
    if (!lista.length) return;
    setPesoBatch({ done: 0, total: lista.length, running: true });
    let idx = 0;
    const worker = async () => {
      while (idx < lista.length) {
        if (verifyStopRef.current) return;
        const row = lista[idx++];
        await verificaPeso(row.id, row.nominativo);
        setPesoBatch((b) => (b ? { ...b, done: b.done + 1 } : b));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCORRENZA_VERIFICA, lista.length) }, worker));
    setPesoBatch((b) => (b ? { ...b, running: false } : b));
    showToast("Verifica pesi conclusa — guarda il riepilogo sopra la tabella");
  }

  function toggleManualPick(rowId) {
    setManualOpenId((id) => (id === rowId ? null : rowId));
    setManualQuery("");
  }

  function pickManualProduct(rowId, prodotto) {
    applyPesoReale(rowId, prodotto.peso, prodotto.descrizione, true);
    setManualOpenId(null);
    setManualQuery("");
  }

  function fermaVerifica() {
    verifyStopRef.current = true;
    setPesoBatch((b) => (b ? { ...b, running: false } : b));
  }

  function riprovaNonTrovate() {
    verifyStopRef.current = false;
    verificaTuttiIPesi(draftRows, draftRows.filter((r) => r.pesoStato === "nontrovato" && r.nominativo));
  }

  function addManualRow() {
    if (!manRow.sped || !manRow.peso || !manRow.fatturato) {
      showToast("Compila spedizione, peso e fatturato");
      return;
    }
    setDraftRows((rows) => [...rows, calcRow(manRow.sped, "", "", manRow.cap, manRow.peso, manRow.fatturato, null)]);
    setManRow({ sped: "", cap: "", zona: "Italia", peso: "", fatturato: "" });
  }

  function removeDraftRow(id) {
    setDraftRows((rows) => rows.filter((r) => r.id !== id));
  }

  function updateDraftRow(id, field, value) {
    setDraftRows((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  async function saveInvoice() {
    setNumeroErr(!fNumero); setDataErr(!fData);
    if (!fNumero || !fData) {
      showToast("Manca numero e/o data fattura — controlla i campi in rosso");
      numeroRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return null;
    }
    const invoice = { numero: fNumero, data: fData, settimana: isoWeek(fData), rows: draftRows, createdAt: new Date().toISOString() };
    const res = await fetch("/api/invoices", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(invoice),
    });
    const data = await res.json();
    if (data.invoice) setInvoices((inv) => [...inv, data.invoice]);
    setDraftRows([]); setUnparsedLines([]); setFNumero(""); setFData(""); setReviewing(false); setStatus("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    showToast(`Fattura ${invoice.numero} salvata in archivio`);
    return data.invoice || null;
  }

  async function saveAndEmail() {
    const invoice = await saveInvoice();
    if (!invoice) return;
    setEmailInvoiceId(invoice.id);
    generateEmail([invoice]);
    setActiveTab("email");
  }

  function csvAnomalie(rows) {
    const header = ["Spedizione", "Cliente", "Zona", "Peso BRT (kg)", "Peso reale (kg)", "Diff peso (kg)", "Pagato (EUR)", "Dovuto (EUR)", "Da recuperare (EUR)"];
    const lines = [header.join(";")];
    rows.filter((r) => r.flag).forEach((r) => {
      const pesoBrt = r.pesoDichiarato ?? r.peso;
      const diffPeso = r.pesoReale != null ? pesoBrt - r.pesoReale : "";
      const cols = [r.sped, r.nominativo || "", r.zona, fmt2(pesoBrt), r.pesoReale != null ? fmt2(r.pesoReale) : "",
        diffPeso !== "" ? fmt2(diffPeso) : "", fmt2(r.fatturato), fmt2(r.atteso), fmt2(r.diff)];
      lines.push(cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"));
    });
    return lines.join("\n");
  }

  function scaricaCsvAnomalie(rows, numero) {
    const csv = csvAnomalie(rows);
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `anomalie-fattura-${numero || "bozza"}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function cancelReview() {
    setDraftRows([]); setUnparsedLines([]); setReviewing(false); setStatus("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function deleteInvoice(id) {
    if (!confirm("Eliminare questa fattura dall'archivio?")) return;
    await fetch(`/api/invoices/${id}`, { method: "DELETE" });
    setInvoices((inv) => inv.filter((i) => i.id !== id));
  }

  async function toggleResolved(key, value) {
    setResolved((r) => ({ ...r, [key]: value }));
    await fetch("/api/resolved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }) });
  }

  async function bulkToggleResolved(keys, value) {
    setResolved((r) => { const next = { ...r }; keys.forEach((k) => { next[k] = value; }); return next; });
    await fetch("/api/resolved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys, value }) });
    showToast(value ? `${keys.length} righe segnate come risolte` : `${keys.length} righe riaperte`);
  }

  async function saveTariff() {
    await fetch("/api/tariffario", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tariffDraft) });
    setTariff(tariffDraft);
    setTariffSaved(true);
    setTimeout(() => setTariffSaved(false), 2000);
  }

  function updateBracket(idx, zona, value) {
    setTariffDraft((t) => {
      const next = JSON.parse(JSON.stringify(t));
      next.brackets[idx][zona] = parseFloat(String(value).replace(",", ".")) || 0;
      return next;
    });
  }
  function updateOltre(zona, value) {
    setTariffDraft((t) => {
      const next = JSON.parse(JSON.stringify(t));
      next.oltre[zona] = parseFloat(String(value).replace(",", ".")) || 0;
      return next;
    });
  }

  function pesoKey(p) {
    return (p.codice || "") + "||" + p.descrizione;
  }

  async function salvaPeso(p) {
    const key = pesoKey(p);
    const nuovoPeso = pesiEdits[key] !== undefined ? pesiEdits[key] : p.peso;
    setPesiSavingKey(key);
    const res = await fetch("/api/pesi", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codice: p.codice, descrizione: p.descrizione, categoria: p.categoria, peso: nuovoPeso }),
    });
    const data = await res.json();
    if (data.listino) setPesi(data.listino);
    setPesiEdits((e) => { const next = { ...e }; delete next[key]; return next; });
    setPesiSavingKey(null);
    showToast("Peso aggiornato");
  }

  async function eliminaPeso(p) {
    if (!confirm(`Eliminare "${p.descrizione}" dal listino?`)) return;
    const res = await fetch("/api/pesi", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codice: p.codice, descrizione: p.descrizione }),
    });
    const data = await res.json();
    if (data.listino) setPesi(data.listino);
  }

  async function aggiungiProdotto() {
    if (!newProd.descrizione || newProd.peso === "") {
      showToast("Servono almeno descrizione e peso");
      return;
    }
    const res = await fetch("/api/pesi", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newProd),
    });
    const data = await res.json();
    if (data.listino) setPesi(data.listino);
    setNewProd({ codice: "", descrizione: "", categoria: "", peso: "" });
    showToast("Prodotto aggiunto al listino");
  }

  const pesiFiltrati = pesiSearch.trim().length >= 2
    ? pesi.filter((p) => p.descrizione.toUpperCase().includes(pesiSearch.trim().toUpperCase())).slice(0, 100)
    : [];

  function formatLine(inv, r) {
    const chi = r.nominativo ? ` — ${r.nominativo}` : "";
    const pesoBrt = r.pesoDichiarato ?? r.peso;
    const pesoInfo = r.pesoReale != null
      ? `Peso dichiarato: ${fmt2(pesoBrt)}kg — Peso reale: ${fmt2(r.pesoReale)}kg`
      : `Peso dichiarato: ${fmt2(pesoBrt)}kg`;
    return `Spedizione ${r.sped}${chi} (${r.zona})\n${pesoInfo}\nPagato: ${fmt(r.fatturato)}€ — Dovuto: ${fmt(r.atteso)}€ — Da recuperare: ${fmt2(r.diff)}€`;
  }
  function formatTag(inv, r) {
    const chi = r.nota || r.nominativo || "";
    return `- ${r.sped}${chi ? " " + chi : ""} (fattura ${inv.numero})`;
  }

  function generateEmail(invoicesOverride) {
    const relevant = invoicesOverride || (emailInvoiceId === "__all__" ? invoices : invoices.filter((i) => i.id === emailInvoiceId));
    let subject;
    if (invoicesOverride && invoicesOverride.length === 1) {
      subject = `Fattura BRT n. ${invoicesOverride[0].numero} del ${invoicesOverride[0].data} — richiesta verifica`;
    } else {
      subject = emailInvoiceId === "__all__"
        ? "Richiesta verifica prezzi e storni — spedizioni in sospeso"
        : (() => { const inv = invoices.find((i) => i.id === emailInvoiceId); return inv ? `Fattura BRT n. ${inv.numero} del ${inv.data} — richiesta verifica` : ""; })();
    }

    const priceLines = [], ritardoLines = [], giacenzaLines = [], pianoLines = [];
    let totaleDaRecuperare = 0;
    relevant.forEach((inv) => {
      inv.rows.forEach((r) => {
        const key = inv.id + "::" + r.id;
        if (resolved[key]) return;
        if (r.flag) { priceLines.push(formatLine(inv, r)); totaleDaRecuperare += r.diff; }
        if (r.tipo === "ritardo" || r.tipo === "annullata") ritardoLines.push(formatTag(inv, r));
        if (r.tipo === "giacenza") giacenzaLines.push(formatTag(inv, r));
        if (r.tipo === "piano_non_eseguita" || r.tipo === "piano_non_richiesta") pianoLines.push(formatTag(inv, r));
      });
    });

    if (!priceLines.length && !ritardoLines.length && !giacenzaLines.length && !pianoLines.length) {
      showToast("Nessuna riga da segnalare");
      return;
    }

    const nomiFatture = [...new Set(relevant.map((i) => i.numero))];
    const introFattura = nomiFatture.length === 1
      ? `ho controllato la fattura ${nomiFatture[0]}${relevant[0]?.data ? ` del ${relevant[0].data}` : ""} e ci sono da rivedere queste spedizioni`
      : `ho controllato le fatture ${nomiFatture.join(", ")} e ci sono da rivedere queste spedizioni`;

    let body = `Ciao Daniele,\n${introFattura}:\n`;
    if (priceLines.length) body += `\n${priceLines.join("\n\n")}\n`;
    if (ritardoLines.length) body += `\nDa stornare per ritardo o annullamento:\n${ritardoLines.join("\n")}\n`;
    if (giacenzaLines.length) body += `\nGiacenze:\n${giacenzaLines.join("\n")}\n`;
    if (pianoLines.length) body += `\nConsegne al piano non eseguite o non richieste da noi:\n${pianoLines.join("\n")}\n`;
    if (priceLines.length) {
      body += `\nRiepilogo: ${priceLines.length} spedizioni da rivedere, totale da recuperare ${fmt2(totaleDaRecuperare)}€.\n`;
    }
    body += "\nAttendiamo nota credito, grazie.\nSaluti,\nAnna";
    setEmailText(body);
    setEmailSubject(subject);
  }

  // ---------- rendering ----------

  if (!unlocked) {
    return (
      <div id="lockScreen">
        <div className="lockBox">
          <img src="/logo.png" alt="De Matteo Home" style={{ height: 38, marginBottom: 22 }} />
          <h2>Controllo Fatture BRT</h2>
          <p>Area riservata — inserisci la password per accedere.</p>
          <input type="password" value={pwInput} onChange={(e) => setPwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && tryUnlock()} placeholder="Password" />
          <div className="err">{pwError}</div>
          <button className="btn" style={{ width: "100%" }} onClick={tryUnlock}>Entra</button>
        </div>
      </div>
    );
  }

  if (loadingApp) {
    return <div style={{ padding: 40, fontFamily: "Inter, sans-serif", color: "#64748B" }}>Caricamento…</div>;
  }

  const daVerificareItems = [];
  invoices.forEach((inv) => {
    (inv.rows || []).forEach((r) => {
      if (r.flag || r.tipo) {
        const key = inv.id + "::" + r.id;
        daVerificareItems.push({ inv, r, key, resolved: !!resolved[key] });
      }
    });
  });
  const openCount = daVerificareItems.filter((i) => !i.resolved).length;

  const byWeek = {};
  invoices.slice().sort((a, b) => new Date(b.data) - new Date(a.data)).forEach((inv) => {
    (byWeek[inv.settimana] = byWeek[inv.settimana] || []).push(inv);
  });

  const draftTotals = draftRows.reduce((acc, r) => {
    acc.diff += r.diff; if (r.flag) acc.flags++; if (r.pianoAmount) acc.piani++; return acc;
  }, { diff: 0, flags: 0, piani: 0 });

  return (
    <div className="app">
      <header className="top">
        <div className="brandbar">
          <img className="brandmark" src="/logo.png" alt="De Matteo Home" />
          <h1>Controllo Fatture BRT</h1>
        </div>
        <nav className="tabs">
          <button className={activeTab === "nuova" ? "active" : ""} onClick={() => setActiveTab("nuova")}>+ Aggiungi fattura</button>
          <button className={activeTab === "archivio" ? "active" : ""} onClick={() => setActiveTab("archivio")}>Archivio</button>
          <button className={activeTab === "verificare" ? "active" : ""} onClick={() => setActiveTab("verificare")}>
            Da verificare {openCount > 0 && <span className="badge">{openCount}</span>}
          </button>
          <button className={activeTab === "tariffario" ? "active" : ""} onClick={() => setActiveTab("tariffario")}>Tariffario</button>
          <button className={activeTab === "pesi" ? "active" : ""} onClick={() => setActiveTab("pesi")}>Pesi prodotti</button>
          <button className={activeTab === "email" ? "active" : ""} onClick={() => setActiveTab("email")}>Email a Daniele</button>
          <button className={activeTab === "guida" ? "active" : ""} onClick={() => setActiveTab("guida")}>Guida</button>
        </nav>
      </header>

      <main>
        {activeTab === "nuova" && (
          <section className="active">
            {!reviewing && (
              <div className="upload-zone" onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}>
                <div className="icon">↑</div>
                <h3>Carica la fattura BRT (PDF)</h3>
                <p>Trascina il file qui o clicca per selezionarlo — l'app legge le spedizioni e controlla i prezzi da sola.</p>
                <input ref={fileInputRef} type="file" accept="application/pdf" onChange={(e) => handleFile(e.target.files[0])} />
              </div>
            )}

            {status === "loading" && <div className="status-line"><div className="spinner"></div> Lettura del PDF in corso…</div>}
            {status === "error" && <div className="status-line">⚠ Non sono riuscito a leggere questo PDF. Aggiungi le righe a mano qui sotto.</div>}
            {status.startsWith("ok:") && (() => {
              const [, n, u] = status.split(":");
              return <div className="status-line">✓ {n} spedizioni riconosciute{u > 0 ? ` — ${u} righe da controllare a mano` : ""}.</div>;
            })()}

            {reviewing && (
              <div>
                <div className="card blue">
                  <div className="grid g2">
                    <div><label>N. Fattura BRT</label>
                      <input ref={numeroRef} value={fNumero} style={{ borderColor: numeroErr ? "var(--red)" : "" }}
                        onChange={(e) => { setFNumero(e.target.value); setNumeroErr(false); }} /></div>
                    <div><label>Data fattura</label>
                      <input type="date" value={fData} style={{ borderColor: dataErr ? "var(--red)" : "" }}
                        onChange={(e) => { setFData(e.target.value); setDataErr(false); }} /></div>
                  </div>
                </div>

                <div className="card">
                  <p className="sec-note" style={{ marginBottom: 12 }}>
                    <b>Peso BRT</b> è quello dichiarato da loro in fattura. <b>Peso reale</b> è quello vero del prodotto, verificato dall'app.
                    <b> Dovuto</b> è quanto avreste dovuto pagare in base al peso reale. <b>Da recuperare</b> è la differenza tra quanto avete
                    pagato e quanto dovuto — quella è la cifra da chiedere indietro a BRT su ogni spedizione.
                  </p>
                  {pesoBatch && (
                    <div className="card blue" style={{ marginBottom: 12, padding: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {pesoBatch.running ? "Verifica pesi in corso…" : "Verifica pesi conclusa"} — {pesoBatch.done}/{pesoBatch.total}
                        </span>
                        {pesoBatch.running && <button className="link" onClick={fermaVerifica}>Ferma</button>}
                      </div>
                      <div style={{ height: 6, background: "var(--blue-mid)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(pesoBatch.done / pesoBatch.total) * 100}%`, background: "var(--blue)", transition: "width .3s" }}></div>
                      </div>
                      {pesoBatch.running && <p className="sec-note" style={{ marginTop: 8, marginBottom: 0 }}>Può richiedere diversi minuti su fatture grandi — puoi continuare a lavorare, si aggiorna da sola.</p>}
                      {!pesoBatch.running && (() => {
                        const trovate = draftRows.filter((r) => r.pesoStato === "trovato").length;
                        const nonTrovate = draftRows.filter((r) => r.pesoStato === "nontrovato").length;
                        const anomalie = draftRows.filter((r) => r.flag).length;
                        const totaleDaRecuperare = draftRows.filter((r) => r.flag).reduce((s, r) => s + r.diff, 0);
                        return (
                          <div style={{ marginTop: 10 }}>
                            <p className="sec-note" style={{ marginBottom: 8 }}>
                              <b>{trovate}</b> pesi verificati, <b>{nonTrovate}</b> non trovati (cercali a mano se vuoi) —
                              <b> {anomalie} spedizioni</b> con differenza da recuperare, per un totale di <b style={{ color: "var(--red)" }}>{fmt2(totaleDaRecuperare)}€</b>.
                            </p>
                            {nonTrovate > 0 && <button className="btn secondary" onClick={riprovaNonTrovate}>Riprova le righe non trovate</button>}
                            {anomalie > 0 && (
                              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                                <button className="btn secondary" onClick={() => scaricaCsvAnomalie(draftRows, fNumero)}>Scarica CSV anomalie</button>
                                <button className="btn" onClick={saveAndEmail}>Salva e genera mail per Daniele →</button>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  <div className="table-wrap">
                    <table>
                      <thead><tr>
                        <th>Sped.</th><th>Cliente</th><th>Zona</th>
                        <th className="num">Peso BRT</th>
                        <th>Peso reale</th>
                        <th className="num">Diff. peso</th>
                        <th className="num">Pagato</th>
                        <th className="num">Dovuto</th>
                        <th className="num">Da recuperare</th>
                        <th>Tipo</th><th>Nota</th><th></th>
                      </tr></thead>
                      <tbody>
                        {draftRows.map((r) => {
                          const pesoBrt = r.pesoDichiarato ?? r.peso;
                          const diffPeso = r.pesoReale != null ? pesoBrt - r.pesoReale : null;
                          return (
                            <tr key={r.id} className={r.flag ? "flag" : ""}>
                              <td>{r.sped}{r.pianoAmount ? <span className="pill blue" title={`Consegna al piano addebitata: ${fmt(r.pianoAmount)}€`}> P</span> : ""}</td>
                              <td>{r.nominativo || "—"}</td>
                              <td>{r.zona}</td>
                              <td className="num">{fmt2(pesoBrt)} kg</td>
                              <td style={{ minWidth: 190 }}>
                                {r.pesoStato === "idle" && <span style={{ color: "var(--ink-soft)", fontSize: 11 }}>in coda…</span>}
                                {r.pesoStato === "loading" && <span className="mini-spinner"></span>}
                                {r.pesoStato === "nontrovato" && (
                                  <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
                                    <button className="btn-tiny" onClick={() => verificaPeso(r.id, r.nominativo)}>Riprova</button>
                                    <button className="btn-tiny" onClick={() => toggleManualPick(r.id)}>
                                      {manualOpenId === r.id ? "annulla" : "Cerca a mano"}
                                    </button>
                                    {manualOpenId === r.id && (
                                      <div style={{ position: "relative" }}>
                                        <input value={manualQuery} onChange={(e) => setManualQuery(e.target.value)}
                                          placeholder="cerca materasso…" style={{ width: 150 }} autoFocus />
                                        {manualQuery.trim().length >= 2 && (
                                          <div style={{ position: "absolute", zIndex: 20, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, maxHeight: 180, overflowY: "auto", width: 240, boxShadow: "0 4px 12px rgba(0,0,0,.08)" }}>
                                            {pesi.filter((p) => p.descrizione.toUpperCase().includes(manualQuery.trim().toUpperCase())).slice(0, 8).map((p) => (
                                              <div key={pesoKey(p)} style={{ padding: "6px 10px", fontSize: 11.5, cursor: "pointer", borderBottom: "1px solid var(--line)" }}
                                                onClick={() => pickManualProduct(r.id, p)}>
                                                {p.descrizione} — <b>{p.peso} kg</b>
                                              </div>
                                            ))}
                                            {pesi.filter((p) => p.descrizione.toUpperCase().includes(manualQuery.trim().toUpperCase())).length === 0 && (
                                              <div style={{ padding: "6px 10px", fontSize: 11.5, color: "var(--ink-soft)" }}>Nessun prodotto trovato — aggiungilo prima in "Pesi prodotti".</div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                                {r.pesoStato === "trovato" && (
                                  <div className="peso-cell" style={{ alignItems: "flex-start", textAlign: "left" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                      <b style={{ fontSize: 14 }}>{fmtKg(r.pesoReale)}</b>
                                      {r.pesoManuale && <span className="pill grey">manuale</span>}
                                      <button className="link" style={{ fontSize: 10.5 }} onClick={() => toggleManualPick(r.id)}>
                                        {manualOpenId === r.id ? "annulla" : "cambia"}
                                      </button>
                                      {manualOpenId === r.id && (
                                        <div style={{ position: "relative" }}>
                                          <input value={manualQuery} onChange={(e) => setManualQuery(e.target.value)}
                                            placeholder="cerca materasso…" style={{ width: 150 }} autoFocus />
                                          {manualQuery.trim().length >= 2 && (
                                            <div style={{ position: "absolute", zIndex: 20, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, maxHeight: 180, overflowY: "auto", width: 240, boxShadow: "0 4px 12px rgba(0,0,0,.08)" }}>
                                              {pesi.filter((p) => p.descrizione.toUpperCase().includes(manualQuery.trim().toUpperCase())).slice(0, 8).map((p) => (
                                                <div key={pesoKey(p)} style={{ padding: "6px 10px", fontSize: 11.5, cursor: "pointer", borderBottom: "1px solid var(--line)" }}
                                                  onClick={() => pickManualProduct(r.id, p)}>
                                                  {p.descrizione} — <b>{p.peso} kg</b>
                                                </div>
                                              ))}
                                              {pesi.filter((p) => p.descrizione.toUpperCase().includes(manualQuery.trim().toUpperCase())).length === 0 && (
                                                <div style={{ padding: "6px 10px", fontSize: 11.5, color: "var(--ink-soft)" }}>Nessun prodotto trovato — aggiungilo prima in "Pesi prodotti".</div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                    {r.prodottiDettaglio && r.prodottiDettaglio.length > 1 ? (
                                      <details style={{ fontSize: 11 }}>
                                        <summary style={{ cursor: "pointer", color: "var(--ink-soft)" }}>{r.prodottiDettaglio.length} prodotti</summary>
                                        <ul style={{ margin: "4px 0 0", paddingLeft: 14 }}>
                                          {r.prodottiDettaglio.map((p, i) => (
                                            <li key={i}>{p.prodottoListino} {p.quantita > 1 ? `×${p.quantita}` : ""} — {p.pesoReale} kg</li>
                                          ))}
                                        </ul>
                                      </details>
                                    ) : (
                                      <small style={{ color: "var(--ink-soft)" }}>{r.prodottoListino}</small>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="num">{diffPeso != null ? <b>{fmt2(diffPeso)} kg</b> : "—"}</td>
                              <td className="num">{fmt(r.fatturato)}€</td>
                              <td className="num">{fmt(r.atteso)}€</td>
                              <td className="num">{r.flag ? <span className="pill rust" style={{ fontSize: 13 }}>+{fmt2(r.diff)}€</span> : `${fmt2(r.diff)}€`}</td>
                              <td>
                                <select value={r.tipo} onChange={(e) => updateDraftRow(r.id, "tipo", e.target.value)} style={{ width: 118 }}>
                                  {TIPO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                              </td>
                              <td><input value={r.nota} placeholder="nota (es. motivo)" style={{ width: 120 }}
                                onChange={(e) => updateDraftRow(r.id, "nota", e.target.value)} /></td>
                              <td><button className="btn-sm" onClick={() => removeDraftRow(r.id)}>✕</button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {draftRows.length === 0 && <div className="empty">Nessuna riga riconosciuta — usa "aggiungi riga a mano" qui sotto.</div>}
                  {draftRows.length > 0 && (
                    <div className="totals">
                      <div className="t"><span className="n">{draftRows.length}</span><span className="l">Righe</span></div>
                      <div className="t"><span className="n">{draftTotals.flags}</span><span className="l">Anomalie</span></div>
                      <div className="t"><span className="n">{draftTotals.piani}</span><span className="l">Consegne al piano</span></div>
                      <div className="t"><span className="n">{fmt2(draftTotals.diff)}€</span><span className="l">Diff. totale</span></div>
                    </div>
                  )}
                </div>

                {unparsedLines.length > 0 && (
                  <div className="card" style={{ borderColor: "var(--red)" }}>
                    <p style={{ margin: "0 0 8px", fontSize: 12.5, fontWeight: 700, color: "var(--red)" }}>Righe non riconosciute automaticamente — verificale a mano:</p>
                    <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.6 }}>
                      {unparsedLines.map((l, i) => <div key={i}>{l}</div>)}
                    </div>
                  </div>
                )}

                <details className="advanced">
                  <summary>+ Aggiungi o correggi una riga a mano</summary>
                  <div className="card" style={{ marginTop: 10 }}>
                    <div className="grid g4">
                      <div><label>N. Spedizione</label><input value={manRow.sped} onChange={(e) => setManRow({ ...manRow, sped: e.target.value })} /></div>
                      <div><label>CAP</label><input value={manRow.cap} maxLength={5}
                        onChange={(e) => setManRow({ ...manRow, cap: e.target.value, zona: detectZona(e.target.value) })} /></div>
                      <div><label>Zona</label>
                        <select value={manRow.zona} onChange={(e) => setManRow({ ...manRow, zona: e.target.value })}>
                          <option>Italia</option><option>Calabria</option><option>Sicilia</option><option>Sardegna</option>
                        </select></div>
                      <div><label>Peso tassabile (kg)</label><input type="number" value={manRow.peso} onChange={(e) => setManRow({ ...manRow, peso: e.target.value })} /></div>
                    </div>
                    <div className="grid g2" style={{ marginTop: 10 }}>
                      <div><label>Trasporto fatturato (€)</label><input type="number" value={manRow.fatturato} onChange={(e) => setManRow({ ...manRow, fatturato: e.target.value })} /></div>
                      <div style={{ display: "flex", alignItems: "flex-end" }}><button className="btn secondary" style={{ width: "100%" }} onClick={addManualRow}>+ Aggiungi riga</button></div>
                    </div>
                  </div>
                </details>

                <div style={{ marginTop: 16 }}>
                  <button className="btn" onClick={saveInvoice}>Salva fattura in archivio</button>
                  <button className="link" style={{ marginLeft: 14 }} onClick={cancelReview}>Annulla</button>
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === "archivio" && (
          <section className="active">
            <h2 className="sec-title">Archivio fatture</h2>
            <p className="sec-note">Tutte le fatture caricate, raggruppate per settimana.</p>
            {invoices.length === 0 && <div className="empty">Nessuna fattura in archivio.</div>}
            {Object.keys(byWeek).sort().reverse().map((week) => (
              <div className="week-group" key={week}>
                <div className="week-head">Settimana {week} — {byWeek[week].length} fattura/e</div>
                {byWeek[week].map((inv) => {
                  const flags = inv.rows.filter((r) => r.flag).length;
                  const totalDiff = inv.rows.reduce((s, r) => s + r.diff, 0);
                  const daSegnalare = inv.rows.filter((r) => r.flag || r.tipo);
                  const ancoraAperte = daSegnalare.filter((r) => !resolved[inv.id + "::" + r.id]).length;
                  const aperta = !!expandedIds[inv.id];
                  return (
                    <div className="card" key={inv.id} style={{ marginBottom: 10, marginTop: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                        onClick={() => toggleExpand(inv.id)}>
                        <span>{aperta ? "▾" : "▸"} Fattura {inv.numero} <span style={{ color: "var(--ink-soft)", fontWeight: 500 }}>— {inv.data} — {inv.rows.length} righe</span></span>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className={`pill ${flags > 0 ? "rust" : "teal"}`}>{flags} anomalie</span>
                          {daSegnalare.length > 0 && (
                            <span className={`pill ${ancoraAperte > 0 ? "amber" : "teal"}`}>
                              {ancoraAperte > 0 ? `${ancoraAperte} ancora aperte` : "Tutto risolto ✓"}
                            </span>
                          )}
                          <button className="btn-sm" onClick={(e) => { e.stopPropagation(); deleteInvoice(inv.id); }}>Elimina</button>
                        </span>
                      </div>
                      {aperta && (
                      <div style={{ marginTop: 12 }}>
                      <div className="table-wrap">
                        <table>
                          <thead><tr><th>Sped.</th><th>Cliente</th><th>CAP</th><th>Zona</th><th className="num">Peso</th><th className="num">Fatturato</th><th className="num">Atteso</th><th className="num">Diff.</th><th>Tipo</th></tr></thead>
                          <tbody>
                            {inv.rows.map((r) => (
                              <tr key={r.id} className={r.flag ? "flag" : ""}>
                                <td>{r.sped}{r.pianoAmount ? <span className="pill blue"> P</span> : ""}</td>
                                <td>{r.nominativo || "—"}</td><td>{r.cap || "—"}</td><td>{r.zona}</td>
                                <td className="num">{fmt2(r.peso)}</td><td className="num">{fmt(r.fatturato)}</td>
                                <td className="num">{fmt(r.atteso)}</td><td className="num">{fmt2(r.diff)}</td>
                                <td>{r.tipo ? <span className="pill grey">{tipoLabel(r.tipo)}</span> : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 8 }}>Differenza totale fattura: <b style={{ color: "var(--ink)" }}>{fmt2(totalDiff)}€</b></div>
                      </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        )}

        {activeTab === "verificare" && (
          <section className="active">
            <h2 className="sec-title">Righe da verificare</h2>
            <p className="sec-note">Spedizioni con differenza ≥ 0,50€ o con un tipo assegnato, raggruppate per fattura — lavorane una alla volta.</p>
            <div className="card" style={{ padding: 14, marginBottom: 12 }}>
              <label className="checkbox-row">
                <input type="checkbox" checked={mostraRisolte} onChange={(e) => setMostraRisolte(e.target.checked)} />
                Mostra anche le fatture già completamente risolte
              </label>
            </div>
            {(() => {
              const byInvoice = {};
              daVerificareItems.forEach((it) => {
                if (!byInvoice[it.inv.id]) byInvoice[it.inv.id] = { inv: it.inv, items: [] };
                byInvoice[it.inv.id].items.push(it);
              });
              let gruppi = Object.values(byInvoice).sort((a, b) => new Date(b.inv.data) - new Date(a.inv.data));
              if (!mostraRisolte) gruppi = gruppi.filter((g) => g.items.some((i) => !i.resolved));

              if (gruppi.length === 0) {
                return <div className="empty">Tutto risolto — nessuna fattura in sospeso al momento.</div>;
              }
              return gruppi.map((g) => {
                const visibili = mostraRisolte ? g.items : g.items.filter((i) => !i.resolved);
                const aperte = g.items.filter((i) => !i.resolved).length;
                const espansa = !!expandedIds[g.inv.id];
                return (
                  <div className="card" key={g.inv.id} style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                      onClick={() => toggleExpand(g.inv.id)}>
                      <span>{espansa ? "▾" : "▸"} Fattura {g.inv.numero} <span style={{ color: "var(--ink-soft)", fontWeight: 500 }}>— {g.inv.data} — {g.items.length} righe</span></span>
                      <span className={`pill ${aperte > 0 ? "amber" : "teal"}`}>{aperte > 0 ? `${aperte} aperte` : "Tutto risolto ✓"}</span>
                    </div>
                    {espansa && (
                    <div className="table-wrap" style={{ marginTop: 10 }}>
                      <table>
                        <thead><tr><th>Sped.</th><th>Cliente</th><th>Zona</th><th className="num">Peso</th><th className="num">Fatturato</th><th className="num">Diff.</th><th>Tipo</th>
                          <th>
                            <label className="checkbox-row">
                              <input type="checkbox"
                                checked={visibili.length > 0 && visibili.every((i) => i.resolved)}
                                onChange={(e) => bulkToggleResolved(visibili.map((i) => i.key), e.target.checked)} />
                              Nota credito ricevuta (tutte)
                            </label>
                          </th>
                        </tr></thead>
                        <tbody>
                          {visibili.sort((a, b) => (b.r.flag - a.r.flag) || (b.r.diff - a.r.diff)).map((it) => (
                            <tr key={it.key} className={it.resolved ? "resolved" : it.r.flag ? "flag" : ""}>
                              <td>{it.r.sped}{it.r.pianoAmount ? <span className="pill blue"> P</span> : ""}</td>
                              <td>{it.r.nominativo || "—"}</td>
                              <td>{it.r.zona}</td>
                              <td className="num">{fmt2(it.r.peso)}</td>
                              <td className="num">{fmt(it.r.fatturato)}</td>
                              <td className="num">{it.r.flag ? `+${fmt2(it.r.diff)}€` : "—"}</td>
                              <td>{tipoLabel(it.r.tipo)}</td>
                              <td><label className="checkbox-row"><input type="checkbox" checked={it.resolved} onChange={(e) => toggleResolved(it.key, e.target.checked)} /> {it.resolved ? "Risolto" : "—"}</label></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    )}
                  </div>
                );
              });
            })()}
          </section>
        )}

        {activeTab === "tariffario" && tariffDraft && (
          <section className="active">
            <h2 className="sec-title">Tariffario contrattuale</h2>
            <p className="sec-note">Tariffa base a spedizione per fascia di peso e zona. Modificalo quando cambia con il rinnovo annuale.</p>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Fascia peso (kg)</th><th className="num">Italia</th><th className="num">Calabria</th><th className="num">Sicilia</th><th className="num">Sardegna</th></tr></thead>
                  <tbody>
                    {tariffDraft.brackets.map((b, idx) => (
                      <tr key={idx}>
                        <td>{b.label}</td>
                        {["Italia", "Calabria", "Sicilia", "Sardegna"].map((z) => (
                          <td className="num" key={z}><input value={b[z]} style={{ width: 70, textAlign: "right" }}
                            onChange={(e) => updateBracket(idx, z, e.target.value)} /></td>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <td>Oltre 80 (al q.le)</td>
                      {["Italia", "Calabria", "Sicilia", "Sardegna"].map((z) => (
                        <td className="num" key={z}><input value={tariffDraft.oltre[z]} style={{ width: 70, textAlign: "right" }}
                          onChange={(e) => updateOltre(z, e.target.value)} /></td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="sec-note" style={{ marginTop: 12, marginBottom: 0 }}>Oltre 80 kg: tariffa "oltre a quintale" × (peso tassabile / 100).</p>
            </div>
            <button className="btn" onClick={saveTariff}>Salva tariffario</button>
            {tariffSaved && <span style={{ marginLeft: 10, fontSize: 12.5, color: "var(--green)", fontWeight: 600 }}>✓ Salvato</span>}
          </section>
        )}

        {activeTab === "pesi" && (
          <section className="active">
            <h2 className="sec-title">Pesi prodotti</h2>
            <p className="sec-note">
              Elenco di {pesi.length} prodotti usato per confrontare il peso dichiarato da BRT con il peso reale.
              Cerca un prodotto per correggerne il peso, o aggiungine uno nuovo se manca.
            </p>

            <div className="card">
              <label>Cerca prodotto</label>
              <input placeholder="Scrivi almeno 2 lettere del nome (es. New Memo Molle)"
                value={pesiSearch} onChange={(e) => setPesiSearch(e.target.value)} />
            </div>

            {pesiSearch.trim().length >= 2 && (
              <div className="card">
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Codice</th><th>Descrizione</th><th>Categoria</th><th className="num">Peso (kg)</th><th></th></tr></thead>
                    <tbody>
                      {pesiFiltrati.map((p) => {
                        const key = pesoKey(p);
                        const val = pesiEdits[key] !== undefined ? pesiEdits[key] : p.peso;
                        const dirty = pesiEdits[key] !== undefined && String(pesiEdits[key]) !== String(p.peso);
                        return (
                          <tr key={key}>
                            <td>{p.codice || "—"}</td>
                            <td>{p.descrizione}</td>
                            <td>{p.categoria || "—"}</td>
                            <td className="num">
                              <input value={val} style={{ width: 80, textAlign: "right" }}
                                onChange={(e) => setPesiEdits((ed) => ({ ...ed, [key]: e.target.value }))} />
                            </td>
                            <td style={{ display: "flex", gap: 6 }}>
                              {dirty && (
                                <button className="btn-tiny" disabled={pesiSavingKey === key} onClick={() => salvaPeso(p)}>
                                  {pesiSavingKey === key ? "…" : "Salva"}
                                </button>
                              )}
                              <button className="btn-sm" onClick={() => eliminaPeso(p)}>✕</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {pesiFiltrati.length === 0 && <div className="empty">Nessun prodotto trovato con questo nome.</div>}
                </div>
              </div>
            )}

            <details className="advanced">
              <summary>+ Aggiungi un prodotto nuovo al listino</summary>
              <div className="card" style={{ marginTop: 10 }}>
                <div className="grid g4">
                  <div><label>Codice (SKU/EAN, opzionale)</label><input value={newProd.codice} onChange={(e) => setNewProd({ ...newProd, codice: e.target.value })} /></div>
                  <div style={{ gridColumn: "span 2" }}><label>Descrizione</label><input value={newProd.descrizione} onChange={(e) => setNewProd({ ...newProd, descrizione: e.target.value })} placeholder="es. MATERASSO NUOVO MODELLO 160x190" /></div>
                  <div><label>Peso (kg)</label><input value={newProd.peso} onChange={(e) => setNewProd({ ...newProd, peso: e.target.value })} /></div>
                </div>
                <div className="grid g2" style={{ marginTop: 10 }}>
                  <div><label>Categoria (opzionale)</label><input value={newProd.categoria} onChange={(e) => setNewProd({ ...newProd, categoria: e.target.value })} /></div>
                  <div style={{ display: "flex", alignItems: "flex-end" }}><button className="btn secondary" style={{ width: "100%" }} onClick={aggiungiProdotto}>+ Aggiungi al listino</button></div>
                </div>
              </div>
            </details>
          </section>
        )}

        {activeTab === "email" && (
          <section className="active">
            <h2 className="sec-title">Email a Daniele</h2>
            <p className="sec-note">Genera il testo pronto per la mail di contestazione, nello stesso stile usato finora.</p>
            <div className="card">
              <label>Seleziona fattura</label>
              <select value={emailInvoiceId} onChange={(e) => setEmailInvoiceId(e.target.value)}>
                <option value="__all__">Tutte le anomalie non risolte</option>
                {invoices.slice().sort((a, b) => new Date(b.data) - new Date(a.data)).map((inv) => (
                  <option key={inv.id} value={inv.id}>Fattura {inv.numero} — {inv.data}</option>
                ))}
              </select>
              <div style={{ marginTop: 12 }}><button className="btn" onClick={() => generateEmail()}>Genera testo</button></div>
            </div>
            {emailText && (
              <div className="card">
                <label>Testo email</label>
                <textarea value={emailText} onChange={(e) => setEmailText(e.target.value)} style={{ minHeight: 260 }} />
                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="btn secondary" onClick={() => { navigator.clipboard.writeText(emailText); showToast("Testo copiato"); }}>Copia testo</button>
                  <a className="btn" style={{ textDecoration: "none", display: "inline-block" }}
                    href={`mailto:daniele.derosa@brt.it?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailText)}`}>Apri in Mail →</a>
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === "guida" && (
          <section className="active">
            <h2 className="sec-title">Guida completa</h2>
            <p className="sec-note">Come funziona l'app, passo per passo e concetto per concetto.</p>

            <h3 style={{ fontSize: 15, fontWeight: 700, margin: "8px 0 14px" }}>Il percorso settimanale</h3>
            {[
              ["1", "Carica la fattura", "Vai su \"+ Aggiungi fattura\" e carica il PDF che arriva da BRT via mail. L'app legge da sola numero fattura, data e tutte le spedizioni (numero, cliente, CAP, peso dichiarato, importo)."],
              ["2", "Controlla le righe rosse", "Sono le spedizioni con un prezzo più alto di almeno 0,50€ rispetto a quanto previsto dal tariffario contrattuale, calcolato sul peso che BRT ha dichiarato. Se qualche riga non è stata letta bene dal PDF, correggila o aggiungila a mano con \"+ Aggiungi o correggi una riga a mano\"."],
              ["3", "Il peso reale si verifica da sola", "Appena carichi il PDF, l'app parte in automatico e controlla il peso reale di ogni riga: cerca l'ordine del cliente su WooCommerce, trova il materasso comprato e lo confronta col listino pesi. Su fatture grandi (300+ righe) può richiedere anche 10-15 minuti perché il sito risponde lentamente — vedi una barra di avanzamento e puoi continuare a lavorare nel frattempo, si aggiorna da sola."],
              ["4", "Ordini fatti nel gestionale (non sul sito)", "Se un cliente ha ordinato direttamente tramite il gestionale invece che dal sito, l'app non lo trova su WooCommerce e la riga resta \"non trovata\". In questo caso clicca \"ordine dal gestionale? seleziona a mano\" sotto la riga, cerca il materasso giusto nella lista che compare e selezionalo: il peso reale viene impostato subito, con l'etichetta \"manuale\" per ricordarti che non è stato trovato in automatico."],
              ["5", "Se un prodotto risulta introvabile anche a mano", "Vai sulla tab \"Pesi prodotti\", cerca il nome del materasso: se manca dal listino, aggiungilo tu con nome e peso. Da quel momento sarà sempre disponibile, sia per la ricerca automatica che per quella manuale."],
              ["6", "Spunta ritardi, giacenze e consegne al piano", "Nella colonna \"Tipo\" di ogni riga, confrontando col gestionale (vedi sotto \"Cosa significa ogni etichetta\")."],
              ["7", "Salva in archivio", "La trovi sempre nella tab \"Archivio\", raggruppata per settimana."],
              ["8", "Genera la mail per Daniele", "Vai su \"Email a Daniele\", scegli la fattura (o \"tutte le anomalie non risolte\"), premi \"Genera testo\": esce già divisa nelle sezioni giuste (prezzi da rivedere, ritardi/annullamenti, giacenze, consegne al piano). Copiala o aprila direttamente in Mail."],
              ["9", "Quando arriva la nota di credito", "Vai su \"Da verificare\" e spunta \"Nota credito ricevuta\" sulla riga risolta. Sparisce dal contatore delle cose in sospeso."],
            ].map(([num, title, text]) => (
              <div className="guide-step" key={num}>
                <div className="num">{num}</div>
                <div><h4>{title}</h4><p>{text}</p></div>
              </div>
            ))}

            <h3 style={{ fontSize: 15, fontWeight: 700, margin: "32px 0 14px" }}>Il prezzo si calcola sul peso reale, non su quello dichiarato da BRT</h3>
            <p className="sec-note">
              BRT può dichiarare il peso che vuole (anche gonfiato per via del calcolo volumetrico) — a voi interessa pagare la tariffa giusta
              per il peso vero del prodotto spedito. Per questo, appena l'app trova il peso reale di una spedizione (in automatico o a mano),
              ricalcola da sola quanto avreste dovuto pagare sul peso vero e confronta con quanto vi hanno fatturato: quella è l'anomalia che conta,
              non il confronto col peso dichiarato da BRT (che resta visibile solo come riferimento). Se un ordine ha più prodotti (es. materasso +
              rete + cuscini), l'app ti chiede quale corrisponde a quella specifica spedizione, invece di sommarli alla cieca.
            </p>

            <h3 style={{ fontSize: 15, fontWeight: 700, margin: "32px 0 14px" }}>Cosa significa ogni etichetta "Tipo"</h3>
            <p className="sec-note">
              <b>Ritardo</b>: la consegna ha superato i tempi contrattuali (24/48h terraferma, 48/72h isole) — lo sai solo tu dal tuo tracciamento manuale, la fattura BRT non lo dice.<br />
              <b>Annullata / rimborsata</b>: l'ordine è stato annullato o il cliente rimborsato per un disagio.<br />
              <b>Giacenza</b>: importo certo da stornare, sempre incluso nella mail di nota di credito.<br />
              <b>Piano non eseguita</b>: il cliente ha pagato la consegna al piano ma BRT non l'ha eseguita — va anche registrata nel gestionale/file resi per il rimborso al cliente.<br />
              <b>Piano non richiesta da noi</b>: il cliente l'ha chiesta direttamente al corriere alla consegna, non tramite voi — si contesta comunque l'addebito a Daniele.
            </p>

            <h3 style={{ fontSize: 15, fontWeight: 700, margin: "32px 0 14px" }}>Il codice "P" accanto al numero spedizione</h3>
            <p className="sec-note">
              Significa che BRT ha addebitato un supplemento per consegna al piano su quella spedizione. L'app lo segnala da sola leggendo il PDF —
              tocca a te controllare nel gestionale se quella consegna al piano era stata davvero richiesta ed eseguita (vedi etichette sopra).
            </p>

            <h3 style={{ fontSize: 15, fontWeight: 700, margin: "32px 0 14px" }}>Le altre tab</h3>
            <p className="sec-note">
              <b>Archivio</b>: tutte le fatture salvate, raggruppate per settimana, sola lettura.<br />
              <b>Da verificare</b>: elenco di tutte le righe con un'anomalia di prezzo o un'etichetta "Tipo" assegnata, con la spunta "Nota credito ricevuta" per tenere traccia di cosa è ancora aperto.<br />
              <b>Tariffario</b>: le tariffe di trasporto BRT per fascia di peso e zona — da aggiornare solo quando cambia il contratto (di solito a gennaio).<br />
              <b>Pesi prodotti</b>: il listino con nome e peso reale di ogni materasso, usato per il confronto. Cercalo, correggilo, aggiungine di nuovi liberamente.<br />
              <b>Email a Daniele</b>: genera il testo della mail di contestazione, pronto da copiare o aprire in Mail.
            </p>
          </section>
        )}

        <footer className="note">
          Il controllo automatico dei prezzi copre la tariffa base di trasporto (fascia peso/zona). Il peso reale viene confrontato con il listino prodotti collegato a WooCommerce — se un prodotto non viene trovato, va verificato a mano. Ritardi, annullamenti, giacenze e consegne al piano vanno confermati con l'etichetta "Tipo" su ogni riga.
        </footer>
      </main>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
