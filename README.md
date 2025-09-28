# Werwolf 🐺

[![CI](https://github.com/puukis/werwolf/actions/workflows/ci.yml/badge.svg)](https://github.com/puukis/werwolf/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)

A web-based role-playing game of deception and deduction. This is a digital version of the popular party game "Mafia" or "Werewolf," designed for a seamless and immersive experience.

![Gameplay Screenshot](https://via.placeholder.com/800x400.png?text=Gameplay+Screenshot+Here)
*(Feel free to replace the placeholder above with a real screenshot or GIF of your game!)*

---

## 📜 Table of Contents

- [✨ Features](#-features)
- [🎮 How to Play](#-how-to-play)
  - [1. Setup](#1-setup)
  - [2. Role Assignment](#2-role-assignment)
  - [3. Night Phase](#3-night-phase)
  - [4. Day Phase](#4-day-phase)
  - [5. Winning](#5-winning)
- [🎭 Roles](#-roles)
- [🎤 Narrator Toolkit](#-narrator-toolkit)
  - [Dashboard Overview](#dashboard-overview)
  - [Timer Controls & Checkpoints](#timer-controls--checkpoints)
  - [Macros & Quick Actions](#macros--quick-actions)
  - [Recovery & Session Management](#recovery--session-management)
- [🛠️ Tech Stack](#-tech-stack)
- [🚀 Getting Started](#-getting-started)
- [🗃️ Backend & Datenbank](#%EF%B8%8F-backend--datenbank)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

---

## ✨ Features

- **Dynamic Role Assignment**: Automatically suggests role compositions based on the number of players.
- **Interactive Gameplay**: Features distinct night and day phases with interactive choices for special roles.
- **Special Roles**: Includes a variety of roles like Werwolf, Seer, Witch, Amor, and more, each with unique abilities.
- **Light & Dark Mode**: A sleek theme toggle for comfortable viewing in any lighting condition.
- **Session Management**: Save and load previous game sessions to pick up right where you left off.
- **Random Events**: An optional "Full Moon" event that gives werewolves an extra kill, adding a layer of unpredictability.
- **Responsive Design**: Playable on both desktop and mobile devices.
- **Persistenter Speicher**: Alle Spielstände und Einstellungen werden über einen kleinen Express-Server mit PostgreSQL-Backend gespeichert.

---

## 🎮 How to Play

The game is divided into two main phases: **Night** and **Day**. The goal is for the **Dorfbewohner (Villagers)** to eliminate all the **Werwölfe (Werewolves)**, while the Werewolves try to outnumber the Villagers.

### 1. Setup

1.  **Enter Player Names**: In the "Spieler" section, enter the names of all players, one per line.
2.  **Select Roles**: In the "Rollen" section, adjust the number of each role you want in the game. The game will suggest a balanced setup based on the player count.
3.  **Start the Game**: Click the "Rollen zuteilen" (Assign Roles) button.

### 2. Role Assignment

- Each player is assigned a card with their name.
- Click on a card to flip it and reveal the player's role. This should be done privately for each player.
- Once everyone knows their role, click the "Nacht starten" (Start Night) button to begin the first night.

### 3. Night Phase

During the night, players with special roles will be prompted to perform their actions. The game will guide you through the sequence.

- **Amor**: Chooses two players to become lovers.
- **Seer**: Can choose one player to reveal their role.
- **Werwolf**: The werewolves choose one player to eliminate.
- **Hexe (Witch)**: Can choose to save the werewolves' victim with a healing potion or eliminate another player with a poison potion.
- **Stumme Jule**: Chooses one player to silence for the next day.

### 4. Day Phase

- The game announces who was eliminated during the night.
- The remaining players discuss who they suspect might be a werewolf.
- The silenced player is not allowed to speak or vote.
- After the discussion, a vote is held to "lynch" a suspect.
- The player with the most votes is eliminated.

### 5. Winning

- The **Dorfbewohner (Villagers)** win if they successfully eliminate all werewolves.
- The **Werwölfe (Werewolves)** win if they equal or outnumber the villagers.
- The **Liebende (Lovers)** win if they are the last two players alive.
- The **Trickster** wins if they are lynched by the villagers.

---

## 🎭 Roles

- **Werwolf**: A member of the werewolf team. Their goal is to eliminate all villagers.
- **Dorfbewohner (Villager)**: A regular player with no special abilities. Their goal is to find and eliminate the werewolves.
- **Seer**: Can see the true role of one player each night.
- **Hexe (Witch)**: Has two single-use potions: one to heal a player targeted by werewolves, and one to poison a player.
- **Amor**: Chooses two players to be lovers at the start of the game. If one dies, the other dies of a broken heart.
- **Jäger (Hunter)**: When eliminated, the Hunter can take one last shot to eliminate another player.
- **Trickster**: A neutral role whose goal is to get lynched by the villagers.
- **Stumme Jule**: Can choose one player each night to silence for the following day.

---

## 🎤 Narrator Toolkit

The Erzähler tools keep the flow of the evening under control and give you recovery options when something unexpected happens. All controls live in the right-hand admin panel.

### Dashboard Overview

- **Phase & counts**: The dashboard highlights the active phase, night/day counters, and remaining players per faction so you can pace discussions and reveal moments.
- **Spotlight & status**: Dedicated rows surface the current Bürgermeister, Michael-Jackson spotlight target, silenced speaker, and any pending revenge or Blood Moon effects.
- **Action log**: Every modal confirmation, macro, and admin change writes to the timeline. Use it as a quick audit trail or to brief co-hosts who join mid-game.

### Timer Controls & Checkpoints

- **Phase timers**: Pause or resume the automatic day/night timers from the admin panel. When timers are paused, an entry is logged so everyone knows why the game is waiting.
- **Automatic checkpoints**: The game saves snapshots after role assignment, at the start of each night, and when sessions are loaded. You’ll see these in the checkpoint list with descriptive labels.
- **Rollback**: Use the “Letzten Checkpoint wiederherstellen” button to return to the last snapshot. A summary appears in the timeline so the group understands what changed.

### Macros & Quick Actions

- **Preset actions**: Macros cover common narrator chores such as reviving everyone, refreshing witch potions, or undoing the previous night. Run a macro from the dropdown to apply it immediately.
- **Admin edits**: Quick actions let you change roles, revive players, eliminate troublemakers, or toggle the Blood Moon. Every change logs its detail so you can retrace steps later.
- **Sandbox support**: The sandbox macro captures the current selection in the night UI and echoes it to the log. It’s handy for dry runs or explaining special phases.

### Recovery & Session Management

- **Run locally**: Clone the repository, richte den Backend-Server gemäß [Backend & Datenbank](#%EF%B8%8F-backend--datenbank) ein und öffne `index.html` anschließend über einen lokalen Webserver.
- **Session saving**: Use the “Spiel speichern” button in the sessions sidebar to store the full state (players, roles, potions, timers). Saved sessions appear in the list for one-click recovery.
- **Manual backups**: From the setup screen you can store and reload player name lists or role configurations. Each attempt now surfaces a modal so you always know whether the operation succeeded.
- **Checkpoint workflow**: Before major reveals, consider triggering a manual macro checkpoint (e.g., via the sandbox). If a misclick happens, roll back and continue without breaking immersion.

---

## 🛠️ Tech Stack

- **HTML5**: For the structure of the web application.
- **CSS3**: For styling, animations, and the light/dark theme.
- **JavaScript (ES6+)**: For all the game logic, state management, and interactivity.

---

## 🚀 Getting Started

1.  Clone the repository:
    ```bash
    git clone https://github.com/puukis/werwolf.git
    ```
2.  Navigate to the project directory:
    ```bash
    cd werwolf
    ```
3.  Install the dependencies:
    ```bash
    npm install
    ```
4.  Starte einen lokalen Webserver deiner Wahl (z. B. über eine IDE oder `npx http-server`) und öffne anschließend `index.html` über `http://localhost:<PORT>`. Für die persistente Speicherung muss der API-Server unter derselben Origin laufen (siehe [Backend & Datenbank](#%EF%B8%8F-backend--datenbank)).

> 💡 Wenn du die Datei nur per `file://` öffnest, kann der Browser den API-Server nicht erreichen und der Status wird nicht gespeichert.

---

## 🗃️ Backend & Datenbank

Die Speicherung aller Themes, Namenslisten, Rollen-Vorlagen und Spielstände läuft über einen Express-Server mit PostgreSQL 16. Dieses Kapitel erklärt die vollständige Einrichtung.

### Voraussetzungen

- Node.js 18 oder neuer (inkl. `npm`)
- PostgreSQL 16 (lokal oder als verwalteter Dienst)
- Zugriff auf die Kommandozeile (`psql` bzw. `createdb`)

### 1. Datenbankbenutzer & Datenbank anlegen

Erstelle zuerst eine dedizierte Datenbank samt Benutzer. Das folgende Beispiel richtet alles lokal über die Standardrolle `postgres` ein:

```bash
# Als Postgres-Superuser ausführen (z. B. via `sudo -u postgres psql`)
psql <<'SQL'
CREATE ROLE werwolf_user WITH LOGIN PASSWORD 'wechselmich';
CREATE DATABASE werwolf OWNER werwolf_user;
GRANT ALL PRIVILEGES ON DATABASE werwolf TO werwolf_user;
SQL
```

> ⚠️ Ersetze `wechselmich` unbedingt durch ein sicheres Passwort.

### 2. Umgebungsvariablen konfigurieren

Der Server liest seine Verbindungseinstellungen aus den Standard-Postgres-Variablen (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`) oder aus einer kompletten `DATABASE_URL`. Für lokale Installationen genügt beispielsweise eine `.env`-Datei (z. B. via [`direnv`](https://direnv.net/) oder [npm `dotenv-cli`](https://www.npmjs.com/package/dotenv-cli)) mit folgendem Inhalt:

```bash
PGHOST=localhost
PGPORT=5432
PGUSER=werwolf_user
PGPASSWORD=wechselmich
PGDATABASE=werwolf
```

Bei gehosteten Datenbanken kannst du stattdessen eine vollständige URL setzen:

```bash
export DATABASE_URL="postgres://werwolf_user:wechselmich@db.example.com:5432/werwolf"
```

Wenn dein Anbieter SSL erzwingt, ergänze `PGSSLMODE=require`, damit `pg` die Verbindung korrekt aufbaut.

### 3. Migrationen ausführen

Nach der Konfiguration einmalig alle Tabellen anlegen:

```bash
npm run migrate
```

Das Script legt eine Tabelle `kv_store` (für Einstellungen & Namenslisten) sowie `sessions` (für Spielstände) an und protokolliert ausgeführte Migrationen in `schema_migrations`.

### 4. API-Server starten

Starte den Express-Server im Projektstamm:

```bash
npm start
```

Standardmäßig lauscht er auf Port `3001`. Du kannst den Port über die Umgebungsvariable `PORT` ändern.

### 5. Frontend mit der API verbinden

Der Client erwartet die API unter derselben Origin wie die ausgelieferte `index.html` (relative Requests auf `/api`). Für die lokale Entwicklung kannst du z. B. so vorgehen:

1. API starten (`npm start`).
2. Separaten statischen Webserver für das Frontend starten, der Requests auf `/api` an `http://localhost:3001` weiterleitet (Reverse-Proxy) oder beide Assets über denselben Express-Server ausliefern.
3. Anschließend `http://localhost:<frontend-port>` aufrufen.

Viele Tools (VS Code *Live Server*, `vite preview`, `serve`, usw.) bieten Proxy-Optionen – konfiguriere `/api` → `http://localhost:3001`.

### 6. Datenpflege & Nutzung

- Themes, gespeicherte Namen und Rollen werden automatisch über die API gelesen/geschrieben.
- Spielstände (`/api/sessions`) speichern automatisch die letzten 20 Snapshots.
- Bei Fehlermeldungen prüfe das Server-Log und deine Datenbankverbindung.

> ✨ Du kannst Daten jederzeit direkt per `psql` inspizieren:
> ```bash
> psql $PGDATABASE $PGUSER
> SELECT key, value, updated_at FROM kv_store;
> SELECT timestamp, created_at FROM sessions;
> ```

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/puukis/werwolf/issues).

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.