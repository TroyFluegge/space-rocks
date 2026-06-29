# Space Rocks

A modern Asteroids-style space shooter built with HTML5 Canvas and vanilla JavaScript. No build step, no dependencies — just a Python server for shared global high scores.

## Running

```bash
git clone https://github.com/TroyFluegge/space-rocks.git
cd space-rocks
python3 server.py
# open http://localhost:8765
```

The server handles both game files and the global leaderboard API. Scores are stored in `scores.db` (SQLite, auto-created). You can also open `index.html` directly as a file, but the leaderboard will fall back to local-only storage.

## Controls

### Keyboard
| Key | Action |
|---|---|
| `W` / `↑` | Thrust forward |
| `S` / `↓` | Reverse thrust |
| `A` / `←` | Rotate left |
| `D` / `→` | Rotate right |
| `Space` | Shoot / hold for laser beam |
| `B` | Detonate bomb |

### Mobile / Touch
| Gesture | Action |
|---|---|
| Quick tap (< 180 ms, < 22 px) | Fire a shot |
| Drag left / right ≥ 30 px | Rotate ship |
| Drag up ≥ 30 px | Thrust forward |
| Tap **B** button (bottom-right) | Detonate bomb (visible only when you have bombs) |
| Tap on menu or game-over screen | Start / restart |

Touch anywhere on the canvas and drag relative to where you touched — no fixed joystick to hunt for. Name entry on mobile opens your keyboard automatically.

## Gameplay

- Shoot space rocks to break them apart — large → medium → small → gone
- Avoid collisions or lose a life (3 lives total)
- Clear all rocks to advance to the next level
- Each level increases rock speed, spawn rate, and enemy aggression
- The space background changes each level (8 distinct themes cycling)

## Power-ups

Colored diamond pickups drift across the field. Collect them by flying into them. Large rocks have a 15% chance to drop one on destruction.

| Color | Type | Effect | Duration |
|---|---|---|---|
| Yellow **R** | Rapid Fire | Fire rate 0.25s → 0.08s | 15s |
| Cyan **S** | Spread Shot | 3 bullets in a fan | 15s |
| Magenta **L** | Laser Beam | Hold Space for a continuous raycast beam | 15s |
| Orange **B** | Bomb | Stored (up to 3) — press `B` to split all rocks and destroy all enemies | One-use |

Active weapon shown bottom-left with a countdown bar. Laser mode also shows a charge meter; overheating locks the laser out briefly.

## Friendlies

Spacemen and International Space Stations drift across the field on a straight trajectory and eventually leave the screen.

| Friendly | Touch effect | Shot effect | Fire pattern |
|---|---|---|---|
| Spaceman | 15s auto-aim assist | −250 pts | Single aimed shot at nearest rock (0.25s rate) |
| ISS | 15s auto-aim assist | −1000 pts | 8-bullet star burst in all directions (0.5s rate) |

**To activate:** fly your ship into the friendly's hitbox. A cyan particle burst and notification confirm activation. The friendly continues on its path and fires from its own position.

**Re-activation:** after 15 seconds expires, fly back into the same friendly (while it's still on screen) for another 15 seconds.

**Immunity:** a friendly you are currently touching cannot be hit by your bullets, so flying into one while shooting is safe.

## Enemies

Green glowing UFO saucers spawn from screen edges every 7–12 seconds (interval shrinks with level). Worth **500 points** each. Starting at level 3 they home in on your position. One shot destroys them; collision costs a life.

## Scoring

| Target | Points |
|---|---|
| Large rock | 20 |
| Medium rock | 50 |
| Small rock | 100 |
| Enemy saucer | 500 |
| Shoot spaceman | −250 |
| Shoot ISS | −1,000 |

## Global High Scores

The top 10 scores are shared across all players on the same server. When your game ends with a qualifying score, a name entry screen appears — type your name (up to 12 characters) and press **Enter** to submit. The leaderboard is visible on the main menu and updates live as other players post scores.

## Files

```
index.html   — canvas shell and CSS
game.js      — all game logic (~2,600 lines, no modules)
server.py    — Python score server (stdlib only, no pip install needed)
scores.db    — SQLite score database (auto-created on first run)
```
