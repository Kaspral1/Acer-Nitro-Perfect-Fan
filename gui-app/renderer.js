// Acer Nitro Perfect Fan - Renderer Process (Enhanced Logic & UI Sync)
// Uses window.electronAPI from preload.js (contextIsolation: true)
const api = window.electronAPI;
const ChartLib = typeof Chart !== 'undefined' ? Chart : null;

// Manual PWM floors — master, CPU and GPU all min 30%
const MIN_PCT_CPU = 30;
const MIN_PCT_GPU = 30;
const MIN_PCT_MASTER = 30;
const SPEED_OFFSET_MIN = -50;
const SPEED_OFFSET_MAX = 50;
const DATA_STALE_MS = 5000;

/** package.json is 1.0.0 (semver); UI / docs always show v1.0 */
function formatAppVersionLabel(raw) {
    const parts = String(raw || '1.0').replace(/^v/i, '').split('.');
    const major = parts[0] || '1';
    const minor = parts[1] || '0';
    return `v${major}.${minor}`;
}

// Global state
let temperatureChart = null;
// Full history buffer: { t: ms, label: string, cpu: number|null, gpu: number|null }
// Always keep up to MAX_HISTORY_MINUTES so range buttons can zoom in/out.
const MAX_HISTORY_MINUTES = 30;
const CHART_POLL_MS = 3000;
const MAX_HISTORY_POINTS = Math.ceil((MAX_HISTORY_MINUTES * 60 * 1000) / CHART_POLL_MS) + 40;
let temperatureHistory = [];
let chartTimeRange = 5; // minutes — display window only
let isManualMode = false;
let updateInterval = null;
let connectionWatchInterval = null;
let maxRpmBaseline = 6100;
let isUserEditingInputs = false;
let currentTranslations = {};
let lastFanDataAt = 0;
let backendAlive = false;
let connectionOnline = false;
let appVersion = '1.0';
let speedOffset = 0; // + = boost CPU, − = boost GPU (from master base)
let isUserEditingOffset = false;
let isUserDraggingFanSlider = false;
let lastAppliedMode = null; // 'manual' | 'auto' | null
/** After a slider release, ignore telemetry long enough for config+daemon to echo. */
let manualUiLockUntil = 0;
let fanDragGeneration = 0;
let offsetDragGeneration = 0;
const MANUAL_UI_LOCK_MS = 900;

function lockManualUi(ms = MANUAL_UI_LOCK_MS) {
    manualUiLockUntil = Date.now() + ms;
}

function isManualUiLocked() {
    return Date.now() < manualUiLockUntil || isUserDraggingFanSlider || isUserEditingOffset;
}

let masterBase = 30; // shared base under offset (master slider)
let currentProfile = 'Silent'; // Silent | Balanced | Turbo
// Źródło krzywej: default (wbudowane profile) | custom (własne, niekasowane przy default)
let curveSource = 'default'; // 'default' | 'custom'
let hasCustomCurve = false;

// Dual curve storage in frontend (speed floor 30% for all points)
let curvesData = {
    cpu: [[45, 30], [55, 30], [65, 30], [75, 42], [85, 65]],
    gpu: [[45, 30], [55, 30], [65, 30], [75, 42], [85, 65]]
};
// Ostatnio znane default/custom z telemetrii (do podglądu przy przełączaniu lokalnym)
let defaultCurvesCache = null;
let customCurvesCache = null;
// Domyślne krzywe wszystkich profili (edycja w Ustawieniach)
const FACTORY_PROFILE_DEFAULTS = {
    Silent: {
        cpu: [[45, 30], [55, 30], [65, 30], [75, 42], [85, 65]],
        gpu: [[45, 30], [55, 30], [65, 30], [75, 42], [85, 65]],
    },
    Balanced: {
        cpu: [[45, 30], [55, 32], [65, 42], [75, 62], [85, 100]],
        gpu: [[45, 30], [55, 32], [65, 42], [75, 62], [85, 100]],
    },
    Turbo: {
        cpu: [[45, 45], [55, 60], [65, 80], [75, 95], [85, 100]],
        gpu: [[45, 45], [55, 60], [65, 80], [75, 95], [85, 100]],
    },
};
let profileDefaultsCache = {
    Silent: {
        cpu: FACTORY_PROFILE_DEFAULTS.Silent.cpu.map((p) => [...p]),
        gpu: FACTORY_PROFILE_DEFAULTS.Silent.gpu.map((p) => [...p]),
    },
    Balanced: {
        cpu: FACTORY_PROFILE_DEFAULTS.Balanced.cpu.map((p) => [...p]),
        gpu: FACTORY_PROFILE_DEFAULTS.Balanced.gpu.map((p) => [...p]),
    },
    Turbo: {
        cpu: FACTORY_PROFILE_DEFAULTS.Turbo.cpu.map((p) => [...p]),
        gpu: FACTORY_PROFILE_DEFAULTS.Turbo.gpu.map((p) => [...p]),
    },
};
let defaultsModalProfile = 'Silent';
let defaultsModalOpen = false;
/** Backend: którykolwiek profil ma domyślne inne niż fabryczne */
let defaultsModifiedFromServer = false;
/** Snapshot cache przy otwarciu modala — Anuluj przywraca ten stan (bez zapisu) */
let defaultsModalSnapshot = null;

function cloneAllProfileDefaults(src) {
    const out = {};
    for (const prof of ['Silent', 'Balanced', 'Turbo']) {
        if (src && src[prof]) {
            out[prof] = cloneCurveMap(src[prof]);
        }
    }
    return out;
}

function clampCurveSpeed(val) {
    const n = Number(val);
    if (Number.isNaN(n)) return MIN_PCT_CPU;
    return Math.max(MIN_PCT_CPU, Math.min(100, n));
}

// DOM Elements
const cpuTemp = document.getElementById('cpu-temp');
const cpuRpm = document.getElementById('cpu-rpm');
const cpuSpeed = document.getElementById('cpu-speed');
const cpuGaugeCircle = document.getElementById('cpu-gauge-circle');

const gpuTemp = document.getElementById('gpu-temp');
const gpuRpm = document.getElementById('gpu-rpm');
const gpuSpeed = document.getElementById('gpu-speed');
const gpuGaugeCircle = document.getElementById('gpu-gauge-circle');

const cpuLoadBar = document.getElementById('cpu-load-bar');
const cpuLoadText = document.getElementById('cpu-load-text');
const gpuLoadBar = document.getElementById('gpu-load-bar');
const gpuLoadText = document.getElementById('gpu-load-text');
const ramLoadBar = document.getElementById('ram-load-bar');
const ramLoadText = document.getElementById('ram-load-text');
const vramLoadBar = document.getElementById('vram-load-bar');
const vramLoadText = document.getElementById('vram-load-text');
const otherSensorsContainer = document.getElementById('other-sensors-container');

const fanSlider = document.getElementById('fan-slider');
const cpuFanSlider = document.getElementById('cpu-fan-slider');
const gpuFanSlider = document.getElementById('gpu-fan-slider');
const speedOffsetSlider = document.getElementById('speed-offset-slider');
const sliderValue = document.getElementById('slider-value');
const cpuSliderValue = document.getElementById('cpu-slider-value');
const gpuSliderValue = document.getElementById('gpu-slider-value');

/** Master / CPU / GPU / offset — aktywne tylko w trybie manualnym */
function setManualControlsEnabled(enabled) {
    const autoTip = currentTranslations['tooltip_auto_mode']
        || currentTranslations['mode_auto_desc']
        || 'Tryb pracy Auto';
    [fanSlider, cpuFanSlider, gpuFanSlider, speedOffsetSlider].forEach((s) => {
        if (!s) return;
        s.disabled = !enabled;
        const wrap = s.closest('.range-wrapper') || s.parentElement || s;
        const group = s.closest('.slider-group');
        if (!enabled) {
            // title na wrapperze — disabled <input> często nie pokazuje tooltipu
            s.setAttribute('title', autoTip);
            wrap.setAttribute('title', autoTip);
            wrap.classList.add('is-locked');
            if (group) {
                group.setAttribute('title', autoTip);
                group.classList.add('is-locked');
            }
        } else {
            s.removeAttribute('title');
            wrap.removeAttribute('title');
            wrap.classList.remove('is-locked');
            if (group) {
                group.removeAttribute('title');
                group.classList.remove('is-locked');
            }
        }
    });
}

const statusValue = document.getElementById('status-value');
const daemonDot = document.getElementById('daemon-dot');
const modeToggle = document.getElementById('mode-toggle');
const modeLabel = document.getElementById('mode-label');
const activeModeDisplay = document.getElementById('active-mode-display');
const profileButtons = document.querySelectorAll('.profile-btn');
const chartButtons = document.querySelectorAll('.chart-btn');
const presetPills = document.querySelectorAll('.preset-pill');

const applyCurveBtn = document.getElementById('apply-curve-btn');

const cpuModelText = document.getElementById('cpu-model-text');
const gpuModelText = document.getElementById('gpu-model-text');

// Window titlebar controls
document.getElementById('minimize-btn').addEventListener('click', () => api.windowMinimize());
document.getElementById('maximize-btn').addEventListener('click', () => api.windowMaximize());

// Close (X): ask quit vs minimize-to-tray, optional "don't ask again"
const CLOSE_PREF_DONT_ASK = 'close-dont-ask';
const CLOSE_PREF_ACTION = 'close-action'; // 'quit' | 'minimize'

function getClosePreference() {
    const dontAsk = localStorage.getItem(CLOSE_PREF_DONT_ASK) === '1';
    const action = localStorage.getItem(CLOSE_PREF_ACTION);
    if (dontAsk && (action === 'quit' || action === 'minimize')) {
        return action;
    }
    return null;
}

function getCloseActionSetting() {
    const pref = getClosePreference();
    if (pref === 'quit' || pref === 'minimize') return pref;
    return 'ask';
}

/** Przekaź preferencję zamykania do main process (Alt+F4 / menedżer okien). */
function pushCloseActionPrefToMain() {
    if (!api || typeof api.setCloseActionPref !== 'function') return;
    const pref = getClosePreference(); // 'quit' | 'minimize' | null
    api.setCloseActionPref(pref || 'ask');
}

function setCloseActionSetting(value) {
    if (value === 'minimize' || value === 'quit') {
        localStorage.setItem(CLOSE_PREF_DONT_ASK, '1');
        localStorage.setItem(CLOSE_PREF_ACTION, value);
    } else {
        localStorage.removeItem(CLOSE_PREF_DONT_ASK);
        localStorage.removeItem(CLOSE_PREF_ACTION);
    }
    syncSettingsCloseSelect();
    pushCloseActionPrefToMain();
}

function syncSettingsCloseSelect() {
    const sel = document.getElementById('settings-close-action');
    if (sel) sel.value = getCloseActionSetting();
}

function saveClosePreference(action, dontAsk) {
    if (dontAsk && (action === 'quit' || action === 'minimize')) {
        localStorage.setItem(CLOSE_PREF_DONT_ASK, '1');
        localStorage.setItem(CLOSE_PREF_ACTION, action);
    }
    syncSettingsCloseSelect();
    pushCloseActionPrefToMain();
}

function resetClosePreference() {
    localStorage.removeItem(CLOSE_PREF_DONT_ASK);
    localStorage.removeItem(CLOSE_PREF_ACTION);
    syncSettingsCloseSelect();
    pushCloseActionPrefToMain();
}

function showSafetyDisclaimer() {
    const banner = document.getElementById('safety-disclaimer');
    if (banner) {
        banner.classList.remove('hidden');
        localStorage.removeItem('disclaimer-dismissed');
    }
}

function applyCloseAction(action) {
    if (action === 'quit') {
        api.windowQuit();
    } else {
        api.windowHide();
    }
}

function showCloseConfirmModal() {
    const modal = document.getElementById('close-confirm-modal');
    if (!modal) {
        applyCloseAction('minimize');
        return;
    }
    const dontAskEl = document.getElementById('close-dont-ask');
    if (dontAskEl) dontAskEl.checked = false;
    modal.classList.remove('hidden');
}

function hideCloseConfirmModal() {
    const modal = document.getElementById('close-confirm-modal');
    if (modal) modal.classList.add('hidden');
}

function handleCloseRequest() {
    // Unikaj podwójnego modalu (np. X + close-requested z main)
    const modal = document.getElementById('close-confirm-modal');
    if (modal && !modal.classList.contains('hidden')) return;

    const pref = getClosePreference();
    if (pref) {
        applyCloseAction(pref);
        return;
    }
    showCloseConfirmModal();
}

document.getElementById('close-btn').addEventListener('click', (e) => {
    e.preventDefault();
    // Nie wołaj window.close() — to od razu applyCloseAction / modal
    handleCloseRequest();
});

function setupCloseConfirmModal() {
    const modal = document.getElementById('close-confirm-modal');
    if (!modal) return;

    const quitBtn = document.getElementById('close-confirm-quit');
    const minBtn = document.getElementById('close-confirm-minimize');
    const cancelBtn = document.getElementById('close-confirm-cancel');
    const dismissBtn = document.getElementById('close-confirm-dismiss');
    const dontAskEl = document.getElementById('close-dont-ask');

    const choose = (action) => {
        const dontAsk = !!(dontAskEl && dontAskEl.checked);
        saveClosePreference(action, dontAsk);
        hideCloseConfirmModal();
        applyCloseAction(action);
    };

    if (quitBtn) quitBtn.addEventListener('click', () => choose('quit'));
    if (minBtn) minBtn.addEventListener('click', () => choose('minimize'));
    if (cancelBtn) cancelBtn.addEventListener('click', hideCloseConfirmModal);
    if (dismissBtn) dismissBtn.addEventListener('click', hideCloseConfirmModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) hideCloseConfirmModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
            hideCloseConfirmModal();
        }
    });
}

