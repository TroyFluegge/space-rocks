'use strict';

// ── Constants ───────────────────────────────────────────────────────────────

let CANVAS_W = window.innerWidth;
let CANVAS_H = window.innerHeight;

const ROTATION_SPEED = 2.5;   // rad/s
const THRUST         = 220;   // px/s²
const FRICTION       = 0.985; // velocity multiplier per frame
const MAX_SPEED      = 320;   // px/s
const BULLET_SPEED   = 520;   // px/s
const MAX_BULLETS    = 5;
const SHOOT_COOLDOWN = 0.25;  // seconds

const SIZE_CONFIG = {
    large:  { radius: 40, points: 20,  rotSpeed: 0.6 },
    medium: { radius: 22, points: 50,  rotSpeed: 1.0 },
    small:  { radius: 11, points: 100, rotSpeed: 2.0 },
};

const ENEMY_POINTS        = 500;
const ENEMY_RADIUS        = 26;
const ENEMY_SPAWN_BASE    = 7;  // seconds between enemy spawns at level 1
const ENEMY_HOMING_LEVEL  = 3;  // level at which enemies start homing

const POWERUP_RADIUS      = 14;
const POWERUP_LIFETIME    = 12; // seconds before powerup disappears
const WEAPON_DURATION     = 15; // seconds a weapon upgrade lasts
const MAX_BOMBS           = 3;
const LASER_DRAIN         = 0.38; // charge/sec while firing
const LASER_REGEN         = 0.22; // charge/sec while not firing
const LASER_DAMAGE_RATE   = 0.15; // seconds between laser hits on a target

const POWERUP_COLORS = { rapid: '#ffdd00', spread: '#00ccff', laser: '#ff44ff', bomb: '#ff8800' };
const POWERUP_LABELS = { rapid: 'R', spread: 'S', laser: 'L', bomb: 'B' };

const SPACEMAN_RADIUS     = 16;
const ISS_RADIUS          = 42;
const SPACEMAN_PENALTY    = 250;
const ISS_PENALTY         = 1000;
const ASSIST_DURATION     = 15;   // seconds auto-fire lasts
const SPACEMAN_FIRE_RATE  = SHOOT_COOLDOWN; // matches default shooting rhythm
const ISS_FIRE_RATE       = 0.5;            // star-burst interval (8 bullets at once)
const FRIENDLY_SPAWN_BASE = 28;   // seconds between friendly spawns

const MAX_LEADERBOARD = 10;
const MAX_NAME_LENGTH = 12;

const GYRO_DEAD_ZONE   = 5;   // degrees of tilt ignored on each side
const GYRO_MAX_TILT    = 30;  // degrees for full rotation speed
const GYRO_THRUST_ANGLE = 12; // degrees forward tilt to activate thrust

// Unit-scale polygon vertices for three irregular rock shapes
const DEBRIS_SHAPES = [
    [[ 0,-1],[0.5,-0.7],[0.9,-0.3],[0.85,0.4],[0.3,0.9],[-0.5,0.8],[-0.9,0.2],[-0.6,-0.6]],
    [[ 0,-0.9],[0.7,-0.5],[1,0.1],[0.4,0.85],[-0.4,0.9],[-0.9,0.3],[-0.75,-0.5],[0.1,-0.7]],
    [[ 0,-1],[0.65,-0.6],[0.85,0.25],[0.5,0.9],[-0.3,1],[-0.95,0.4],[-0.8,-0.45],[0.15,-0.65]],
];

// ── Canvas / Context ────────────────────────────────────────────────────────

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

function resizeCanvas() {
    CANVAS_W = canvas.width  = window.innerWidth;
    CANVAS_H = canvas.height = window.innerHeight;
    generateStars();
    generateBackground();
}
window.addEventListener('resize', resizeCanvas);

// ── Input ───────────────────────────────────────────────────────────────────

const keys = {};
window.addEventListener('keydown', e => {
    keys[e.code] = true;
    const blocked = ['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
    if (blocked.includes(e.code)) e.preventDefault();
    ensureAudio();

    // Name entry input — handle character capture
    if (state === 'name_entry') {
        const _ni = document.getElementById('nameInput');
        const mobileInputFocused = _ni && document.activeElement === _ni;

        if (e.key === 'Enter') {
            if (_ni) { _ni.blur(); _ni.style.pointerEvents = 'none'; }
            const enteredName = nameEntryText.trim() || 'PILOT';
            state = 'menu';
            submitScore(enteredName); // async — fire and forget
            e.preventDefault();
        } else if (mobileInputFocused) {
            // Mobile: let the input receive characters natively; oninput syncs nameEntryText.
            // Do NOT call preventDefault here — that's what was reversing the input.
        } else {
            if (e.key === 'Backspace') {
                nameEntryText = nameEntryText.slice(0, -1);
            } else if (e.key.length === 1 && nameEntryText.length < MAX_NAME_LENGTH) {
                nameEntryText += e.key.toUpperCase();
            }
            e.preventDefault();
        }
    }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    ensureAudio();
    initGyro();
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
    }
    const t = e.touches[0];
    touch = { active: true, startX: t.clientX, startY: t.clientY,
              startTime: Date.now(), curX: t.clientX, curY: t.clientY };
    if (state === 'playing' && bombs > 0 && isBombButtonHit(t.clientX, t.clientY)) {
        detonateBomb();
        touch.active = false;
    }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    touch.curX = e.touches[0].clientX;
    touch.curY = e.touches[0].clientY;
}, { passive: false });

canvas.addEventListener('touchend', e => {
    e.preventDefault();
    const elapsed = Date.now() - touch.startTime;
    const moved   = Math.hypot(touch.curX - touch.startX, touch.curY - touch.startY);
    if (elapsed < 180 && moved < 22) {
        if (state === 'playing') {
            touchShootPending = true;
        } else if (state === 'menu') {
            keys['Space'] = true;
            setTimeout(() => { keys['Space'] = false; }, 80);
        } else if (state === 'game_over' && gameOverLockout <= 0) {
            keys['Space'] = true;
            setTimeout(() => { keys['Space'] = false; }, 80);
        }
    }
    touch.active = false;
}, { passive: false });

function isLeft()    { return keys['KeyA'] || keys['ArrowLeft'];  }
function isRight()   { return keys['KeyD'] || keys['ArrowRight']; }
function isForward() {
    if (keys['KeyW'] || keys['ArrowUp']) return true;
    if (gyroActive) return getDeviceTilt().tiltFB > GYRO_THRUST_ANGLE;
    return false;
}
function isBack()    { return keys['KeyS'] || keys['ArrowDown']; }
function isShoot()   { return keys['Space'] || touchShootPending; }
function isStart()   { return keys['Space'] || keys['Enter']; }

// Read current screen rotation angle (0, 90, 180, 270).
function getScreenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') {
        return screen.orientation.angle;
    }
    return typeof window.orientation === 'number' ? window.orientation : 0;
}

// Return { tiltLR, tiltFB } compensated for screen orientation.
// tiltLR: negative = player's left, positive = player's right.
// tiltFB: positive = player tilting device forward (thrust).
function getDeviceTilt() {
    const dGamma = gyroGamma - gyroBaseGamma;
    const dBeta  = gyroBeta  - gyroBaseBeta;
    switch (getScreenAngle()) {
        case 90:          return { tiltLR:  dBeta, tiltFB:  dGamma };
        case 270: case -90: return { tiltLR: -dBeta, tiltFB: -dGamma };
        case 180:         return { tiltLR: -dGamma, tiltFB:  dBeta };
        default:          return { tiltLR:  dGamma, tiltFB: -dBeta };
    }
}

// Returns -1..1: negative = rotate left, positive = rotate right.
// Returns 0 when inside dead zone or gyro inactive.
function gyroRotInput() {
    if (!gyroActive) return 0;
    const { tiltLR } = getDeviceTilt();
    if (Math.abs(tiltLR) < GYRO_DEAD_ZONE) return 0;
    const sign = tiltLR > 0 ? 1 : -1;
    return sign * Math.min(1, (Math.abs(tiltLR) - GYRO_DEAD_ZONE) / (GYRO_MAX_TILT - GYRO_DEAD_ZONE));
}

function calibrateGyro() {
    gyroBaseBeta  = gyroBeta;
    gyroBaseGamma = gyroGamma;
}

function initGyro() {
    if (gyroInitialized) return;
    gyroInitialized = true;

    function startListening() {
        window.addEventListener('deviceorientation', e => {
            if (e.gamma === null || e.beta === null) return;
            gyroBeta  = e.beta;
            gyroGamma = e.gamma;
            if (!gyroActive) {
                gyroActive = true;
                calibrateGyro();
                if (state === 'playing') {
                    notification = { text: 'TILT TO STEER  TAP TO SHOOT', color: '#00eeff', timer: 3 };
                }
            }
        });

        // Re-calibrate after the screen settles into the new orientation
        // so the hold angle at the moment of rotation becomes the new neutral.
        const onOrientationChange = () => {
            setTimeout(calibrateGyro, 250);
        };
        if (screen.orientation) {
            screen.orientation.addEventListener('change', onOrientationChange);
        }
        window.addEventListener('orientationchange', onOrientationChange);
    }

    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
        // iOS 13+ requires explicit permission from a user gesture
        DeviceOrientationEvent.requestPermission()
            .then(r => { if (r === 'granted') startListening(); })
            .catch(() => {});
    } else if (typeof DeviceOrientationEvent !== 'undefined') {
        startListening();
    }
}

// ── Audio ───────────────────────────────────────────────────────────────────

let audioCtx = null;

function ensureAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playLaser() {
    if (!audioCtx) return;
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.12);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.start(t);
    osc.stop(t + 0.13);
}

function playExplosion(size) {
    if (!audioCtx) return;
    const durations = { large: 0.5, medium: 0.3, small: 0.15 };
    const dur = durations[size] || 0.3;
    const bufLen = Math.floor(audioCtx.sampleRate * dur);
    const buffer = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
    const data   = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const src    = audioCtx.createBufferSource();
    const filter = audioCtx.createBiquadFilter();
    const gain   = audioCtx.createGain();
    src.buffer = buffer;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);

    filter.type = 'bandpass';
    filter.frequency.value = size === 'large' ? 120 : size === 'medium' ? 200 : 350;
    filter.Q.value = 0.8;

    const t = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.start(t);
    src.stop(t + dur + 0.01);
}

function playLevelUp() {
    if (!audioCtx) return;
    const notes = [523, 659, 784]; // C5, E5, G5
    notes.forEach((freq, i) => {
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const t = audioCtx.currentTime + i * 0.15;
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.start(t);
        osc.stop(t + 0.2);
    });
}

function playGameOver() {
    if (!audioCtx) return;
    const notes = [440, 311]; // A4, D#4
    notes.forEach((freq, i) => {
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const t = audioCtx.currentTime + i * 0.45;
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.start(t);
        osc.stop(t + 0.45);
    });
}

function playShipHit() {
    if (!audioCtx) return;
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    osc.type = 'square';
    osc.frequency.value = 180;
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.start(t);
    osc.stop(t + 0.11);
}

function playEnemyExplosion() {
    if (!audioCtx) return;
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(800, t + 0.08);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.3);
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.start(t);
    osc.stop(t + 0.31);
}

function playEnemySpawn() {
    if (!audioCtx) return;
    // Two-tone rising chirp — unmistakable alert
    [0, 0.12].forEach((delay, i) => {
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const t = audioCtx.currentTime + delay;
        osc.type = 'square';
        osc.frequency.setValueAtTime(300 + i * 200, t);
        osc.frequency.exponentialRampToValueAtTime(600 + i * 200, t + 0.1);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.start(t);
        osc.stop(t + 0.11);
    });
}

function playPowerupCollect() {
    if (!audioCtx) return;
    // Rising three-note chime
    [523, 784, 1047].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        const t = audioCtx.currentTime + i * 0.07;
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.start(t); osc.stop(t + 0.16);
    });
}

