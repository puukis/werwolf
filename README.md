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
- **No Server Needed**: A complete client-side application that runs directly in your browser.

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

- **Run locally**: Clone the repository, open `index.html` in a browser, and you’re ready to facilitate offline. No server setup is required.
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

This is a purely client-side application, so no installation is needed.

1.  Clone the repository:
    ```bash
    git clone https://github.com/puukis/werwolf.git
    ```
2.  Navigate to the project directory:
    ```bash
    cd werwolf
    ```
3.  Open the `index.html` file in your favorite web browser.

That's it! You're ready to play.

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/puukis/werwolf/issues).

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.