function clampCpuSpeed(val) {
    return Math.max(MIN_PCT_CPU, Math.min(100, parseInt(val, 10) || 0));
}

function clampGpuSpeed(val) {
    return Math.max(MIN_PCT_GPU, Math.min(100, parseInt(val, 10) || 0));
}

function clampMasterSpeed(val) {
    return Math.max(MIN_PCT_MASTER, Math.min(100, parseInt(val, 10) || 0));
}

function clampSpeedOffset(val) {
    const n = parseInt(val, 10);
    if (Number.isNaN(n)) return 0;
    return Math.max(SPEED_OFFSET_MIN, Math.min(SPEED_OFFSET_MAX, n));
}

function formatOffsetLabel(offset) {
    const o = clampSpeedOffset(offset);
    if (o === 0) {
        return currentTranslations['offset_desc_zero'] || 'CPU = GPU (bez różnicy)';
    }
    if (o > 0) {
        return (currentTranslations['offset_desc_plus'] || 'CPU +{n}% (CPU szybszy)')
            .replace('{n}', String(o));
    }
    return (currentTranslations['offset_desc_minus'] || 'GPU +{n}% (GPU szybszy)')
        .replace('{n}', String(Math.abs(o)));
}

function formatOffsetBadge(offset) {
    const o = clampSpeedOffset(offset);
    if (o > 0) return `CPU +${o}%`;
    if (o < 0) return `GPU +${Math.abs(o)}%`;
    return '0%';
}

function updateOffsetUI(offset, { fromUser = false } = {}) {
    speedOffset = clampSpeedOffset(offset);
    const slider = document.getElementById('speed-offset-slider');
    const badge = document.getElementById('offset-value');
    const desc = document.getElementById('offset-desc');
    if (slider && (!fromUser || document.activeElement !== slider)) {
        if (!fromUser) slider.value = String(speedOffset);
    }
    if (fromUser && slider) slider.value = String(speedOffset);
    if (badge) badge.textContent = formatOffsetBadge(speedOffset);
    if (desc) desc.textContent = formatOffsetLabel(speedOffset);
}

/** From master base → effective CPU/GPU after offset (+ boosts CPU, − boosts GPU). */
function fansFromBase(base) {
    const b = clampMasterSpeed(base);
    const o = speedOffset;
    if (o > 0) {
        return { base: b, cpu: clampCpuSpeed(b + o), gpu: clampGpuSpeed(b) };
    }
    if (o < 0) {
        return { base: b, cpu: clampCpuSpeed(b), gpu: clampGpuSpeed(b - o) };
    }
    return { base: b, cpu: clampCpuSpeed(b), gpu: clampGpuSpeed(b) };
}

function getCurveProfileLabel(profile) {
    const p = profile || currentProfile || 'Silent';
    const keyMap = {
        Silent: 'curve_profile_silent',
        Balanced: 'curve_profile_balanced',
        Turbo: 'curve_profile_turbo',
    };
    const fallbacks = {
        Silent: 'PROFIL CICHY',
        Balanced: 'PROFIL NORMALNY',
        Turbo: 'PROFIL TURBO',
    };
    const key = keyMap[p] || keyMap.Silent;
    return currentTranslations[key] || fallbacks[p] || fallbacks.Silent;
}

function updateCurveEditorTitle(profile) {
    if (profile) currentProfile = profile;
    const el = document.getElementById('curve-editor-title');
    if (!el) return;
    const name = getCurveProfileLabel(currentProfile);
    const tpl = currentTranslations['curve_editor_title'] || 'KRZYWA CHŁODZENIA {profile}';
    el.textContent = tpl.replace('{profile}', name);
}

function applyFanSlidersFromBase(base, { send = false } = {}) {
    const f = fansFromBase(base);
    masterBase = f.base;
    if (fanSlider) {
        fanSlider.value = f.base;
        sliderValue.textContent = `${Math.round(f.base)}%`;
    }
    if (cpuFanSlider) {
        cpuFanSlider.value = f.cpu;
        cpuSliderValue.textContent = `${Math.round(f.cpu)}%`;
    }
    if (gpuFanSlider) {
        gpuFanSlider.value = f.gpu;
        gpuSliderValue.textContent = `${Math.round(f.gpu)}%`;
    }
    if (send) {
        api.setFanSpeed({ speed: f.base });
    }
    return f;
}

function setConnectionStatus(online, reason) {
    connectionOnline = online;
    const statusText = online
        ? (currentTranslations['connected'] || 'Połączono')
        : (currentTranslations['disconnected'] || 'Brak połączenia');
    const headerText = online
        ? (currentTranslations['system_optimal'] || 'SYSTEM OPTIMAL')
        : (currentTranslations['system_offline'] || 'OFFLINE');

    if (statusValue) {
        // In manual mode keep mode description when online
        if (online && isManualMode) {
            statusValue.textContent = currentTranslations['mode_manual_desc'] || 'Sterowanie ręczne';
        } else {
            statusValue.textContent = statusText;
        }
    }

    const headerStatus = document.getElementById('header-status-text');
    if (headerStatus) headerStatus.textContent = headerText;

    const headerBadge = document.getElementById('header-status-badge');
    const headerDot = headerBadge ? headerBadge.querySelector('.status-dot') : null;
    if (daemonDot) {
        daemonDot.className = online ? 'status-dot green' : 'status-dot red';
    }
    if (headerDot) {
        headerDot.className = online ? 'status-dot green' : 'status-dot red';
    }
    if (headerBadge) {
        headerBadge.classList.toggle('offline', !online);
    }

    if (!online && reason === 'stale') {
        // silent — polled; toast only once would need extra state
    }
}

// Toast Notification Helper
function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-dot ${type}"></span>
        <span class="toast-msg">${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Initialize Chart.js telemetry graph
function initChart() {
    if (!ChartLib) {
        console.error('Chart.js not loaded');
        return;
    }
    const ctx = document.getElementById('temp-chart').getContext('2d');

    // Intel blue / NVIDIA green (match gauges & resource bars)
    const cpuGradient = ctx.createLinearGradient(0, 0, 0, 200);
    cpuGradient.addColorStop(0, 'rgba(0, 113, 197, 0.35)');
    cpuGradient.addColorStop(1, 'rgba(0, 113, 197, 0.0)');

    const gpuGradient = ctx.createLinearGradient(0, 0, 0, 200);
    gpuGradient.addColorStop(0, 'rgba(118, 185, 0, 0.35)');
    gpuGradient.addColorStop(1, 'rgba(118, 185, 0, 0.0)');

    temperatureChart = new ChartLib(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'CPU Temp (°C)',
                data: [],
                borderColor: '#0071c5',
                backgroundColor: cpuGradient,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.35,
                fill: true,
            }, {
                label: 'GPU Temp (°C)',
                data: [],
                borderColor: '#76b900',
                backgroundColor: gpuGradient,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.35,
                fill: true,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 300,
                easing: 'easeOutQuart',
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: {
                        color: '#8e95ab',
                        font: { family: 'Outfit', size: 11 },
                        boxWidth: 12,
                        padding: 10,
                        usePointStyle: true,
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(14, 17, 26, 0.95)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 10,
                    titleFont: { family: 'Outfit', size: 12 },
                    bodyFont: { family: 'JetBrains Mono', size: 12 },
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)', drawBorder: false },
                    ticks: { color: '#636b83', font: { family: 'JetBrains Mono', size: 10 }, maxRotation: 0, maxTicksLimit: 8 }
                },
                y: {
                    min: 30,
                    max: 100,
                    grid: { color: 'rgba(255, 255, 255, 0.04)', drawBorder: false },
                    ticks: { color: '#636b83', font: { family: 'JetBrains Mono', size: 10 }, stepSize: 10 }
                }
            }
        }
    });
}

/** Read curve points from dual editor inputs for fan: 'cpu' | 'gpu' */
function readCurveFromInputs(fan) {
    const points = [];
    for (let i = 1; i <= 6; i++) {
        const tempEl = document.getElementById(`curve-${fan}-temp-${i}`);
        const speedEl = document.getElementById(`curve-${fan}-speed-${i}`);
        if (!tempEl || !speedEl) continue;
        const row = tempEl.closest('.table-row');
        if (row && row.style.display === 'none') continue;
        // Skip empty/hidden half-rows: no temp value treated as unused slot
        if (tempEl.value === '' && speedEl.value === '') continue;
        let t = parseFloat(tempEl.value);
        let s = parseFloat(speedEl.value);
        if (Number.isNaN(t) && Number.isNaN(s)) continue;
        t = Number.isNaN(t) ? 0 : Math.max(0, Math.min(110, t));
        s = clampCurveSpeed(Number.isNaN(s) ? MIN_PCT_CPU : s);
        points.push([t, s]);
    }
    return points;
}

function sortCurvePoints(points) {
    return [...points].sort((a, b) => a[0] - b[0]);
}

function isCurveUnsorted(points) {
    for (let i = 0; i < points.length - 1; i++) {
        if (points[i][0] > points[i + 1][0]) return true;
    }
    return false;
}

/** Draw one fan curve (fill + stroke + handles) on shared scale */
function paintCurveOnCanvas(ctx, points, colors, mapX, mapY, h) {
    if (!points || points.length < 2) return;
    const sorted = sortCurvePoints(points);

    // Soft fill under curve
    ctx.beginPath();
    ctx.moveTo(mapX(sorted[0][0]), h);
    for (const p of sorted) {
        ctx.lineTo(mapX(p[0]), mapY(p[1]));
    }
    ctx.lineTo(mapX(sorted[sorted.length - 1][0]), h);
    ctx.closePath();
    const fillGradient = ctx.createLinearGradient(0, 0, 0, h);
    fillGradient.addColorStop(0, colors.fillTop);
    fillGradient.addColorStop(1, colors.fillBottom);
    ctx.fillStyle = fillGradient;
    ctx.fill();

    // Stroke
    ctx.beginPath();
    ctx.moveTo(mapX(sorted[0][0]), mapY(sorted[0][1]));
    for (let i = 1; i < sorted.length; i++) {
        ctx.lineTo(mapX(sorted[i][0]), mapY(sorted[i][1]));
    }
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Handles
    for (const p of sorted) {
        const px = mapX(p[0]);
        const py = mapY(p[1]);
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

// Draw crisp HiDPI canvas preview — both CPU & GPU on one scale
function drawCurvePreview() {
    const canvas = document.getElementById('curve-preview-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const parent = canvas.parentElement;
    const rect = (parent || canvas).getBoundingClientRect();
    const w = Math.max(0, Math.floor(rect.width));
    const h = Math.max(0, Math.floor(rect.height));
    // Guard: zero size → step 0 causes infinite loop and freezes the UI
    if (w < 2 || h < 2) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const stepX = w / 4;
    const stepY = h / 4;
    for (let x = 0; x <= w + 0.5; x += stepX) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }
    for (let y = 0; y <= h + 0.5; y += stepY) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }

    // Shared scale: temp 30–100°C → X, speed 0–100% → Y
    const mapX = (t) => Math.max(0, Math.min(w, ((t - 30) / 70) * w));
    const mapY = (s) => Math.max(0, Math.min(h, h - (s / 100) * h));

    const cpuPoints = readCurveFromInputs('cpu');
    const gpuPoints = readCurveFromInputs('gpu');

    // GPU first (under), then CPU on top for readability
    paintCurveOnCanvas(ctx, gpuPoints, {
        stroke: '#76b900',
        fillTop: 'rgba(118, 185, 0, 0.22)',
        fillBottom: 'rgba(118, 185, 0, 0.0)',
    }, mapX, mapY, h);

    paintCurveOnCanvas(ctx, cpuPoints, {
        stroke: '#0071c5',
        fillTop: 'rgba(0, 113, 197, 0.28)',
        fillBottom: 'rgba(0, 113, 197, 0.0)',
    }, mapX, mapY, h);
}

// Update circular gauges
function updateGauge(circle, rpm) {
    if (!circle) return;
    const maxRpm = maxRpmBaseline;
    const pct = Math.min(1.0, Math.max(0.0, rpm / maxRpm));
    const circumference = 440;
    const offset = circumference - (pct * circumference);
    circle.style.strokeDashoffset = offset;
}

// Load both CPU & GPU curves into dual 4-column inputs
// TYLKO główna karta krzywej — NIE tabela w modalu domyślnych (#defaults-inputs-table),
// bo wspólny selektor .curve-inputs-table chował wiersze modala co ~0.5s (telemetria).
function loadCurvesToInputs() {
    const cpuPts = curvesData.cpu || [];
    const gpuPts = curvesData.gpu || [];
    const rowCount = Math.max(cpuPts.length, gpuPts.length, 1);
    const tableRows = document.querySelectorAll(
        '#custom-curve-card .curve-inputs-table .table-row'
    );

    tableRows.forEach((row, idx) => {
        const i = idx + 1;
        const cpuTemp = document.getElementById(`curve-cpu-temp-${i}`);
        const cpuSpeed = document.getElementById(`curve-cpu-speed-${i}`);
        const gpuTemp = document.getElementById(`curve-gpu-temp-${i}`);
        const gpuSpeed = document.getElementById(`curve-gpu-speed-${i}`);

        if (idx < rowCount) {
            row.style.display = 'grid';
            if (idx < cpuPts.length) {
                if (cpuTemp) cpuTemp.value = Math.round(cpuPts[idx][0]);
                if (cpuSpeed) {
                    cpuSpeed.min = String(MIN_PCT_CPU);
                    cpuSpeed.value = Math.round(clampCurveSpeed(cpuPts[idx][1]));
                }
            } else {
                if (cpuTemp) cpuTemp.value = '';
                if (cpuSpeed) cpuSpeed.value = '';
            }
            if (idx < gpuPts.length) {
                if (gpuTemp) gpuTemp.value = Math.round(gpuPts[idx][0]);
                if (gpuSpeed) {
                    gpuSpeed.min = String(MIN_PCT_CPU);
                    gpuSpeed.value = Math.round(clampCurveSpeed(gpuPts[idx][1]));
                }
            } else {
                if (gpuTemp) gpuTemp.value = '';
                if (gpuSpeed) gpuSpeed.value = '';
            }
        } else {
            row.style.display = 'none';
        }
    });
    setCurveInputsReadonly(curveSource === 'default');
    drawCurvePreview();
}

// Back-compat alias
function loadCurveToInputs() {
    loadCurvesToInputs();
}

function setCurveInputsReadonly(readonly) {
    const table = document.querySelector('#custom-curve-card .curve-inputs-table');
    if (table) table.classList.toggle('is-readonly', !!readonly);
    for (const fan of ['cpu', 'gpu']) {
        for (let i = 1; i <= 6; i++) {
            const t = document.getElementById(`curve-${fan}-temp-${i}`);
            const s = document.getElementById(`curve-${fan}-speed-${i}`);
            if (t) t.readOnly = !!readonly;
            if (s) s.readOnly = !!readonly;
        }
    }
}

function syncCurveSourceUI(source) {
    curveSource = source === 'custom' ? 'custom' : 'default';
    const btnDefault = document.getElementById('curve-source-default');
    const btnCustom = document.getElementById('curve-source-custom');
    if (btnDefault && btnCustom) {
        btnDefault.classList.toggle('active', curveSource === 'default');
        btnCustom.classList.toggle('active', curveSource === 'custom');
    }
    setCurveInputsReadonly(curveSource === 'default');
}

function mapCurvePayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    for (const fan of ['cpu', 'gpu']) {
        const pts = raw[fan];
        if (!Array.isArray(pts) || !pts.length) return null;
        out[fan] = pts.map(([t, s]) => [Number(t), clampCurveSpeed(s)]);
    }
    return out;
}