function playBomb() {
    if (!audioCtx) return;
    // Deep low boom with rumble
    const bufLen = Math.floor(audioCtx.sampleRate * 0.8);
    const buffer = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const src = audioCtx.createBufferSource();
    const filter = audioCtx.createBiquadFilter();
    const gain = audioCtx.createGain();
    src.buffer = buffer;
    src.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
    filter.type = 'lowpass'; filter.frequency.value = 180;
    const t = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.9, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    src.start(t); src.stop(t + 0.81);
}

function playLaserTick() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.06);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.start(t); osc.stop(t + 0.07);
}

function playFriendlyDestroyed() {
    if (!audioCtx) return;
    // Descending alarmed beeps — "oh no!"
    [880, 660, 440].forEach((freq, i) => {
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        const t = audioCtx.currentTime + i * 0.13;
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.start(t); osc.stop(t + 0.12);
    });
}

function playAssistActivate() {
    if (!audioCtx) return;
    // Warm ascending chord — friendly rescue
    [330, 415, 523, 660].forEach((freq, i) => {
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        const t = audioCtx.currentTime + i * 0.06;
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.start(t); osc.stop(t + 0.26);
    });
}

// ── Factory Functions ────────────────────────────────────────────────────────

function createShip() {
    return {
        x: CANVAS_W / 2,
        y: CANVAS_H / 2,
        vx: 0,
        vy: 0,
        rotation: 0,       // radians; 0 = pointing up
        radius: 16,
        invulnerable: false,
        invulnerableTimer: 0,
        thrustOn: false,
        shootCooldown: 0,
        active: true,
    };
}

function createBullet(x, y, angle) {
    return {
        x,
        y,
        vx: Math.sin(angle) * BULLET_SPEED,
        vy: -Math.cos(angle) * BULLET_SPEED,
        radius: 3,
        lifetime: 1.5,
        active: true,
    };
}

function createDebris(x, y, size, vx, vy) {
    const cfg = SIZE_CONFIG[size];
    const craterCount = size === 'small' ? 1 : size === 'medium' ? 2 : 3;
    const craters = [];
    for (let i = 0; i < craterCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist  = 0.15 + Math.random() * 0.45;
        craters.push({
            nx: Math.cos(angle) * dist,
            ny: Math.sin(angle) * dist,
            nr: 0.08 + Math.random() * 0.12,
        });
    }
    return {
        x, y, vx, vy,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 2 * cfg.rotSpeed,
        radius: cfg.radius,
        size,
        points: cfg.points,
        shapeVariant: Math.floor(Math.random() * DEBRIS_SHAPES.length),
        craters,
        active: true,
    };
}

function createEnemy(x, y, vx, vy) {
    return {
        x, y, vx, vy,
        radius: ENEMY_RADIUS,
        points: ENEMY_POINTS,
        active: true,
        pulseTimer: 0,
        spawnAge: 0,   // used for entrance flash effect
    };
}

function createFriendly(x, y, vx, vy, type) {
    return {
        x, y, vx, vy,
        radius:      type === 'iss' ? ISS_RADIUS : SPACEMAN_RADIUS,
        type,        // 'spaceman' | 'iss'
        rotation:    Math.random() * Math.PI * 2,
        bobTimer:    Math.random() * Math.PI * 2,
        shipTouching: false,   // true while ship hitbox overlaps — prevents instant re-trigger
        active:      true,
    };
}

function createPowerup(x, y, type) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = 35 + Math.random() * 30;
    return {
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        radius:   POWERUP_RADIUS,
        type,                          // 'rapid' | 'spread' | 'laser' | 'bomb'
        lifetime: POWERUP_LIFETIME,
        rotation: Math.random() * Math.PI * 2,
        active:   true,
    };
}

// ── Level Config ─────────────────────────────────────────────────────────────

function getLevelConfig(level) {
    return {
        spawnInterval: Math.max(0.5, 3.0 - (level - 1) * 0.25),
        maxDebris:     Math.min(25, 5 + level * 2),
        speedMult:     Math.min(3.0, 1.0 + (level - 1) * 0.15),
        debrisCount:   Math.min(8, 2 + level),
    };
}

// ── Game State ───────────────────────────────────────────────────────────────

let state;              // 'menu' | 'playing' | 'game_over' | 'name_entry'
let score;
let lives;
let level;
let leaderboard;        // [{name, score}, ...] top 10, sorted desc
let leaderboardLoading; // true while fetching from server
let nameEntryText;      // string being typed on name entry screen
let nameEntryRank;      // 1-based rank of the just-earned score

let ship;
let bullets;
let debris;
let enemies;
let powerups;
let stars;
let floatingTexts;

let spawnTimer;
let enemySpawnTimer;
let powerupSpawnTimer;
let levelCfg;
let waveDebrisRemaining;
let levelTransitionTimer;
let gameOverLockout;
let particleExplosions;

// Weapon upgrade state
let weaponMode;         // 'normal' | 'rapid' | 'spread' | 'laser'
let weaponTimer;        // remaining seconds for current upgrade
let bombs;              // stored bomb count
let laserCharge;        // 0.0 – 1.0
let laserOverheat;      // seconds of overheat lockout
let laserDamageTimer;   // rate-limits laser hits
let laserBeam;          // {sx,sy,ex,ey} set each frame while laser fires
let screenFlash;        // 0-1, used for bomb visual flash
let notification;       // {text, color, timer} for pickup announcements

// Friendly entity state
let friendlies;
let friendlySpawnTimer;
let assistActive;
let assistSource;
let assistTimer;
let assistFireRate;
let assistFireTimer;

// Background offscreen canvas
let bgCanvas = null;

// Touch / mobile input state
let touch = { active: false, startX: 0, startY: 0, startTime: 0, curX: 0, curY: 0 };
let touchShootPending = false;

// Gyroscope state
let gyroActive       = false;  // orientation API is running and returning data
let gyroInitialized  = false;  // initGyro() already called
let gyroBeta         = 0;      // current device beta (front-back tilt)
let gyroGamma        = 0;      // current device gamma (left-right tilt)
let gyroBaseBeta     = 0;      // calibration baseline beta
let gyroBaseGamma    = 0;      // calibration baseline gamma

// ── Stars ────────────────────────────────────────────────────────────────────

function generateStars() {
    stars = [];
    for (let i = 0; i < 220; i++) {
        const rnd = Math.random();
        let r, g, b;
        if (rnd < 0.60) {
            // white/blue-white
            r = 200 + Math.floor(Math.random() * 56);
            g = 210 + Math.floor(Math.random() * 46);
            b = 255;
        } else if (rnd < 0.80) {
            // warm yellow
            r = 255;
            g = 230 + Math.floor(Math.random() * 26);
            b = 180 + Math.floor(Math.random() * 31);
        } else if (rnd < 0.92) {
            // blue
            r = 130 + Math.floor(Math.random() * 51);
            g = 180 + Math.floor(Math.random() * 41);
            b = 255;
        } else {
            // orange-red
            r = 255;
            g = 140 + Math.floor(Math.random() * 41);
            b = 80  + Math.floor(Math.random() * 31);
        }

        const sizeRnd = Math.random();
        let size;
        if (sizeRnd < 0.85)      size = 1;
        else if (sizeRnd < 0.95) size = 1.5;
        else                     size = 2.5;

        const twinkle      = size > 1;
        const twinkleSpeed = 0.8 + Math.random() * 2;
        const twinklePhase = Math.random() * Math.PI * 2;

        stars.push({
            x: Math.random() * CANVAS_W,
            y: Math.random() * CANVAS_H,
            brightness: 0.3 + Math.random() * 0.7,
            size,
            r, g, b,
            twinkle,
            twinkleSpeed,
            twinklePhase,
        });
    }
}

// ── Background ───────────────────────────────────────────────────────────────

