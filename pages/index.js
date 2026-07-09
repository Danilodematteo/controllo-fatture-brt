import { useState, useEffect, useRef } from "react";
import { DEFAULT_TARIFF, calcAtteso, detectZona } from "../lib/tariff";
import { LEGENDA_CODICI } from "../lib/parseInvoice";
import { provinciaInfo, risolviArrivo } from "../lib/province";

const APP_PASSWORD = "DeMatteo2026"; // <-- cambia qui la password
const WC_ADMIN_URL = "https://dematteohome.it"; // stesso dominio usato per l'integrazione WooCommerce (vedi pages/api/woo/find-order.js)
const SOGLIA_ANOMALIA = 0.10; // euro

const TIPO_OPTIONS = [
  { value: "", label: "—" },
  { value: "ritardo", label: "Ritardo" },
  { value: "annullata", label: "Annullata / rimborsata" },
  { value: "giacenza", label: "Giacenza" },
  { value: "piano_non_eseguita", label: "Consegna al piano non eseguita" },
  { value: "piano_non_richiesta", label: "Consegna al piano non richiesta da noi" },
];
const tipoLabel = (v) => TIPO_OPTIONS.find((o) => o.value === v)?.label || "—";

// Filtro di ricerca condiviso tra Archivio e Da verificare: cerca per numero
// spedizione o per nome cliente (case-insensitive, corrispondenza parziale).
function matchRicerca(r, query) {
  if (!query) return true;
  const q = query.trim().toUpperCase();
  if (!q) return true;
  return (r.sped || "").toUpperCase().includes(q) || (r.nominativo || "").toUpperCase().includes(q);
}

// Sotto-riga con data di partenza, riferimento mittente e link diretto
// all'ordine WooCommerce (usa il riferimento come ID ordine — verificato
// affidabile, vedi pages/api/woo/find-order.js).
function spedExtra(r) {
  const rifValido = r.riferimento && r.riferimento.length >= 4;
  return (
    <>
      {r.dataSpedizione && <span className="rif-mittente">Partita il {r.dataSpedizione}</span>}
      {r.riferimento && <span className="rif-mittente">Rif. {r.riferimento}</span>}
      {rifValido && (
        <a href={`${WC_ADMIN_URL}/wp-admin/post.php?post=${r.riferimento}&action=edit`}
          target="_blank" rel="noopener noreferrer" className="rif-mittente wc-link">
          Apri ordine ↗
        </a>
      )}
    </>
  );
}