function cloneCurveMap(map) {
    if (!map) return null;
    return {
        cpu: (map.cpu || []).map((p) => [...p]),
        gpu: (map.gpu || []).map((p) => [...p]),
    };
}

function curvePointsEqual(a, b, tol = 0.05) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (Math.abs(Number(a[i][0]) - Number(b[i][0])) > tol) return false;
        if (Math.abs(Number(a[i][1]) - Number(b[i][1])) > tol) return false;
    }
    return true;
}

function curveMapEqualsFactory(map, factory) {
    if (!map || !factory) return false;
    return curvePointsEqual(map.cpu, factory.cpu) && curvePointsEqual(map.gpu, factory.gpu);
}

function isProfileDefaultsModified(profile) {
    const factory = FACTORY_PROFILE_DEFAULTS[profile];
    const current = profileDefaultsCache[profile];
    if (!factory) return false;
    if (!current) return false;
    return !curveMapEqualsFactory(current, factory);
}

function anyProfileDefaultsModifiedInCache() {
    return ['Silent', 'Balanced', 'Turbo'].some((p) => isProfileDefaultsModified(p));
}

/** Banner + przycisk przywracania, gdy domyślne różnią się od fabrycznych */
function updateDefaultsEditedBanner() {
    const banner = document.getElementById('defaults-edited-banner');
    if (!banner) return;
    // Porównuj z wbudowanymi defaultami programu — nie z factory z backendu
    // (stary proces / AppImage może mieć poprzednie Turbo).
    let dirty = anyProfileDefaultsModifiedInCache();
    if (defaultsModalOpen) {
        const cpu = readDefaultsCurveFromInputs('cpu');
        const gpu = readDefaultsCurveFromInputs('gpu');
        const factory = FACTORY_PROFILE_DEFAULTS[defaultsModalProfile];
        if (factory && cpu.length >= 2 && gpu.length >= 2) {
            const live = {
                cpu: sortCurvePoints(cpu),
                gpu: sortCurvePoints(gpu),
            };
            if (!curveMapEqualsFactory(live, factory)) dirty = true;
        } else if (factory && (cpu.length > 0 || gpu.length > 0)) {
            // Częściowa edycja — traktuj jako zmienione
            dirty = true;
        }
    }
    banner.classList.toggle('hidden', !dirty);
}

function mergeProfileDefaultsPayload(raw) {
    if (!raw || typeof raw !== 'object') return;
    for (const prof of ['Silent', 'Balanced', 'Turbo']) {
        if (!raw[prof]) continue;
        const mapped = mapCurvePayload(raw[prof]);
        if (mapped) profileDefaultsCache[prof] = mapped;
    }
}

function mergeFactoryProfilesPayload(raw) {
    if (!raw || typeof raw !== 'object') return;
    for (const prof of ['Silent', 'Balanced', 'Turbo']) {
        if (!raw[prof]) continue;
        const mapped = mapCurvePayload(raw[prof]);
        if (mapped) {
            FACTORY_PROFILE_DEFAULTS[prof] = mapped;
        }
    }
}

/** Read curve points from defaults-modal inputs */
function readDefaultsCurveFromInputs(fan) {
    const points = [];
    for (let i = 1; i <= 6; i++) {
        const tempEl = document.getElementById(`def-${fan}-temp-${i}`);
        const speedEl = document.getElementById(`def-${fan}-speed-${i}`);
        if (!tempEl || !speedEl) continue;
        if (tempEl.value === '' && speedEl.value === '') continue;
        let t = parseFloat(tempEl.value);
        let s = parseFloat(speedEl.value);
        if (Number.isNaN(t) && Number.isNaN(s)) continue;
        t = Number.isNaN(t) ? 0 : Math.max(0, Math.min(110, t));
        s = clampCurveSpeed(Number.isNaN(s) ? MIN_PCT_CPU : s);
        points.push([t, s]);
    }
    return points;
}

function loadDefaultsProfileToInputs(profile) {
    const data = profileDefaultsCache[profile] || FACTORY_PROFILE_DEFAULTS[profile];
    if (!data) return;
    if (!profileDefaultsCache[profile]) {
        profileDefaultsCache[profile] = cloneCurveMap(data);
    }
    const cpuPts = data.cpu || [];
    const gpuPts = data.gpu || [];
    const tableRows = document.querySelectorAll('#defaults-inputs-table .table-row');

    // Zawsze pokazuj wszystkie 6 wierszy (puste = opcjonalne punkty) — nie chowaj tabeli
    tableRows.forEach((row, idx) => {
        const i = idx + 1;
        row.style.display = 'grid';
        const cpuTemp = document.getElementById(`def-cpu-temp-${i}`);
        const cpuSpeed = document.getElementById(`def-cpu-speed-${i}`);
        const gpuTemp = document.getElementById(`def-gpu-temp-${i}`);
        const gpuSpeed = document.getElementById(`def-gpu-speed-${i}`);

        if (idx < cpuPts.length) {
            if (cpuTemp) cpuTemp.value = Math.round(cpuPts[idx][0]);
            if (cpuSpeed) cpuSpeed.value = Math.round(clampCurveSpeed(cpuPts[idx][1]));
        } else {
            if (cpuTemp) cpuTemp.value = '';
            if (cpuSpeed) cpuSpeed.value = '';
        }
        if (idx < gpuPts.length) {
            if (gpuTemp) gpuTemp.value = Math.round(gpuPts[idx][0]);
            if (gpuSpeed) gpuSpeed.value = Math.round(clampCurveSpeed(gpuPts[idx][1]));
        } else {
            if (gpuTemp) gpuTemp.value = '';
            if (gpuSpeed) gpuSpeed.value = '';
        }
    });
    drawDefaultsCurvePreview();
    updateDefaultsEditedBanner();
}

function drawDefaultsCurvePreview() {
    const canvas = document.getElementById('defaults-curve-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    // Rozmiar z kontenera (nie z canvas — atrybuty width/height psuły layout HiDPI)
    const parent = canvas.parentElement;
    const rect = (parent || canvas).getBoundingClientRect();
    const w = Math.max(0, Math.floor(rect.width));
    const h = Math.max(0, Math.floor(rect.height));
    // Ukryty modal → 0×0; pętla x += w/4 przy w=0 = freeze UI
    if (w < 2 || h < 2) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // WAŻNE: najpierw CSS (rozmiar wyświetlania), potem bufor pikseli.
    // Samo canvas.width/height bez CSS powiększa element o dpr i wypycha tabelę!
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const stepX = w / 4;
    const stepY = h / 4;
    for (let x = 0; x <= w + 0.5; x += stepX) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }
    for (let y = 0; y <= h + 0.5; y += stepY) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }

    const mapX = (t) => Math.max(0, Math.min(w, ((t - 30) / 70) * w));
    const mapY = (s) => Math.max(0, Math.min(h, h - (s / 100) * h));

    const cpuPoints = readDefaultsCurveFromInputs('cpu');
    const gpuPoints = readDefaultsCurveFromInputs('gpu');

    paintCurveOnCanvas(ctx, gpuPoints, {
        stroke: '#76b900',
        fillTop: 'rgba(118, 185, 0, 0.22)',
        fillBottom: 'rgba(118, 185, 0, 0.0)',
    }, mapX, mapY, h);

    paintCurveOnCanvas(ctx, cpuPoints, {
        stroke: '#0071c5',
        fillTop: 'rgba(0, 113, 197, 0.28)',
        fillBottom: 'rgba(0, 113, 197, 0.0)',
    }, mapX, mapY, h);
}

function stashDefaultsInputsToCache() {
    const cpu = readDefaultsCurveFromInputs('cpu');
    const gpu = readDefaultsCurveFromInputs('gpu');
    if (cpu.length >= 2 && gpu.length >= 2) {
        profileDefaultsCache[defaultsModalProfile] = {
            cpu: sortCurvePoints(cpu).map(([t, s]) => [t, clampCurveSpeed(s)]),
            gpu: sortCurvePoints(gpu).map(([t, s]) => [t, clampCurveSpeed(s)]),
        };
    }
}

function setDefaultsModalProfile(profile) {
    if (!['Silent', 'Balanced', 'Turbo'].includes(profile)) return;
    if (defaultsModalOpen && profile !== defaultsModalProfile) {
        stashDefaultsInputsToCache();
    }
    defaultsModalProfile = profile;
    document.querySelectorAll('.defaults-profile-tab').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.profile === profile);
    });
    loadDefaultsProfileToInputs(profile);
}

function openDefaultsModal() {
    try {
        const modal = document.getElementById('defaults-modal');
        if (!modal) return;
        defaultsModalOpen = true;
        // Snapshot przed edycją — Anuluj / X odrzuca lokalne zmiany bez zapisu
        defaultsModalSnapshot = cloneAllProfileDefaults(profileDefaultsCache);
        const settingsDropdown = document.getElementById('settings-menu-dropdown');
        if (settingsDropdown) settingsDropdown.classList.add('hidden');

        // Najpierw pokaż modal (canvas musi mieć niezerowy rozmiar przed rysowaniem)
        modal.classList.remove('hidden');

        const profile = ['Silent', 'Balanced', 'Turbo'].includes(currentProfile)
            ? currentProfile
            : 'Silent';
        setDefaultsModalProfile(profile);
        updateDefaultsEditedBanner();

        // Rysuj po layout (dwa rAF — po reflow z display:flex)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                try {
                    drawDefaultsCurvePreview();
                    updateDefaultsEditedBanner();
                } catch (err) {
                    console.error('defaults modal draw error:', err);
                }
            });
        });
    } catch (err) {
        console.error('openDefaultsModal error:', err);
        defaultsModalOpen = false;
        defaultsModalSnapshot = null;
    }
}

/**
 * @param {{ discard?: boolean }} [opts] discard=true przywraca snapshot (Anuluj / X / backdrop)
 */
function closeDefaultsModal(opts = {}) {
    const discard = !!opts.discard;
    if (discard && defaultsModalSnapshot) {
        for (const prof of ['Silent', 'Balanced', 'Turbo']) {
            if (defaultsModalSnapshot[prof]) {
                profileDefaultsCache[prof] = cloneCurveMap(defaultsModalSnapshot[prof]);
            }
        }
    }
    defaultsModalSnapshot = null;
    const modal = document.getElementById('defaults-modal');
    if (modal) modal.classList.add('hidden');
    defaultsModalOpen = false;
}

