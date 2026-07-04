// lib/tariff.js
// Stessa logica già usata nell'app attuale (fasce di peso x zona).
// Se BRT aggiorna le tariffe, modifica solo questo file.

const DEFAULT_TARIFF = {
  brackets: [
    { label: "0 – 5", max: 5, Italia: 4.700, Calabria: 5.700, Sicilia: 5.700, Sardegna: 5.600 },
    { label: "6 – 20", max: 20, Italia: 9.500, Calabria: 10.500, Sicilia: 10.500, Sardegna: 10.500 },
    { label: "21 – 40", max: 40, Italia: 12.400, Calabria: 14.300, Sicilia: 14.300, Sardegna: 14.300 },
    { label: "41 – 60", max: 60, Italia: 15.200, Calabria: 19.000, Sicilia: 19.000, Sardegna: 19.000 },
    { label: "61 – 80", max: 80, Italia: 19.000, Calabria: 23.800, Sicilia: 23.800, Sardegna: 23.800 },
  ],
  oltre: { Italia: 22.800, Calabria: 28.500, Sicilia: 28.500, Sardegna: 28.500 },
};

function detectZona(cap) {
  if (!cap || cap.length < 2) return "Italia";
  const p = parseInt(cap.slice(0, 2), 10);
  if (p >= 7 && p <= 9) return "Sardegna";
  if (p >= 87 && p <= 89) return "Calabria";
  if (p >= 90 && p <= 98) return "Sicilia";
  return "Italia";
}

function calcAtteso(peso, zona, tariff = DEFAULT_TARIFF) {
  peso = parseFloat(peso) || 0;
  for (const b of tariff.brackets) {
    if (peso <= b.max) return b[zona] ?? b.Italia;
  }
  const rate = tariff.oltre[zona] ?? tariff.oltre.Italia;
  return rate * (peso / 100);
}

module.exports = { DEFAULT_TARIFF, detectZona, calcAtteso };