function generateBackground() {
    bgCanvas = document.createElement('canvas');
    bgCanvas.width  = CANVAS_W;
    bgCanvas.height = CANVAS_H;
    const bc = bgCanvas.getContext('2d');

    const theme = ((level || 1) - 1) % 8;

    // ── Sky gradient ────────────────────────────────────────────────────────
    const skyGrad = bc.createLinearGradient(0, 0, 0, CANVAS_H);
    const skyColors = [
        ['#020818', '#030e1a'],   // 0 Earth Orbit
        ['#120804', '#0c0400'],   // 1 Inner Solar
        ['#040810', '#080c18'],   // 2 Jupiter
        ['#0c0018', '#080010'],   // 3 Nebula Cluster
        ['#100408', '#0c0204'],   // 4 Binary Stars
        ['#04080c', '#020408'],   // 5 Saturn
        ['#000008', '#000004'],   // 6 Deep Space
        ['#100800', '#0c0400'],   // 7 Solar Corona
    ];
    skyGrad.addColorStop(0, skyColors[theme][0]);
    skyGrad.addColorStop(1, skyColors[theme][1]);
    bc.fillStyle = skyGrad;
    bc.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Nebula helper using ellipse transform
    function nebula(cx, cy, rx, ry, r, g, b, alpha) {
        bc.save();
        const grad = bc.createRadialGradient(0, 0, 0, 0, 0, 1);
        grad.addColorStop(0,   `rgba(${r},${g},${b},${alpha})`);
        grad.addColorStop(0.5, `rgba(${r},${g},${b},${alpha * 0.35})`);
        grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
        bc.translate(cx, cy);
        bc.scale(rx, ry);
        bc.fillStyle = grad;
        bc.beginPath();
        bc.arc(0, 0, 1, 0, Math.PI * 2);
        bc.fill();
        bc.restore();
    }

    // ── Helper: draw a sun ─────────────────────────────────────────────────
    function drawSun(cx, cy, radius, r1, g1, b1, r2, g2, b2, r3, g3, b3) {
        bc.save();
        // Outer glow halo
        const halo = bc.createRadialGradient(cx, cy, radius * 0.8, cx, cy, radius * 3);
        halo.addColorStop(0,   `rgba(${r2},${g2},${b2},0.25)`);
        halo.addColorStop(0.5, `rgba(${r2},${g2},${b2},0.08)`);
        halo.addColorStop(1,   `rgba(${r2},${g2},${b2},0)`);
        bc.fillStyle = halo;
        bc.beginPath();
        bc.arc(cx, cy, radius * 3, 0, Math.PI * 2);
        bc.fill();

        // Sun body
        const sunGrad = bc.createRadialGradient(cx - radius * 0.25, cy - radius * 0.25, 0, cx, cy, radius);
        sunGrad.addColorStop(0,   `rgb(${r1},${g1},${b1})`);
        sunGrad.addColorStop(0.5, `rgb(${r2},${g2},${b2})`);
        sunGrad.addColorStop(1,   `rgb(${r3},${g3},${b3})`);
        bc.shadowColor = `rgb(${r2},${g2},${b2})`;
        bc.shadowBlur  = radius * 0.8;
        bc.fillStyle   = sunGrad;
        bc.beginPath();
        bc.arc(cx, cy, radius, 0, Math.PI * 2);
        bc.fill();
        bc.shadowBlur = 0;
        bc.restore();
    }

    // ── Helper: corona rays ────────────────────────────────────────────────
    function drawCorona(cx, cy, radius, count, r, g, b) {
        bc.save();
        for (let i = 0; i < count; i++) {
            const angle  = (Math.PI * 2 / count) * i + (i % 3) * 0.3;
            const len    = radius * (1.4 + (i % 5) * 0.3);
            bc.strokeStyle = `rgba(${r},${g},${b},0.15)`;
            bc.lineWidth   = 2 + (i % 3);
            bc.beginPath();
            bc.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
            bc.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
            bc.stroke();
        }
        bc.restore();
    }

    // ── Helper: draw planet ────────────────────────────────────────────────
    function drawPlanet(cx, cy, radius, r1, g1, b1, r2, g2, b2, r3, g3, b3) {
        bc.save();
        bc.shadowColor = `rgba(${r2},${g2},${b2},0.4)`;
        bc.shadowBlur  = radius * 0.5;
        const pg = bc.createRadialGradient(
            cx - radius * 0.3, cy - radius * 0.35, radius * 0.05,
            cx, cy, radius
        );
        pg.addColorStop(0,    `rgb(${r1},${g1},${b1})`);
        pg.addColorStop(0.55, `rgb(${r2},${g2},${b2})`);
        pg.addColorStop(1,    `rgb(${r3},${g3},${b3})`);
        bc.fillStyle = pg;
        bc.beginPath();
        bc.arc(cx, cy, radius, 0, Math.PI * 2);
        bc.fill();
        bc.shadowBlur = 0;
        bc.restore();
    }

    // ── Helper: draw planet bands ──────────────────────────────────────────
    function drawBands(cx, cy, radius, bands) {
        bc.save();
        bc.beginPath();
        bc.arc(cx, cy, radius, 0, Math.PI * 2);
        bc.clip();
        for (const band of bands) {
            bc.fillStyle = `rgba(${band[0]},${band[1]},${band[2]},${band[3]})`;
            bc.fillRect(cx - radius, cy + band[4] * radius, radius * 2, band[5] * radius);
        }
        bc.restore();
    }

    // ── Helper: draw moon ──────────────────────────────────────────────────
    function drawMoon(cx, cy, radius) {
        bc.save();
        bc.shadowColor = 'rgba(180,180,180,0.3)';
        bc.shadowBlur  = radius * 0.4;
        const mg = bc.createRadialGradient(
            cx - radius * 0.25, cy - radius * 0.3, radius * 0.05,
            cx, cy, radius
        );
        mg.addColorStop(0,   '#c8c8c8');
        mg.addColorStop(0.6, '#787878');
        mg.addColorStop(1,   '#303030');
        bc.fillStyle = mg;
        bc.beginPath();
        bc.arc(cx, cy, radius, 0, Math.PI * 2);
        bc.fill();
        bc.shadowBlur = 0;

        // craters
        const craterData = [
            { ox: -0.3, oy: -0.2, r: 0.18 },
            { ox:  0.25, oy: 0.3, r: 0.12 },
            { ox: -0.1, oy: 0.4,  r: 0.08 },
        ];
        for (const c of craterData) {
            bc.beginPath();
            bc.arc(cx + c.ox * radius, cy + c.oy * radius, c.r * radius, 0, Math.PI * 2);
            bc.fillStyle = 'rgba(0,0,0,0.35)';
            bc.fill();
            bc.beginPath();
            bc.arc(cx + c.ox * radius - c.r * radius * 0.3,
                   cy + c.oy * radius - c.r * radius * 0.3,
                   c.r * radius * 0.6, Math.PI, Math.PI * 2);
            bc.strokeStyle = 'rgba(200,200,200,0.3)';
            bc.lineWidth   = 1;
            bc.stroke();
        }
        bc.restore();
    }

    // ── Helper: draw Saturn rings ──────────────────────────────────────────
    function drawRings(cx, cy, radius) {
        bc.save();
        const ringColors = [
            [210, 190, 150, 0.55],
            [180, 155, 110, 0.40],
            [230, 210, 170, 0.30],
        ];
        const scales = [1.8, 2.3, 2.9];
        for (let i = ringColors.length - 1; i >= 0; i--) {
            const [r, g, b, a] = ringColors[i];
            bc.strokeStyle = `rgba(${r},${g},${b},${a})`;
            bc.lineWidth   = radius * 0.22;
            bc.beginPath();
            bc.ellipse(cx, cy, radius * scales[i], radius * 0.22, 0.18, 0, Math.PI * 2);
            bc.stroke();
        }
        bc.restore();
    }

    // ── Per-theme rendering ────────────────────────────────────────────────
    if (theme === 0) {
        // Earth Orbit: deep blue, Earth lower-right, one grey moon
        nebula(CANVAS_W * 0.3, CANVAS_H * 0.4, CANVAS_W * 0.4, CANVAS_H * 0.3, 20, 40, 120, 0.18);
        nebula(CANVAS_W * 0.7, CANVAS_H * 0.2, CANVAS_W * 0.3, CANVAS_H * 0.25, 10, 60, 100, 0.12);
        // Earth (large, partially off-screen lower-right)
        const ex = CANVAS_W + 80, ey = CANVAS_H + 60;
        drawPlanet(ex, ey, 160, 90, 160, 220, 30, 100, 180, 8, 30, 60);
        drawBands(ex, ey, 160, [
            [60, 180, 100, 0.25, -0.55, 0.18],
            [40, 120, 200, 0.18,  0.10, 0.14],
            [70, 200, 90,  0.20, -0.15, 0.10],
        ]);
        // Moon upper-left area
        drawMoon(CANVAS_W * 0.12, CANVAS_H * 0.18, 22);
    } else if (theme === 1) {
        // Inner Solar System: warm dark sky, sun top-left, dusty nebulae
        nebula(CANVAS_W * 0.5, CANVAS_H * 0.6, CANVAS_W * 0.45, CANVAS_H * 0.35, 160, 80, 20, 0.14);
        nebula(CANVAS_W * 0.25, CANVAS_H * 0.75, CANVAS_W * 0.3, CANVAS_H * 0.25, 140, 60, 10, 0.10);
        drawSun(-40, -40, 70, 255, 255, 220, 255, 200, 60, 200, 80, 0);
        drawCorona(-40, -40, 70, 18, 255, 200, 80);
    } else if (theme === 2) {
        // Jupiter Region: dark blue-grey, Jupiter bottom-right, Europa
        nebula(CANVAS_W * 0.2, CANVAS_H * 0.3, CANVAS_W * 0.5, CANVAS_H * 0.4, 40, 60, 120, 0.15);
        nebula(CANVAS_W * 0.6, CANVAS_H * 0.1, CANVAS_W * 0.35, CANVAS_H * 0.3, 20, 40, 80, 0.10);
        const jx = CANVAS_W + 60, jy = CANVAS_H + 30;
        drawPlanet(jx, jy, 200, 200, 160, 100, 180, 130, 70, 100, 70, 30);
        drawBands(jx, jy, 200, [
            [160, 100, 60,  0.35, -0.60, 0.20],
            [200, 160, 100, 0.25, -0.30, 0.15],
            [140, 90,  50,  0.30,  0.00, 0.12],
            [190, 150, 90,  0.20,  0.22, 0.18],
            [150, 100, 55,  0.28,  0.50, 0.14],
        ]);
        // Europa (small icy moon)
        drawMoon(CANVAS_W * 0.78, CANVAS_H * 0.88, 14);
    } else if (theme === 3) {
        // Nebula Cluster: deep purple, vivid overlapping nebulae
        nebula(CANVAS_W * 0.35, CANVAS_H * 0.45, CANVAS_W * 0.55, CANVAS_H * 0.50, 180, 20, 200, 0.22);
        nebula(CANVAS_W * 0.65, CANVAS_H * 0.30, CANVAS_W * 0.45, CANVAS_H * 0.40, 100, 0,  220, 0.20);
        nebula(CANVAS_W * 0.50, CANVAS_H * 0.60, CANVAS_W * 0.40, CANVAS_H * 0.35, 0,  180, 220, 0.16);
        // Distant tiny moon
        drawMoon(CANVAS_W * 0.85, CANVAS_H * 0.12, 10);
    } else if (theme === 4) {
        // Binary Stars: dark red tint, orange large sun + blue smaller sun
        nebula(CANVAS_W * 0.5, CANVAS_H * 0.5, CANVAS_W * 0.6, CANVAS_H * 0.5, 120, 20, 20, 0.18);
        nebula(CANVAS_W * 0.3, CANVAS_H * 0.3, CANVAS_W * 0.4, CANVAS_H * 0.35, 60, 10, 80, 0.12);
        // Large orange sun bottom-left
        drawSun(CANVAS_W * 0.08, CANVAS_H * 0.85, 55, 255, 255, 200, 255, 160, 40, 200, 60, 0);
        drawCorona(CANVAS_W * 0.08, CANVAS_H * 0.85, 55, 14, 255, 160, 40);
        // Smaller blue sun upper-right
        drawSun(CANVAS_W * 0.88, CANVAS_H * 0.12, 30, 220, 240, 255, 140, 180, 255, 60, 100, 200);
        drawCorona(CANVAS_W * 0.88, CANVAS_H * 0.12, 30, 10, 140, 180, 255);
    } else if (theme === 5) {
        // Saturn Ring System
        nebula(CANVAS_W * 0.3, CANVAS_H * 0.5, CANVAS_W * 0.5, CANVAS_H * 0.4, 60, 50, 80, 0.14);
        nebula(CANVAS_W * 0.7, CANVAS_H * 0.2, CANVAS_W * 0.35, CANVAS_H * 0.3, 40, 30, 60, 0.10);
        const sx = CANVAS_W * 0.82, sy = CANVAS_H * 0.5;
        drawRings(sx, sy, 90);
        drawPlanet(sx, sy, 90, 220, 200, 150, 190, 165, 100, 110, 90, 50);
        drawMoon(CANVAS_W * 0.92, CANVAS_H * 0.22, 16);
    } else if (theme === 6) {
        // Deep Space: near-black, faint blue-grey nebulae, distant spiral galaxy
        nebula(CANVAS_W * 0.4, CANVAS_H * 0.45, CANVAS_W * 0.5, CANVAS_H * 0.45, 60, 80, 120, 0.10);
        nebula(CANVAS_W * 0.7, CANVAS_H * 0.25, CANVAS_W * 0.35, CANVAS_H * 0.30, 40, 60, 100, 0.08);
        // Spiral galaxy (layered ellipses)
        bc.save();
        const gx = CANVAS_W * 0.15, gy = CANVAS_H * 0.2;
        const gLayers = [
            [30, 8,  0.15, 100, 120, 200, 0.20],
            [20, 5,  0.20, 140, 160, 220, 0.30],
            [10, 3,  0.08, 200, 210, 255, 0.40],
        ];
        for (const [rx, ry, rot, r, g, b, a] of gLayers) {
            const gg = bc.createRadialGradient(gx, gy, 0, gx, gy, rx);
            gg.addColorStop(0,   `rgba(${r},${g},${b},${a})`);
            gg.addColorStop(0.6, `rgba(${r},${g},${b},${a * 0.5})`);
            gg.addColorStop(1,   `rgba(${r},${g},${b},0)`);
            bc.fillStyle = gg;
            bc.save();
            bc.translate(gx, gy);
            bc.rotate(rot);
            bc.scale(1, ry / rx);
            bc.beginPath();
            bc.arc(0, 0, rx, 0, Math.PI * 2);
            bc.fill();
            bc.restore();
        }
        bc.restore();
    } else {
        // Solar Corona: dark orange, massive sun half-visible top-right
        nebula(CANVAS_W * 0.4, CANVAS_H * 0.6, CANVAS_W * 0.55, CANVAS_H * 0.5, 180, 80, 10, 0.20);
        nebula(CANVAS_W * 0.2, CANVAS_H * 0.35, CANVAS_W * 0.4, CANVAS_H * 0.35, 140, 50, 5, 0.14);
        const scx = CANVAS_W + 60, scy = -60;
        drawSun(scx, scy, 220, 255, 255, 200, 255, 180, 60, 200, 80, 0);
        drawCorona(scx, scy, 220, 24, 255, 160, 40);
    }
}

// ── Spawning ─────────────────────────────────────────────────────────────────

function spawnDebrisFromEdge(speedMult) {
    const edge = Math.floor(Math.random() * 4);
    let x, y;
    const margin = 60;
    if (edge === 0) { x = Math.random() * CANVAS_W; y = -margin; }
    else if (edge === 1) { x = CANVAS_W + margin; y = Math.random() * CANVAS_H; }
    else if (edge === 2) { x = Math.random() * CANVAS_W; y = CANVAS_H + margin; }
    else                 { x = -margin; y = Math.random() * CANVAS_H; }

    const targetX = 120 + Math.random() * (CANVAS_W - 240);
    const targetY = 100 + Math.random() * (CANVAS_H - 200);
    const dx   = targetX - x;
    const dy   = targetY - y;
    const dist = Math.hypot(dx, dy);
    const spd  = (50 + Math.random() * 80) * speedMult;
    return createDebris(x, y, 'large', (dx / dist) * spd, (dy / dist) * spd);
}