function restoreFactoryDefaults() {
    // Przywróć wbudowane krzywe programu (te z FACTORY_PROFILE_DEFAULTS),
    // nie factory z backendu — reset_default_curves w starym procesie
    // potrafiło cofnąć Turbo do poprzednich wartości.
    for (const prof of ['Silent', 'Balanced', 'Turbo']) {
        const data = cloneCurveMap(FACTORY_PROFILE_DEFAULTS[prof]);
        profileDefaultsCache[prof] = data;
        if (api.setDefaultCurve) {
            api.setDefaultCurve({ profile: prof, fan: 'cpu', points: data.cpu });
            api.setDefaultCurve({ profile: prof, fan: 'gpu', points: data.gpu });
        }
    }
    defaultsModifiedFromServer = false;

    // Po przywróceniu — Anuluj nie powinno cofnąć do stanu „przed restore”
    defaultsModalSnapshot = cloneAllProfileDefaults(profileDefaultsCache);

    loadDefaultsProfileToInputs(defaultsModalProfile);

    if (defaultCurvesCache || currentProfile) {
        defaultCurvesCache = cloneCurveMap(profileDefaultsCache[currentProfile] || FACTORY_PROFILE_DEFAULTS.Silent);
        if (curveSource === 'default') {
            curvesData = cloneCurveMap(defaultCurvesCache);
            loadCurvesToInputs();
        }
    }

    updateDefaultsEditedBanner();
    showToast(
        currentTranslations['toast_defaults_restored']
            || 'Przywrócono fabryczne ustawienia domyślne',
        'success'
    );
}

function saveDefaultsModal() {
    // Stash aktywnej zakładki, potem zapisz WSZYSTKIE profile z cache
    // (wcześniej zapisywany był tylko bieżący tab — edycje na innych ginęły).
    stashDefaultsInputsToCache();

    const savedNames = [];
    for (const prof of ['Silent', 'Balanced', 'Turbo']) {
        const data = profileDefaultsCache[prof];
        if (!data || !data.cpu || !data.gpu || data.cpu.length < 2 || data.gpu.length < 2) {
            showToast(
                currentTranslations['toast_defaults_need_points']
                    || 'Każda krzywa wymaga co najmniej 2 punktów',
                'warning'
            );
            return;
        }
        const cpu = sortCurvePoints(data.cpu).map(([t, s]) => [
            Math.max(0, Math.min(110, t)),
            clampCurveSpeed(s),
        ]);
        const gpu = sortCurvePoints(data.gpu).map(([t, s]) => [
            Math.max(0, Math.min(110, t)),
            clampCurveSpeed(s),
        ]);
        profileDefaultsCache[prof] = { cpu, gpu };

        if (api.setDefaultCurve) {
            api.setDefaultCurve({ profile: prof, fan: 'cpu', points: cpu });
            api.setDefaultCurve({ profile: prof, fan: 'gpu', points: gpu });
        }
        savedNames.push(prof);
    }

    // Lokalnie: banner wg porównania z fabryką (telemetria potwierdzi później)
    defaultsModifiedFromServer = anyProfileDefaultsModifiedInCache();

    // Odśwież cache głównego edytora dla aktywnego profilu
    if (currentProfile && profileDefaultsCache[currentProfile]) {
        defaultCurvesCache = cloneCurveMap(profileDefaultsCache[currentProfile]);
        if (curveSource === 'default') {
            curvesData = cloneCurveMap(defaultCurvesCache);
            loadCurvesToInputs();
        }
    }

    // Snapshot = stan po zapisie (kolejne Anuluj nie cofnie zapisanego)
    defaultsModalSnapshot = cloneAllProfileDefaults(profileDefaultsCache);

    const labels = {
        Silent: currentTranslations['profile_silent_name'] || 'Cichy',
        Balanced: currentTranslations['profile_balanced_name'] || 'Normalny',
        Turbo: currentTranslations['profile_turbo_name'] || 'Turbo',
    };
    const list = savedNames.map((p) => labels[p] || p).join(', ');

    updateDefaultsEditedBanner();
    showToast(
        (currentTranslations['toast_defaults_saved'] || 'Zapisano domyślne krzywe: {profile}')
            .replace('{profile}', list),
        'success'
    );
}

let lastSummaryRawText = "";

function renderLogSummaryModal(stats) {
    const modal = document.getElementById('summary-modal');
    const content = document.getElementById('summary-modal-content');
    if (!modal || !content) return;

    modal.classList.remove('hidden');

    if (stats.error) {
        content.innerHTML = `<div class="summary-error" style="color:#ff3b30; padding: 20px; text-align: center; font-size: 13px;">❌ ${stats.error}</div>`;
        lastSummaryRawText = stats.error;
        return;
    }

    const c = stats.cpu || {};
    const g = stats.gpu || {};

    const fmtSec = (sec) => {
        if (!sec) return '0 sek.';
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = Math.floor(sec % 60);
        let res = [];
        if (h > 0) res.push(`${h} godz.`);
        if (m > 0 || h > 0) res.push(`${m} min`);
        res.push(`${s} sek.`);
        return res.join(' ');
    };

    lastSummaryRawText = `=== PODSUMOWANIE TELEMETRII I LOGÓW ===
Czas działania: ${fmtSec(stats.total_runtime_seconds)} (${stats.total_samples} pomiarów)
Zakres: Od ${stats.start_time} Do ${stats.end_time}

[PROCESOR CPU]
• Średnia temp: ${c.avg_temp}°C | Max: ${c.max_temp}°C | Min: ${c.min_temp}°C
• Czas trwania przy max temp: ${fmtSec(c.time_at_max_sec)}
• Średnie obroty wiatraka: ${c.avg_speed}% (max ${c.max_speed}%)
• Średnie obciążenie: ${c.avg_load}%

[KARTA GRAFICZNA GPU]
• Średnia temp: ${g.avg_temp}°C | Max: ${g.max_temp}°C | Min: ${g.min_temp}°C
• Czas trwania przy max temp: ${fmtSec(g.time_at_max_sec)}
• Średnie obroty wiatraka: ${g.avg_speed}% (max ${g.max_speed}%)
• Tryb Cichy Zero-RPM (0%): ${fmtSec(g.zero_rpm_sec)} (${g.zero_rpm_pct}%)`;

    content.innerHTML = `
        <div class="summary-grid">
            <div class="summary-card" style="grid-column: 1 / -1;">
                <div class="summary-card-title general">ℹ️ OGÓLNE PARAMETRY SESJI</div>
                <div class="summary-row"><span class="summary-label">Czas działania programu:</span><span class="summary-value">${fmtSec(stats.total_runtime_seconds)}</span></div>
                <div class="summary-row"><span class="summary-label">Liczba próbek pomiarowych:</span><span class="summary-value">${stats.total_samples} (odczyt co ~${stats.sample_interval_sec}s)</span></div>
                <div class="summary-row"><span class="summary-label">Zakres czasowy logów:</span><span class="summary-value">${stats.start_time} — ${stats.end_time}</span></div>
            </div>

            <div class="summary-card">
                <div class="summary-card-title cpu">💻 PROCESOR (CPU)</div>
                <div class="summary-row"><span class="summary-label">Średnia temperatura:</span><span class="summary-value" style="color:var(--cpu-color);">${c.avg_temp}°C</span></div>
                <div class="summary-row"><span class="summary-label">Maksymalna temperatura:</span><span class="summary-value" style="color:#ff3b30;">${c.max_temp}°C</span></div>
                <div class="summary-row"><span class="summary-label">Minimalna temperatura:</span><span class="summary-value">${c.min_temp}°C</span></div>
                <div class="summary-row"><span class="summary-label">Czas przy max temp.:</span><span class="summary-value">${fmtSec(c.time_at_max_sec)}</span></div>
                <div class="summary-row"><span class="summary-label">Średnie obroty wiatraka:</span><span class="summary-value">${c.avg_speed}% (max ${c.max_speed}%)</span></div>
                <div class="summary-row"><span class="summary-label">Średnie obciążenie CPU:</span><span class="summary-value">${c.avg_load}%</span></div>
            </div>

            <div class="summary-card">
                <div class="summary-card-title gpu">🎮 KARTA GRAFICZNA (GPU)</div>
                <div class="summary-row"><span class="summary-label">Średnia temperatura:</span><span class="summary-value" style="color:var(--gpu-color);">${g.avg_temp}°C</span></div>
                <div class="summary-row"><span class="summary-label">Maksymalna temperatura:</span><span class="summary-value" style="color:#ff3b30;">${g.max_temp}°C</span></div>
                <div class="summary-row"><span class="summary-label">Minimalna temperatura:</span><span class="summary-value">${g.min_temp}°C</span></div>
                <div class="summary-row"><span class="summary-label">Czas przy max temp.:</span><span class="summary-value">${fmtSec(g.time_at_max_sec)}</span></div>
                <div class="summary-row"><span class="summary-label">Średnie obroty wiatraka:</span><span class="summary-value">${g.avg_speed}% (max ${g.max_speed}%)</span></div>
                <div class="summary-row"><span class="summary-label">Tryb Cichy Zero-RPM:</span><span class="summary-value" style="color:#34c759;">${fmtSec(g.zero_rpm_sec)} (${g.zero_rpm_pct}%)</span></div>
            </div>
        </div>
    `;
}

