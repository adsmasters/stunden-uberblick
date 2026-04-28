# Stundencheck

Stundenübersicht für Kunden – online gehostet auf GitHub Pages, Daten in Supabase.

## Funktionen

- **Übersicht**: Alle Kunden auf einen Blick, farbige Hervorhebung welche **Abteilung über Budget** ist
- **Stunden eintragen**: Pro Kunde und Monat Account Management und Advertising Stunden separat eingeben
- **Detailansicht**: Monat-für-Monat Aufschlüsselung, direkt klicken zum Bearbeiten
- **Kunden verwalten**: Kunden anlegen, umbenennen, Budgets setzen, löschen
- **Geteilt**: Alle Mitarbeiter sehen dieselben Daten über Supabase

## Setup (einmalig)

### 1. Supabase-Projekt erstellen

1. Gehe zu [supabase.com](https://supabase.com) → kostenloses Konto erstellen
2. Neues Projekt anlegen (Region: EU West empfohlen)
3. Warte ca. 1–2 Minuten bis das Projekt bereit ist

### 2. Datenbank einrichten

Im Supabase Dashboard: **SQL Editor → New Query** → folgendes Script einfügen und ausführen:

```sql
-- Kundentabelle
create table if not exists clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  am_budget  numeric,
  adv_budget numeric,
  created_at timestamptz default now()
);

-- Monatseinträge
create table if not exists entries (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  year       int  not null,
  month      int  not null,
  am_hours   numeric not null default 0,
  adv_hours  numeric not null default 0,
  updated_at timestamptz default now(),
  constraint entries_unique unique (client_id, year, month)
);

alter table clients disable row level security;
alter table entries disable row level security;
```

### 3. Zugangsdaten notieren

Im Supabase Dashboard: **Project Settings → API**
- **Project URL** (z.B. `https://xxxx.supabase.co`)
- **anon public** Key

### 4. GitHub Pages aktivieren

```bash
cd stundencheck
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/DEIN-USER/stundencheck.git
git push -u origin main
```

Dann: Repository → **Settings → Pages → Source: main** → Save

Die URL lautet: `https://DEIN-USER.github.io/stundencheck/`

### 5. Tool konfigurieren

URL an alle Mitarbeiter teilen. Jeder gibt einmalig in den **Einstellungen** ein:
- Supabase Project URL
- Supabase anon Key

Alle sehen danach dieselben Daten.

## Bedienung

| Seite | Funktion |
|---|---|
| **Übersicht** | Monatsauswahl → zeigt alle Kunden mit farbigen Zellen für überschrittene Abteilungen |
| **Kunden** | Kunden anlegen, Budgets setzen, löschen |
| **Detailansicht** | Jahresansicht eines Kunden – Stunden durch Klick auf den Wert direkt bearbeiten |
| **Einstellungen** | Supabase-Verbindung konfigurieren |

## Stunden eingeben

**Übersicht**: Stift-Symbol in der Zeile des Kunden klicken → Monat wird aus dem Filter übernommen

**Detailansicht**: Auf den Stundenwert (unterstrichen) direkt klicken → Eingabefeld erscheint → Enter zum Speichern

Stunden werden als Dezimalzahl eingegeben: `12.5` = 12:30 h