const fmt = (n) => (Math.round((n || 0) * 1000) / 1000).toFixed(3).replace(".", ",");
const fmt2 = (n) => (Math.round((n || 0) * 100) / 100).toFixed(2).replace(".", ",");
const fmtKg = (n) => (n === null || n === undefined ? "—" : `${n} kg`);
const fmtData = (iso) => {
  if (!iso) return "—";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
};
const ZONE = ["Italia", "Calabria", "Sicilia", "Sardegna"];

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
  const [ricercaArchivio, setRicercaArchivio] = useState("");
  const [ricercaVerificare, setRicercaVerificare] = useState("");
  const [resolved, setResolved] = useState({});
  const [loadingApp, setLoadingApp] = useState(true);

  const [fNumero, setFNumero] = useState("");
  const [fData, setFData] = useState("");
  const [draftRows, setDraftRows] = useState([]);
  const [draftPdfBase64, setDraftPdfBase64] = useState(null);
  const [unparsedLines, setUnparsedLines] = useState([]);
  const [status, setStatus] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [numeroErr, setNumeroErr] = useState(false);
  const [dataErr, setDataErr] = useState(false);
  const fileInputRef = useRef(null);
  const numeroRef = useRef(null);

  const [manRow, setManRow] = useState({ sped: "", provincia: "", peso: "", fatturato: "" });

  const [tariffDraft, setTariffDraft] = useState(null);
  const [tariffSaved, setTariffSaved] = useState(false);

  const [emailInvoiceId, setEmailInvoiceId] = useState("__all__");
  const [emailText, setEmailText] = useState("");
  const [emailSubject, setEmailSubject] = useState("");

  const [pesi, setPesi] = useState([]);
  const [pesiSearch, setPesiSearch] = useState("");
  const [pesiEdits, setPesiEdits] = useState({});
  const [pesiSavingKey, setPesiSavingKey] = useState(null);
  const [newProd, setNewProd] = useState({ codice: "", descrizione: "", categoria: "", peso: "" });

  const [mostraRisolte, setMostraRisolte] = useState(false);
  const [expandedIds, setExpandedIds] = useState({});
  const [archBatch, setArchBatch] = useState({});
  const [manualOpenId, setManualOpenId] = useState(null);
  const [pesoDMBatch, setPesoDMBatch] = useState(null);
  const verifyStopRef = useRef(false);
  const [manualQuery, setManualQuery] = useState("");
  const [legendaOpen, setLegendaOpen] = useState(false);

  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);

  function toggleExpand(id) {
    setExpandedIds((e) => ({ ...e, [id]: !e[id] }));
  }
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

  // ---------- riga: costruzione e ricalcolo ----------

  function computeCalc(pesoReale, zona, fatturatoTrasporto) {
    const atteso = calcAtteso(pesoReale, zona, tariff);
    const diff = (fatturatoTrasporto || 0) - atteso;
    return { atteso, diff, flag: diff >= SOGLIA_ANOMALIA };
  }

  function calcRowFromParsed(r) {
    const arrivoSigla = risolviArrivo(r.provinciaArrivo, r.provinciaPartenza);
    const pInfo = provinciaInfo(arrivoSigla);
    const { atteso, diff, flag } = computeCalc(r.pesoReale, pInfo.zona, r.trasporto);
    return {
      id: newRowId(), sped: r.sped, dataSpedizione: r.dataSpedizione || "", riferimento: r.riferimento || "", nominativo: r.nominativo || "",
      cap: r.cap, provincia: arrivoSigla, provinciaNome: pInfo.nome, zona: pInfo.zona,
      pesoReale: r.pesoReale, pesoTassabile: r.peso, colli: r.colli || 1, // peso tassabile BRT, solo riferimento
      trasporto: r.trasporto, varieSum: r.varieSum || 0, fatturato: r.fatturato,
      varieDettaglio: r.varieDettaglio || [], rawText: r.rawText || "",
      atteso, diff, flag,
      pianoAmount: r.pianoAmount || null, tipo: "",
      pesoDM: null, prodottoDM: null, pesoDMStato: "idle", pesoDMManuale: false, prodottiDettaglioDM: null,
    };
  }

  function calcRowManual(sped, provincia, pesoReale, trasporto) {
    const pInfo = provinciaInfo(provincia);
    const { atteso, diff, flag } = computeCalc(parseFloat(pesoReale) || 0, pInfo.zona, parseFloat(trasporto) || 0);
    return {
      id: newRowId(), sped, riferimento: "", nominativo: "", cap: "", provincia: provincia.toUpperCase(), provinciaNome: pInfo.nome, zona: pInfo.zona,
      pesoReale: parseFloat(pesoReale) || 0, pesoTassabile: null,
      trasporto: parseFloat(trasporto) || 0, varieSum: 0, fatturato: parseFloat(trasporto) || 0,
      varieDettaglio: [], rawText: "",
      atteso, diff, flag,
      pianoAmount: null, tipo: "",
      pesoDM: null, prodottoDM: null, pesoDMStato: "idle", pesoDMManuale: false, prodottiDettaglioDM: null,
    };
  }

  // ---------- caricamento PDF ----------

  async function handleFile(file) {
    if (!file) return;
    setDraftRows([]);
    setUnparsedLines([]);
    setDraftPdfBase64(null);
    setReviewing(true);
    setStatus("loading");
    try {
      const res = await fetch("/api/parse-invoice", { method: "POST", body: file });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.header) { setFNumero(data.header.numero); setFData(data.header.data); }
      const rows = (data.rows || []).map(calcRowFromParsed);
      setDraftRows(rows);
      setUnparsedLines(data.unparsed || []);
      setStatus(`ok:${rows.length}:${(data.unparsed || []).length}`);
      verificaTuttiIPesiDM(rows); // parte da sola, ora è veloce grazie alla ricerca per numero ordine
      // conserva anche il PDF originale (base64) per poterlo salvare in archivio
      // e permettere un controllo "testa/croce" senza dover recuperare la mail
      const reader = new FileReader();
      reader.onload = () => setDraftPdfBase64(String(reader.result).split(",")[1] || null);
      reader.readAsDataURL(file);
    } catch (e) {
      setStatus("error");
    }
  }

  // ---------- Peso De Matteo (verifica facoltativa contro il listino/WooCommerce) ----------

  function applyPesoDM(rowId, pesoDM, prodottoDM, manuale, dettaglio) {
    setDraftRows((rows) => rows.map((r) => (r.id === rowId
      ? { ...r, pesoDM, prodottoDM, pesoDMManuale: !!manuale, pesoDMStato: "trovato", prodottiDettaglioDM: dettaglio || null }
      : r)));
  }

  async function verificaPesoDM(rowId, nominativo, cap, riferimento) {
    setDraftRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, pesoDMStato: "loading" } : r)));
    if (!riferimento || riferimento.length < 4) {
      setDraftRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, pesoDMStato: "nontrovato" } : r)));
      return;
    }
    try {
      const res = await fetch("/api/woo/find-order", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ riferimento }),
      });
      const data = await res.json();
      const ordine = (data.risultati || [])[0];
      const prodotti = ordine ? ordine.prodotti.filter((p) => p.pesoTrovato) : [];
      if (!prodotti.length) {
        setDraftRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, pesoDMStato: "nontrovato" } : r)));
        return;
      }
      const pesoTotale = prodotti.reduce((s, p) => s + (p.pesoReale || 0) * (p.quantita || 1), 0);
      const label = prodotti.map((p) => p.prodottoListino).join(" + ");
      applyPesoDM(rowId, pesoTotale, label, false, prodotti);
    } catch (e) {
      setDraftRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, pesoDMStato: "nontrovato" } : r)));
    }
  }

  const CONCORRENZA_DM = 5;
  async function verificaTuttiIPesiDM(rows) {
    const lista = rows.filter((r) => r.riferimento && r.riferimento.length >= 4);
    if (!lista.length) return;
    verifyStopRef.current = false;
    setPesoDMBatch({ done: 0, total: lista.length, running: true });
    let idx = 0;
    const worker = async () => {
      while (idx < lista.length) {
        if (verifyStopRef.current) return;
        const row = lista[idx++];
        await verificaPesoDM(row.id, row.nominativo, row.cap, row.riferimento);
        setPesoDMBatch((b) => (b ? { ...b, done: b.done + 1 } : b));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCORRENZA_DM, lista.length) }, worker));
    setPesoDMBatch((b) => (b ? { ...b, running: false } : b));
  }
  function fermaVerificaDM() {
    verifyStopRef.current = true;
    setPesoDMBatch((b) => (b ? { ...b, running: false } : b));
  }

  function toggleManualPick(key) {
    setManualOpenId((id) => (id === key ? null : key));
    setManualQuery("");
  }
  function pickManualProduct(rowId, prodotto) {
    applyPesoDM(rowId, prodotto.peso, prodotto.descrizione, true);
    setManualOpenId(null);
    setManualQuery("");
  }

  // ---------- righe manuali ----------

  function addManualRow() {
    if (!manRow.sped || !manRow.peso || !manRow.fatturato) {
      showToast("Compila spedizione, peso reale e trasporto fatturato");
      return;
    }
    setDraftRows((rows) => [...rows, calcRowManual(manRow.sped, manRow.provincia, manRow.peso, manRow.fatturato)]);
    setManRow({ sped: "", cap: "", zona: "Italia", peso: "", fatturato: "" });
  }
  function removeDraftRow(id) {
    setDraftRows((rows) => rows.filter((r) => r.id !== id));
  }
  function updateDraftRow(id, field, value) {
    setDraftRows((rows) => rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  // ---------- salvataggio ----------

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
    if (data.invoice) {
      setInvoices((inv) => [...inv, data.invoice]);
      if (draftPdfBase64) {
        fetch(`/api/invoices/${data.invoice.id}/pdf`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdfBase64: draftPdfBase64 }),
        }).catch(() => {}); // il PDF è un extra: se fallisce, la fattura resta comunque salvata
      }
    }
    setDraftRows([]); setUnparsedLines([]); setDraftPdfBase64(null); setFNumero(""); setFData(""); setReviewing(false); setStatus("");
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
    const header = ["Spedizione", "Cliente", "Zona", "Peso reale BRT (kg)", "Trasporto fatturato (EUR)", "Trasporto dovuto (EUR)", "Diff (EUR)", "Varie (EUR)", "Tipo"];
    const lines = [header.join(";")];
    rows.filter((r) => r.flag).forEach((r) => {
      const cols = [r.sped, r.nominativo || "", r.zona, fmt2(r.pesoReale), fmt2(r.trasporto), fmt2(r.atteso), fmt2(r.diff), fmt2(r.varieSum), tipoLabel(r.tipo)];
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

  async function persistInvoiceRows(invId) {
    setInvoices((current) => {
      const inv = current.find((i) => i.id === invId);
      if (inv) {
        fetch(`/api/invoices/${invId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: inv.rows }) });
      }
      return current;
    });
  }

  function applyPesoDMArchivio(invId, rowId, pesoDM, prodottoDM, manuale, dettaglio) {
    setInvoices((invs) => invs.map((inv) => {
      if (inv.id !== invId) return inv;
      return { ...inv, rows: inv.rows.map((r) => (r.id === rowId ? { ...r, pesoDM, prodottoDM, pesoDMManuale: !!manuale, pesoDMStato: "trovato", prodottiDettaglioDM: dettaglio || null } : r)) };
    }));
  }
  async function verificaPesoDMArchivio(invId, rowId, nominativo, dataFattura, cap, riferimento) {
    setInvoices((invs) => invs.map((inv) => inv.id !== invId ? inv : { ...inv, rows: inv.rows.map((r) => r.id === rowId ? { ...r, pesoDMStato: "loading" } : r) }));
    if (!nominativo) {
      setInvoices((invs) => invs.map((inv) => inv.id !== invId ? inv : { ...inv, rows: inv.rows.map((r) => r.id === rowId ? { ...r, pesoDMStato: "nontrovato" } : r) }));
      return;
    }
    try {
      const res = await fetch("/api/woo/find-order", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nominativo, dataSpedizione: dataFattura, cap, riferimento }),
      });
      const data = await res.json();
      const ordine = (data.risultati || [])[0];
      const prodotti = ordine ? ordine.prodotti.filter((p) => p.pesoTrovato) : [];
      if (!prodotti.length) {
        setInvoices((invs) => invs.map((inv) => inv.id !== invId ? inv : { ...inv, rows: inv.rows.map((r) => r.id === rowId ? { ...r, pesoDMStato: "nontrovato" } : r) }));
        return;
      }
      const pesoTotale = prodotti.reduce((s, p) => s + (p.pesoReale || 0) * (p.quantita || 1), 0);
      const label = prodotti.map((p) => p.prodottoListino).join(" + ");
      applyPesoDMArchivio(invId, rowId, pesoTotale, label, false, prodotti);
    } catch (e) {
      setInvoices((invs) => invs.map((inv) => inv.id !== invId ? inv : { ...inv, rows: inv.rows.map((r) => r.id === rowId ? { ...r, pesoDMStato: "nontrovato" } : r) }));
    }
  }
  async function verificaTuttiIPesiDMArchivio(inv) {
    const lista = inv.rows.filter((r) => r.riferimento && r.riferimento.length >= 4 && r.pesoDMStato !== "trovato");
    if (!lista.length) { showToast("Non ci sono righe da verificare in questa fattura"); return; }
    setArchBatch((b) => ({ ...b, [inv.id]: { done: 0, total: lista.length, running: true } }));
    let idx = 0;
    const worker = async () => {
      while (idx < lista.length) {
        const row = lista[idx++];
        await verificaPesoDMArchivio(inv.id, row.id, row.nominativo, inv.data, row.cap, row.riferimento);
        setArchBatch((b) => ({ ...b, [inv.id]: { ...b[inv.id], done: b[inv.id].done + 1 } }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, lista.length) }, worker));
    setArchBatch((b) => ({ ...b, [inv.id]: { ...b[inv.id], running: false } }));
    await persistInvoiceRows(inv.id);
    showToast("Confronto col catalogo concluso e salvato");
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
    setTariffDraft((t) => { const next = JSON.parse(JSON.stringify(t)); next.brackets[idx][zona] = parseFloat(String(value).replace(",", ".")) || 0; return next; });
  }
  function updateOltre(zona, value) {
    setTariffDraft((t) => { const next = JSON.parse(JSON.stringify(t)); next.oltre[zona] = parseFloat(String(value).replace(",", ".")) || 0; return next; });
  }

  function pesoKey(p) { return (p.codice || "") + "||" + p.descrizione; }
  async function salvaPeso(p) {
    const key = pesoKey(p);
    const nuovoPeso = pesiEdits[key] !== undefined ? pesiEdits[key] : p.peso;
    setPesiSavingKey(key);
    const res = await fetch("/api/pesi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codice: p.codice, descrizione: p.descrizione, categoria: p.categoria, peso: nuovoPeso }) });
    const data = await res.json();
    if (data.listino) setPesi(data.listino);
    setPesiEdits((e) => { const next = { ...e }; delete next[key]; return next; });
    setPesiSavingKey(null);
    showToast("Peso aggiornato");
  }
  async function eliminaPeso(p) {
    if (!confirm(`Eliminare "${p.descrizione}" dal listino?`)) return;
    const res = await fetch("/api/pesi", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codice: p.codice, descrizione: p.descrizione }) });
    const data = await res.json();
    if (data.listino) setPesi(data.listino);
  }
  async function aggiungiProdotto() {
    if (!newProd.descrizione || newProd.peso === "") { showToast("Servono almeno descrizione e peso"); return; }
    const res = await fetch("/api/pesi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newProd) });
    const data = await res.json();
    if (data.listino) setPesi(data.listino);
    setNewProd({ codice: "", descrizione: "", categoria: "", peso: "" });
    showToast("Prodotto aggiunto al listino");
  }
  const pesiFiltrati = pesiSearch.trim().length >= 2
    ? pesi.filter((p) => p.descrizione.toUpperCase().includes(pesiSearch.trim().toUpperCase())).slice(0, 100)
    : [];

  // ---------- email ----------

  function formatShipmentBlock(inv, r) {
    const testo = r.rawText || `${r.sped} — ${r.nominativo} (${r.zona}) — peso reale ${fmt2(r.pesoReale)}kg — fatturato ${fmt(r.trasporto)}€`;
    return `Fattura ${inv.numero}:\n${testo}`;
  }
  function formatTag(inv, r) {
    const chi = r.nominativo || "";
    const riga = `- ${r.sped}${chi ? " " + chi : ""} (fattura ${inv.numero}) — Motivazione: ${tipoLabel(r.tipo)}`;
    if (r.tipo === "giacenza") return `*** ${riga} ***`;
    return riga;
  }

  function generateEmail(invoicesOverride) {
    const relevant = invoicesOverride || (emailInvoiceId === "__all__" ? invoices : invoices.filter((i) => i.id === emailInvoiceId));

    const priceLines = [], ritardoLines = [], giacenzaLines = [], pianoLines = [];
    let totaleDaRecuperare = 0;
    relevant.forEach((inv) => {
      inv.rows.forEach((r) => {
        const key = inv.id + "::" + r.id;
        if (resolved[key]) return;
        if (r.flag) { priceLines.push(formatShipmentBlock(inv, r)); totaleDaRecuperare += r.diff; }
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
    const subject = nomiFatture.length === 1
      ? `Fattura BRT n. ${nomiFatture[0]} — richiesta verifica prezzi`
      : `Fatture BRT n. ${nomiFatture.join(", ")} — richiesta verifica prezzi`;
    const introFattura = nomiFatture.length === 1
      ? `ho controllato la fattura ${nomiFatture[0]}${relevant[0]?.data ? ` del ${fmtData(relevant[0].data)}` : ""} e ci sono da rivedere queste spedizioni`
      : `ho controllato le fatture ${nomiFatture.join(", ")} e ci sono da rivedere queste spedizioni`;

    let body = `Ciao Daniele,\n${introFattura}:\n`;
    if (priceLines.length) body += `\n${priceLines.join("\n\n")}\n`;
    if (ritardoLines.length) body += `\nDa stornare per ritardo o annullamento:\n${ritardoLines.join("\n")}\n`;
    if (giacenzaLines.length) body += `\nGiacenze:\n${giacenzaLines.join("\n")}\n`;
    if (pianoLines.length) body += `\nConsegne al piano non eseguite o non richieste da noi:\n${pianoLines.join("\n")}\n`;
    body += "\nAttendiamo nota credito, grazie.\nSaluti";
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
  if (loadingApp) return <div style={{ padding: 40, fontFamily: "Inter, sans-serif", color: "#64748B" }}>Caricamento…</div>;

  const daVerificareItems = [];
  invoices.forEach((inv) => {
    (inv.rows || []).forEach((r) => {
      if (r.flag || r.tipo) daVerificareItems.push({ inv, r, key: inv.id + "::" + r.id, resolved: !!resolved[inv.id + "::" + r.id] });
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
                <p>Trascina il file qui o clicca per selezionarlo — l'app legge le spedizioni e controlla i prezzi da sola, sul peso reale dichiarato da BRT.</p>
                <input ref={fileInputRef} type="file" accept="application/pdf" onChange={(e) => handleFile(e.target.files[0])} />
              </div>
            )}

            {status === "loading" && <div className="status-line"><div className="spinner"></div> Lettura del PDF in corso…</div>}
            {status === "error" && <div className="status-line">⚠ Non sono riuscito a leggere questo PDF. Aggiungi le righe a mano qui sotto.</div>}
            {status.startsWith("ok:") && (() => {
              const [, n, u] = status.split(":");
              return <div className="status-line">✓ {n} spedizioni lette e calcolate all'istante{u > 0 ? ` — ${u} righe da controllare a mano` : ""}.</div>;
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
                    Il calcolo usa il <b>peso reale</b> dichiarato da BRT in fattura (non quello tassabile/volumetrico) per capire quanto
                    avreste dovuto pagare di trasporto. Segnaliamo una spedizione quando la differenza è di almeno {fmt2(SOGLIA_ANOMALIA)}€.
                    La provincia e il codice isola (evidenziato) vengono letti direttamente dalla fattura.
                  </p>
                  {pesoDMBatch && (
                    <div className="card blue" style={{ marginBottom: 12, padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {pesoDMBatch.running ? "Confronto col catalogo De Matteo in corso…" : "Confronto concluso"} — {pesoDMBatch.done}/{pesoDMBatch.total}
                        </span>
                        {pesoDMBatch.running && <button className="link" onClick={fermaVerificaDM}>Ferma</button>}
                      </div>
                      <div style={{ height: 6, background: "var(--blue-mid)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(pesoDMBatch.done / pesoDMBatch.total) * 100}%`, background: "var(--blue)", transition: "width .3s" }}></div>
                      </div>
                    </div>
                  )}
                  <div className="table-wrap">
                    <table>
                      <thead><tr>
                        <th>Sped. / dati fattura</th><th>Cliente</th><th>Prov.</th>
                        <th className="num">Peso reale BRT</th>
                        <th className="num">Trasp. fatturato</th>
                        <th className="num">Trasp. dovuto</th>
                        <th className="num">Da recuperare</th>
                        <th style={{ position: "relative" }}>
                          Varie
                          <button className="info-icon" onClick={() => setLegendaOpen((v) => !v)}>i</button>
                          {legendaOpen && (
                            <div className="legenda-popup" style={{ top: 24, left: 0 }} onClick={(e) => e.stopPropagation()}>
                              <h5>Legenda codici BRT</h5>
                              {Object.entries(LEGENDA_CODICI).map(([code, label]) => (
                                <div className="riga" key={code}><b>{code}</b><span>{label}</span></div>
                              ))}
                              <button className="link" style={{ marginTop: 8, fontSize: 11 }} onClick={() => setLegendaOpen(false)}>Chiudi</button>
                            </div>
                          )}
                        </th>
                        <th>Peso De Matteo</th>
                        <th>Tipo</th><th></th>
                      </tr></thead>
                      <tbody>
                        {draftRows.map((r) => (
                          <tr key={r.id} className={r.flag ? "flag" : ""}>
                            <td>{r.sped}{spedExtra(r)}{r.pianoAmount != null ? <div className="piano-badge" style={{ marginTop: 4 }}>PIANO</div> : ""}</td>
                            <td>{r.nominativo || "—"}</td>
                            <td>{r.provinciaNome}<br /><small style={{ color: "var(--ink)", fontWeight: 600 }}>{r.zona}</small></td>
                            <td className="num">{fmt2(r.pesoReale)} kg{r.colli > 1 && <><br /><span className="pill blue">{r.colli} colli</span></>}</td>
                            <td className="num">{fmt(r.trasporto)}€</td>
                            <td className="num">{fmt(r.atteso)}€</td>
                            <td className="num">{r.flag ? <span className="pill rust" style={{ fontSize: 13 }}>+{fmt2(r.diff)}€</span> : `${fmt2(r.diff)}€`}</td>
                            <td style={{ minWidth: 130 }}>
                              <div>{fmt2(r.varieSum)}€</div>
                              {r.varieDettaglio && r.varieDettaglio.length > 0 && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 3 }}>
                                  {r.varieDettaglio.map((v, i) => (
                                    <span key={i} className={v.code === "J" ? "pill isola" : "pill grey"} title={v.label}>
                                      {v.code}{v.amount != null ? ` ${fmt2(v.amount)}` : ""}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td style={{ minWidth: 170 }}>
                              {r.pesoDMStato === "idle" && <span style={{ color: "var(--ink-soft)", fontSize: 11 }}>in coda…</span>}
                              {r.pesoDMStato === "loading" && <span className="mini-spinner"></span>}
                              {r.pesoDMStato === "nontrovato" && (
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  <button className="btn-tiny" onClick={() => verificaPesoDM(r.id, r.nominativo, r.cap, r.riferimento)}>Riprova</button>
                                  <button className="btn-tiny" onClick={() => toggleManualPick(r.id)}>{manualOpenId === r.id ? "annulla" : "cerca a mano"}</button>
                                </div>
                              )}
                              {r.pesoDMStato === "trovato" && (
                                <div className="peso-cell" style={{ alignItems: "flex-start", textAlign: "left" }}>
                                  <b style={{ fontSize: 13 }}>{fmtKg(r.pesoDM)}</b>
                                  {r.pesoDMManuale && <span className="pill grey">manuale</span>}
                                  {r.prodottiDettaglioDM && r.prodottiDettaglioDM.length > 1 ? (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                                      {r.prodottiDettaglioDM.map((p, i) => (
                                        <small key={i} style={{ color: "var(--ink-soft)" }}>
                                          {p.prodottoListino}{p.quantita > 1 ? ` ×${p.quantita}` : ""}
                                        </small>
                                      ))}
                                    </div>
                                  ) : (
                                    <small style={{ color: "var(--ink-soft)" }}>{r.prodottoDM}</small>
                                  )}
                                  <button className="link" style={{ fontSize: 10 }} onClick={() => toggleManualPick(r.id)}>{manualOpenId === r.id ? "annulla" : "cambia"}</button>
                                </div>
                              )}
                              {manualOpenId === r.id && (
                                <div style={{ position: "relative", marginTop: 4 }}>
                                  <input value={manualQuery} onChange={(e) => setManualQuery(e.target.value)} placeholder="cerca materasso…" style={{ width: 150 }} autoFocus />
                                  {manualQuery.trim().length >= 2 && (
                                    <div style={{ position: "absolute", zIndex: 20, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, maxHeight: 180, overflowY: "auto", width: 240, boxShadow: "0 4px 12px rgba(0,0,0,.08)" }}>
                                      {pesi.filter((p) => p.descrizione.toUpperCase().includes(manualQuery.trim().toUpperCase())).slice(0, 8).map((p) => (
                                        <div key={pesoKey(p)} style={{ padding: "6px 10px", fontSize: 11.5, cursor: "pointer", borderBottom: "1px solid var(--line)" }}
                                          onClick={() => pickManualProduct(r.id, p)}>{p.descrizione} — <b>{p.peso} kg</b></div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                            <td>
                              <select value={r.tipo} onChange={(e) => updateDraftRow(r.id, "tipo", e.target.value)} style={{ width: 118 }}>
                                {TIPO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            </td>
                            <td><button className="btn-sm" onClick={() => removeDraftRow(r.id)}>✕</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {draftRows.length === 0 && <div className="empty">Nessuna riga riconosciuta — usa "aggiungi riga a mano" qui sotto.</div>}
                  {draftRows.length > 0 && (
                    <>
                      <div className="totals">
                        <div className="t"><span className="n">{draftRows.length}</span><span className="l">Righe</span></div>
                        <div className="t"><span className="n">{draftTotals.flags}</span><span className="l">Anomalie</span></div>
                        <div className="t"><span className="n">{draftTotals.piani}</span><span className="l">Consegne al piano</span></div>
                        <div className="t"><span className="n" style={{ color: "var(--red)" }}>{fmt2(draftTotals.diff)}€</span><span className="l">Da recuperare (tot.)</span></div>
                      </div>
                      {draftTotals.flags > 0 && (
                        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                          <button className="btn secondary" onClick={() => scaricaCsvAnomalie(draftRows, fNumero)}>Scarica CSV anomalie</button>
                          <button className="btn" onClick={saveAndEmail}>Salva e genera mail per Daniele →</button>
                        </div>
                      )}
                    </>
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
                      <div><label>Sigla provincia (es. MI, AG, CE)</label><input value={manRow.provincia} maxLength={2} style={{ textTransform: "uppercase" }}
                        onChange={(e) => setManRow({ ...manRow, provincia: e.target.value.toUpperCase() })} /></div>
                      <div><label>Peso reale (kg)</label><input type="number" value={manRow.peso} onChange={(e) => setManRow({ ...manRow, peso: e.target.value })} /></div>
                      <div><label>Trasporto fatturato (€)</label><input type="number" value={manRow.fatturato} onChange={(e) => setManRow({ ...manRow, fatturato: e.target.value })} /></div>
                    </div>
                    <div className="grid g2" style={{ marginTop: 10 }}>
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
            <div className="card" style={{ padding: 12, marginBottom: 14 }}>
              <input type="text" value={ricercaArchivio} onChange={(e) => setRicercaArchivio(e.target.value)}
                placeholder="Cerca per numero spedizione o nome cliente…" style={{ width: "100%" }} />
            </div>
            {invoices.length === 0 && <div className="empty">Nessuna fattura in archivio.</div>}
            {Object.keys(byWeek).sort().reverse().map((week) => {
              const qArchivio = ricercaArchivio.trim();
              const fattureSettimana = qArchivio
                ? byWeek[week].filter((inv) => inv.rows.some((r) => matchRicerca(r, qArchivio)))
                : byWeek[week];
              if (fattureSettimana.length === 0) return null;
              return (
              <div className="week-group" key={week}>
                <div className="week-head">Settimana {week} — {fattureSettimana.length} fattura/e</div>
                {fattureSettimana.map((inv) => {
                  const righeVisibili = qArchivio ? inv.rows.filter((r) => matchRicerca(r, qArchivio)) : inv.rows;
                  const flags = inv.rows.filter((r) => r.flag).length;
                  const totalDiff = inv.rows.reduce((s, r) => s + (r.flag ? r.diff : 0), 0);
                  const daSegnalare = inv.rows.filter((r) => r.flag || r.tipo);
                  const ancoraAperte = daSegnalare.filter((r) => !resolved[inv.id + "::" + r.id]).length;
                  const aperta = qArchivio ? true : !!expandedIds[inv.id];
                  const batch = archBatch[inv.id];
                  const daVerificareDM = inv.rows.filter((r) => r.riferimento && r.riferimento.length >= 4 && r.pesoDMStato !== "trovato").length;
                  return (
                    <div className="card" key={inv.id} style={{ marginBottom: 10, marginTop: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                        onClick={() => toggleExpand(inv.id)}>
                        <span>{aperta ? "▾" : "▸"} Fattura {inv.numero} <span style={{ color: "var(--ink)", fontWeight: 500 }}>— {fmtData(inv.data)} — {inv.rows.length} righe</span></span>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className={`pill ${flags > 0 ? "rust" : "teal"}`}>{flags} anomalie</span>
                          {daSegnalare.length > 0 && (
                            <span className={`pill ${ancoraAperte > 0 ? "amber" : "teal"}`}>{ancoraAperte > 0 ? `${ancoraAperte} ancora aperte` : "Tutto risolto ✓"}</span>
                          )}
                          <a href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noopener noreferrer"
                            className="btn-sm pdf-btn" onClick={(e) => e.stopPropagation()}>
                            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M7 2h7l5 5v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
                              <path d="M14 2v5h5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
                              <path d="M8.5 12.5h7M8.5 15.5h7M8.5 9.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                            </svg>
                            PDF originale
                          </a>
                          <button className="btn-sm" onClick={(e) => { e.stopPropagation(); deleteInvoice(inv.id); }}>Elimina</button>
                        </span>
                      </div>
                      {aperta && (
                        <div style={{ marginTop: 12 }}>
                          {daVerificareDM > 0 && !batch?.running && (
                            <button className="btn secondary" style={{ marginBottom: 10 }} onClick={() => verificaTuttiIPesiDMArchivio(inv)}>
                              Confronta col catalogo De Matteo ({daVerificareDM})
                            </button>
                          )}
                          {batch?.running && (
                            <div className="card blue" style={{ padding: 12, marginBottom: 10 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Confronto in corso… — {batch.done}/{batch.total}</div>
                              <div style={{ height: 6, background: "var(--blue-mid)", borderRadius: 4, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${(batch.done / batch.total) * 100}%`, background: "var(--blue)", transition: "width .3s" }}></div>
                              </div>
                            </div>
                          )}
                          <div className="table-wrap">
                            <table>
                              <thead><tr>
                                <th>Sped.</th><th>Cliente</th><th>Zona</th><th className="num">Peso reale</th>
                                <th className="num">Fatturato</th><th className="num">Dovuto</th><th className="num">Diff.</th>
                                <th>Peso De Matteo</th><th>Tipo</th>
                              </tr></thead>
                              <tbody>
                                {righeVisibili.map((r) => (
                                  <tr key={r.id} className={r.flag ? "flag" : ""}>
                                    <td>{r.sped}{spedExtra(r)}{r.pianoAmount != null ? <div className="piano-badge" style={{ marginTop: 4 }}>PIANO</div> : ""}</td>
                                    <td>{r.nominativo || "—"}</td><td>{r.zona}</td>
                                    <td className="num">{fmt2(r.pesoReale)} kg{r.colli > 1 && <><br /><span className="pill blue">{r.colli} colli</span></>}</td>
                                    <td className="num">{fmt(r.trasporto)}€</td>
                                    <td className="num">{fmt(r.atteso)}€</td>
                                    <td className="num">{r.flag ? <span className="pill rust">+{fmt2(r.diff)}€</span> : `${fmt2(r.diff)}€`}</td>
                                    <td>{r.pesoDMStato === "trovato" ? <span>{fmtKg(r.pesoDM)}</span> : "—"}</td>
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
              );
            })}
          </section>
        )}

        {activeTab === "verificare" && (
          <section className="active">
            <h2 className="sec-title">Righe da verificare</h2>
            <p className="sec-note">Spedizioni con differenza ≥ {fmt2(SOGLIA_ANOMALIA)}€ o con un tipo assegnato, raggruppate per fattura.</p>
            <div className="card" style={{ padding: 12, marginBottom: 12 }}>
              <input type="text" value={ricercaVerificare} onChange={(e) => setRicercaVerificare(e.target.value)}
                placeholder="Cerca per numero spedizione o nome cliente…" style={{ width: "100%" }} />
            </div>
            <div className="card" style={{ padding: 14, marginBottom: 12 }}>
              <label className="checkbox-row">
                <input type="checkbox" checked={mostraRisolte} onChange={(e) => setMostraRisolte(e.target.checked)} />
                Mostra anche le fatture già completamente risolte
              </label>
            </div>
            {(() => {
              const qVerificare = ricercaVerificare.trim();
              const byInvoice = {};
              daVerificareItems.forEach((it) => {
                if (qVerificare && !matchRicerca(it.r, qVerificare)) return;
                if (!byInvoice[it.inv.id]) byInvoice[it.inv.id] = { inv: it.inv, items: [] };
                byInvoice[it.inv.id].items.push(it);
              });
              let gruppi = Object.values(byInvoice).sort((a, b) => new Date(b.inv.data) - new Date(a.inv.data));
              if (!mostraRisolte) gruppi = gruppi.filter((g) => g.items.some((i) => !i.resolved));
              if (gruppi.length === 0) return <div className="empty">{qVerificare ? "Nessun risultato per questa ricerca." : "Tutto risolto — nessuna fattura in sospeso al momento."}</div>;
              return gruppi.map((g) => {
                const visibili = mostraRisolte ? g.items : g.items.filter((i) => !i.resolved);
                const aperte = g.items.filter((i) => !i.resolved).length;
                const espansa = qVerificare ? true : !!expandedIds[g.inv.id];
                return (
                  <div className="card" key={g.inv.id} style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                      onClick={() => toggleExpand(g.inv.id)}>
                      <span>{espansa ? "▾" : "▸"} Fattura {g.inv.numero} <span style={{ color: "var(--ink)", fontWeight: 500 }}>— {fmtData(g.inv.data)} — {g.items.length} righe</span></span>
                      <span className={`pill ${aperte > 0 ? "amber" : "teal"}`}>{aperte > 0 ? `${aperte} aperte` : "Tutto risolto ✓"}</span>
                    </div>
                    {espansa && (
                      <div className="table-wrap" style={{ marginTop: 10 }}>
                        <table>
                          <thead><tr><th>Sped.</th><th>Cliente</th><th>Zona</th><th className="num">Peso reale</th><th className="num">Fatturato</th><th className="num">Diff.</th><th>Tipo</th>
                            <th>
                              <label className="checkbox-row">
                                <input type="checkbox" checked={visibili.length > 0 && visibili.every((i) => i.resolved)}
                                  onChange={(e) => bulkToggleResolved(visibili.map((i) => i.key), e.target.checked)} />
                                Nota credito ricevuta (tutte)
                              </label>
                            </th>
                          </tr></thead>
                          <tbody>
                            {visibili.sort((a, b) => (b.r.flag - a.r.flag) || (b.r.diff - a.r.diff)).map((it) => (
                              <tr key={it.key} className={it.resolved ? "resolved" : it.r.flag ? "flag" : ""}>
                                <td>{it.r.sped}{spedExtra(it.r)}{it.r.pianoAmount != null ? <div className="piano-badge" style={{ marginTop: 4 }}>PIANO</div> : ""}</td>
                                <td>{it.r.nominativo || "—"}</td>
                                <td>{it.r.zona}</td>
                                <td className="num">{fmt2(it.r.pesoReale)} kg</td>
                                <td className="num">{fmt(it.r.trasporto)}€</td>
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
                        {ZONE.map((z) => (
                          <td className="num" key={z}><input value={b[z]} style={{ width: 70, textAlign: "right" }} onChange={(e) => updateBracket(idx, z, e.target.value)} /></td>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <td>Oltre 80 (al q.le)</td>
                      {ZONE.map((z) => (
                        <td className="num" key={z}><input value={tariffDraft.oltre[z]} style={{ width: 70, textAlign: "right" }} onChange={(e) => updateOltre(z, e.target.value)} /></td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="sec-note" style={{ marginTop: 12, marginBottom: 0 }}>Oltre 80 kg: tariffa "oltre a quintale" × (peso reale / 100).</p>
            </div>
            <button className="btn" onClick={saveTariff}>Salva tariffario</button>
            {tariffSaved && <span style={{ marginLeft: 10, fontSize: 12.5, color: "var(--green)", fontWeight: 600 }}>✓ Salvato</span>}
          </section>
        )}

        {activeTab === "pesi" && (
          <section className="active">
            <h2 className="sec-title">Pesi prodotti (catalogo De Matteo)</h2>
            <p className="sec-note">
              Elenco di {pesi.length} prodotti usato solo per il confronto facoltativo "Peso De Matteo" — un controllo aggiuntivo
              rispetto al peso reale già dichiarato da BRT in fattura. Cerca un prodotto per correggerne il peso, o aggiungine uno nuovo se manca.
            </p>
            <div className="card">
              <label>Cerca prodotto</label>
              <input placeholder="Scrivi almeno 2 lettere del nome (es. New Memo Molle)" value={pesiSearch} onChange={(e) => setPesiSearch(e.target.value)} />
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
                            <td>{p.codice || "—"}</td><td>{p.descrizione}</td><td>{p.categoria || "—"}</td>
                            <td className="num"><input value={val} style={{ width: 80, textAlign: "right" }} onChange={(e) => setPesiEdits((ed) => ({ ...ed, [key]: e.target.value }))} /></td>
                            <td style={{ display: "flex", gap: 6 }}>
                              {dirty && <button className="btn-tiny" disabled={pesiSavingKey === key} onClick={() => salvaPeso(p)}>{pesiSavingKey === key ? "…" : "Salva"}</button>}
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
            <p className="sec-note">Genera il testo pronto per la mail di contestazione, con la riga originale della fattura per ogni spedizione.</p>
            <div className="card">
              <label>Seleziona fattura</label>
              <select value={emailInvoiceId} onChange={(e) => setEmailInvoiceId(e.target.value)}>
                <option value="__all__">Tutte le anomalie non risolte</option>
                {invoices.slice().sort((a, b) => new Date(b.data) - new Date(a.data)).map((inv) => (
                  <option key={inv.id} value={inv.id}>Fattura {inv.numero} — {fmtData(inv.data)}</option>
                ))}
              </select>
              <div style={{ marginTop: 12 }}><button className="btn" onClick={() => generateEmail()}>Genera testo</button></div>
            </div>
            {emailText && (
              <div className="card">
                <label>Testo email</label>
                <textarea value={emailText} onChange={(e) => setEmailText(e.target.value)} style={{ minHeight: 300 }} />
                <p className="sec-note" style={{ marginTop: 8 }}>
                  Nota: le righe di "Giacenze" sono racchiuse tra *** *** perché una vera colorazione rossa non è possibile in una mail di solo testo.
                </p>
                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="btn secondary" onClick={() => { navigator.clipboard.writeText(emailText); showToast("Testo copiato"); }}>Copia testo</button>
                  {(() => {
                    const base = "https://webmail.dematteohome.it/?_task=mail&_action=compose";
                    const to = `&_to=${encodeURIComponent("daniele.derosa@brt.it")}`;
                    const subj = `&_subject=${encodeURIComponent(emailSubject)}`;
                    const full = `${base}${to}${subj}&_body=${encodeURIComponent(emailText)}`;
                    const troppoLunga = full.length > 6000;
                    const href = troppoLunga ? `${base}${to}${subj}` : full;
                    return (
                      <>
                        <a className="btn" style={{ textDecoration: "none", display: "inline-block" }} target="_blank" rel="noopener noreferrer" href={href}>
                          Apri in Mail (webmail) →
                        </a>
                        {troppoLunga && (
                          <p className="sec-note" style={{ width: "100%", marginTop: 6, color: "var(--red)" }}>
                            Questa mail è troppo lunga (tante spedizioni insieme) per essere trasferita automaticamente al testo —
                            si aprirà solo con destinatario e oggetto già pronti: copia il testo con il pulsante qui sopra e incollalo tu nel corpo della mail.
                          </p>
                        )}
                      </>
                    );
                  })()}
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
              ["1", "Carica la fattura", "Vai su \"+ Aggiungi fattura\" e carica il PDF che arriva da BRT via mail. L'app legge da sola numero fattura, data e tutte le spedizioni — comprese le due colonne di peso (reale e tassabile) e tutte le voci \"varie\"."],
              ["2", "I calcoli sono già pronti, all'istante", "Il confronto usa il peso reale dichiarato da BRT (non quello tassabile/volumetrico) per calcolare quanto avreste dovuto pagare di trasporto. Non serve aspettare nessuna verifica: appena carichi il PDF, vedi già tutte le anomalie."],
              ["3", "Correggi la zona se serve", "La zona (Italia/Calabria/Sicilia/Sardegna) si deduce dal CAP, ma per le piccole isole (Ischia, Procida, Elba, ecc.) può non essere precisa — correggila tu dal menu a tendina sulla riga se lo sai."],
              ["4", "\"Confronta con catalogo\" (facoltativo)", "Su ogni riga puoi anche chiedere un secondo controllo: cerca l'ordine su WooCommerce e confronta il peso reale dichiarato da BRT con quello del prodotto nel vostro catalogo. È un controllo extra, non obbligatorio, utile se hai dubbi che anche il \"peso reale\" scritto da BRT non torni."],
              ["5", "Spunta ritardi, giacenze e consegne al piano", "Nella colonna \"Tipo\" di ogni riga. Le consegne al piano sono già segnalate da sole con il badge \"CONSEGNA AL PIANO\" — l'importo esatto è nel testo originale della fattura, mostrato sotto ogni riga, perché non sempre l'app riesce ad abbinarlo con certezza al codice giusto."],
              ["6", "Salva, scarica il CSV o genera subito la mail", "In fondo trovi \"Salva fattura in archivio\", oppure — se ci sono anomalie — \"Scarica CSV anomalie\" e \"Salva e genera mail per Daniele\" che fa tutto in un click."],
              ["7", "Genera la mail per Daniele (in qualsiasi momento)", "Vai su \"Email a Daniele\": il testo include, per ogni spedizione anomala, la riga originale così come appare in fattura, e per ogni riga con un \"Tipo\" assegnato la motivazione della richiesta."],
              ["8", "Invia dalla webmail", "Premi \"Apri in Mail (webmail)\" — si apre Roundcube con tutto già scritto. Rileggi e premi Invia tu stessa."],
              ["9", "Quando arriva la nota di credito", "Vai su \"Da verificare\", apri la fattura e spunta \"Nota credito ricevuta\"."],
            ].map(([num, title, text]) => (
              <div className="guide-step" key={num}>
                <div className="num">{num}</div>
                <div><h4>{title}</h4><p>{text}</p></div>
              </div>
            ))}

            <h3 style={{ fontSize: 15, fontWeight: 700, margin: "32px 0 14px" }}>Peso reale vs peso tassabile — la differenza che conta</h3>
            <p className="sec-note">
              Ogni spedizione in fattura ha due pesi: quello <b>reale</b> (il peso vero dichiarato da BRT) e quello <b>tassabile</b>
              (usato per calcolare il trasporto, spesso più alto per via del calcolo volumetrico). L'app confronta sempre quanto avreste
              dovuto pagare in base al <b>peso reale</b> con quanto vi hanno effettivamente fatturato per il trasporto — quella differenza,
              da almeno {fmt2(SOGLIA_ANOMALIA)}€ in su, è l'anomalia da segnalare a Daniele.
            </p>

            <h3 style={{ fontSize: 15, fontWeight: 700, margin: "32px 0 14px" }}>Le "varie" (handling, carburante, ecc.)</h3>
            <p className="sec-note">
              Oltre al trasporto, ogni spedizione ha piccole spese accessorie (gestione, carburante, ISTAT...) che l'app somma nella colonna
              "Varie", a titolo informativo — non fanno parte del confronto peso/prezzo perché sono dovute comunque, indipendentemente dal peso.
            </p>

            <h3 style={{ fontSize: 15, fontWeight: 700, margin: "32px 0 14px" }}>Cosa significa ogni etichetta "Tipo"</h3>
            <p className="sec-note">
              <b>Ritardo</b>: consegna oltre i tempi contrattuali — lo sai solo tu.<br />
              <b>Annullata / rimborsata</b>: ordine annullato o cliente rimborsato.<br />
              <b>Giacenza</b>: importo certo da stornare.<br />
              <b>Piano non eseguita</b>: pagata dal cliente ma non eseguita da BRT.<br />
              <b>Piano non richiesta da noi</b>: il cliente l'ha chiesta direttamente al corriere.
            </p>

            <h3 style={{ fontSize: 15, fontWeight: 700, margin: "32px 0 14px" }}>Le altre tab</h3>
            <p className="sec-note">
              <b>Archivio</b> e <b>Da verificare</b>: fatture chiuse di default, clicca per aprirle.<br />
              <b>Tariffario</b>: le tariffe BRT per peso/zona.<br />
              <b>Pesi prodotti</b>: il catalogo usato solo per il confronto facoltativo "Peso De Matteo".<br />
              <b>Email a Daniele</b>: testo pronto con la riga originale di ogni spedizione e la motivazione per ogni "Tipo" assegnato.
            </p>
          </section>
        )}

        <footer className="note">
          Il controllo automatico confronta il peso reale dichiarato da BRT con la tariffa contrattuale, calcolato all'istante appena carichi il PDF.
          Il "Peso De Matteo" (catalogo prodotti) è un controllo aggiuntivo facoltativo. Ritardi, annullamenti, giacenze e consegne al piano vanno confermati con l'etichetta "Tipo".
        </footer>
      </main>

      {toast && <div className="toast show">{toast}</div>}
    </div>
  );
}