function splitDebris(d) {
    const childMap = { large: 'medium', medium: 'small', small: null };
    const next = childMap[d.size];
    if (!next) return [];

    const count    = 2 + Math.floor(Math.random() * 2);
    const children = [];
    const parentAngle = Math.atan2(d.vy, d.vx);
    const parentSpeed = Math.hypot(d.vx, d.vy);

    for (let i = 0; i < count; i++) {
        const scatter = (Math.random() - 0.5) * Math.PI;
        const angle   = parentAngle + scatter;
        const spd     = (parentSpeed * (0.8 + Math.random() * 0.7)) + 30;
        const ox      = Math.cos(angle) * (d.radius * 0.6);
        const oy      = Math.sin(angle) * (d.radius * 0.6);
        children.push(createDebris(d.x + ox, d.y + oy, next, Math.cos(angle) * spd, Math.sin(angle) * spd));
    }
    return children;
}

function spawnEnemyFromEdge(speedMult) {
    const edge = Math.floor(Math.random() * 4);
    let x, y, vx, vy;
    const margin = 60;
    const spd = (80 + Math.random() * 60) * speedMult;

    // Pick an entry edge and aim toward the opposite side with some scatter
    if (edge === 0) {
        x = Math.random() * CANVAS_W; y = -margin;
        vx = (Math.random() - 0.5) * spd * 0.5; vy = spd;
    } else if (edge === 1) {
        x = CANVAS_W + margin; y = Math.random() * CANVAS_H;
        vx = -spd; vy = (Math.random() - 0.5) * spd * 0.5;
    } else if (edge === 2) {
        x = Math.random() * CANVAS_W; y = CANVAS_H + margin;
        vx = (Math.random() - 0.5) * spd * 0.5; vy = -spd;
    } else {
        x = -margin; y = Math.random() * CANVAS_H;
        vx = spd; vy = (Math.random() - 0.5) * spd * 0.5;
    }
    return createEnemy(x, y, vx, vy);
}

function enemySpawnInterval() {
    return Math.max(5, ENEMY_SPAWN_BASE - (level - 1) * 0.8) + (Math.random() * 4 - 2);
}

function spawnPowerupAt(x, y) {
    const roll = Math.random();
    let type;
    if      (roll < 0.28) type = 'rapid';
    else if (roll < 0.56) type = 'spread';
    else if (roll < 0.78) type = 'laser';
    else                  type = 'bomb';
    powerups.push(createPowerup(x, y, type));
}

function spawnPowerupFromEdge() {
    const edge = Math.floor(Math.random() * 4);
    const margin = 30;
    let x, y;
    if      (edge === 0) { x = Math.random() * CANVAS_W; y = -margin; }
    else if (edge === 1) { x = CANVAS_W + margin; y = Math.random() * CANVAS_H; }
    else if (edge === 2) { x = Math.random() * CANVAS_W; y = CANVAS_H + margin; }
    else                 { x = -margin; y = Math.random() * CANVAS_H; }
    spawnPowerupAt(x, y);
}

function spawnFriendlyFromEdge() {
    const type  = Math.random() < 0.75 ? 'spaceman' : 'iss';
    const edge  = Math.floor(Math.random() * 4);
    const margin = 60;
    let x, y, vx, vy;
    const spd = type === 'iss' ? 28 + Math.random() * 18 : 40 + Math.random() * 30;

    if (edge === 0) {
        x = Math.random() * CANVAS_W; y = -margin;
        vx = (Math.random() - 0.5) * spd * 0.4; vy = spd * (0.6 + Math.random() * 0.4);
    } else if (edge === 1) {
        x = CANVAS_W + margin; y = Math.random() * CANVAS_H;
        vx = -spd * (0.6 + Math.random() * 0.4); vy = (Math.random() - 0.5) * spd * 0.4;
    } else if (edge === 2) {
        x = Math.random() * CANVAS_W; y = CANVAS_H + margin;
        vx = (Math.random() - 0.5) * spd * 0.4; vy = -spd * (0.6 + Math.random() * 0.4);
    } else {
        x = -margin; y = Math.random() * CANVAS_H;
        vx = spd * (0.6 + Math.random() * 0.4); vy = (Math.random() - 0.5) * spd * 0.4;
    }
    friendlies.push(createFriendly(x, y, vx, vy, type));
}

function friendlySpawnInterval() {
    return Math.max(18, FRIENDLY_SPAWN_BASE - level * 1.2) + (Math.random() * 8 - 4);
}

function debrisWeight(d) {
    if (d.size === 'large')  return 1.0;
    if (d.size === 'medium') return 0.5;
    return 0.25;
}

function totalDebrisWeight() {
    return debris.reduce((sum, d) => sum + debrisWeight(d), 0);
}

// ── Particles ────────────────────────────────────────────────────────────────

function spawnParticles(x, y, count, color) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const spd   = 30 + Math.random() * 120;
        particleExplosions.push({
            x, y,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd,
            life: 0.4 + Math.random() * 0.4,
            maxLife: 0.4 + Math.random() * 0.4,
            color,
            active: true,
        });
    }
}

// ── Level / Game Start ───────────────────────────────────────────────────────

function resetWeapon() {
    weaponMode      = 'normal';
    weaponTimer     = 0;
    laserCharge     = 1.0;
    laserOverheat   = 0;
    laserDamageTimer = 0;
    laserBeam       = null;
}

function startLevel(n) {
    level    = n;
    levelCfg = getLevelConfig(n);
    debris   = [];
    bullets  = [];
    enemies  = [];
    powerups = [];
    floatingTexts      = [];
    particleExplosions = [];
    spawnTimer          = levelCfg.spawnInterval;
    enemySpawnTimer     = 4;
    powerupSpawnTimer   = 10 + Math.random() * 5;
    friendlySpawnTimer  = friendlySpawnInterval();
    waveDebrisRemaining = levelCfg.debrisCount * 3;
    screenFlash         = 0;
    notification        = null;
    friendlies          = [];

    for (let i = 0; i < levelCfg.debrisCount; i++) {
        debris.push(spawnDebrisFromEdge(levelCfg.speedMult));
    }
    waveDebrisRemaining -= levelCfg.debrisCount;
    levelTransitionTimer = 0;
    generateBackground();
}

function startGame() {
    fetchLeaderboard(); // pull latest scores from server before the game begins
    score  = 0;
    lives  = 3;
    bombs  = 0;
    ship   = createShip();
    enemies      = [];
    powerups     = [];
    friendlies   = [];
    floatingTexts = [];
    screenFlash  = 0;
    notification = null;
    assistActive    = false;
    assistSource    = null;
    assistTimer     = 0;
    assistFireTimer = 0;
    calibrateGyro(); // snapshot current tilt as the neutral position
    resetWeapon();
    startLevel(1);
    state  = 'playing';
}

// ── Update ───────────────────────────────────────────────────────────────────

function update(dt) {
    if (state === 'menu')           updateMenu(dt);
    else if (state === 'playing')   updatePlaying(dt);
    else if (state === 'game_over') updateGameOver(dt);
    // name_entry state is driven entirely by keydown events
}

function updateMenu() {
    if (isStart()) startGame();
}

function updateGameOver(dt) {
    gameOverLockout -= dt;
    if (gameOverLockout <= 0 && isStart()) {
        fetchLeaderboard(); // pull fresh global scores when returning to menu
        state = 'menu';
    }
}

function updatePlaying(dt) {
    if (levelTransitionTimer > 0) {
        levelTransitionTimer -= dt;
        if (levelTransitionTimer <= 0) {
            startLevel(level + 1);
            ship.invulnerable = true;
            ship.invulnerableTimer = 2.0;
        }
        return;
    }

    updateShip(dt);
    updateBullets(dt);
    updateDebris(dt);
    updateEnemies(dt);
    updateFriendlies(dt);
    updateAssist(dt);
    updateParticles(dt);
    updateFloatingTexts(dt);
    updatePowerups(dt);
    updateWeaponState(dt);
    checkCollisions();
    checkLevelComplete();

    if (screenFlash > 0) screenFlash -= dt * 3;
    if (notification && (notification.timer -= dt) <= 0) notification = null;
}

function updateShip(dt) {
    // Rotation — keyboard is binary full-speed; gyro is proportional -1..1
    if (isLeft())             ship.rotation -= ROTATION_SPEED * dt;
    else if (isRight())       ship.rotation += ROTATION_SPEED * dt;
    else {
        const rot = gyroRotInput();
        if (rot !== 0) ship.rotation += rot * ROTATION_SPEED * dt;
    }

    // Thrust
    const thrusting = isForward();
    const reversing = isBack();
    ship.thrustOn = thrusting;

    if (thrusting) {
        ship.vx += Math.sin(ship.rotation) * THRUST * dt;
        ship.vy -= Math.cos(ship.rotation) * THRUST * dt;
    }
    if (reversing) {
        ship.vx -= Math.sin(ship.rotation) * THRUST * 0.5 * dt;
        ship.vy += Math.cos(ship.rotation) * THRUST * 0.5 * dt;
    }

    // Friction & speed cap
    ship.vx *= FRICTION;
    ship.vy *= FRICTION;
    const spd = Math.hypot(ship.vx, ship.vy);
    if (spd > MAX_SPEED) {
        ship.vx = (ship.vx / spd) * MAX_SPEED;
        ship.vy = (ship.vy / spd) * MAX_SPEED;
    }

    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;

    // Wrap around screen edges
    if (ship.x < -ship.radius) ship.x = CANVAS_W + ship.radius;
    if (ship.x > CANVAS_W + ship.radius) ship.x = -ship.radius;
    if (ship.y < -ship.radius) ship.y = CANVAS_H + ship.radius;
    if (ship.y > CANVAS_H + ship.radius) ship.y = -ship.radius;

    // Invulnerability countdown
    if (ship.invulnerable) {
        ship.invulnerableTimer -= dt;
        if (ship.invulnerableTimer <= 0) ship.invulnerable = false;
    }

    // Bomb (B key)
    if (keys['KeyB'] && !keys['_bUsed'] && bombs > 0) {
        keys['_bUsed'] = true;
        detonateBomb();
    }
    if (!keys['KeyB']) keys['_bUsed'] = false;

    // Shooting — laser is handled in updateWeaponState; others here
    if (weaponMode !== 'laser') {
        ship.shootCooldown -= dt;
        const cooldown = weaponMode === 'rapid' ? 0.08 : SHOOT_COOLDOWN;
        if (isShoot() && ship.shootCooldown <= 0) {
            const nx = ship.x + Math.sin(ship.rotation) * ship.radius;
            const ny = ship.y - Math.cos(ship.rotation) * ship.radius;
            if (weaponMode === 'spread') {
                if (bullets.length + 3 <= 15) {
                    [-0.32, 0, 0.32].forEach(offset => {
                        bullets.push(createBullet(nx, ny, ship.rotation + offset));
                    });
                    ship.shootCooldown = SHOOT_COOLDOWN + 0.05;
                    touchShootPending = false;
                    playLaser();
                }
            } else {
                if (bullets.length < 12) {
                    bullets.push(createBullet(nx, ny, ship.rotation));
                    ship.shootCooldown = cooldown;
                    touchShootPending = false;
                    playLaser();
                }
            }
        }
    }
}

function updateBullets(dt) {
    for (const b of bullets) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.lifetime -= dt;
        if (b.lifetime <= 0 || b.x < 0 || b.x > CANVAS_W || b.y < 0 || b.y > CANVAS_H) {
            b.active = false;
        }
    }
    bullets = bullets.filter(b => b.active);
}

function updateDebris(dt) {
    for (const d of debris) {
        d.x        += d.vx * dt;
        d.y        += d.vy * dt;
        d.rotation += d.rotationSpeed * dt;

        const margin = d.radius + 20;
        if (d.x < -margin || d.x > CANVAS_W + margin ||
            d.y < -margin || d.y > CANVAS_H + margin) {
            d.active = false;
        }
    }
    debris = debris.filter(d => d.active);

    // Continuous spawning
    if (waveDebrisRemaining > 0 && totalDebrisWeight() < levelCfg.maxDebris) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
            debris.push(spawnDebrisFromEdge(levelCfg.speedMult));
            waveDebrisRemaining--;
            spawnTimer = levelCfg.spawnInterval;
        }
    }
}

function updateParticles(dt) {
    for (const p of particleExplosions) {
        p.x    += p.vx * dt;
        p.y    += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) p.active = false;
    }
    particleExplosions = particleExplosions.filter(p => p.active);
}