// Update UI elements based on backend data
function updateUI(data) {
    if (!data) return;

    // Update hardware models if present
    if (data.hardware) {
        if (data.hardware.cpu_model && cpuModelText) cpuModelText.textContent = data.hardware.cpu_model;
        if (data.hardware.gpu_model && gpuModelText) gpuModelText.textContent = data.hardware.gpu_model;
    }

    // Update Resource Load Progress Bars
    if (data.resources) {
        const { cpu_load, ram_used, ram_total, gpu_load, vram_used, vram_total } = data.resources;

        if (cpu_load !== undefined && cpuLoadBar && cpuLoadText) {
            const cpuPct = Math.min(100, Math.max(0, cpu_load));
            cpuLoadBar.style.width = `${cpuPct}%`;
            cpuLoadText.textContent = `${Math.round(cpuPct)}%`;
        }

        if (gpu_load !== undefined && gpuLoadBar && gpuLoadText) {
            const gpuPct = Math.min(100, Math.max(0, gpu_load));
            gpuLoadBar.style.width = `${gpuPct}%`;
            gpuLoadText.textContent = `${Math.round(gpuPct)}%`;
        }

        if (ram_used !== undefined && ram_total !== undefined && ramLoadBar && ramLoadText) {
            const ramPct = ram_total > 0 ? Math.min(100, Math.max(0, (ram_used / ram_total) * 100)) : 0;
            ramLoadBar.style.width = `${ramPct}%`;
            ramLoadText.textContent = `${ram_used.toFixed(1)} / ${ram_total.toFixed(1)} GB`;
        }

        if (vram_used !== undefined && vram_total !== undefined && vramLoadBar && vramLoadText) {
            const vramPct = vram_total > 0 ? Math.min(100, Math.max(0, (vram_used / vram_total) * 100)) : 0;
            vramLoadBar.style.width = `${vramPct}%`;
            vramLoadText.textContent = `${vram_used.toFixed(1)} / ${vram_total.toFixed(1)} GB`;
        }
    }

    // Sync curve source + active curves from backend
    if (data.curve_source === 'custom' || data.curve_source === 'default') {
        if (!isUserEditingInputs) {
            syncCurveSourceUI(data.curve_source);
        }
    }
    // factory_profiles z backendu NIE nadpisuje wbudowanych defaultów
    // (Przywróć musi wracać do krzywej programu, nie do starego factory).
    if (typeof data.defaults_modified === 'boolean' && !defaultsModalOpen) {
        defaultsModifiedFromServer = data.defaults_modified;
    }
    if (data.profile_defaults && !defaultsModalOpen) {
        mergeProfileDefaultsPayload(data.profile_defaults);
    }
    if (data.default_curves) {
        const mapped = mapCurvePayload(data.default_curves);
        if (mapped) {
            defaultCurvesCache = mapped;
            // Trzymaj spójność z cache profilu bieżącego (nie nadpisuj w trakcie edycji)
            if (!defaultsModalOpen && currentProfile && profileDefaultsCache[currentProfile]) {
                profileDefaultsCache[currentProfile] = cloneCurveMap(mapped);
            }
        }
    }
    if (data.custom_curves) {
        const mapped = mapCurvePayload(data.custom_curves);
        if (mapped) customCurvesCache = mapped;
    } else if (data.has_custom_curve === false) {
        // keep previous cache so UI can still show last custom if any
    }
    if (typeof data.has_custom_curve === 'boolean') {
        hasCustomCurve = data.has_custom_curve;
    }
    if (data.curves && !isUserEditingInputs) {
        const mapped = mapCurvePayload(data.curves);
        if (mapped) {
            curvesData = mapped;
            loadCurvesToInputs();
        }
    }

    // Temperature list: CPU, GPU, NVMe 1/2, PCH, motherboard, power section
    if (otherSensorsContainer && (data.sensor_data || data.cpu || data.gpu)) {
        otherSensorsContainer.innerHTML = '';

        const formatSignedTemp = (celsius) => {
            const n = Number(celsius);
            if (!Number.isFinite(n)) return null;
            return `${n >= 0 ? '+' : ''}${n.toFixed(1)}°C`;
        };

        let processedSensors = [];

        const cpuTempValue = data.cpu && data.cpu.temperature;
        const cpuDisplay = formatSignedTemp(cpuTempValue);
        if (cpuDisplay) {
            processedSensors.push({
                displayName: currentTranslations['sensor_cpu_package'] || 'CPU',
                tempVal: Number(cpuTempValue),
                displayVal: cpuDisplay,
                order: 1,
            });
        }

        const gpuTempValue = data.gpu && data.gpu.temperature;
        const gpuDisplay = formatSignedTemp(gpuTempValue);
        if (gpuDisplay) {
            processedSensors.push({
                displayName: currentTranslations['sensor_gpu'] || 'GPU',
                tempVal: Number(gpuTempValue),
                displayVal: gpuDisplay,
                order: 2,
            });
        }

        const sensorMappings = [
            { match: 'composite', name: currentTranslations['sensor_nvme'] || 'Dysk NVMe', order: 3, dedup: false },
            { match: 'pch', name: currentTranslations['sensor_pch'] || 'Mostek Płyty (PCH)', order: 5, dedup: true },
            { match: 'temp3', name: currentTranslations['sensor_chassis'] || 'Płyta Główna', order: 6, dedup: true },
            { match: 'temp1', name: currentTranslations['sensor_vrm'] || 'Sekcja Zasilania', order: 7, dedup: true },
        ];

        if (data.sensor_data) {
            const relevantSensors = Object.entries(data.sensor_data).filter(([key, val]) =>
                (key.toLowerCase().includes('temp') || key.toLowerCase().includes('sensor') || key.toLowerCase().includes('composite'))
                && !key.toLowerCase().includes('core')
                && !String(val).includes('N/A')
            );

            relevantSensors.forEach(([key, val]) => {
                const lowerKey = key.toLowerCase();

                // Skip NVMe sub-sensors to avoid clutter, just keep the main 'Composite'
                if (lowerKey.includes('sensor 1') || lowerKey.includes('sensor 2')) return;

                let displayName = null;
                let order = 99;
                let isDedup = false;

                for (const mapping of sensorMappings) {
                    if (lowerKey.includes(mapping.match)) {
                        displayName = mapping.name;
                        order = mapping.order;
                        isDedup = mapping.dedup;

                        if (mapping.match === 'composite') {
                            const match = lowerKey.match(/\s(\d+)$/);
                            const nvmeIndex = match ? parseInt(match[1], 10) + 1 : 1;
                            displayName = `${mapping.name} ${nvmeIndex}`;
                            order = 2 + nvmeIndex;
                        }
                        break;
                    }
                }

                if (!displayName) return;

                const tempVal = parseFloat(String(val).replace('+', '').replace('°C', ''));
                if (isNaN(tempVal)) return;

                if (isDedup) {
                    const existing = processedSensors.find(s => s.displayName === displayName);
                    if (existing) {
                        if (tempVal > existing.tempVal) {
                            existing.tempVal = tempVal;
                            existing.displayVal = String(val).split(' ')[0];
                        }
                        return;
                    }
                }

                processedSensors.push({ displayName, tempVal, displayVal: String(val).split(' ')[0], order });
            });
        }

        processedSensors.sort((a, b) => a.order - b.order);
        processedSensors = processedSensors.slice(0, 10);

        if (processedSensors.length > 0) {
            processedSensors.forEach((sensor) => {
                const item = document.createElement('div');
                item.className = 'resource-item';
                item.style.marginBottom = '6px';
                
                const header = document.createElement('div');
                header.className = 'resource-header';
                
                const label = document.createElement('span');
                label.className = 'resource-label';
                label.style.fontSize = '0.75rem';
                label.textContent = sensor.displayName;
                
                const value = document.createElement('span');
                value.className = 'resource-val';
                value.style.fontSize = '0.75rem';
                value.textContent = sensor.displayVal;
                
                header.appendChild(label);
                header.appendChild(value);
                item.appendChild(header);
                otherSensorsContainer.appendChild(item);
            });
        } else {
            otherSensorsContainer.innerHTML = `<div class="resource-item"><span class="resource-label" style="font-size: 0.75rem; color: #636b83;">${currentTranslations['no_sensors'] || 'Brak dodatkowych czujników'}</span></div>`;
        }
    }

    const formatTemp = (value) => {
        const n = Number(value);
        return Number.isFinite(n) ? `${n.toFixed(1)}°C` : '—';
    };
    const formatRpm = (value) => {
        const n = Number(value);
        return Number.isFinite(n) ? Math.round(n).toLocaleString() : '—';
    };
    const formatPct = (value) => {
        const n = Number(value);
        return Number.isFinite(n) ? `${Math.round(n)}%` : '—';
    };
    const finiteOrNull = (value) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    };

    // Update CPU data
    if (data.cpu) {
        const cpuTempValue = finiteOrNull(data.cpu.temperature);
        const cpuRpmValue = finiteOrNull(data.cpu.rpm) ?? 0;
        const cpuSpeedValue = finiteOrNull(data.cpu.speed);

        cpuTemp.textContent = formatTemp(cpuTempValue);
        cpuRpm.textContent = formatRpm(data.cpu.rpm);
        cpuSpeed.textContent = formatPct(cpuSpeedValue);

        updateGauge(cpuGaugeCircle, cpuRpmValue);

        if (cpuTempValue !== null && cpuTempValue > 80) {
            cpuTemp.classList.add('high');
        } else {
            cpuTemp.classList.remove('high');
        }
    }

    // Update GPU data
    if (data.gpu) {
        const gpuTempValue = finiteOrNull(data.gpu.temperature);
        const gpuRpmValue = finiteOrNull(data.gpu.rpm) ?? 0;
        const gpuSpeedValue = finiteOrNull(data.gpu.speed);

        gpuTemp.textContent = formatTemp(gpuTempValue);
        gpuRpm.textContent = formatRpm(data.gpu.rpm);
        gpuSpeed.textContent = formatPct(gpuSpeedValue);

        updateGauge(gpuGaugeCircle, gpuRpmValue);

        if (gpuTempValue !== null && gpuTempValue > 78) {
            gpuTemp.classList.add('high');
        } else {
            gpuTemp.classList.remove('high');
        }
    }

    // One history sample per poll (paired CPU + GPU) for range filtering
    const sampleCpu = data.cpu ? finiteOrNull(data.cpu.temperature) : null;
    const sampleGpu = data.gpu ? finiteOrNull(data.gpu.temperature) : null;
    if (sampleCpu !== null || sampleGpu !== null) {
        addTemperatureSample(sampleCpu, sampleGpu);
    }

    // Mode FIRST — so slider enable + value sync use the real backend state
    const isFixed = (data.status === 'Fixed');
    const modeKey = isFixed ? 'manual' : 'auto';
    const modeChanged = lastAppliedMode !== modeKey;
    isManualMode = isFixed;
    lastAppliedMode = modeKey;
    if (modeToggle) modeToggle.checked = isFixed;
    syncModeSegmentUI(isFixed);
    setManualControlsEnabled(isManualMode);

    // Sync fan sliders (skip while user is dragging or command is in-flight)
    if (!isManualUiLocked()) {
        if (isManualMode && (data.manual_base !== undefined || data.manual_speeds)) {
            // Master = manual_base; CPU/GPU = efektywne PWM
            const base = data.manual_base !== undefined && data.manual_base !== null
                ? Number(data.manual_base)
                : Number(data.manual_speeds['0'] ?? data.manual_speeds[0]);
            const eff = data.manual_speeds_effective || data.manual_speeds;
            if (!Number.isNaN(base)) {
                masterBase = clampMasterSpeed(base);
                fanSlider.value = masterBase;
                sliderValue.textContent = `${Math.round(masterBase)}%`;
            }
            if (eff) {
                const cpuE = Number(eff['0'] ?? eff[0]);
                const gpuE = Number(eff['1'] ?? eff[1]);
                if (!Number.isNaN(cpuE)) {
                    cpuFanSlider.value = clampCpuSpeed(cpuE);
                    cpuSliderValue.textContent = `${Math.round(clampCpuSpeed(cpuE))}%`;
                }
                if (!Number.isNaN(gpuE)) {
                    gpuFanSlider.value = clampGpuSpeed(gpuE);
                    gpuSliderValue.textContent = `${Math.round(clampGpuSpeed(gpuE))}%`;
                }
            } else if (!Number.isNaN(base)) {
                applyFanSlidersFromBase(base, { send: false });
            }
        } else if (!isManualMode) {
            // Auto: show live PWM duty from sensors
            if (data.cpu?.speed !== undefined && data.cpu.speed !== null) {
                cpuFanSlider.value = data.cpu.speed;
                cpuSliderValue.textContent = `${Math.round(data.cpu.speed)}%`;
            }
            if (data.gpu?.speed !== undefined && data.gpu.speed !== null) {
                gpuFanSlider.value = data.gpu.speed;
                gpuSliderValue.textContent = `${Math.round(data.gpu.speed)}%`;
            }
            if (data.fanSpeed !== undefined) {
                fanSlider.value = data.fanSpeed;
                sliderValue.textContent = `${Math.round(data.fanSpeed)}%`;
            }
        }
    }

    // Highlight active profile button + curve editor title
    if (data.profile) {
        currentProfile = data.profile;
        profileButtons.forEach(btn => {
            if (btn.dataset.profile === data.profile) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
        updateCurveEditorTitle(data.profile);
    }

    if (data.log_summary_response) {
        renderLogSummaryModal(data.log_summary_response);
        return;
    }

    if (data.auto_logging !== undefined) {
        const loggingToggle = document.getElementById('logging-toggle');
        const menuLoggingToggle = document.getElementById('menu-logging-toggle');
        if (loggingToggle && document.activeElement !== loggingToggle) {
            loggingToggle.checked = data.auto_logging;
        }
        if (menuLoggingToggle && document.activeElement !== menuLoggingToggle) {
            menuLoggingToggle.checked = data.auto_logging;
        }
    }

    // Live data received → online
    lastFanDataAt = Date.now();
    backendAlive = true;
    setConnectionStatus(true);

    // Sync permanent fan offset from backend
    if (data.speed_offset !== undefined && data.speed_offset !== null && !isManualUiLocked()) {
        updateOffsetUI(data.speed_offset);
    }

    // Settings close-action select (localStorage) — keep in sync if open
    if (modeChanged) {
        syncSettingsCloseSelect();
    }

    if (statusValue) {
        statusValue.textContent = isFixed
            ? (currentTranslations['mode_manual_desc'] || 'Sterowanie ręczne')
            : (currentTranslations['connected'] || 'Połączono');
    }
    if (activeModeDisplay) {
        activeModeDisplay.textContent = isFixed
            ? (currentTranslations['mode_manual_desc'] || 'Sterowanie ręczne')
            : `Dynamic Auto (${data.profile || 'Silent'})`;
    }

    // Refresh mode description under AUTO/MANUAL
    const modeLabelEl = document.getElementById('mode-label');
    if (modeLabelEl) {
        modeLabelEl.textContent = isManualMode
            ? (currentTranslations['mode_manual_desc'] || 'Sterowanie ręczne')
            : (currentTranslations['mode_auto_desc'] || 'Tryb Auto (Krzywa EC)');
    }
}

function syncModeSegmentUI(isManual) {
    const btnAuto = document.getElementById('mode-btn-auto');
    const btnManual = document.getElementById('mode-btn-manual');
    if (btnAuto && btnManual) {
        if (isManual) {
            btnManual.classList.add('active');
            btnAuto.classList.remove('active');
        } else {
            btnAuto.classList.add('active');
            btnManual.classList.remove('active');
        }
    }
}

function addTemperatureSample(cpuValue, gpuValue) {
    const now = Date.now();
    const timeStr = new Date(now).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });

    // Carry forward last known value if one side missing this tick
    const last = temperatureHistory.length
        ? temperatureHistory[temperatureHistory.length - 1]
        : null;
    const cpu = cpuValue !== null && cpuValue !== undefined
        ? cpuValue
        : (last ? last.cpu : null);
    const gpu = gpuValue !== null && gpuValue !== undefined
        ? gpuValue
        : (last ? last.gpu : null);

    temperatureHistory.push({ t: now, label: timeStr, cpu, gpu });

    // Always retain full 30 min buffer (independent of selected display range)
    const hardCutoff = now - MAX_HISTORY_MINUTES * 60 * 1000;
    while (temperatureHistory.length && temperatureHistory[0].t < hardCutoff) {
        temperatureHistory.shift();
    }
    while (temperatureHistory.length > MAX_HISTORY_POINTS) {
        temperatureHistory.shift();
    }

    updateChart();
}

function updateChart() {
    if (!temperatureChart) return;

    const now = Date.now();
    const rangeMs = Math.max(1, chartTimeRange) * 60 * 1000;
    const cutoff = now - rangeMs;

    // Filter to selected window (5 / 10 / 30 min)
    const inRange = temperatureHistory.filter((p) => p.t >= cutoff);

    // Downsample for smooth rendering (cap ~120 points)
    const maxDisplay = 120;
    const skipFactor = Math.max(1, Math.floor(inRange.length / maxDisplay));
    const labels = [];
    const cpu = [];
    const gpu = [];

    for (let i = 0; i < inRange.length; i += skipFactor) {
        labels.push(inRange[i].label);
        cpu.push(inRange[i].cpu);
        gpu.push(inRange[i].gpu);
    }
    // Always include the newest point
    if (inRange.length > 0) {
        const lastIdx = inRange.length - 1;
        if (lastIdx % skipFactor !== 0) {
            labels.push(inRange[lastIdx].label);
            cpu.push(inRange[lastIdx].cpu);
            gpu.push(inRange[lastIdx].gpu);
        }
    }

    temperatureChart.data.labels = labels;
    temperatureChart.data.datasets[0].data = cpu;
    temperatureChart.data.datasets[1].data = gpu;
    temperatureChart.update('none');
}

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Event Listeners setup
function setKbdButtonsActive(level) {
    document.querySelectorAll('.kbd-level-btn').forEach((btn) => {
        btn.classList.toggle('active', Number(btn.dataset.kbdLevel) === Number(level));
    });
}

