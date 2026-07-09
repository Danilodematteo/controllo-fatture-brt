// lib/province.js
// Sigla provincia -> nome completo + zona tariffaria BRT (Italia/Calabria/Sicilia/Sardegna).
// Elenco fisso delle province italiane (fonte: ISTAT/Poste Italiane).

const PROVINCE = {
  TO: { nome: "Torino", zona: "Italia" }, VC: { nome: "Vercelli", zona: "Italia" },
  NO: { nome: "Novara", zona: "Italia" }, CN: { nome: "Cuneo", zona: "Italia" },
  AT: { nome: "Asti", zona: "Italia" }, AL: { nome: "Alessandria", zona: "Italia" },
  BI: { nome: "Biella", zona: "Italia" }, VB: { nome: "Verbano-Cusio-Ossola", zona: "Italia" },
  AO: { nome: "Aosta", zona: "Italia" },
  MI: { nome: "Milano", zona: "Italia" }, BG: { nome: "Bergamo", zona: "Italia" },
  BS: { nome: "Brescia", zona: "Italia" }, PV: { nome: "Pavia", zona: "Italia" },
  CR: { nome: "Cremona", zona: "Italia" }, MN: { nome: "Mantova", zona: "Italia" },
  CO: { nome: "Como", zona: "Italia" }, SO: { nome: "Sondrio", zona: "Italia" },
  VA: { nome: "Varese", zona: "Italia" }, LC: { nome: "Lecco", zona: "Italia" },
  LO: { nome: "Lodi", zona: "Italia" }, MB: { nome: "Monza e Brianza", zona: "Italia" },
  TN: { nome: "Trento", zona: "Italia" }, BZ: { nome: "Bolzano", zona: "Italia" },
  VE: { nome: "Venezia", zona: "Italia" }, VR: { nome: "Verona", zona: "Italia" },
  VI: { nome: "Vicenza", zona: "Italia" }, TV: { nome: "Treviso", zona: "Italia" },
  BL: { nome: "Belluno", zona: "Italia" }, PD: { nome: "Padova", zona: "Italia" },
  RO: { nome: "Rovigo", zona: "Italia" },
  UD: { nome: "Udine", zona: "Italia" }, GO: { nome: "Gorizia", zona: "Italia" },
  TS: { nome: "Trieste", zona: "Italia" }, PN: { nome: "Pordenone", zona: "Italia" },
  GE: { nome: "Genova", zona: "Italia" }, IM: { nome: "Imperia", zona: "Italia" },
  SP: { nome: "La Spezia", zona: "Italia" }, SV: { nome: "Savona", zona: "Italia" },
  BO: { nome: "Bologna", zona: "Italia" }, FE: { nome: "Ferrara", zona: "Italia" },
  FC: { nome: "Forlì-Cesena", zona: "Italia" }, MO: { nome: "Modena", zona: "Italia" },
  PR: { nome: "Parma", zona: "Italia" }, PC: { nome: "Piacenza", zona: "Italia" },
  RA: { nome: "Ravenna", zona: "Italia" }, RE: { nome: "Reggio Emilia", zona: "Italia" },
  RN: { nome: "Rimini", zona: "Italia" },
  FI: { nome: "Firenze", zona: "Italia" }, AR: { nome: "Arezzo", zona: "Italia" },
  GR: { nome: "Grosseto", zona: "Italia" }, LI: { nome: "Livorno", zona: "Italia" },
  LU: { nome: "Lucca", zona: "Italia" }, MS: { nome: "Massa-Carrara", zona: "Italia" },
  PI: { nome: "Pisa", zona: "Italia" }, PT: { nome: "Pistoia", zona: "Italia" },
  PO: { nome: "Prato", zona: "Italia" }, SI: { nome: "Siena", zona: "Italia" },
  PG: { nome: "Perugia", zona: "Italia" }, TR: { nome: "Terni", zona: "Italia" },
  AN: { nome: "Ancona", zona: "Italia" }, AP: { nome: "Ascoli Piceno", zona: "Italia" },
  FM: { nome: "Fermo", zona: "Italia" }, MC: { nome: "Macerata", zona: "Italia" },
  PU: { nome: "Pesaro e Urbino", zona: "Italia" },
  RM: { nome: "Roma", zona: "Italia" }, FR: { nome: "Frosinone", zona: "Italia" },
  LT: { nome: "Latina", zona: "Italia" }, RI: { nome: "Rieti", zona: "Italia" },
  VT: { nome: "Viterbo", zona: "Italia" },
  AQ: { nome: "L'Aquila", zona: "Italia" }, CH: { nome: "Chieti", zona: "Italia" },
  PE: { nome: "Pescara", zona: "Italia" }, TE: { nome: "Teramo", zona: "Italia" },
  CB: { nome: "Campobasso", zona: "Italia" }, IS: { nome: "Isernia", zona: "Italia" },
  NA: { nome: "Napoli", zona: "Italia" }, AV: { nome: "Avellino", zona: "Italia" },
  BN: { nome: "Benevento", zona: "Italia" }, CE: { nome: "Caserta", zona: "Italia" },
  SA: { nome: "Salerno", zona: "Italia" },
  BA: { nome: "Bari", zona: "Italia" }, BT: { nome: "Barletta-Andria-Trani", zona: "Italia" },
  BR: { nome: "Brindisi", zona: "Italia" }, FG: { nome: "Foggia", zona: "Italia" },
  LE: { nome: "Lecce", zona: "Italia" }, TA: { nome: "Taranto", zona: "Italia" },
  PZ: { nome: "Potenza", zona: "Italia" }, MT: { nome: "Matera", zona: "Italia" },
  // Calabria
  CZ: { nome: "Catanzaro", zona: "Calabria" }, CS: { nome: "Cosenza", zona: "Calabria" },
  KR: { nome: "Crotone", zona: "Calabria" }, RC: { nome: "Reggio Calabria", zona: "Calabria" },
  VV: { nome: "Vibo Valentia", zona: "Calabria" },
  // Sicilia
  PA: { nome: "Palermo", zona: "Sicilia" }, AG: { nome: "Agrigento", zona: "Sicilia" },
  CL: { nome: "Caltanissetta", zona: "Sicilia" }, CT: { nome: "Catania", zona: "Sicilia" },
  EN: { nome: "Enna", zona: "Sicilia" }, ME: { nome: "Messina", zona: "Sicilia" },
  RG: { nome: "Ragusa", zona: "Sicilia" }, SR: { nome: "Siracusa", zona: "Sicilia" },
  TP: { nome: "Trapani", zona: "Sicilia" },
  // Sardegna (incluse le sigle storiche pre-2016, presenti ancora in alcuni archivi)
  CA: { nome: "Cagliari", zona: "Sardegna" }, NU: { nome: "Nuoro", zona: "Sardegna" },
  OR: { nome: "Oristano", zona: "Sardegna" }, SS: { nome: "Sassari", zona: "Sardegna" },
  SU: { nome: "Sud Sardegna", zona: "Sardegna" }, CI: { nome: "Carbonia-Iglesias", zona: "Sardegna" },
  OG: { nome: "Ogliastra", zona: "Sardegna" }, OT: { nome: "Olbia-Tempio", zona: "Sardegna" },
  VS: { nome: "Medio Campidano", zona: "Sardegna" },
};

function provinciaInfo(sigla) {
  const s = (sigla || "").toUpperCase().trim();
  return PROVINCE[s] || { nome: s || "—", zona: "Italia" };
}

// L'ordine delle due sigle provincia (partenza/arrivo) in fattura BRT non è
// sempre lo stesso — dipende dal formato della riga. Il magazzino di origine
// De Matteo Home è sempre a Caserta (CE): quindi la sigla che NON è "CE" è
// quasi sempre l'arrivo (destinazione), indipendentemente da che posizione
// occupa nella riga. Se entrambe le sigle sono CE, è una consegna locale.
function risolviArrivo(sigla1, sigla2, origine = "CE") {
  const a = (sigla1 || "").toUpperCase().trim();
  const b = (sigla2 || "").toUpperCase().trim();
  if (a && a !== origine) return a;
  if (b && b !== origine) return b;
  return a || b || origine;
}

module.exports = { PROVINCE, provinciaInfo, risolviArrivo };