function updateEnemies(dt) {
    for (const e of enemies) {
        e.pulseTimer += dt;
        e.spawnAge   += dt;

        // At higher levels, nudge velocity slightly toward the player (homing)
        if (level >= ENEMY_HOMING_LEVEL) {
            const dx   = ship.x - e.x;
            const dy   = ship.y - e.y;
            const dist = Math.hypot(dx, dy) || 1;
            const strength = 20 * levelCfg.speedMult; // homing pull, px/s²
            e.vx += (dx / dist) * strength * dt;
            e.vy += (dy / dist) * strength * dt;
            // Cap enemy speed
            const spd = Math.hypot(e.vx, e.vy);
            const maxSpd = 160 * levelCfg.speedMult;
            if (spd > maxSpd) { e.vx = e.vx / spd * maxSpd; e.vy = e.vy / spd * maxSpd; }
        }

        e.x += e.vx * dt;
        e.y += e.vy * dt;

        const margin = ENEMY_RADIUS + 30;
        if (e.x < -margin || e.x > CANVAS_W + margin ||
            e.y < -margin || e.y > CANVAS_H + margin) {
            e.active = false;
        }
    }
    enemies = enemies.filter(e => e.active);

    // Spawn new enemy on timer
    enemySpawnTimer -= dt;
    if (enemySpawnTimer <= 0) {
        enemies.push(spawnEnemyFromEdge(levelCfg.speedMult));
        enemySpawnTimer = enemySpawnInterval();
        playEnemySpawn();
    }
}

function updateFloatingTexts(dt) {
    for (const t of floatingTexts) {
        t.y    -= 40 * dt;
        t.life -= dt;
        if (t.life <= 0) t.active = false;
    }
    floatingTexts = floatingTexts.filter(t => t.active);
}

function updatePowerups(dt) {
    for (const p of powerups) {
        p.x        += p.vx * dt;
        p.y        += p.vy * dt;
        p.rotation += 2.0 * dt;
        p.lifetime -= dt;

        // Wrap at edges so powerups don't vanish immediately off-screen
        if (p.x < -POWERUP_RADIUS) p.x = CANVAS_W + POWERUP_RADIUS;
        if (p.x > CANVAS_W + POWERUP_RADIUS) p.x = -POWERUP_RADIUS;
        if (p.y < -POWERUP_RADIUS) p.y = CANVAS_H + POWERUP_RADIUS;
        if (p.y > CANVAS_H + POWERUP_RADIUS) p.y = -POWERUP_RADIUS;

        if (p.lifetime <= 0) p.active = false;
    }
    powerups = powerups.filter(p => p.active);

    // Spawn powerup on timer
    powerupSpawnTimer -= dt;
    if (powerupSpawnTimer <= 0) {
        spawnPowerupFromEdge();
        powerupSpawnTimer = 12 + Math.random() * 8;
    }
}

function findNearestTarget(ox, oy) {
    let nearest = null, bestDist = Infinity;
    for (const obj of [...debris, ...enemies]) {
        if (!obj.active) continue;
        const d = Math.hypot(obj.x - ox, obj.y - oy);
        if (d < bestDist) { bestDist = d; nearest = obj; }
    }
    return nearest;
}

function updateFriendlies(dt) {
    for (const f of friendlies) {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.bobTimer += dt;

        // Remove once fully off canvas — no wrapping, they pass through on their trajectory
        const margin = (f.type === 'iss' ? ISS_RADIUS : SPACEMAN_RADIUS) + 60;
        if (f.x < -margin || f.x > CANVAS_W + margin ||
            f.y < -margin || f.y > CANVAS_H + margin) {
            if (f === assistSource) { assistActive = false; assistSource = null; }
            f.active = false;
        }
    }
    friendlies = friendlies.filter(f => f.active);

    // Spawn timer
    friendlySpawnTimer -= dt;
    if (friendlySpawnTimer <= 0) {
        spawnFriendlyFromEdge();
        friendlySpawnTimer = friendlySpawnInterval();
    }
}

function updateAssist(dt) {
    if (!assistActive) return;

    // If the source friendly was shot, end assist early
    if (!assistSource || !assistSource.active) {
        assistActive = false;
        assistSource = null;
        return;
    }

    assistTimer -= dt;
    if (assistTimer <= 0) {
        // Preserve shipTouching so player must leave and re-enter to get another 15s
        if (assistSource) assistSource.shipTouching = circlesOverlap(ship, assistSource);
        assistActive = false;
        assistSource = null;
        notification = { text: 'AUTO-FIRE ENDED', color: '#88ddff', timer: 2 };
        return;
    }

    assistFireTimer -= dt;
    if (assistFireTimer <= 0) {
        assistFireTimer = assistFireRate;
        const sx = assistSource.x;
        const sy = assistSource.y;

        if (assistSource.type === 'iss') {
            // Star burst: 8 bullets evenly spread in all directions
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2;
                const b = createBullet(sx, sy, angle);
                b.color = '#00eeff';
                bullets.push(b);
            }
            playLaser();
        } else {
            // Spaceman: single aimed shot at nearest threat
            const target = findNearestTarget(sx, sy);
            if (target) {
                const angle = Math.atan2(target.x - sx, -(target.y - sy));
                const b = createBullet(sx, sy, angle);
                b.color = '#00eeff';
                bullets.push(b);
                playLaser();
            }
        }
    }
}

function updateWeaponState(dt) {
    laserBeam = null;

    if (weaponMode !== 'normal') {
        weaponTimer -= dt;
        if (weaponTimer <= 0) {
            resetWeapon();
            notification = { text: 'WEAPON EXPIRED', color: '#aaaaaa', timer: 2 };
            return;
        }
    }

    if (weaponMode === 'laser') {
        if (laserOverheat > 0) laserOverheat -= dt;

        if (isShoot() && laserCharge > 0 && laserOverheat <= 0) {
            laserCharge -= LASER_DRAIN * dt;
            if (laserCharge <= 0) {
                laserCharge   = 0;
                laserOverheat = 1.8;
            }
            const beam = laserRaycast();
            laserBeam = beam;

            // Damage first hit target at a controlled rate
            laserDamageTimer -= dt;
            if (beam.target && laserDamageTimer <= 0) {
                laserDamageTimer = LASER_DAMAGE_RATE;
                const obj = beam.target;
                obj.active = false;
                if (obj.size !== undefined) {
                    // Debris
                    score += obj.points;
                    const children = splitDebris(obj);
                    debris = debris.filter(d => d.active);
                    debris.push(...children);
                    spawnParticles(obj.x, obj.y, 4, debrisColor(obj.size));
                    playExplosion(obj.size);
                } else {
                    // Enemy
                    score += obj.points;
                    enemies = enemies.filter(e => e.active);
                    spawnParticles(obj.x, obj.y, 12, '#44ff44');
                    floatingTexts.push({ x: obj.x, y: obj.y, text: `+${obj.points}`, life: 1.0, maxLife: 1.0, active: true });
                    playEnemyExplosion();
                }
            }
            // Throttled laser sound
            laserDamageTimer <= LASER_DAMAGE_RATE - 0.05 && playLaserTick();
        } else {
            laserCharge = Math.min(1, laserCharge + LASER_REGEN * dt);
        }
    }
    touchShootPending = false; // consume tap input after each frame
}

function laserRaycast() {
    const dx = Math.sin(ship.rotation);
    const dy = -Math.cos(ship.rotation);
    const ox = ship.x + dx * (ship.radius + 2);
    const oy = ship.y + dy * (ship.radius + 2);

    let target = null, bestT = Infinity;
    for (const obj of [...debris, ...enemies]) {
        if (!obj.active) continue;
        const fx = obj.x - ox, fy = obj.y - oy;
        const b2 = fx * dx + fy * dy;
        const disc = b2 * b2 - (fx * fx + fy * fy - obj.radius * obj.radius);
        if (disc < 0 || b2 < 0) continue;
        const t = b2 - Math.sqrt(disc);
        if (t < bestT) { bestT = t; target = obj; }
    }

    const reach = Math.min(target ? bestT : 900, 900);
    return { sx: ox, sy: oy, ex: ox + dx * reach, ey: oy + dy * reach, target };
}

function bombButtonRect() {
    const size = Math.max(48, Math.min(72, CANVAS_W * 0.1));
    return { x: CANVAS_W - size - 12, y: CANVAS_H - size - 12, w: size, h: size };
}

function isBombButtonHit(cx, cy) {
    const r = bombButtonRect();
    return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
}

function detonateBomb() {
    if (bombs <= 0) return;
    bombs--;
    playBomb();
    screenFlash = 1.0;

    // Split all debris one size down, destroy smalls
    const survivors = [];
    for (const d of debris) {
        if (!d.active) continue;
        score += d.points;
        const children = splitDebris(d);
        if (children.length > 0) {
            survivors.push(...children);
        }
        spawnParticles(d.x, d.y, 6, debrisColor(d.size));
    }
    debris = survivors;

    // Destroy all enemies
    for (const e of enemies) {
        if (!e.active) continue;
        score += e.points;
        spawnParticles(e.x, e.y, 14, '#44ff44');
        floatingTexts.push({ x: e.x, y: e.y, text: `+${e.points}`, life: 1.0, maxLife: 1.0, active: true });
    }
    enemies = [];

    notification = { text: 'BOMB!', color: '#ff8800', timer: 1.5 };
}

function checkCollisions() {
    const newDebris = [];

    // Bullets vs Debris
    for (const b of bullets) {
        if (!b.active) continue;
        for (const d of debris) {
            if (!d.active) continue;
            if (circlesOverlap(b, d)) {
                b.active = false;
                d.active = false;
                score += d.points;
                const children = splitDebris(d);
                newDebris.push(...children);
                const pCount = d.size === 'large' ? 10 : d.size === 'medium' ? 6 : 3;
                spawnParticles(d.x, d.y, pCount, debrisColor(d.size));
                playExplosion(d.size);
                if (d.size === 'large' && Math.random() < 0.15) spawnPowerupAt(d.x, d.y);
                break;
            }
        }
    }

    bullets = bullets.filter(b => b.active);
    debris  = debris.filter(d => d.active);
    debris.push(...newDebris);

    // Bullets vs Enemies
    for (const b of bullets) {
        if (!b.active) continue;
        for (const e of enemies) {
            if (!e.active) continue;
            if (circlesOverlap(b, e)) {
                b.active = false;
                e.active = false;
                score += e.points;
                spawnParticles(e.x, e.y, 16, '#44ff44');
                floatingTexts.push({ x: e.x, y: e.y, text: `+${e.points}`, life: 1.0, maxLife: 1.0, active: true });
                playEnemyExplosion();
                break;
            }
        }
    }

    bullets = bullets.filter(b => b.active);
    enemies = enemies.filter(e => e.active);

    // Ship vs Debris or Enemies
    if (!ship.invulnerable) {
        let hit = false;
        for (const d of debris) {
            if (!d.active) continue;
            if (circlesOverlap(ship, d)) { hit = true; break; }
        }
        if (!hit) {
            for (const e of enemies) {
                if (!e.active) continue;
                if (circlesOverlap(ship, e)) {
                    e.active = false;
                    spawnParticles(e.x, e.y, 12, '#44ff44');
                    hit = true;
                    break;
                }
            }
            enemies = enemies.filter(e => e.active);
        }

        if (hit) {
            lives--;
            spawnParticles(ship.x, ship.y, 15, '#ff4444');
            playShipHit();

            if (lives <= 0) {
                playGameOver();
                if (qualifiesForLeaderboard(score)) {
                    // Find what rank this score will be
                    nameEntryRank = leaderboard.findIndex(e => score > e.score) + 1;
                    if (nameEntryRank === 0) nameEntryRank = leaderboard.length + 1;
                    nameEntryText = '';
                    state = 'name_entry';
                    // Summon mobile keyboard via hidden input
                    const _ni = document.getElementById('nameInput');
                    if (_ni) {
                        _ni.value = '';
                        _ni.style.pointerEvents = 'auto';
                        _ni.focus();
                        // oninput is the single source of truth for mobile typing.
                        // Enter/submit is handled by the window keydown listener above.
                        _ni.oninput = () => {
                            nameEntryText = _ni.value.toUpperCase().slice(0, MAX_NAME_LENGTH);
                        };
                    }
                } else {
                    state = 'game_over';
                    gameOverLockout = 2.0;
                }
                return;
            }

            ship.x  = CANVAS_W / 2;
            ship.y  = CANVAS_H / 2;
            ship.vx = 0;
            ship.vy = 0;
            ship.invulnerable      = true;
            ship.invulnerableTimer = 3.0;
        }
    }

    // Ship vs Powerups (collect on touch)
    for (const p of powerups) {
        if (!p.active) continue;
        if (circlesOverlap(ship, p)) {
            p.active = false;
            collectPowerup(p.type);
        }
    }
    powerups = powerups.filter(p => p.active);

    // Ship vs Friendlies — checked FIRST so shipTouching is current before bullet check
    for (const f of friendlies) {
        if (!f.active) continue;
        const touching = circlesOverlap(ship, f);
        if (touching && !f.shipTouching) {
            collectFriendly(f);
        }
        f.shipTouching = touching;
    }

    // Bullets vs Friendlies — immune if ship is touching it or it is the active assist source
    for (const b of bullets) {
        if (!b.active) continue;
        for (const f of friendlies) {
            if (!f.active) continue;
            if (f.shipTouching || f === assistSource) continue;
            if (circlesOverlap(b, f)) {
                b.active = false;
                f.active = false;
                const penalty = f.type === 'iss' ? ISS_PENALTY : SPACEMAN_PENALTY;
                score = Math.max(0, score - penalty);
                spawnParticles(f.x, f.y, 10, '#ffaaaa');
                floatingTexts.push({ x: f.x, y: f.y, text: `-${penalty}`, life: 1.2, maxLife: 1.2, active: true });
                notification = { text: 'FRIENDLY FIRE!', color: '#ff4444', timer: 2.5 };
                playFriendlyDestroyed();
                break;
            }
        }
    }
    bullets    = bullets.filter(b => b.active);
    friendlies = friendlies.filter(f => f.active);
}