function setKbdTimeoutActive(enabled) {
    const onBtn = document.getElementById('kbd-timeout-on');
    const offBtn = document.getElementById('kbd-timeout-off');
    if (onBtn) onBtn.classList.toggle('active', enabled === true);
    if (offBtn) offBtn.classList.toggle('active', enabled === false);
}

const POWER_PROFILE_META = [
    { id: 'low-power', nameKey: 'power_low_power', hintKey: 'power_hint_low_power' },
    { id: 'quiet', nameKey: 'power_quiet', hintKey: 'power_hint_quiet' },
    { id: 'balanced', nameKey: 'power_balanced', hintKey: 'power_hint_balanced' },
    { id: 'balanced-performance', nameKey: 'power_sport', hintKey: 'power_hint_sport' },
    { id: 'performance', nameKey: 'power_performance', hintKey: 'power_hint_performance' },
];

let currentPowerProfile = null;
let powerProfileAvailable = false;
let powerProfileBusy = false;

function powerProfileLabel(id) {
    const meta = POWER_PROFILE_META.find((item) => item.id === id);
    if (!meta) return id || '—';
    return currentTranslations[meta.nameKey] || id;
}

function setPowerProfileButtonsActive(profile) {
    document.querySelectorAll('.power-profile-btn').forEach((btn) => {
        const active = btn.dataset.powerProfile === profile;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

function updatePowerProfileHint(profile) {
    const hintEl = document.getElementById('power-profile-hint');
    if (!hintEl) return;
    const meta = POWER_PROFILE_META.find((item) => item.id === profile);
    hintEl.textContent = meta
        ? (currentTranslations[meta.hintKey] || '')
        : '';
}

function updatePowerProfileStatusBar(profile) {
    const valueEl = document.getElementById('power-status-value');
    if (!valueEl) return;
    valueEl.textContent = profile ? powerProfileLabel(profile) : '—';
}

function applyPowerProfileState(state) {
    const section = document.getElementById('power-profile-section');
    const statusEl = document.getElementById('power-profile-status');
    if (!section) return;

    powerProfileAvailable = !!(state && state.available);
    currentPowerProfile = state && state.current ? state.current : currentPowerProfile;

    const known = new Set(Array.isArray(state && state.choices) ? state.choices : POWER_PROFILE_META.map((p) => p.id));
    document.querySelectorAll('.power-profile-btn').forEach((btn) => {
        btn.hidden = !known.has(btn.dataset.powerProfile);
    });

    if (!powerProfileAvailable) {
        section.classList.add('is-offline');
        if (statusEl) {
            statusEl.hidden = false;
            statusEl.textContent = currentTranslations['power_offline']
                || 'Brak połączenia z DAMX. sudo systemctl start damx-daemon';
        }
    } else {
        section.classList.remove('is-offline');
        if (statusEl) {
            statusEl.hidden = true;
            statusEl.textContent = '';
        }
    }

    setPowerProfileButtonsActive(currentPowerProfile);
    updatePowerProfileHint(currentPowerProfile);
    updatePowerProfileStatusBar(currentPowerProfile);
}

async function refreshPowerProfileUi() {
    if (!api.getThermalProfile) return;
    try {
        const state = await api.getThermalProfile();
        applyPowerProfileState(state);
    } catch (err) {
        console.warn('thermal profile status failed', err);
        applyPowerProfileState({ available: false, current: currentPowerProfile, choices: [] });
    }
}

async function refreshKbdBacklightUi() {
    const section = document.getElementById('kbd-backlight-section');
    const statusEl = document.getElementById('kbd-status');
    if (!section) return;
    try {
        const state = api.getKbdBacklight ? await api.getKbdBacklight() : { available: false };
        if (!state || !state.available) {
            section.classList.add('is-offline');
            if (statusEl) {
                statusEl.hidden = false;
                statusEl.textContent = currentTranslations['kbd_driver_missing']
                    || 'Brak sterownika klawiatury. sudo ./acer-nitro-ec/install-kbd-backlight.sh';
            }
            return;
        }
        section.classList.remove('is-offline');
        if (statusEl) {
            statusEl.hidden = true;
            statusEl.textContent = '';
        }
        setKbdButtonsActive(state.level);
        if (state.timeout === true || state.timeout === false) {
            setKbdTimeoutActive(state.timeout);
        }
    } catch (err) {
        console.warn('kbd backlight status failed', err);
        section.classList.add('is-offline');
        if (statusEl) {
            statusEl.hidden = false;
            statusEl.textContent = currentTranslations['kbd_driver_missing']
                || 'Brak sterownika klawiatury. sudo ./acer-nitro-ec/install-kbd-backlight.sh';
        }
    }
}

function setupEventListeners() {
    document.querySelectorAll('.kbd-level-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const level = Number(btn.dataset.kbdLevel);
            if (!api.setKbdBacklight) return;
            const state = await api.setKbdBacklight(level);
            if (state && state.available) {
                setKbdButtonsActive(state.level);
            }
        });
    });
    document.querySelectorAll('[data-kbd-timeout]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!api.setKbdTimeout) return;
            const enabled = btn.dataset.kbdTimeout === '1';
            const state = await api.setKbdTimeout(enabled);
            if (state && state.available && (state.timeout === true || state.timeout === false)) {
                setKbdTimeoutActive(state.timeout);
            }
        });
    });

    document.querySelectorAll('.power-profile-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (!api.setThermalProfile || powerProfileBusy) return;
            const profile = btn.dataset.powerProfile;
            if (!profile) return;
            powerProfileBusy = true;
            setPowerProfileButtonsActive(profile);
            updatePowerProfileHint(profile);
            try {
                const state = await api.setThermalProfile(profile);
                applyPowerProfileState(state);
                if (state && state.available) {
                    const name = powerProfileLabel(state.current || profile);
                    showToast(
                        (currentTranslations['toast_power_profile'] || 'Ustawiono profil zasilania: {profile}')
                            .replace('{profile}', name),
                        'success'
                    );
                } else {
                    showToast(
                        currentTranslations['toast_power_profile_fail']
                            || 'Nie udało się zmienić profilu zasilania (DAMX)',
                        'warning'
                    );
                }
            } catch (err) {
                console.warn('set thermal profile failed', err);
                showToast(
                    currentTranslations['toast_power_profile_fail']
                        || 'Nie udało się zmienić profilu zasilania (DAMX)',
                    'warning'
                );
                refreshPowerProfileUi();
            } finally {
                powerProfileBusy = false;
            }
        });
    });

    const sendMasterSpeed = debounce((val) => {
        lockManualUi();
        api.setFanSpeed({ speed: clampMasterSpeed(val) });
    }, 150);
    const sendCpuSpeed = debounce((val) => {
        lockManualUi();
        api.setFanSpeed({ fanId: 0, speed: clampCpuSpeed(val) });
    }, 150);
    const sendGpuSpeed = debounce((val) => {
        lockManualUi();
        api.setFanSpeed({ fanId: 1, speed: clampGpuSpeed(val) });
    }, 150);

    // Sliders — master / CPU / GPU all floored at 30%
    fanSlider.min = String(MIN_PCT_MASTER);
    cpuFanSlider.min = String(MIN_PCT_CPU);
    gpuFanSlider.min = String(MIN_PCT_GPU);

    // Don't overwrite slider positions from telemetry while user drags,
    // and keep a short lock after release so the echo cannot snap back.
    [fanSlider, cpuFanSlider, gpuFanSlider].forEach((s) => {
        if (!s) return;
        s.addEventListener('pointerdown', (e) => {
            fanDragGeneration += 1;
            isUserDraggingFanSlider = true;
            lockManualUi();
            try { s.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        });
        const endFanDrag = () => {
            const gen = fanDragGeneration;
            lockManualUi();
            window.setTimeout(() => {
                if (gen === fanDragGeneration) isUserDraggingFanSlider = false;
            }, MANUAL_UI_LOCK_MS);
        };
        s.addEventListener('pointerup', endFanDrag);
        s.addEventListener('pointercancel', endFanDrag);
    });

    fanSlider.addEventListener('input', (e) => {
        const val = clampMasterSpeed(e.target.value);
        e.target.value = val;
        // Master = baza; CPU/GPU pokazują efekt offsetu (+CPU / −GPU)
        applyFanSlidersFromBase(val, { send: false });
        sendMasterSpeed(val);
    });

    cpuFanSlider.addEventListener('input', (e) => {
        let val = clampCpuSpeed(e.target.value);
        if (Math.abs(speedOffset) >= 1) {
            // Przy offsecie suwak CPU ustawia bazę (efekt: baza+offset dla +)
            // Jeśli offset > 0, użytkownik widzi efektywną wartość — przelicz na bazę
            let base = val;
            if (speedOffset > 0) {
                base = clampMasterSpeed(val - speedOffset);
            }
            const f = applyFanSlidersFromBase(base, { send: false });
            sendMasterSpeed(f.base);
            return;
        }
        e.target.value = val;
        cpuSliderValue.textContent = `${val}%`;
        sendCpuSpeed(val);
    });

    gpuFanSlider.addEventListener('input', (e) => {
        if (Math.abs(speedOffset) >= 1) {
            // Przy offsecie GPU wynika z bazy — nie rozłączaj
            const f = fansFromBase(masterBase);
            e.target.value = f.gpu;
            gpuSliderValue.textContent = `${Math.round(f.gpu)}%`;
            showToast(currentTranslations['toast_offset_linked'] || 'Przy offsecie steruj Master/CPU lub suwakiem różnicy', 'warning');
            return;
        }
        const val = clampGpuSpeed(e.target.value);
        e.target.value = val;
        gpuSliderValue.textContent = `${val}%`;
        sendGpuSpeed(val);
    });

    // Permanent CPU↔GPU speed offset (+ boosts CPU, − boosts GPU)
    // Zablokowany w trybie Auto — tak samo jak suwaki Master/CPU/GPU
    const offsetSlider = speedOffsetSlider;
    const sendSpeedOffset = debounce((val) => {
        lockManualUi();
        api.setSpeedOffset(val);
    }, 150);

    if (offsetSlider) {
        offsetSlider.addEventListener('pointerdown', (e) => {
            if (!isManualMode) {
                e.preventDefault();
                return;
            }
            offsetDragGeneration += 1;
            isUserEditingOffset = true;
            lockManualUi();
            try { offsetSlider.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        });
        const endOffsetEdit = (sendToast) => {
            if (!isManualMode) {
                isUserEditingOffset = false;
                return;
            }
            const gen = offsetDragGeneration;
            lockManualUi();
            const val = clampSpeedOffset(offsetSlider.value);
            api.setSpeedOffset(val);
            if (sendToast) {
                showToast(
                    (currentTranslations['toast_offset_set'] || 'Ustawiono różnicę CPU vs GPU: {offset}')
                        .replace('{offset}', formatOffsetBadge(val)),
                    'info'
                );
            }
            window.setTimeout(() => {
                if (gen === offsetDragGeneration) isUserEditingOffset = false;
            }, MANUAL_UI_LOCK_MS);
        };
        // change fires once on release — do not also handle pointerup (that raced
        // with telemetry and re-sent 0 after the slider was snapped back).
        offsetSlider.addEventListener('change', () => endOffsetEdit(true));
        offsetSlider.addEventListener('pointercancel', () => endOffsetEdit(false));
        offsetSlider.addEventListener('input', (e) => {
            if (!isManualMode) return;
            const val = clampSpeedOffset(e.target.value);
            updateOffsetUI(val, { fromUser: true });
            // Od razu podnieś CPU lub GPU na suwakach (baza = master)
            const base = clampMasterSpeed(masterBase || fanSlider.value || MIN_PCT_MASTER);
            masterBase = base;
            applyFanSlidersFromBase(base, { send: false });
            // Wyślij offset do API → config → daemon (faktyczne PWM)
            sendSpeedOffset(val);
        });
    }

    // Preset Pills
    presetPills.forEach(pill => {
        pill.addEventListener('click', () => {
            if (!isManualMode) {
                showToast(currentTranslations['toast_enable_manual'] || 'Włącz najpierw sterowanie manualne w sidebarze!', 'warning');
                return;
            }
            const spd = clampMasterSpeed(pill.dataset.speed);
            lockManualUi();
            applyFanSlidersFromBase(spd, { send: true });
            showToast((currentTranslations['toast_fan_speed_set'] || 'Ustawiono prędkość wiatraków na {speed}%').replace('{speed}', String(spd)), 'success');
        });
    });

    // Profile Buttons
    profileButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            profileButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentProfile = btn.dataset.profile || 'Silent';
            api.applyProfile(currentProfile);
            updateCurveEditorTitle(currentProfile);
            applyTranslations();
            showToast((currentTranslations['toast_profile_activated'] || 'Aktywowano profil chłodzenia: {profile}').replace('{profile}', currentProfile), 'success');
        });
    });

    // Mode Segmented Control (AUTO / MANUAL)
    const modeBtnAuto = document.getElementById('mode-btn-auto');
    const modeBtnManual = document.getElementById('mode-btn-manual');

    const handleModeSwitch = (isManual) => {
        isManualMode = isManual;
        if (modeToggle) modeToggle.checked = isManual;
        syncModeSegmentUI(isManual);
        setManualControlsEnabled(isManualMode);
        api.setMode(isManualMode ? 'manual' : 'auto');
        applyTranslations();

        if (isManualMode) {
            // Zachowaj osobno CPU i GPU (w Auto GPU może być 0% — podłoga 30%).
            const cpuVal = clampCpuSpeed(cpuFanSlider ? cpuFanSlider.value : MIN_PCT_CPU);
            const gpuVal = clampGpuSpeed(gpuFanSlider ? gpuFanSlider.value : MIN_PCT_GPU);
            if (cpuFanSlider) {
                cpuFanSlider.value = cpuVal;
                cpuSliderValue.textContent = `${cpuVal}%`;
            }
            if (gpuFanSlider) {
                gpuFanSlider.value = gpuVal;
                gpuSliderValue.textContent = `${gpuVal}%`;
            }
            lockManualUi();
            api.setFanSpeed({ fanId: 0, speed: cpuVal });
            api.setFanSpeed({ fanId: 1, speed: gpuVal });
            showToast(currentTranslations['toast_manual_mode_active'] || 'Przełączono na ręczne sterowanie obrotami PWM', 'info');
        } else {
            isUserEditingOffset = false;
            showToast(currentTranslations['toast_auto_mode_active'] || 'Przywrócono automatyczne sterowanie krzywą EC', 'info');
        }
    };

    if (modeBtnAuto) modeBtnAuto.addEventListener('click', () => handleModeSwitch(false));
    if (modeBtnManual) modeBtnManual.addEventListener('click', () => handleModeSwitch(true));
    if (modeToggle) {
        modeToggle.addEventListener('change', () => handleModeSwitch(modeToggle.checked));
    }

    // Logging Toggle Switch (Sidebar & Status Menu)
    const loggingToggle = document.getElementById('logging-toggle');
    const menuLoggingToggle = document.getElementById('menu-logging-toggle');

    const handleLoggingChange = (checked) => {
        api.setAutoLogging(checked);
        if (loggingToggle) loggingToggle.checked = checked;
        if (menuLoggingToggle) menuLoggingToggle.checked = checked;
        if (checked) {
            showToast(currentTranslations['toast_logging_enabled'] || 'Włączono automatyczne zapisywanie logów', 'info');
        } else {
            showToast(currentTranslations['toast_logging_disabled'] || 'Wyłączono zapisywanie logów', 'info');
        }
    };

    if (loggingToggle) {
        loggingToggle.addEventListener('change', () => handleLoggingChange(loggingToggle.checked));
    }
    if (menuLoggingToggle) {
        menuLoggingToggle.addEventListener('change', () => handleLoggingChange(menuLoggingToggle.checked));
    }

    // Status Bar Popover Menu & Summary Modal
    const statusMenuBtn = document.getElementById('status-menu-btn');
    const statusDropdown = document.getElementById('status-menu-dropdown');
    const settingsMenuBtn = document.getElementById('settings-menu-btn');
    const settingsDropdown = document.getElementById('settings-menu-dropdown');
    const menuSummaryBtn = document.getElementById('menu-summary-btn');
    const summaryModal = document.getElementById('summary-modal');
    const closeModalX = document.getElementById('close-modal-x');
    const closeSummaryBtn = document.getElementById('close-summary-btn');
    const copySummaryBtn = document.getElementById('copy-summary-btn');

    const closeAllStatusDropdowns = () => {
        if (statusDropdown) statusDropdown.classList.add('hidden');
        if (settingsDropdown) settingsDropdown.classList.add('hidden');
    };

    if (statusMenuBtn && statusDropdown) {
        statusMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const willOpen = statusDropdown.classList.contains('hidden');
            closeAllStatusDropdowns();
            if (willOpen) statusDropdown.classList.remove('hidden');
        });
    }

    if (settingsMenuBtn && settingsDropdown) {
        settingsMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const willOpen = settingsDropdown.classList.contains('hidden');
            closeAllStatusDropdowns();
            if (willOpen) {
                syncSettingsCloseSelect();
                settingsDropdown.classList.remove('hidden');
                refreshKbdBacklightUi();
            }
        });
    }

    document.addEventListener('click', (e) => {
        const inStats = statusDropdown && statusMenuBtn
            && (statusDropdown.contains(e.target) || statusMenuBtn.contains(e.target));
        const inSettings = settingsDropdown && settingsMenuBtn
            && (settingsDropdown.contains(e.target) || settingsMenuBtn.contains(e.target));
        if (!inStats && !inSettings) {
            closeAllStatusDropdowns();
        }
    });

    // Settings: close X behavior
    const settingsCloseAction = document.getElementById('settings-close-action');
    if (settingsCloseAction) {
        syncSettingsCloseSelect();
        settingsCloseAction.addEventListener('change', () => {
            setCloseActionSetting(settingsCloseAction.value);
            const labels = {
                ask: currentTranslations['toast_close_ask'] || 'Przy X będzie pytanie o zamknięcie',
                minimize: currentTranslations['toast_close_minimize'] || 'Przy X zawsze minimalizuj do tray',
                quit: currentTranslations['toast_close_quit'] || 'Przy X zawsze zamykaj całkowicie',
            };
            showToast(labels[settingsCloseAction.value] || labels.ask, 'info');
        });
        // Prevent document click from closing when using select
        settingsCloseAction.addEventListener('click', (e) => e.stopPropagation());
    }

    const settingsEditDefaults = document.getElementById('settings-edit-defaults-btn');
    if (settingsEditDefaults) {
        settingsEditDefaults.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openDefaultsModal();
        });
    }

    // Defaults modal: profile tabs, inputs, save/cancel
    document.querySelectorAll('.defaults-profile-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
            setDefaultsModalProfile(btn.dataset.profile);
        });
    });
    for (const fan of ['cpu', 'gpu']) {
        for (let i = 1; i <= 6; i++) {
            const tInput = document.getElementById(`def-${fan}-temp-${i}`);
            const sInput = document.getElementById(`def-${fan}-speed-${i}`);
            [tInput, sInput].forEach((inp) => {
                if (!inp) return;
                inp.addEventListener('input', () => {
                    if (!defaultsModalOpen) return;
                    drawDefaultsCurvePreview();
                    updateDefaultsEditedBanner();
                });
            });
            if (sInput) {
                const enforce = () => {
                    if (sInput.value === '') return;
                    const clamped = clampCurveSpeed(sInput.value);
                    if (String(clamped) !== String(sInput.value)) {
                        sInput.value = Math.round(clamped);
                    }
                    drawDefaultsCurvePreview();
                    updateDefaultsEditedBanner();
                };
                sInput.addEventListener('change', enforce);
                sInput.addEventListener('blur', enforce);
            }
        }
    }
    const defaultsCloseX = document.getElementById('defaults-modal-close-x');
    const defaultsCancel = document.getElementById('defaults-modal-cancel');
    const defaultsSave = document.getElementById('defaults-modal-save');
    const defaultsRestore = document.getElementById('defaults-modal-restore');
    const defaultsModal = document.getElementById('defaults-modal');
    if (defaultsCloseX) defaultsCloseX.addEventListener('click', () => closeDefaultsModal({ discard: true }));
    if (defaultsCancel) defaultsCancel.addEventListener('click', () => closeDefaultsModal({ discard: true }));
    if (defaultsSave) defaultsSave.addEventListener('click', saveDefaultsModal);
    if (defaultsRestore) defaultsRestore.addEventListener('click', restoreFactoryDefaults);
    if (defaultsModal) {
        defaultsModal.addEventListener('click', (e) => {
            if (e.target === defaultsModal) closeDefaultsModal({ discard: true });
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && defaultsModalOpen) {
            closeDefaultsModal({ discard: true });
        }
    });

    const settingsShowDisclaimer = document.getElementById('settings-show-disclaimer-btn');
    if (settingsShowDisclaimer) {
        settingsShowDisclaimer.addEventListener('click', () => {
            closeAllStatusDropdowns();
            showSafetyDisclaimer();
            showToast(currentTranslations['toast_disclaimer_shown'] || 'Pokazano ostrzeżenie bezpieczeństwa', 'info');
        });
    }

    const settingsResetClose = document.getElementById('settings-reset-close-btn');
    if (settingsResetClose) {
        settingsResetClose.addEventListener('click', () => {
            resetClosePreference();
            showToast(currentTranslations['toast_close_reset'] || 'Przy X znowu pojawi się pytanie', 'success');
        });
    }

    if (menuSummaryBtn) {
        menuSummaryBtn.addEventListener('click', () => {
            closeAllStatusDropdowns();
            if (summaryModal) {
                const content = document.getElementById('summary-modal-content');
                if (content) content.innerHTML = '<div class="summary-loading">Ładowanie statystyk...</div>';
                summaryModal.classList.remove('hidden');
            }
            api.getLogSummary();
        });
    }

    const menuOpenLogsBtn = document.getElementById('menu-open-logs-btn');
    if (menuOpenLogsBtn) {
        menuOpenLogsBtn.addEventListener('click', () => {
            closeAllStatusDropdowns();
            api.openLogFile();
        });
    }

    const closeModal = () => {
        if (summaryModal) summaryModal.classList.add('hidden');
    };

    if (closeModalX) closeModalX.addEventListener('click', closeModal);
    if (closeSummaryBtn) closeSummaryBtn.addEventListener('click', closeModal);
    if (summaryModal) {
        summaryModal.addEventListener('click', (e) => {
            if (e.target === summaryModal) closeModal();
        });
    }

    if (copySummaryBtn) {
        copySummaryBtn.addEventListener('click', () => {
            if (lastSummaryRawText) {
                navigator.clipboard.writeText(lastSummaryRawText).then(() => {
                    showToast(currentTranslations['toast_report_copied'] || 'Skopiowano raport do schowka!', 'success');
                });
            }
        });
    }

    // Chart Time Range Selector — re-filter stored history (does not clear buffer)
    chartButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            chartButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const mins = parseInt(btn.dataset.time, 10);
            chartTimeRange = Number.isFinite(mins) && mins > 0 ? mins : 5;
            updateChart();
        });
    });

    // Curve source: Domyślny / Własny (własne nie są kasowane przy default)
    const curveSourceBtns = document.querySelectorAll('.curve-source-btn');
    curveSourceBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const src = btn.dataset.source === 'custom' ? 'custom' : 'default';
            if (src === curveSource) return;
            syncCurveSourceUI(src);
            if (api.setCurveSource) {
                api.setCurveSource(src);
            }
            // Natychmiastowy podgląd z cache (zanim wróci telemetria)
            if (src === 'default' && defaultCurvesCache) {
                curvesData = {
                    cpu: defaultCurvesCache.cpu.map((p) => [...p]),
                    gpu: defaultCurvesCache.gpu.map((p) => [...p]),
                };
                loadCurvesToInputs();
            } else if (src === 'custom') {
                if (customCurvesCache) {
                    curvesData = {
                        cpu: customCurvesCache.cpu.map((p) => [...p]),
                        gpu: customCurvesCache.gpu.map((p) => [...p]),
                    };
                } else if (defaultCurvesCache) {
                    // Pierwsze "Własny" — start od domyślnych (edytowalne)
                    curvesData = {
                        cpu: defaultCurvesCache.cpu.map((p) => [...p]),
                        gpu: defaultCurvesCache.gpu.map((p) => [...p]),
                    };
                }
                loadCurvesToInputs();
            }
            const msg = src === 'custom'
                ? (currentTranslations['toast_curve_source_custom'] || 'Krzywa: Własne ustawienia')
                : (currentTranslations['toast_curve_source_default'] || 'Krzywa: Ustawienia domyślne profilu');
            showToast(msg, 'info');
        });
    });

    // Dual curve inputs (CPU + GPU) — live preview + 30% speed floor
    for (const fan of ['cpu', 'gpu']) {
        for (let i = 1; i <= 6; i++) {
            const tInput = document.getElementById(`curve-${fan}-temp-${i}`);
            const sInput = document.getElementById(`curve-${fan}-speed-${i}`);
            [tInput, sInput].forEach((inp) => {
                if (!inp) return;
                inp.addEventListener('focus', () => {
                    if (curveSource === 'default') return;
                    isUserEditingInputs = true;
                });
                inp.addEventListener('blur', () => { isUserEditingInputs = false; });
                inp.addEventListener('input', () => {
                    if (curveSource === 'default') return;
                    drawCurvePreview();
                });
            });
            if (sInput) {
                sInput.min = String(MIN_PCT_CPU);
                const enforceSpeedFloor = () => {
                    if (curveSource === 'default') return;
                    if (sInput.value === '') return;
                    const clamped = clampCurveSpeed(sInput.value);
                    if (String(clamped) !== String(sInput.value)) {
                        sInput.value = Math.round(clamped);
                    }
                    drawCurvePreview();
                };
                sInput.addEventListener('change', enforceSpeedFloor);
                sInput.addEventListener('blur', enforceSpeedFloor);
            }
        }
    }

    // Language Selector
    const langSelect = document.getElementById('language-select');
    if (langSelect) {
        langSelect.addEventListener('change', (e) => {
            loadLanguage(e.target.value);
        });
    }

    // Tray Button
    const trayBtn = document.getElementById('tray-btn');
    if (trayBtn) {
        trayBtn.addEventListener('click', () => {
            api.windowHide();
        });
    }

    // Safety disclaimer dismiss
    const disclaimerBanner = document.getElementById('safety-disclaimer');
    const disclaimerDismiss = document.getElementById('disclaimer-dismiss');
    if (disclaimerBanner && localStorage.getItem('disclaimer-dismissed') === '1') {
        disclaimerBanner.classList.add('hidden');
    }
    if (disclaimerDismiss) {
        disclaimerDismiss.addEventListener('click', () => {
            if (disclaimerBanner) disclaimerBanner.classList.add('hidden');
            localStorage.setItem('disclaimer-dismissed', '1');
        });
    }

    // ZAPISZ I ZASTOSUJ — zapisuje jako Własne + stosuje (defaulty profilu zostają)
    if (applyCurveBtn) {
        applyCurveBtn.addEventListener('click', () => {
            // W trybie Domyślny najpierw przełącz na edycję własną (kopiuje wartości z pól)
            if (curveSource === 'default') {
                syncCurveSourceUI('custom');
            }

            let anyUnsorted = false;
            const saved = {};

            for (const fan of ['cpu', 'gpu']) {
                let points = readCurveFromInputs(fan);
                if (points.length < 2) {
                    showToast(
                        (currentTranslations['toast_curve_need_points'] || 'Krzywa {target} wymaga co najmniej 2 punktów').replace('{target}', fan.toUpperCase()),
                        'warning'
                    );
                    return;
                }
                if (isCurveUnsorted(points)) anyUnsorted = true;
                points = sortCurvePoints(points).map(([t, s]) => [
                    Math.max(0, Math.min(110, t)),
                    clampCurveSpeed(s),
                ]);
                saved[fan] = points;
                curvesData[fan] = points;
                api.setFanCurve([fan, ...points.flat()]);
            }

            customCurvesCache = {
                cpu: saved.cpu.map((p) => [...p]),
                gpu: saved.gpu.map((p) => [...p]),
            };
            hasCustomCurve = true;
            curveSource = 'custom';
            syncCurveSourceUI('custom');
            loadCurvesToInputs();

            if (anyUnsorted) {
                showToast(
                    currentTranslations['toast_curves_saved_sorted']
                        || 'Zapisano i zastosowano krzywe (punkty posortowane)',
                    'info'
                );
            } else {
                showToast(
                    currentTranslations['toast_curves_saved_success']
                        || 'Zapisano i zastosowano własne krzywe CPU i GPU',
                    'success'
                );
            }
        });
    }

    // Resize listener for sharp canvas preview
    window.addEventListener('resize', drawCurvePreview);
}

