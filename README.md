# Controllo Fatture BRT — De Matteo Home

Backend + logica per il controllo automatico delle fatture BRT, con incrocio
dati da WooCommerce (cliente → prodotto acquistato → peso reale) per
verificare se BRT sta addebitando pesi/prezzi superiori al dovuto.

## Perché serve un backend (e non solo un file HTML)

Le chiavi API di WooCommerce non possono stare scritte in un file che gira
nel browser: chiunque potrebbe leggerle con "Ispeziona/Visualizza sorgente"
e accedere a ordini e clienti del negozio. Qui invece le chiavi restano solo
sul server (variabili d'ambiente Vercel), mai visibili al browser.

## Cosa fa ogni pezzo

- `lib/tariff.js` — calcola il prezzo di trasporto atteso per fascia peso/zona
- `lib/parseInvoice.js` — legge il testo del PDF BRT ed estrae le spedizioni
- `pages/api/parse-invoice.js` — riceve il PDF caricato e lo analizza
- `pages/api/woo/find-order.js` — cerca su WooCommerce l'ordine del cliente
  della spedizione BRT (per nome e periodo) e ne restituisce i prodotti
- `pages/api/woo/product-weight.js` — recupera il peso reale di un prodotto
  dal catalogo WooCommerce
- `pages/api/invoices/*` — archivio fatture (sostituisce lo storage di Claude)

## Setup per Andrea

### 1. Chiavi WooCommerce (fatte generare dal cliente)
WooCommerce → Impostazioni → Avanzate → API REST → Aggiungi chiave
- Permesso: **Lettura**
- Copia Consumer Key e Consumer Secret

### 2. Deploy su Vercel
```
git init
git add .
git commit -m "Prima versione"
# crea un repo su GitHub e collegalo
git remote add origin <url-repo-github>
git push -u origin main
```
Poi su vercel.com → New Project → importa il repo.

### 3. Variabili d'ambiente su Vercel
Project Settings → Environment Variables → aggiungi:
- `WC_URL` = https://dematteohome.it
- `WC_KEY` = (consumer key generata al punto 1)
- `WC_SECRET` = (consumer secret generata al punto 1)

### 4. Database (archivio fatture)
Vercel Dashboard → Storage → Create Database → **KV** → collega al progetto.
Vercel imposta da solo le variabili `KV_*` necessarie, non serve fare nulla
a mano.

### 5. Dominio
Project Settings → Domains → aggiungi `controllo-fatture.dematteohome.it`
(o il nome scelto) e segui le istruzioni DNS mostrate da Vercel.

## Stato del progetto

Questa è la **prima fase**: backend e logica di base pronti e testabili.
Il frontend (l'interfaccia grafica completa che Anna usa oggi, con tutte le
tab — Archivio, Da verificare, Tariffario, Email, Guida) va riportato qui
sopra queste API una volta confermato che il collegamento a WooCommerce
funziona correttamente con dati reali. Consiglio: testare prima
`/api/woo/find-order` con un nome cliente vero e verificare che i prodotti
tornino corretti, prima di investire tempo sul resto dell'interfaccia.

## Nota sul matching cliente → ordine

Il collegamento fattura BRT → ordine WooCommerce avviene per **nome cliente
+ finestra di date** (WooCommerce non conosce il numero di spedizione BRT).
Non è garantito al 100% (nomi omonimi, ordini multipli nello stesso periodo)
— l'interfaccia dovrà sempre mostrare il match trovato per conferma umana,
mai applicarlo alla cieca.