function collectPowerup(type) {
    playPowerupCollect();
    if (type === 'bomb') {
        bombs = Math.min(MAX_BOMBS, bombs + 1);
        notification = { text: `BOMB +1  (${bombs}/${MAX_BOMBS})  press B`, color: POWERUP_COLORS.bomb, timer: 2.5 };
    } else {
        weaponMode  = type;
        weaponTimer = WEAPON_DURATION;
        const labels = { rapid: 'RAPID FIRE!', spread: 'SPREAD SHOT!', laser: 'LASER BEAM!' };
        notification = { text: labels[type], color: POWERUP_COLORS[type], timer: 2.5 };
        if (type === 'laser') { laserCharge = 1.0; laserOverheat = 0; }
    }
}

function collectFriendly(f) {
    playAssistActivate();
    assistActive    = true;
    assistSource    = f;
    assistTimer     = ASSIST_DURATION;
    assistFireRate  = f.type === 'iss' ? ISS_FIRE_RATE : SPACEMAN_FIRE_RATE;
    assistFireTimer = 0;
    const label = f.type === 'iss' ? 'ISS ESCORT' : 'SPACEMAN RESCUE';
    notification = { text: `${label} — AUTO-FIRE ${ASSIST_DURATION}s`, color: '#00eeff', timer: 3 };
    spawnParticles(f.x, f.y, 12, '#00eeff');
}

function checkLevelComplete() {
    if (debris.length === 0 && waveDebrisRemaining === 0) {
        levelTransitionTimer = 2.5;
        playLevelUp();
    }
}

function circlesOverlap(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const r  = a.radius + b.radius;
    return dx * dx + dy * dy < r * r;
}

function debrisColor(size) {
    if (size === 'large')  return '#aaaaaa';
    if (size === 'medium') return '#bbaa88';
    return '#ddccaa';
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

function loadLeaderboardCache() {
    try {
        const raw = localStorage.getItem('spaceRocksLeaderboard');
        if (raw) return JSON.parse(raw);
    } catch (_) {}
    // Migrate legacy single hi-score
    const legacy = parseInt(localStorage.getItem('spaceRocksHiScore') || '0', 10);
    if (legacy > 0) return [{ name: 'PILOT', score: legacy }];
    return [];
}

function cacheLeaderboard(data) {
    leaderboard = data;
    try { localStorage.setItem('spaceRocksLeaderboard', JSON.stringify(data)); } catch (_) {}
}

async function fetchLeaderboard() {
    leaderboardLoading = true;
    try {
        const res = await fetch('/api/scores');
        if (!res.ok) throw new Error('server error');
        cacheLeaderboard(await res.json());
    } catch (_) {
        // Keep cached data — server may not be running
    } finally {
        leaderboardLoading = false;
    }
}

function qualifiesForLeaderboard(s) {
    if (s <= 0) return false;
    if (leaderboard.length < MAX_LEADERBOARD) return true;
    return s > leaderboard[leaderboard.length - 1].score;
}

async function submitScore(name) {
    const clean = (name || 'PILOT').slice(0, MAX_NAME_LENGTH).toUpperCase();
    // Optimistic local update so the menu shows it immediately
    const optimistic = [...leaderboard, { name: clean, score }]
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_LEADERBOARD);
    cacheLeaderboard(optimistic);

    try {
        const res = await fetch('/api/scores', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ name: clean, score }),
        });
        if (res.ok) cacheLeaderboard(await res.json()); // replace with authoritative server list
    } catch (_) {
        // Optimistic update stays if server is unreachable
    }
}

function topScore() {
    return leaderboard.length > 0 ? leaderboard[0].score : 0;
}

// ── Render ───────────────────────────────────────────────────────────────────

function render() {
    renderBackground();

    if (state === 'menu')             renderMenu();
    else if (state === 'playing')     renderPlaying();
    else if (state === 'game_over')   renderGameOver();
    else if (state === 'name_entry')  renderNameEntry();
}

function renderBackground() {
    // Blit pre-rendered background (sky gradient + nebulae + celestial bodies)
    if (bgCanvas) {
        ctx.drawImage(bgCanvas, 0, 0);
    } else {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // Draw dynamic twinkling stars on top
    const now = Date.now() / 1000;
    for (const s of stars) {
        let alpha = s.brightness;
        if (s.twinkle) {
            alpha = s.brightness * (0.6 + 0.4 * Math.sin(now * s.twinkleSpeed + s.twinklePhase));
        }
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = `rgb(${s.r},${s.g},${s.b})`;
        if (s.size <= 1) {
            ctx.fillRect(s.x, s.y, 1, 1);
        } else {
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size / 2, 0, Math.PI * 2);
            ctx.fill();
            // Crosshair glow for large stars
            if (s.size > 1.5) {
                ctx.globalAlpha = alpha * 0.35;
                ctx.strokeStyle = `rgb(${s.r},${s.g},${s.b})`;
                ctx.lineWidth   = 0.5;
                ctx.beginPath();
                ctx.moveTo(s.x - 4, s.y);
                ctx.lineTo(s.x + 4, s.y);
                ctx.moveTo(s.x, s.y - 4);
                ctx.lineTo(s.x, s.y + 4);
                ctx.stroke();
            }
        }
        ctx.restore();
    }
}

function renderMenu() {
    ctx.save();
    ctx.textAlign = 'center';

    ctx.font = 'bold 56px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#44aaff';
    ctx.shadowBlur = 20;
    ctx.fillText('SPACE ROCKS', CANVAS_W / 2, CANVAS_H * 0.13);

    ctx.shadowBlur = 0;
    ctx.font = '16px monospace';
    ctx.fillStyle = '#888888';
    ctx.fillText('A/D  rotate    W/S  thrust    SPACE  shoot    B  bomb', CANVAS_W / 2, CANVAS_H * 0.13 + 46);

    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = '#ffffff';
    const blink = Math.floor(Date.now() / 500) % 2 === 0;
    if (blink) ctx.fillText('PRESS SPACE TO START', CANVAS_W / 2, CANVAS_H * 0.13 + 90);

    // Leaderboard table
    const cx    = CANVAS_W / 2;
    const top   = CANVAS_H * 0.13 + 136;
    const rowH  = Math.min(28, (CANVAS_H - top - 40) / (MAX_LEADERBOARD + 1));

    ctx.font      = 'bold 15px monospace';
    ctx.fillStyle = '#ffcc44';
    ctx.shadowColor = '#ffcc44';
    ctx.shadowBlur  = 6;
    ctx.fillText('GLOBAL HIGH SCORES', cx, top);
    ctx.shadowBlur = 0;

    if (leaderboardLoading && leaderboard.length === 0) {
        const dots = '.'.repeat(1 + Math.floor(Date.now() / 400) % 3);
        ctx.font      = '14px monospace';
        ctx.fillStyle = '#555555';
        ctx.fillText(`loading${dots}`, cx, top + rowH * 1.5);
    } else if (leaderboard.length === 0) {
        ctx.font      = '14px monospace';
        ctx.fillStyle = '#555555';
        ctx.fillText('— no scores yet —', cx, top + rowH * 1.5);
    } else {
        ctx.font = '14px monospace';
        leaderboard.forEach((entry, i) => {
            const y     = top + (i + 1) * rowH + 4;
            const medal = i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#888888';
            ctx.fillStyle = medal;
            ctx.textAlign = 'right';
            ctx.fillText(`${i + 1}.`, cx - 130, y);
            ctx.textAlign = 'left';
            ctx.fillText(entry.name.padEnd(MAX_NAME_LENGTH), cx - 120, y);
            ctx.textAlign = 'right';
            ctx.fillText(entry.score.toLocaleString(), cx + 130, y);
        });
        // Show refresh state in corner
        if (leaderboardLoading) {
            ctx.font      = '11px monospace';
            ctx.fillStyle = '#444444';
            ctx.textAlign = 'center';
            ctx.fillText('refreshing…', cx, top + (MAX_LEADERBOARD + 1) * rowH + 8);
        }
    }

    ctx.restore();
}

function renderPlaying() {
    renderParticles();
    renderDebris();
    renderPowerups();
    renderFriendlies();
    renderEnemies();
    renderLaserBeam();
    renderBullets();
    renderShip();
    renderFloatingTexts();
    renderHUD();
    renderNotification();

    // Bomb screen flash
    if (screenFlash > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.7, screenFlash);
        ctx.fillStyle   = '#ff8800';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.restore();
    }

    if (levelTransitionTimer > 0) renderLevelTransition();
}

function renderDebris() {
    for (const d of debris) {
        const shape = DEBRIS_SHAPES[d.shapeVariant];
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(d.rotation);
        ctx.scale(d.radius, d.radius);

        // Build the polygon path
        ctx.beginPath();
        ctx.moveTo(shape[0][0], shape[0][1]);
        for (let i = 1; i < shape.length; i++) ctx.lineTo(shape[i][0], shape[i][1]);
        ctx.closePath();

        // Radial gradient fill (highlight at upper-left)
        const rg = ctx.createRadialGradient(-0.3, -0.4, 0.05, 0, 0, 1);
        rg.addColorStop(0,   '#909090');
        rg.addColorStop(0.5, '#505050');
        rg.addColorStop(1,   '#1a1a1a');
        ctx.fillStyle = rg;
        ctx.fill();

        // Outline — lighter for smaller (more shattered) rocks
        const strokeCol = d.size === 'large' ? '#888' : d.size === 'medium' ? '#aaa' : '#ccc';
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth   = 1.5 / d.radius;
        ctx.stroke();

        // Craters (normalized coords, drawn in scaled space)
        if (d.craters) {
            for (const c of d.craters) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(c.nx, c.ny, c.nr, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.fill();
                // Lighter rim arc
                ctx.beginPath();
                ctx.arc(c.nx - c.nr * 0.25, c.ny - c.nr * 0.25, c.nr * 0.65, Math.PI * 0.9, Math.PI * 2.1);
                ctx.strokeStyle = 'rgba(180,180,180,0.35)';
                ctx.lineWidth   = 0.04;
                ctx.stroke();
                ctx.restore();
            }
        }

        ctx.restore();
    }
}