// Receive telemetry data from electron main process
if (api && typeof api.onFanData === 'function') {
    api.onFanData((data) => {
        try {
            updateUI(data);
        } catch (err) {
            console.error('Error updating UI:', err);
        }
    });
}

if (api && typeof api.onBackendStatus === 'function') {
    api.onBackendStatus((status) => {
        backendAlive = !!(status && status.connected);
        if (!backendAlive) {
            setConnectionStatus(false, 'backend');
        }
    });
}

async function loadLanguage(lang) {
    try {
        const res = await fetch(`./i18n/${lang}.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        currentTranslations = await res.json();
        applyTranslations();
        localStorage.setItem('preferred-language', lang);
    } catch (err) {
        console.error('Error loading language:', err);
    }
}

function applyTranslations() {
    if (!currentTranslations) return;

    const setText = (id, key) => {
        const el = document.getElementById(id);
        if (el && currentTranslations[key]) {
            el.textContent = currentTranslations[key];
        }
    };

    setText('header-status-text', 'system_optimal');
    setText('profiles-title', 'profiles_title');
    setText('profile-silent-name', 'profile_silent_name');
    setText('profile-balanced-name', 'profile_balanced_name');
    setText('profile-turbo-name', 'profile_turbo_name');
    setText('working-mode-title', 'working_mode_title');
    setText('manual-control-label', 'manual_control_label');
    setText('mode-auto-btn', 'mode_auto_btn');
    setText('mode-manual-btn', 'mode_manual_btn');
    setText('logging-section-title', 'logging_section_title');
    setText('logging-label', 'logging_label');
    setText('menu-btn-label', 'menu_btn_label');
    setText('menu-header-title', 'menu_header_title');
    setText('menu-logging-label', 'logging_label');
    setText('menu-summary-label', 'menu_summary_label');
    setText('menu-open-logs-label', 'menu_open_logs_label');
    setText('settings-btn-label', 'settings_btn_label');
    setText('settings-header-title', 'settings_header_title');
    setText('settings-close-label', 'settings_close_label');
    setText('settings-edit-defaults-label', 'settings_edit_defaults');
    setText('settings-show-disclaimer-label', 'settings_show_disclaimer');
    setText('settings-reset-close-label', 'settings_reset_close');

    // Settings select options (i18n)
    const closeAsk = document.getElementById('settings-close-ask');
    const closeMin = document.getElementById('settings-close-minimize');
    const closeQuit = document.getElementById('settings-close-quit');
    if (closeAsk && currentTranslations['settings_close_ask']) closeAsk.textContent = currentTranslations['settings_close_ask'];
    if (closeMin && currentTranslations['settings_close_minimize']) closeMin.textContent = currentTranslations['settings_close_minimize'];
    if (closeQuit && currentTranslations['settings_close_quit']) closeQuit.textContent = currentTranslations['settings_close_quit'];
    syncSettingsCloseSelect();
    setText('summary-modal-title', 'summary_modal_title');
    setText('btn-copy-report', 'btn_copy_report');
    setText('btn-close', 'btn_close');
    setText('defaults-modal-title', 'defaults_modal_title');
    setText('defaults-modal-hint', 'defaults_modal_hint');
    setText('defaults-edited-msg', 'defaults_edited_msg');
    setText('defaults-btn-restore', 'defaults_btn_restore');
    setText('defaults-tab-silent-label', 'profile_silent_name');
    setText('defaults-tab-balanced-label', 'profile_balanced_name');
    setText('defaults-tab-turbo-label', 'profile_turbo_name');
    setText('defaults-cpu-temp-col', 'temp_col');
    setText('defaults-cpu-rpm-col', 'rpm_col');
    setText('defaults-gpu-temp-col', 'temp_col');
    setText('defaults-gpu-rpm-col', 'rpm_col');
    setText('defaults-btn-cancel', 'close_btn_cancel');
    setText('defaults-btn-save', 'defaults_btn_save');
    
    const modeLabelEl = document.getElementById('mode-label');
    if (modeLabelEl) {
        modeLabelEl.textContent = isManualMode
            ? (currentTranslations['mode_manual_desc'] || 'Sterowanie ręczne')
            : (currentTranslations['mode_auto_desc'] || 'Tryb Auto (Krzywa EC)');
    }

    setText('resources-title', 'resources_title');
    setText('other-sensors-title', 'other_sensors_title');
    setText('kbd-backlight-title', 'kbd_backlight_title');
    setText('kbd-timeout-label', 'kbd_timeout_label');
    setText('kbd-timeout-off-text', 'kbd_timeout_no');
    setText('kbd-timeout-on-text', 'kbd_timeout_yes');
    refreshKbdBacklightUi();
    setText('power-profiles-title', 'power_profiles_title');
    setText('power-low-power-name', 'power_low_power');
    setText('power-quiet-name', 'power_quiet');
    setText('power-balanced-name', 'power_balanced');
    setText('power-sport-name', 'power_sport');
    setText('power-performance-name', 'power_performance');
    setText('power-status-label', 'power_status_label');
    document.querySelectorAll('.power-profile-btn').forEach((btn) => {
        const meta = POWER_PROFILE_META.find((item) => item.id === btn.dataset.powerProfile);
        if (meta && currentTranslations[meta.hintKey]) {
            btn.title = currentTranslations[meta.hintKey];
        }
    });
    updatePowerProfileHint(currentPowerProfile);
    updatePowerProfileStatusBar(currentPowerProfile);
    
    setText('cpu-header', 'cpu_header');
    setText('gpu-header', 'gpu_header');
    
    setText('cpu-pwm-label', 'pwm_fill');
    setText('gpu-pwm-label', 'pwm_fill');

    setText('manual-sliders-title', 'manual_sliders_title');
    setText('master-slider-label', 'master_slider_label');
    setText('cpu-fan-label', 'cpu_fan_label');
    setText('gpu-fan-label', 'gpu_fan_label');
    setText('offset-label', 'offset_label');
    // Odśwież tooltip suwaków przy zmianie języka / trybu
    setManualControlsEnabled(isManualMode);

    updateCurveEditorTitle(currentProfile);
    setText('cpu-temp-col', 'temp_col');
    setText('cpu-rpm-col', 'rpm_col');
    setText('gpu-temp-col', 'temp_col');
    setText('gpu-rpm-col', 'rpm_col');
    setText('curve-source-default-label', 'curve_source_default');
    setText('curve-source-custom-label', 'curve_source_custom');

    setText('save-curve-btn-text', 'save_curve_btn');
    setText('temp-history-title', 'temp_history_title');

    setText('daemon-status-text', 'daemon_status_label');
    setText('working-mode-label', 'working_mode_label');
    setText('disclaimer-text', 'disclaimer_text');
    setText('close-confirm-title', 'close_confirm_title');
    setText('close-confirm-text', 'close_confirm_text');
    setText('close-dont-ask-label', 'close_dont_ask');
    setText('close-btn-cancel', 'close_btn_cancel');
    setText('close-btn-minimize', 'close_btn_minimize');
    setText('close-btn-quit', 'close_btn_quit');
    updateOffsetUI(speedOffset);

    // Refresh connection-related labels without forcing wrong online state
    if (connectionOnline) {
        setConnectionStatus(true);
    } else {
        setConnectionStatus(false);
    }

    const activeModeDisplayEl = document.getElementById('active-mode-display');
    if (activeModeDisplayEl) {
        if (!isManualMode) {
            const activeBtn = document.querySelector('.profile-btn.active');
            const profileName = activeBtn ? activeBtn.dataset.profile : 'Silent';
            activeModeDisplayEl.textContent = `Dynamic Auto (${profileName})`;
        } else {
            activeModeDisplayEl.textContent = currentTranslations['mode_manual_desc'] || 'Sterowanie ręczne';
        }
    }

    const versionEl = document.getElementById('app-version');
    if (versionEl) {
        versionEl.textContent = formatAppVersionLabel(appVersion);
    }
}

function setupAutoRefresh() {
    if (updateInterval) clearInterval(updateInterval);
    updateInterval = setInterval(() => {
        api.requestFanStatus();
        if (!powerProfileBusy) refreshPowerProfileUi();
    }, CHART_POLL_MS);

    if (connectionWatchInterval) clearInterval(connectionWatchInterval);
    connectionWatchInterval = setInterval(() => {
        if (!lastFanDataAt) {
            setConnectionStatus(false, 'waiting');
            return;
        }
        if (Date.now() - lastFanDataAt > DATA_STALE_MS || !backendAlive) {
            setConnectionStatus(false, 'stale');
        }
    }, 1000);
}

async function initialize() {
    initChart();

    // Version badge from package.json via main process
    try {
        if (api.getAppVersion) {
            appVersion = await api.getAppVersion();
        }
    } catch (err) {
        console.warn('Could not read app version:', err);
    }
    const versionEl = document.getElementById('app-version');
    if (versionEl) versionEl.textContent = formatAppVersionLabel(appVersion);

    // Load preferred language or default to polish
    const prefLang = localStorage.getItem('preferred-language') || 'pl';
    await loadLanguage(prefLang);
    const langSelect = document.getElementById('language-select');
    if (langSelect) {
        langSelect.value = prefLang;
    }

    // Preferencja X → main (Alt+F4 / menedżer okien)
    pushCloseActionPrefToMain();
    if (api && typeof api.onCloseRequested === 'function') {
        api.onCloseRequested(() => handleCloseRequest());
    }

    setupEventListeners();
    refreshKbdBacklightUi();
    refreshPowerProfileUi();
    setupCloseConfirmModal();
    setupAutoRefresh();

    // Initial UI: offline until first telemetry; mode/sliders filled from first packet
    setConnectionStatus(false, 'waiting');
    lastAppliedMode = null;
    if (modeToggle) modeToggle.checked = false;
    syncModeSegmentUI(false);
    setManualControlsEnabled(false);
    fanSlider.min = String(MIN_PCT_MASTER);
    cpuFanSlider.min = String(MIN_PCT_CPU);
    gpuFanSlider.min = String(MIN_PCT_GPU);
    // Placeholder until backend JSON arrives (avoid flashing wrong mode)
    fanSlider.value = String(MIN_PCT_MASTER);
    cpuFanSlider.value = String(MIN_PCT_CPU);
    gpuFanSlider.value = String(MIN_PCT_GPU);
    sliderValue.textContent = `${MIN_PCT_MASTER}%`;
    cpuSliderValue.textContent = `${MIN_PCT_CPU}%`;
    gpuSliderValue.textContent = `${MIN_PCT_GPU}%`;
    updateOffsetUI(0);
    syncSettingsCloseSelect();

    loadCurvesToInputs();
    api.requestFanStatus();
}

document.addEventListener('DOMContentLoaded', initialize);

// Skalowanie CSS (transform: scale) zostało usunięte — powodowało kurczenie
// całego UI (często ~50%) przy otwarciu modalu / reflow.
// Layout #app-wrapper = 100% okna Electron (1200×920).
function applyScaling() {
    const appWrapper = document.getElementById('app-wrapper');
    if (!appWrapper) return;
    appWrapper.style.transform = 'none';
    appWrapper.style.width = '100%';
    appWrapper.style.height = '100%';
}

window.addEventListener('resize', () => {
    applyScaling();
    // Odśwież podglądy po zmianie rozmiaru okna (nie przy samym otwarciu modala)
    try {
        drawCurvePreview();
        if (defaultsModalOpen) drawDefaultsCurvePreview();
        if (temperatureChart) temperatureChart.resize();
    } catch (_) { /* ignore */ }
});
applyScaling();