function renderFriendlies() {
    for (const f of friendlies) {
        ctx.save();
        ctx.translate(f.x, f.y);

        // Glow ring when this friendly is the active assist source
        if (f === assistSource && assistActive) {
            const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.006);
            const r = f.type === 'iss' ? ISS_RADIUS + 8 : SPACEMAN_RADIUS + 8;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(0,238,255,${0.4 + 0.5 * pulse})`;
            ctx.lineWidth   = 3;
            ctx.shadowColor = '#00eeff';
            ctx.shadowBlur  = 14;
            ctx.stroke();
            ctx.shadowBlur  = 0;
        }

        if (f.type === 'spaceman') {
            const bob = Math.sin(f.bobTimer * 1.8) * 2;
            ctx.translate(0, bob);

            ctx.shadowColor = '#88ffee';
            ctx.shadowBlur  = 10;

            // Body (suit torso)
            ctx.fillStyle = '#ddddff';
            ctx.fillRect(-5, 2, 10, 10);
            ctx.strokeStyle = '#aabbff';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(-5, 2, 10, 10);

            // Helmet
            ctx.beginPath();
            ctx.arc(0, -4, 7, 0, Math.PI * 2);
            ctx.fillStyle = '#ccddff';
            ctx.fill();
            ctx.strokeStyle = '#88aaff';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Visor (gold tinted)
            ctx.beginPath();
            ctx.ellipse(0, -4, 4, 3, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,220,80,0.75)';
            ctx.fill();

            // Arms
            ctx.strokeStyle = '#ccddff';
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(-5, 4);  ctx.lineTo(-10, 8);  ctx.stroke();
            ctx.beginPath(); ctx.moveTo(5, 4);   ctx.lineTo(10, 8);   ctx.stroke();

            // Legs
            ctx.beginPath(); ctx.moveTo(-3, 12); ctx.lineTo(-4, 18);  ctx.stroke();
            ctx.beginPath(); ctx.moveTo(3, 12);  ctx.lineTo(4, 18);   ctx.stroke();

        } else {
            // ISS
            ctx.shadowColor = '#aaddff';
            ctx.shadowBlur  = 14;

            // Central truss bar (horizontal)
            ctx.fillStyle   = '#cccccc';
            ctx.strokeStyle = '#aaaaaa';
            ctx.lineWidth   = 2;
            ctx.fillRect(-ISS_RADIUS, -4, ISS_RADIUS * 2, 8);
            ctx.strokeRect(-ISS_RADIUS, -4, ISS_RADIUS * 2, 8);

            // Habitat module (center cylinder)
            ctx.fillStyle   = '#ddeeff';
            ctx.fillRect(-14, -9, 28, 18);
            ctx.strokeStyle = '#88aacc';
            ctx.lineWidth   = 1.5;
            ctx.strokeRect(-14, -9, 28, 18);

            // Module windows
            [-5, 5].forEach(ox => {
                ctx.beginPath();
                ctx.arc(ox, 0, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#aaddff';
                ctx.fill();
            });

            // Solar panel arrays (left + right)
            [[-ISS_RADIUS - 2, -12], [ISS_RADIUS - 18, -12]].forEach(([px, py]) => {
                ctx.fillStyle   = '#2255aa';
                ctx.strokeStyle = '#4488ff';
                ctx.lineWidth   = 1;
                ctx.fillRect(px, py, 18, 24);
                ctx.strokeRect(px, py, 18, 24);
                // Panel lines
                ctx.strokeStyle = '#6699cc';
                ctx.lineWidth = 0.5;
                for (let j = 1; j < 4; j++) {
                    ctx.beginPath();
                    ctx.moveTo(px, py + j * 6);
                    ctx.lineTo(px + 18, py + j * 6);
                    ctx.stroke();
                }
            });
        }

        ctx.restore();
    }
}

function renderEnemies() {
    for (const e of enemies) {
        const pulse = 0.5 + 0.5 * Math.sin(e.pulseTimer * 5);

        // Entrance strobe: flash brightly for first 0.8 seconds
        const strobing = e.spawnAge < 0.8 && Math.floor(e.spawnAge * 12) % 2 === 0;
        if (strobing) {
            ctx.save();
            ctx.translate(e.x, e.y);
            ctx.beginPath();
            ctx.arc(0, 0, e.radius + 10, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,255,120,0.35)';
            ctx.fill();
            ctx.restore();
        }

        ctx.save();
        ctx.translate(e.x, e.y);

        ctx.shadowColor = '#00ffaa';
        ctx.shadowBlur  = 16 + 8 * pulse;

        // ── Saucer body ──
        ctx.beginPath();
        ctx.ellipse(0, 5, 26, 9, 0, 0, Math.PI * 2);
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth   = 2.5;
        ctx.stroke();

        // Solid body fill (dark tinted)
        ctx.beginPath();
        ctx.ellipse(0, 5, 26, 9, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,80,40,0.7)';
        ctx.fill();

        // ── Dome ──
        ctx.beginPath();
        ctx.ellipse(0, 2, 14, 12, 0, Math.PI, 0, false);
        ctx.strokeStyle = '#44ffcc';
        ctx.lineWidth   = 2;
        ctx.stroke();

        // Dome fill (tinted so it reads as a separate surface)
        ctx.beginPath();
        ctx.ellipse(0, 2, 14, 12, 0, Math.PI, 0, false);
        ctx.fillStyle = `rgba(0,${Math.floor(120 + 80 * pulse)},80,0.5)`;
        ctx.fill();

        // ── Rim lights ──
        const rimColors = ['#ff4444', '#ffff00', '#00ffff'];
        [-16, 0, 16].forEach((ox, i) => {
            ctx.beginPath();
            ctx.arc(ox, 5, 3.5, 0, Math.PI * 2);
            ctx.fillStyle  = rimColors[i];
            ctx.shadowColor = rimColors[i];
            ctx.shadowBlur  = 8;
            ctx.fill();
        });

        ctx.restore();
    }
}

function renderPowerups() {
    for (const p of powerups) {
        const color = POWERUP_COLORS[p.type];
        const flash = p.lifetime < 3 && Math.floor(p.lifetime * 6) % 2 === 0; // blink when expiring
        if (flash) continue;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);

        ctx.shadowColor = color;
        ctx.shadowBlur  = 14;

        // Diamond (rotated square)
        const r = POWERUP_RADIUS;
        ctx.beginPath();
        ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth   = 2;
        ctx.stroke();
        ctx.fillStyle = `${color}33`; // translucent fill
        ctx.fill();

        // Inner icon letter (not rotated so it's always readable)
        ctx.rotate(-p.rotation);
        ctx.shadowBlur  = 0;
        ctx.font        = 'bold 11px monospace';
        ctx.fillStyle   = color;
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(POWERUP_LABELS[p.type], 0, 0);
        ctx.textBaseline = 'alphabetic';

        ctx.restore();
    }
}

function renderLaserBeam() {
    if (!laserBeam) return;
    const { sx, sy, ex, ey } = laserBeam;

    ctx.save();
    // Outer glow
    ctx.strokeStyle = 'rgba(255,80,255,0.25)';
    ctx.lineWidth   = 10;
    ctx.shadowColor = '#ff44ff';
    ctx.shadowBlur  = 20;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    // Core beam
    ctx.strokeStyle = '#ff88ff';
    ctx.lineWidth   = 2;
    ctx.shadowBlur  = 8;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    // Bright center line
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1;
    ctx.shadowBlur  = 0;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.restore();
}

function renderNotification() {
    if (!notification) return;
    ctx.save();
    ctx.textAlign  = 'center';
    ctx.font       = 'bold 28px monospace';
    ctx.fillStyle  = notification.color;
    ctx.shadowColor = notification.color;
    ctx.shadowBlur  = 16;
    ctx.globalAlpha = Math.min(1, notification.timer);
    ctx.fillText(notification.text, CANVAS_W / 2, CANVAS_H / 2 - 80);
    ctx.restore();
}

function renderFloatingTexts() {
    for (const t of floatingTexts) {
        const alpha = t.life / t.maxLife;
        ctx.save();
        ctx.globalAlpha  = alpha;
        ctx.font         = 'bold 18px monospace';
        ctx.fillStyle    = '#44ff44';
        ctx.textAlign    = 'center';
        ctx.shadowColor  = '#00ff50';
        ctx.shadowBlur   = 10;
        ctx.fillText(t.text, t.x, t.y);
        ctx.restore();
    }
}

function renderBullets() {
    for (const b of bullets) {
        const color = b.color || '#ffee44';
        ctx.save();
        ctx.fillStyle   = color;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 8;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function renderShip() {
    if (!ship.active) return;

    if (ship.invulnerable) {
        // Blink: hide every other 0.1s interval
        if (Math.floor(ship.invulnerableTimer * 10) % 2 === 0) return;
    }

    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.rotation);

    // ── Engine exhaust / flame ───────────────────────────────────────────
    if (ship.thrustOn) {
        ctx.save();
        // Main exhaust radial gradient
        const flameLen = 18 + Math.random() * 14;
        const fg = ctx.createRadialGradient(0, 12, 0, 0, 12 + flameLen * 0.5, flameLen);
        fg.addColorStop(0,   'rgba(255,255,255,0.95)');
        fg.addColorStop(0.2, 'rgba(80,220,255,0.80)');
        fg.addColorStop(0.6, 'rgba(255,140,20,0.45)');
        fg.addColorStop(1,   'rgba(255,60,0,0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.moveTo(-5, 12);
        ctx.lineTo(0, 12 + flameLen);
        ctx.lineTo(5, 12);
        ctx.closePath();
        ctx.fill();

        // Random flame tongues
        for (let t = 0; t < 2; t++) {
            const tLen  = flameLen * (0.55 + Math.random() * 0.5);
            const tOff  = (Math.random() - 0.5) * 5;
            ctx.strokeStyle = `rgba(255,${120 + Math.floor(Math.random() * 100)},0,0.6)`;
            ctx.lineWidth   = 1.5;
            ctx.beginPath();
            ctx.moveTo(tOff - 2, 12);
            ctx.quadraticCurveTo(tOff, 12 + tLen * 0.6, tOff, 12 + tLen);
            ctx.stroke();
        }
        ctx.restore();
    }

    // ── Engine nozzle ────────────────────────────────────────────────────
    ctx.save();
    const nozzleGrad = ctx.createRadialGradient(0, 12, 0, 0, 12, 5);
    nozzleGrad.addColorStop(0,   '#223344');
    nozzleGrad.addColorStop(1,   '#0a1218');
    ctx.fillStyle = nozzleGrad;
    ctx.beginPath();
    ctx.arc(0, 12, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── Left wing ────────────────────────────────────────────────────────
    ctx.save();
    const lwGrad = ctx.createLinearGradient(-20, 8, -8, 4);
    lwGrad.addColorStop(0,   '#1a2530');
    lwGrad.addColorStop(0.6, '#263545');
    lwGrad.addColorStop(1,   '#344a60');
    ctx.fillStyle = lwGrad;
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(-20, 8);
    ctx.lineTo(-8, 12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3a5570';
    ctx.lineWidth   = 0.8;
    ctx.stroke();
    ctx.restore();

    // ── Right wing ───────────────────────────────────────────────────────
    ctx.save();
    const rwGrad = ctx.createLinearGradient(20, 8, 8, 4);
    rwGrad.addColorStop(0,   '#1a2530');
    rwGrad.addColorStop(0.6, '#263545');
    rwGrad.addColorStop(1,   '#344a60');
    ctx.fillStyle = rwGrad;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(20, 8);
    ctx.lineTo(8, 12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3a5570';
    ctx.lineWidth   = 0.8;
    ctx.stroke();
    ctx.restore();

    // ── Fuselage ─────────────────────────────────────────────────────────
    ctx.save();
    const fGrad = ctx.createLinearGradient(0, -16, 0, 12);
    fGrad.addColorStop(0,   '#4a6680');
    fGrad.addColorStop(0.5, '#2e4a60');
    fGrad.addColorStop(1,   '#1a2530');
    ctx.fillStyle   = fGrad;
    ctx.shadowColor = 'rgba(80,140,200,0.3)';
    ctx.shadowBlur  = 6;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(5, -10);
    ctx.lineTo(8, 0);
    ctx.lineTo(6, 12);
    ctx.lineTo(0, 9);
    ctx.lineTo(-6, 12);
    ctx.lineTo(-8, 0);
    ctx.lineTo(-5, -10);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    // Edge highlight on right side
    ctx.strokeStyle = '#5a7a98';
    ctx.lineWidth   = 0.8;
    ctx.stroke();
    ctx.restore();

    // ── Hull panel lines ──────────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = '#3a5570';
    ctx.lineWidth   = 0.7;
    // Center spine
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(0, 8);
    ctx.stroke();
    // Cross brace
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(5, 0);
    ctx.stroke();
    ctx.restore();

    // ── Cockpit ───────────────────────────────────────────────────────────
    ctx.save();
    const cpGrad = ctx.createRadialGradient(0, -6, 0, 0, -6, 6);
    cpGrad.addColorStop(0,   '#88ccff');
    cpGrad.addColorStop(0.5, '#2266aa');
    cpGrad.addColorStop(1,   '#001144');
    ctx.fillStyle = cpGrad;
    ctx.shadowColor = '#44aaff';
    ctx.shadowBlur  = 6;
    ctx.beginPath();
    ctx.ellipse(0, -6, 4, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    // ── Nose accent dot ───────────────────────────────────────────────────
    ctx.save();
    ctx.fillStyle   = '#aaeeff';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur  = 4;
    ctx.beginPath();
    ctx.arc(0, -15, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    // ── Wing-tip lights ───────────────────────────────────────────────────
    ctx.save();
    // Left wing tip: red
    ctx.fillStyle   = '#ff4444';
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur  = 5;
    ctx.beginPath();
    ctx.arc(-20, 8, 2, 0, Math.PI * 2);
    ctx.fill();
    // Right wing tip: green
    ctx.fillStyle   = '#44ff88';
    ctx.shadowColor = '#00ff44';
    ctx.beginPath();
    ctx.arc(20, 8, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.restore();
}

function renderParticles() {
    for (const p of particleExplosions) {
        const alpha = p.life / p.maxLife;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle   = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function renderHUD() {
    ctx.save();
    ctx.font      = 'bold 20px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(`SCORE: ${score}`, 16, 32);

    ctx.font      = '16px monospace';
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText(`LVL ${level}`, 16, 56);

    const best = topScore();
    if (best > 0) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffcc44';
        ctx.font      = '14px monospace';
        ctx.fillText(`BEST: ${best.toLocaleString()}`, CANVAS_W / 2, 22);
    }

    // Lives as small ship icons (top-right)
    for (let i = 0; i < lives; i++) {
        const lx = CANVAS_W - 24 - i * 28;
        const ly = 22;
        ctx.save();
        ctx.translate(lx, ly);
        ctx.beginPath();
        ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8);
        ctx.closePath();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 1.5;
        ctx.stroke();
        ctx.restore();
    }

    // Weapon mode + timer bar (bottom-left)
    if (weaponMode !== 'normal') {
        const color  = POWERUP_COLORS[weaponMode];
        const label  = { rapid: 'RAPID FIRE', spread: 'SPREAD', laser: 'LASER' }[weaponMode];
        const barW   = 120;
        const barFill = (weaponTimer / WEAPON_DURATION) * barW;
        const bx = 16, by = CANVAS_H - 36;

        ctx.font      = 'bold 13px monospace';
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 8;
        ctx.textAlign = 'left';
        ctx.fillText(label, bx, by - 6);
        ctx.shadowBlur = 0;

        // Background bar
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(bx, by, barW, 6);
        // Fill bar
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, barFill, 6);

        // Laser charge sub-bar
        if (weaponMode === 'laser') {
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            ctx.fillRect(bx, by + 10, barW, 4);
            ctx.fillStyle = laserOverheat > 0 ? '#ff4444' : '#ff88ff';
            ctx.fillRect(bx, by + 10, laserCharge * barW, 4);
        }
    }

    // Bomb count (bottom-left, below weapon or at bottom if no weapon)
    if (bombs > 0) {
        const by = weaponMode !== 'normal' ? CANVAS_H - 70 : CANVAS_H - 36;
        ctx.font      = 'bold 13px monospace';
        ctx.fillStyle = POWERUP_COLORS.bomb;
        ctx.shadowColor = POWERUP_COLORS.bomb;
        ctx.shadowBlur  = 6;
        ctx.textAlign = 'left';
        ctx.fillText(`BOMB x${bombs}  [B]`, 16, by);
        ctx.shadowBlur = 0;

        // Touch-only bomb button (bottom-right corner)
        if ('ontouchstart' in window) {
            const r = bombButtonRect();
            ctx.save();
            ctx.globalAlpha = 0.82;
            ctx.fillStyle = 'rgba(255,120,0,0.25)';
            ctx.strokeStyle = POWERUP_COLORS.bomb;
            ctx.lineWidth = 2.5;
            const rad = 10;
            ctx.beginPath();
            ctx.moveTo(r.x + rad, r.y);
            ctx.lineTo(r.x + r.w - rad, r.y);
            ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + rad, rad);
            ctx.lineTo(r.x + r.w, r.y + r.h - rad);
            ctx.arcTo(r.x + r.w, r.y + r.h, r.x + r.w - rad, r.y + r.h, rad);
            ctx.lineTo(r.x + rad, r.y + r.h);
            ctx.arcTo(r.x, r.y + r.h, r.x, r.y + r.h - rad, rad);
            ctx.lineTo(r.x, r.y + rad);
            ctx.arcTo(r.x, r.y, r.x + rad, r.y, rad);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.shadowColor = POWERUP_COLORS.bomb;
            ctx.shadowBlur  = 10;
            ctx.fillStyle   = POWERUP_COLORS.bomb;
            ctx.font        = `bold ${Math.round(r.w * 0.45)}px monospace`;
            ctx.textAlign   = 'center';
            ctx.fillText('B', r.x + r.w / 2, r.y + r.h * 0.52 + r.w * 0.16);
            ctx.shadowBlur  = 0;
            ctx.font        = `${Math.round(r.w * 0.26)}px monospace`;
            ctx.fillStyle   = '#ffffff';
            ctx.fillText(`x${bombs}`, r.x + r.w / 2, r.y + r.h * 0.85);
            ctx.restore();
        }
    }

    // Auto-aim assist indicator (bottom-right)
    if (assistActive) {
        const barW = 110;
        const bx   = CANVAS_W - barW - 16;
        const by   = CANVAS_H - 36;
        const pct  = assistTimer / ASSIST_DURATION;

        ctx.font      = 'bold 13px monospace';
        ctx.fillStyle = '#00eeff';
        ctx.shadowColor = '#00eeff';
        ctx.shadowBlur  = 8;
        ctx.textAlign = 'right';
        ctx.fillText(`AUTO-FIRE  ${Math.ceil(assistTimer)}s`, CANVAS_W - 16, by - 6);
        ctx.shadowBlur = 0;

        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(bx, by, barW, 6);
        ctx.fillStyle = '#00eeff';
        ctx.fillRect(bx, by, pct * barW, 6);
    }

    ctx.restore();
}

function renderLevelTransition() {
    ctx.save();
    ctx.globalAlpha = Math.min(1, levelTransitionTimer * 0.8);
    ctx.textAlign   = 'center';
    ctx.font        = 'bold 56px monospace';
    ctx.fillStyle   = '#ffffff';
    ctx.shadowColor = '#44aaff';
    ctx.shadowBlur  = 30;
    ctx.fillText(`LEVEL ${level + 1}`, CANVAS_W / 2, CANVAS_H / 2 - 20);
    ctx.font      = '22px monospace';
    ctx.fillStyle = '#aaaaaa';
    ctx.shadowBlur = 0;
    ctx.fillText('INCOMING!', CANVAS_W / 2, CANVAS_H / 2 + 30);
    ctx.restore();
}

function renderGameOver() {
    renderParticles();

    ctx.save();
    ctx.textAlign = 'center';

    ctx.font      = 'bold 56px monospace';
    ctx.fillStyle = '#ff4444';
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur  = 20;
    ctx.fillText('GAME OVER', CANVAS_W / 2, 220);

    ctx.shadowBlur = 0;
    ctx.font      = '24px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`SCORE: ${score}`, CANVAS_W / 2, 300);

    const best = topScore();
    if (best > 0) {
        ctx.font      = '18px monospace';
        ctx.fillStyle = '#ffcc44';
        ctx.fillText(`BEST: ${best.toLocaleString()}`, CANVAS_W / 2, 340);
    }

    ctx.font      = '18px monospace';
    ctx.fillStyle = '#aaaaaa';
    if (gameOverLockout <= 0) {
        const blink = Math.floor(Date.now() / 500) % 2 === 0;
        if (blink) ctx.fillText('PRESS SPACE TO PLAY AGAIN', CANVAS_W / 2, 420);
    }

    ctx.restore();
}

function renderNameEntry() {
    ctx.save();
    ctx.textAlign = 'center';
    const cx = CANVAS_W / 2;
    const cy = CANVAS_H / 2;

    // Background panel
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(cx - 260, cy - 160, 520, 320);
    ctx.strokeStyle = '#ffcc44';
    ctx.lineWidth   = 2;
    ctx.strokeRect(cx - 260, cy - 160, 520, 320);

    ctx.font      = 'bold 28px monospace';
    ctx.fillStyle = '#ffcc44';
    ctx.shadowColor = '#ffcc44';
    ctx.shadowBlur  = 12;
    ctx.fillText('NEW HIGH SCORE!', cx, cy - 112);
    ctx.shadowBlur = 0;

    ctx.font      = '20px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`RANK #${nameEntryRank}   SCORE: ${score.toLocaleString()}`, cx, cy - 76);

    ctx.font      = '16px monospace';
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText('ENTER YOUR NAME', cx, cy - 40);

    // Name input box
    const boxW = 300, boxH = 44;
    ctx.strokeStyle = '#44aaff';
    ctx.lineWidth   = 2;
    ctx.shadowColor = '#44aaff';
    ctx.shadowBlur  = 8;
    ctx.strokeRect(cx - boxW / 2, cy - 18, boxW, boxH);
    ctx.shadowBlur = 0;

    const cursor = Math.floor(Date.now() / 530) % 2 === 0 ? '_' : '';
    ctx.font      = 'bold 22px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(nameEntryText + cursor, cx, cy + 14);

    ctx.font      = '14px monospace';
    ctx.fillStyle = '#666666';
    ctx.fillText('TYPE NAME  •  ENTER TO CONFIRM', cx, cy + 60);

    // Hint: show current rank context
    if (leaderboard.length > 0) {
        const prev = leaderboard[nameEntryRank - 1];
        if (prev) {
            ctx.fillStyle = '#555555';
            ctx.fillText(`displaces  ${prev.name}  (${prev.score.toLocaleString()})`, cx, cy + 84);
        }
    }

    ctx.restore();
}

// ── Game Loop ────────────────────────────────────────────────────────────────

let lastTime = 0;

function gameLoop(timestamp) {
    const raw   = timestamp - lastTime;
    lastTime    = timestamp;
    const delta = Math.min(raw, 50); // cap at 50ms
    const dt    = delta / 1000;

    update(dt);
    render();
    requestAnimationFrame(gameLoop);
}

// ── Init ─────────────────────────────────────────────────────────────────────

function init() {
    leaderboard        = loadLeaderboardCache(); // instant local load
    leaderboardLoading = false;
    fetchLeaderboard();                          // async server refresh
    resizeCanvas();
    state   = 'menu';
    score   = 0;
    lives   = 3;
    level   = 1;
    bombs   = 0;
    bullets = [];
    debris  = [];
    enemies = [];
    powerups = [];
    friendlies = [];
    floatingTexts = [];
    particleExplosions = [];
    screenFlash  = 0;
    notification = null;
    assistActive = false;
    assistSource = null;
    assistTimer  = 0;
    assistFireTimer = 0;
    nameEntryText = '';
    resetWeapon();
    generateBackground();
    requestAnimationFrame(gameLoop);
}

init();
