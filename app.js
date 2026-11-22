// Badminton Matcher v2.0.0
// Initialize Icons
lucide.createIcons();

// --- PWA Setup ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(reg => { reg.update(); }).catch(err => console.log('SW setup failed', err));
}

// --- FIREBASE SETUP ---
const firebaseConfig = {
  apiKey: "AIzaSyCqyeMPxi1Zaq1gM_ZtFBZ0ZVzc4LK_gSI",
  authDomain: "badmintonapp-7d9b3.firebaseapp.com",
  projectId: "badmintonapp-7d9b3",
  storageBucket: "badmintonapp-7d9b3.firebasestorage.app",
  messagingSenderId: "93874052881",
  appId: "1:93874052881:web:b5bd71c1c06bfbe2a976b0"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// 啟用 Firestore 本地離線快取（離線可讀可寫，連網時自動同步）
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    if (err.code === 'failed-precondition') {
        console.warn('Firestore 離線快取：多個分頁同時開啟，僅在主分頁啟用');
    } else if (err.code === 'unimplemented') {
        console.warn('當前瀏覽器不支援 Firestore 離線持久化');
    }
});

// --- MULTI-USER & MULTI-GROUP STATE ---
let currentUser = null;
let userGroups = [];
let currentGroupId = null;
let currentGroupMeta = null;
let hasLoadedCurrentGroup = false;
let unsubscribeGroupsList = null;
let unsubscribeGroupDoc = null;

function getDefaultMatchState() {
    return {
        courts: [
            { name: '預備場 1', isSingles: false, teamA: [null, null], teamB: [null, null] }
        ],
        activeCourts: [
            { name: '場地 1', isSingles: false, teamA: [null, null], teamB: [null, null] },
            { name: '場地 2', isSingles: false, teamA: [null, null], teamB: [null, null] },
            { name: '場地 3', isSingles: false, teamA: [null, null], teamB: [null, null] }
        ],
        pool: []
    };
}

function getDefaultMatchConfig() {
    return {
        enablePriority: true,
        priorityStep: 100,
        unplayedPriority: 600,
        maxWaitingPriority: 500,
        confirmFinishMatch: false,
        avoidRecentPartner: true,
        avoidSameCourt: true,
        balanceMatchCount: false,
        maxTeamDiff: 2,
        maxPlayerGap: 4
    };
}

function getCurrentGroupDocRef() {
    return currentGroupId ? db.collection('groups').doc(currentGroupId) : null;
}

function getOfflineKey(suffix) {
    if (currentUser && currentGroupId) {
        return `${suffix}_${currentUser.uid}_${currentGroupId}`;
    }
    return suffix;
}

function getUserDisplayName(user) {
    if (!user) return '使用者';
    if (user.displayName && user.displayName.trim()) return user.displayName.trim();
    if (user.email) return user.email.split('@')[0];
    return '使用者';
}

function generateShareCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `BM-${code}`;
}

function updateUrlGroupParam(groupId) {
    if (!groupId) return;
    try {
        const url = new URL(window.location.href);
        url.searchParams.set('group', groupId);
        window.history.replaceState({}, '', url.toString());
        sessionStorage.setItem('activeGroupId', groupId);
        if (currentUser) {
            localStorage.setItem('lastGroupId_' + currentUser.uid, groupId);
        }
    } catch (e) {}
}

// --- STATE ---
let players = [];
let matchState = getDefaultMatchState();

// Variables for Drag & Click
let draggedPlayerId = null;
let clickedPlayerId = null;

// --- CONFIGURATION ---
// 規則預設值：
// 規則 1: 等待優先值輪替機制 (預設開, 每輪 25 點)
// 規則 2: 今日場次平衡 (預設關)
// 規則 3: 兩隊總分差 (預設 2, 0=不限)
// 規則 4: 同場等級落差 (預設 4, 0=不限)
// 規則 5: 避開前搭檔 (預設開)
// 規則 6: 預備場地數 (預設 1, 0=關)
// 上場中場地數: 預設 3
let matchConfig = {
    enablePriority: true,
    priorityStep: 100,
    unplayedPriority: 600,
    maxWaitingPriority: 500,
    confirmFinishMatch: false,
    avoidRecentPartner: true,
    avoidSameCourt: true,
    balanceMatchCount: false,
    maxTeamDiff: 2,
    maxPlayerGap: 4
};

let isCourtVertical = localStorage.getItem('courtOrientation') === 'vertical';

// --- DOM ELEMENTS ---
const navBtns = document.querySelectorAll('.nav-btn');
const views = document.querySelectorAll('.view');
const addPlayerForm = document.getElementById('addPlayerForm');
const playerListEl = document.getElementById('playerList');
const totalPlayerCountEl = document.getElementById('totalPlayerCount');
const playerNameInput = document.getElementById('playerName');
const playerLevelInput = document.getElementById('playerLevel');
const levelValueSpan = document.getElementById('levelValue');
const playingCountEl = document.getElementById('playingCount');
const courtsContainer = document.getElementById('preCourtsContainer');
const activeCourtsContainer = document.getElementById('activeCourtsContainer');
const restingPlayersList = document.getElementById('restingPlayersList');
const playerSortModeSelect = document.getElementById('playerSortMode');
const activeCourtCountSelect = document.getElementById('activeCourtCount');
const courtCountSelect = document.getElementById('preCourtCount');
const playerSearchInput = document.getElementById('playerSearch');
const btnClearAttendance = document.getElementById('btnClearAttendance');
const playerIsEmployeeCheckbox = document.getElementById('playerIsEmployee');

// Settings Elements
const btnPriorityOn = document.getElementById('btnPriorityOn');
const btnPriorityOff = document.getElementById('btnPriorityOff');
const cfgPriorityStep = document.getElementById('cfgPriorityStep');
const cfgUnplayedPriority = document.getElementById('cfgUnplayedPriority');
const cfgMaxWaitingPriority = document.getElementById('cfgMaxWaitingPriority');
const hintUnplayedVal = document.getElementById('hintUnplayedVal');
const hintMaxWaitingVal = document.getElementById('hintMaxWaitingVal');
const hintStepVal = document.getElementById('hintStepVal');
const btnAvoidPartnerOn = document.getElementById('btnAvoidPartnerOn');
const btnAvoidPartnerOff = document.getElementById('btnAvoidPartnerOff');
const btnAvoidSameCourtOn = document.getElementById('btnAvoidSameCourtOn');
const btnAvoidSameCourtOff = document.getElementById('btnAvoidSameCourtOff');
const btnBalanceMatchesOn = document.getElementById('btnBalanceMatchesOn');
const btnBalanceMatchesOff = document.getElementById('btnBalanceMatchesOff');
const btnConfirmFinishOn = document.getElementById('btnConfirmFinishOn');
const btnConfirmFinishOff = document.getElementById('btnConfirmFinishOff');
const cfgMaxTeamDiff = document.getElementById('cfgMaxTeamDiff');
const cfgMaxPlayerGap = document.getElementById('cfgMaxPlayerGap');
const btnApplyCourts = document.getElementById('btnApplyCourts');

// Layout Toggle Elements
const btnToggleCourtOrientation = document.getElementById('btnToggleCourtOrientation');
const orientationLabel = document.getElementById('orientationLabel');

let playerSortMode = 'levelDesc';
let playerSearchText = '';
let isPlayerEditMode = false;

// --- PRIORITY FORMULA HELPER ---
function getActiveCourtCount() {
    return (matchState.activeCourts && matchState.activeCourts.length > 0) ? matchState.activeCourts.length : 3;
}

function getUnplayedPriority() {
    if (matchConfig && matchConfig.unplayedPriority !== undefined) {
        return Math.max(0, Number(matchConfig.unplayedPriority));
    }
    // Backward compatibility fallback
    const courtCount = getActiveCourtCount();
    const step = (matchConfig && matchConfig.priorityStep) ? matchConfig.priorityStep : 100;
    const offset = (matchConfig && matchConfig.unplayedCourtOffset !== undefined) ? Number(matchConfig.unplayedCourtOffset) : 1;
    return Math.max(0, (courtCount + offset) * step);
}

function getMaxWaitingPriority() {
    if (matchConfig && matchConfig.maxWaitingPriority !== undefined) {
        return Math.max(0, Number(matchConfig.maxWaitingPriority));
    }
    // Backward compatibility fallback
    const courtCount = getActiveCourtCount();
    const step = (matchConfig && matchConfig.priorityStep) ? matchConfig.priorityStep : 100;
    const offset = (matchConfig && matchConfig.playedCapCourtOffset !== undefined) ? Number(matchConfig.playedCapCourtOffset) : 0;
    return Math.max(0, (courtCount + offset) * step);
}

function getPlayerPriority(p) {
    if (!p) return 0;
    if (p.customPriority && p.priority !== undefined && p.priority !== null) {
        return Math.max(0, Number(p.priority));
    }
    const isUnplayed = !p.matchCount || p.matchCount === 0;
    if (isUnplayed) {
        return getUnplayedPriority();
    }
    const maxWaitingPrio = getMaxWaitingPriority();
    if (p.priority !== undefined && p.priority !== null) {
        return Math.min(Number(p.priority), maxWaitingPrio);
    }
    return 0;
}

function updateUnplayedHint() {
    const hintUnplayedVal = document.getElementById('hintUnplayedVal');
    const hintMaxWaitingVal = document.getElementById('hintMaxWaitingVal');
    const hintStepVal = document.getElementById('hintStepVal');
    const step = cfgPriorityStep ? (parseInt(cfgPriorityStep.value) || 100) : 100;
    const unplayedPrio = cfgUnplayedPriority ? (parseInt(cfgUnplayedPriority.value) >= 0 ? parseInt(cfgUnplayedPriority.value) : 600) : 600;
    const maxWaitingPrio = cfgMaxWaitingPriority ? (parseInt(cfgMaxWaitingPriority.value) >= 0 ? parseInt(cfgMaxWaitingPriority.value) : 500) : 500;

    if (hintUnplayedVal) hintUnplayedVal.textContent = unplayedPrio;
    if (hintMaxWaitingVal) hintMaxWaitingVal.textContent = maxWaitingPrio;
    if (hintStepVal) hintStepVal.textContent = step;
}

// --- SETTINGS SNAPSHOT & DIRTY CHECKING (防呆保護) ---
let savedSettingsSnapshot = null;

function saveCurrentSettingsSnapshot() {
    savedSettingsSnapshot = {
        enablePriority: matchConfig.enablePriority !== undefined ? Boolean(matchConfig.enablePriority) : true,
        priorityStep: matchConfig.priorityStep !== undefined ? Number(matchConfig.priorityStep) : 100,
        unplayedPriority: matchConfig.unplayedPriority !== undefined ? Number(matchConfig.unplayedPriority) : getUnplayedPriority(),
        maxWaitingPriority: matchConfig.maxWaitingPriority !== undefined ? Number(matchConfig.maxWaitingPriority) : getMaxWaitingPriority(),
        confirmFinishMatch: matchConfig.confirmFinishMatch !== undefined ? Boolean(matchConfig.confirmFinishMatch) : false,
        avoidRecentPartner: matchConfig.avoidRecentPartner !== undefined ? Boolean(matchConfig.avoidRecentPartner) : true,
        avoidSameCourt: matchConfig.avoidSameCourt !== undefined ? Boolean(matchConfig.avoidSameCourt) : true,
        balanceMatchCount: matchConfig.balanceMatchCount !== undefined ? Boolean(matchConfig.balanceMatchCount) : false,
        activeCourtCount: (matchState.activeCourts && matchState.activeCourts.length > 0) ? matchState.activeCourts.length : 3,
        preCourtCount: (matchState.courts !== undefined) ? matchState.courts.length : 1,
        maxTeamDiff: matchConfig.maxTeamDiff !== undefined ? Number(matchConfig.maxTeamDiff) : 2,
        maxPlayerGap: matchConfig.maxPlayerGap !== undefined ? Number(matchConfig.maxPlayerGap) : 4
    };
}

function getUIConfigValues() {
    return {
        enablePriority: btnPriorityOn ? btnPriorityOn.classList.contains('is-active') : true,
        priorityStep: cfgPriorityStep ? (parseInt(cfgPriorityStep.value) || 100) : 100,
        unplayedPriority: cfgUnplayedPriority ? (parseInt(cfgUnplayedPriority.value) >= 0 ? parseInt(cfgUnplayedPriority.value) : 600) : 600,
        maxWaitingPriority: cfgMaxWaitingPriority ? (parseInt(cfgMaxWaitingPriority.value) >= 0 ? parseInt(cfgMaxWaitingPriority.value) : 500) : 500,
        confirmFinishMatch: btnConfirmFinishOn ? btnConfirmFinishOn.classList.contains('is-active') : false,
        avoidRecentPartner: btnAvoidPartnerOn ? btnAvoidPartnerOn.classList.contains('is-active') : true,
        avoidSameCourt: btnAvoidSameCourtOn ? btnAvoidSameCourtOn.classList.contains('is-active') : true,
        balanceMatchCount: btnBalanceMatchesOn ? btnBalanceMatchesOn.classList.contains('is-active') : false,
        activeCourtCount: activeCourtCountSelect ? (parseInt(activeCourtCountSelect.value) || 3) : 3,
        preCourtCount: courtCountSelect ? (parseInt(courtCountSelect.value) >= 0 ? parseInt(courtCountSelect.value) : 1) : 1,
        maxTeamDiff: cfgMaxTeamDiff ? (parseInt(cfgMaxTeamDiff.value) >= 0 ? parseInt(cfgMaxTeamDiff.value) : 2) : 2,
        maxPlayerGap: cfgMaxPlayerGap ? (parseInt(cfgMaxPlayerGap.value) >= 0 ? parseInt(cfgMaxPlayerGap.value) : 4) : 4
    };
}

function setToggleState(btnOn, btnOff, isOn) {
    if (!btnOn || !btnOff) return;
    if (isOn) {
        btnOn.classList.add('is-active');
        btnOn.style.background = '#10b981';
        btnOn.style.color = 'white';
        btnOff.classList.remove('is-active');
        btnOff.style.background = 'rgba(15,23,42,0.6)';
        btnOff.style.color = 'var(--text-muted)';
    } else {
        btnOff.classList.add('is-active');
        btnOff.style.background = '#ef4444';
        btnOff.style.color = 'white';
        btnOn.classList.remove('is-active');
        btnOn.style.background = 'rgba(15,23,42,0.6)';
        btnOn.style.color = 'var(--text-muted)';
    }
}

function setUIFromConfig(cfg) {
    if (!cfg) return;
    setToggleState(btnPriorityOn, btnPriorityOff, cfg.enablePriority);
    if (cfgPriorityStep) cfgPriorityStep.value = (cfg.priorityStep !== undefined) ? cfg.priorityStep : 100;
    if (cfgUnplayedPriority) {
        cfgUnplayedPriority.value = (cfg.unplayedPriority !== undefined) ? cfg.unplayedPriority : (cfg.unplayedCourtOffset !== undefined ? ((cfg.activeCourtCount || 3) + Number(cfg.unplayedCourtOffset)) * (cfg.priorityStep || 100) : 600);
    }
    if (cfgMaxWaitingPriority) {
        cfgMaxWaitingPriority.value = (cfg.maxWaitingPriority !== undefined) ? cfg.maxWaitingPriority : (cfg.playedCapCourtOffset !== undefined ? ((cfg.activeCourtCount || 3) + Number(cfg.playedCapCourtOffset)) * (cfg.priorityStep || 100) : 500);
    }

    setToggleState(btnAvoidPartnerOn, btnAvoidPartnerOff, cfg.avoidRecentPartner);
    setToggleState(btnAvoidSameCourtOn, btnAvoidSameCourtOff, cfg.avoidSameCourt !== undefined ? cfg.avoidSameCourt : true);
    setToggleState(btnBalanceMatchesOn, btnBalanceMatchesOff, cfg.balanceMatchCount);
    setToggleState(btnConfirmFinishOn, btnConfirmFinishOff, cfg.confirmFinishMatch || false);

    if (activeCourtCountSelect) activeCourtCountSelect.value = cfg.activeCourtCount;
    if (courtCountSelect) courtCountSelect.value = cfg.preCourtCount;
    if (cfgMaxTeamDiff) cfgMaxTeamDiff.value = cfg.maxTeamDiff;
    if (cfgMaxPlayerGap) cfgMaxPlayerGap.value = cfg.maxPlayerGap;

    updateUnplayedHint();
}

function getSettingsDiffs(current, saved) {
    if (!saved) return [];
    const diffs = [];
    if (current.activeCourtCount !== saved.activeCourtCount) {
        diffs.push(`上場中場地數：${saved.activeCourtCount} 面 ➔ ${current.activeCourtCount} 面`);
    }
    if (current.preCourtCount !== saved.preCourtCount) {
        const sTxt = saved.preCourtCount === 0 ? '關閉(0面)' : `${saved.preCourtCount} 面`;
        const cTxt = current.preCourtCount === 0 ? '關閉(0面)' : `${current.preCourtCount} 面`;
        diffs.push(`預備場地數：${sTxt} ➔ ${cTxt}`);
    }
    if (current.enablePriority !== saved.enablePriority) {
        diffs.push(`等待優先值輪替機制：${saved.enablePriority ? '開啟' : '關閉'} ➔ ${current.enablePriority ? '開啟' : '關閉'}`);
    }
    if (current.priorityStep !== saved.priorityStep) {
        diffs.push(`每輪等待增加點數：${saved.priorityStep} 點 ➔ ${current.priorityStep} 點`);
    }
    if (current.unplayedPriority !== saved.unplayedPriority) {
        diffs.push(`未打過者優先值：${saved.unplayedPriority} 點 ➔ ${current.unplayedPriority} 點`);
    }
    if (current.maxWaitingPriority !== saved.maxWaitingPriority) {
        diffs.push(`已打過者等待上限：${saved.maxWaitingPriority} 點 ➔ ${current.maxWaitingPriority} 點`);
    }
    if (current.confirmFinishMatch !== saved.confirmFinishMatch) {
        diffs.push(`下場確認通知：${saved.confirmFinishMatch ? '開啟' : '關閉'} ➔ ${current.confirmFinishMatch ? '開啟' : '關閉'}`);
    }
    if (current.avoidRecentPartner !== saved.avoidRecentPartner) {
        diffs.push(`避開前搭檔：${saved.avoidRecentPartner ? '開啟' : '關閉'} ➔ ${current.avoidRecentPartner ? '開啟' : '關閉'}`);
    }
    if (current.avoidSameCourt !== saved.avoidSameCourt) {
        diffs.push(`避開前同場者：${saved.avoidSameCourt ? '開啟' : '關閉'} ➔ ${current.avoidSameCourt ? '開啟' : '關閉'}`);
    }
    if (current.balanceMatchCount !== saved.balanceMatchCount) {
        diffs.push(`今日場次平衡：${saved.balanceMatchCount ? '開啟' : '關閉'} ➔ ${current.balanceMatchCount ? '開啟' : '關閉'}`);
    }
    if (current.maxTeamDiff !== saved.maxTeamDiff) {
        const sTxt = saved.maxTeamDiff === 0 ? '不限(關閉)' : `≤ ${saved.maxTeamDiff}`;
        const cTxt = current.maxTeamDiff === 0 ? '不限(關閉)' : `≤ ${current.maxTeamDiff}`;
        diffs.push(`兩隊總分差：${sTxt} ➔ ${cTxt}`);
    }
    if (current.maxPlayerGap !== saved.maxPlayerGap) {
        const sTxt = saved.maxPlayerGap === 0 ? '不限(關閉)' : `≤ ${saved.maxPlayerGap}`;
        const cTxt = current.maxPlayerGap === 0 ? '不限(關閉)' : `≤ ${current.maxPlayerGap}`;
        diffs.push(`同場等級落差：${sTxt} ➔ ${cTxt}`);
    }
    return diffs;
}

function applySettingsFromUI() {
    const cur = getUIConfigValues();
    matchConfig.enablePriority = cur.enablePriority;
    matchConfig.priorityStep = cur.priorityStep;
    matchConfig.unplayedPriority = cur.unplayedPriority;
    matchConfig.maxWaitingPriority = cur.maxWaitingPriority;
    matchConfig.confirmFinishMatch = cur.confirmFinishMatch;
    matchConfig.avoidRecentPartner = cur.avoidRecentPartner;
    matchConfig.avoidSameCourt = cur.avoidSameCourt;
    matchConfig.balanceMatchCount = cur.balanceMatchCount;
    matchConfig.maxTeamDiff = cur.maxTeamDiff;
    matchConfig.maxPlayerGap = cur.maxPlayerGap;

    matchState = readStateFromDOM();
    matchState.activeCourts = matchState.activeCourts || [];
    updateCourtsArray(matchState.activeCourts, cur.activeCourtCount, matchState.pool, '場地 ');
    matchState.courts = matchState.courts || [];
    updateCourtsArray(matchState.courts, cur.preCourtCount, matchState.pool, '預備場 ');

    saveCurrentSettingsSnapshot();
    const groupRef = getCurrentGroupDocRef();
    if (groupRef && hasLoadedCurrentGroup) {
        recordLocalModification();
        groupRef.set({ matchConfig, matchState, lastModified: Date.now() }, { merge: true });
    }
    renderMatchUI(true);
}

function restoreSettingsUIFromSnapshot() {
    if (!savedSettingsSnapshot) return;
    setUIFromConfig(savedSettingsSnapshot);
}

// Wire Settings UI listeners
if (btnPriorityOn && btnPriorityOff) {
    btnPriorityOn.addEventListener('click', () => setToggleState(btnPriorityOn, btnPriorityOff, true));
    btnPriorityOff.addEventListener('click', () => setToggleState(btnPriorityOn, btnPriorityOff, false));
}
if (btnAvoidPartnerOn && btnAvoidPartnerOff) {
    btnAvoidPartnerOn.addEventListener('click', () => setToggleState(btnAvoidPartnerOn, btnAvoidPartnerOff, true));
    btnAvoidPartnerOff.addEventListener('click', () => setToggleState(btnAvoidPartnerOn, btnAvoidPartnerOff, false));
}
if (btnAvoidSameCourtOn && btnAvoidSameCourtOff) {
    btnAvoidSameCourtOn.addEventListener('click', () => setToggleState(btnAvoidSameCourtOn, btnAvoidSameCourtOff, true));
    btnAvoidSameCourtOff.addEventListener('click', () => setToggleState(btnAvoidSameCourtOn, btnAvoidSameCourtOff, false));
}
if (btnBalanceMatchesOn && btnBalanceMatchesOff) {
    btnBalanceMatchesOn.addEventListener('click', () => setToggleState(btnBalanceMatchesOn, btnBalanceMatchesOff, true));
    btnBalanceMatchesOff.addEventListener('click', () => setToggleState(btnBalanceMatchesOn, btnBalanceMatchesOff, false));
}
if (btnConfirmFinishOn && btnConfirmFinishOff) {
    btnConfirmFinishOn.addEventListener('click', () => setToggleState(btnConfirmFinishOn, btnConfirmFinishOff, true));
    btnConfirmFinishOff.addEventListener('click', () => setToggleState(btnConfirmFinishOn, btnConfirmFinishOff, false));
}
if (cfgPriorityStep) {
    cfgPriorityStep.addEventListener('input', updateUnplayedHint);
}
if (cfgUnplayedPriority) {
    cfgUnplayedPriority.addEventListener('input', updateUnplayedHint);
}
if (cfgMaxWaitingPriority) {
    cfgMaxWaitingPriority.addEventListener('input', updateUnplayedHint);
}

if (btnApplyCourts) {
    btnApplyCourts.addEventListener('click', () => {
        applySettingsFromUI();
        const origHtml = btnApplyCourts.innerHTML;
        btnApplyCourts.innerHTML = '<i data-lucide="check-circle"></i> 已套用！';
        btnApplyCourts.style.background = '#10b981';
        lucide.createIcons();
        setTimeout(() => {
            btnApplyCourts.innerHTML = origHtml;
            btnApplyCourts.style.background = '';
            lucide.createIcons();
        }, 1500);
    });
}

// Orientation Toggle
function updateOrientationUI() {
    if (!btnToggleCourtOrientation) return;
    if (isCourtVertical) {
        btnToggleCourtOrientation.innerHTML = '<i data-lucide="columns-2"></i> <span id="orientationLabel">直式</span>';
        btnToggleCourtOrientation.title = '目前為直式版面，點擊切換為橫式版面';
    } else {
        btnToggleCourtOrientation.innerHTML = '<i data-lucide="rows-2"></i> <span id="orientationLabel">橫式</span>';
        btnToggleCourtOrientation.title = '目前為橫式版面，點擊切換為直式版面';
    }
    lucide.createIcons();
}

if (btnToggleCourtOrientation) {
    btnToggleCourtOrientation.addEventListener('click', () => {
        isCourtVertical = !isCourtVertical;
        localStorage.setItem('courtOrientation', isCourtVertical ? 'vertical' : 'horizontal');
        updateOrientationUI();
        renderMatchUI();
    });
}
updateOrientationUI();

// --- SCROLL & VIEW RESTORATION (重新整理不跳畫面，支援多開分頁隔離) ---
function saveViewScrollPosition(viewId) {
    if (!viewId) return;
    try {
        const groupPrefix = currentGroupId || 'default';
        sessionStorage.setItem(`scrollPos_${groupPrefix}_${viewId}`, String(window.scrollY));
    } catch(e) {}
}

function restoreViewScrollPosition(viewId) {
    if (!viewId) return;
    try {
        const groupPrefix = currentGroupId || 'default';
        const saved = sessionStorage.getItem(`scrollPos_${groupPrefix}_${viewId}`);
        if (saved !== null) {
            const top = parseInt(saved, 10);
            if (!isNaN(top)) {
                requestAnimationFrame(() => {
                    window.scrollTo({ top, behavior: 'instant' });
                });
            }
        }
    } catch(e) {}
}

let scrollSaveTimeout = null;
window.addEventListener('scroll', () => {
    if (scrollSaveTimeout) return;
    scrollSaveTimeout = setTimeout(() => {
        scrollSaveTimeout = null;
        const currentActiveView = document.querySelector('.view.active');
        if (currentActiveView) {
            saveViewScrollPosition(currentActiveView.id);
        }
    }, 100);
}, { passive: true });

window.addEventListener('beforeunload', () => {
    const currentActiveView = document.querySelector('.view.active');
    if (currentActiveView) {
        saveViewScrollPosition(currentActiveView.id);
    }
});

window.addEventListener('pagehide', () => {
    const currentActiveView = document.querySelector('.view.active');
    if (currentActiveView) {
        saveViewScrollPosition(currentActiveView.id);
    }
});

function switchView(targetId, skipDirtyCheck = false) {
    if (!targetId) targetId = 'viewMatch';
    const target = document.getElementById(targetId);
    if (!target) return;

    const currentActiveView = document.querySelector('.view.active');

    // If leaving viewSettings, check for unapplied modifications
    if (!skipDirtyCheck && currentActiveView && currentActiveView.id === 'viewSettings' && targetId !== 'viewSettings') {
        const currentUI = getUIConfigValues();
        const diffs = getSettingsDiffs(currentUI, savedSettingsSnapshot);
        if (diffs.length > 0) {
            const confirmMsg = `您有以下尚未套用的設定變更：\n\n` + 
                diffs.map(d => `• ${d}`).join('\n') + 
                `\n\n是否立即套用變更？\n點選【確定】：立即套用設定並切換畫面\n點選【取消】：放棄未套用的變更並切換畫面`;
            if (confirm(confirmMsg)) {
                applySettingsFromUI();
            } else {
                restoreSettingsUIFromSnapshot();
            }
        }
    }

    if (currentActiveView) {
        saveViewScrollPosition(currentActiveView.id);
    }

    navBtns.forEach(b => {
        b.classList.toggle('active', b.dataset.target === targetId);
    });

    views.forEach(v => {
        const isActive = (v.id === targetId);
        v.classList.toggle('active', isActive);
        v.style.display = isActive ? 'block' : 'none';
    });

    // 僅在排點主頁 (viewMatch) 顯示頂部標題，其他頁面 (viewSettings, viewPlayers) 隱藏頂部
    const mainHeader = document.getElementById('mainHeader');
    if (mainHeader) {
        mainHeader.style.display = (targetId === 'viewMatch') ? 'block' : 'none';
    }

    if (isPlayerEditMode && btnEditPlayersToggle) {
        isPlayerEditMode = false;
        btnEditPlayersToggle.classList.remove('primary-btn');
        btnEditPlayersToggle.classList.add('outline-btn');
        btnEditPlayersToggle.innerHTML = `<i data-lucide="edit"></i> 進入編輯`;
        lucide.createIcons();
        renderDatabaseList();
    }

    if (targetId === 'viewSettings') {
        setUIFromConfig(savedSettingsSnapshot);
    } else if (targetId === 'viewMatch') {
        syncStateBeforeMatchView();
    }

    try {
        localStorage.setItem('activeView', targetId);
    } catch(e) {}

    // Clean initial view attribute now that JS has taken over
    document.documentElement.removeAttribute('data-initial-view');

    restoreViewScrollPosition(targetId);
}

// --- NAVIGATION WITH DIRTY CHECKING (防呆保護) ---
navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        switchView(btn.dataset.target, false);
    });
});

// In-App Refresh / Sync Button (重新整理並同步雲端資料，不跳畫面)
const btnRefreshSync = document.getElementById('btnRefreshSync');
if (btnRefreshSync) {
    btnRefreshSync.addEventListener('click', async () => {
        const groupRef = getCurrentGroupDocRef();
        if (!groupRef) return;

        const icon = btnRefreshSync.querySelector('i');
        const label = document.getElementById('refreshLabel');
        const currentActiveView = document.querySelector('.view.active');
        const currentViewId = currentActiveView ? currentActiveView.id : 'viewMatch';
        const currentScrollY = window.scrollY;

        if (icon) icon.classList.add('spin-animation');
        if (label) label.textContent = '同步中...';

        try {
            const doc = await groupRef.get();
            if (doc.exists) {
                const data = doc.data();
                applyServerDataToLocalState(doc.id, data);
                saveCurrentSettingsSnapshot();
                setUIFromConfig(savedSettingsSnapshot);
                renderTopAccountBar();
                renderDatabaseList();
                syncPoolWithPlayers();
                renderMatchUI();
            }
            if (label) label.textContent = '已最新';
            setTimeout(() => {
                if (label) label.textContent = '重新整理';
                if (icon) icon.classList.remove('spin-animation');
                lucide.createIcons();
            }, 1200);
        } catch (err) {
            console.error("Refresh sync error:", err);
            if (label) label.textContent = '失敗';
            setTimeout(() => {
                if (label) label.textContent = '重新整理';
                if (icon) icon.classList.remove('spin-animation');
                lucide.createIcons();
            }, 1500);
        } finally {
            window.scrollTo({ top: currentScrollY, behavior: 'instant' });
            restoreViewScrollPosition(currentViewId);
        }
    });
}

// --- PLAYER MANAGEMENT ---
playerLevelInput.addEventListener('input', (e) => {
    const val = e.target.value;
    levelValueSpan.textContent = val;
    levelValueSpan.className = `level-badge level-${val}`;
});

function recordLocalModification() {
    const now = Date.now();
    localStorage.setItem(getOfflineKey('localLastModified'), now.toString());
    if (!navigator.onLine && currentUser && currentGroupId) {
        localStorage.setItem(getOfflineKey('hasOfflineEdits'), 'true');
        localStorage.setItem(getOfflineKey('offlineSnapshot'), JSON.stringify({
            players,
            matchState,
            matchConfig,
            lastModified: now
        }));
    }
}

function countActivePlayersInState(ms) {
    if (!ms || !ms.activeCourts) return 0;
    let count = 0;
    ms.activeCourts.forEach(c => {
        if (c.teamA) {
            if (c.teamA[0]) count++;
            if (c.teamA[1]) count++;
        }
        if (c.teamB) {
            if (c.teamB[0]) count++;
            if (c.teamB[1]) count++;
        }
    });
    return count;
}

function formatStateSummary(pList, ms) {
    const totalP = (pList || []).length;
    const playingP = (pList || []).filter(p => p.isPlaying).length;
    const activeP = countActivePlayersInState(ms);
    const poolP = (ms && ms.pool) ? ms.pool.length : 0;
    return `• 球員總數：${totalP} 人 (今日出席 ${playingP} 人)<br>• 上場狀態：${activeP} 人比賽中<br>• 候補等待：${poolP} 人`;
}

function showConflictModal(localSnap, serverData) {
    const modal = document.getElementById('conflictModal');
    if (!modal) return;

    const localTimeEl = document.getElementById('conflictLocalTime');
    const localSummaryEl = document.getElementById('conflictLocalSummary');
    const serverTimeEl = document.getElementById('conflictServerTime');
    const serverSummaryEl = document.getElementById('conflictServerSummary');

    const localDateStr = localSnap.lastModified ? new Date(localSnap.lastModified).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '離線操作紀錄';
    const serverDateStr = serverData.lastModified ? new Date(serverData.lastModified).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '雲端現有版本';

    if (localTimeEl) localTimeEl.textContent = `最後修改：${localDateStr}`;
    if (localSummaryEl) localSummaryEl.innerHTML = formatStateSummary(localSnap.players, localSnap.matchState);

    if (serverTimeEl) serverTimeEl.textContent = `最後更新：${serverDateStr}`;
    if (serverSummaryEl) serverSummaryEl.innerHTML = formatStateSummary(serverData.players, serverData.matchState);

    modal.style.display = 'flex';
    lucide.createIcons();

    const btnKeepLocal = document.getElementById('btnKeepLocal');
    const btnKeepServer = document.getElementById('btnKeepServer');
    const editsKey = getOfflineKey('hasOfflineEdits');
    const snapKey = getOfflineKey('offlineSnapshot');

    btnKeepLocal.onclick = () => {
        const groupRef = getCurrentGroupDocRef();
        const now = Date.now();
        if (groupRef) {
            groupRef.set({
                players,
                matchState,
                matchConfig,
                lastModified: now
            }, { merge: true });
        }
        localStorage.removeItem(editsKey);
        localStorage.removeItem(snapKey);
        modal.style.display = 'none';
        alert('已成功以本機離線紀錄覆蓋雲端伺服器！');
    };

    btnKeepServer.onclick = () => {
        applyServerDataToLocalState(currentGroupId, serverData);
        saveCurrentSettingsSnapshot();
        setUIFromConfig(savedSettingsSnapshot);
        renderTopAccountBar();
        renderDatabaseList();
        syncPoolWithPlayers();
        renderMatchUI();

        localStorage.removeItem(editsKey);
        localStorage.removeItem(snapKey);
        modal.style.display = 'none';
        alert('已成功載入雲端伺服器紀錄！');
    };
}

function applyServerDataToLocalState(groupId, data) {
    if (!data) return;
    currentGroupMeta = {
        id: groupId,
        name: data.name || '未命名群組',
        ownerUid: data.ownerUid || '',
        ownerName: data.ownerName || '建立者',
        memberUids: Array.isArray(data.memberUids) ? data.memberUids : [],
        memberNames: data.memberNames || {},
        shareCode: data.shareCode || '',
        shareEnabled: data.shareEnabled !== undefined ? Boolean(data.shareEnabled) : false
    };

    players = Array.isArray(data.players) ? data.players : [];

    if (data.matchState) {
        matchState = data.matchState;
        matchState.courts = matchState.courts || [];
        matchState.activeCourts = matchState.activeCourts || [];
        matchState.pool = matchState.pool || [];
        if (matchState.activeCourts.length === 0) {
            matchState.activeCourts = getDefaultMatchState().activeCourts;
        }
    } else {
        matchState = getDefaultMatchState();
    }

    if (data.matchConfig) {
        matchConfig = {
            enablePriority: data.matchConfig.enablePriority !== undefined ? data.matchConfig.enablePriority : true,
            priorityStep: data.matchConfig.priorityStep !== undefined ? data.matchConfig.priorityStep : 100,
            unplayedPriority: data.matchConfig.unplayedPriority !== undefined ? data.matchConfig.unplayedPriority : (data.matchConfig.unplayedCourtOffset !== undefined ? ((data.matchConfig.activeCourtsCount || 3) + Number(data.matchConfig.unplayedCourtOffset)) * (data.matchConfig.priorityStep || 100) : 600),
            maxWaitingPriority: data.matchConfig.maxWaitingPriority !== undefined ? data.matchConfig.maxWaitingPriority : (data.matchConfig.playedCapCourtOffset !== undefined ? ((data.matchConfig.activeCourtsCount || 3) + Number(data.matchConfig.playedCapCourtOffset)) * (data.matchConfig.priorityStep || 100) : 500),
            confirmFinishMatch: data.matchConfig.confirmFinishMatch !== undefined ? data.matchConfig.confirmFinishMatch : false,
            avoidRecentPartner: data.matchConfig.avoidRecentPartner !== undefined ? data.matchConfig.avoidRecentPartner : true,
            avoidSameCourt: data.matchConfig.avoidSameCourt !== undefined ? data.matchConfig.avoidSameCourt : true,
            balanceMatchCount: data.matchConfig.balanceMatchCount !== undefined ? data.matchConfig.balanceMatchCount : false,
            maxTeamDiff: data.matchConfig.maxTeamDiff !== undefined ? data.matchConfig.maxTeamDiff : 2,
            maxPlayerGap: data.matchConfig.maxPlayerGap !== undefined ? data.matchConfig.maxPlayerGap : 4
        };
    } else {
        matchConfig = getDefaultMatchConfig();
    }
}

function savePlayers() {
    const groupRef = getCurrentGroupDocRef();
    if (!groupRef || !hasLoadedCurrentGroup) return;
    const now = Date.now();
    recordLocalModification();
    groupRef.set({ players, lastModified: now }, { merge: true });
}

function saveMatchState() {
    const groupRef = getCurrentGroupDocRef();
    if (!groupRef || !hasLoadedCurrentGroup) return;
    const now = Date.now();
    recordLocalModification();
    groupRef.set({ matchState, lastModified: now }, { merge: true });
}

function savePlayersAndMatchState() {
    const groupRef = getCurrentGroupDocRef();
    if (!groupRef || !hasLoadedCurrentGroup) return;
    const now = Date.now();
    recordLocalModification();
    groupRef.set({ players, matchState, lastModified: now }, { merge: true });
}

// --- FIRESTORE REALTIME SYNC (PER GROUP) ---
function subscribeToGroupDoc(groupId) {
    if (!groupId) return;
    if (unsubscribeGroupDoc) {
        unsubscribeGroupDoc();
        unsubscribeGroupDoc = null;
    }

    hasLoadedCurrentGroup = false;
    currentGroupId = groupId;
    draggedPlayerId = null;
    clickedPlayerId = null;
    closePlayerStatusModal();
    updateUrlGroupParam(groupId);
    renderTopAccountBar();
    const mgrModalInit = document.getElementById('groupManagerModal');
    if (mgrModalInit && mgrModalInit.style.display === 'flex') {
        renderGroupManagerList();
    }

    unsubscribeGroupDoc = db.collection('groups').doc(groupId).onSnapshot(doc => {
        if (currentGroupId !== groupId) return;

        if (!doc.exists) {
            hasLoadedCurrentGroup = false;
            const remaining = userGroups.filter(g => g.id !== groupId);
            if (remaining.length > 0) {
                alert('目前群組已被建立者刪除或您已被移出，將切換至其他可用群組。');
                subscribeToGroupDoc(remaining[0].id);
            } else if (currentUser) {
                alert('目前群組已不存在，將為您建立一個新群組。');
                createGroup('我的羽球群組');
            }
            return;
        }

        const data = doc.data();
        const isFromCache = doc.metadata.fromCache;

        // 若有離線修改，且本次收到的是來自雲端的真實更新，檢查衝突
        const editsKey = getOfflineKey('hasOfflineEdits');
        const snapKey = getOfflineKey('offlineSnapshot');
        if (!isFromCache && localStorage.getItem(editsKey) === 'true') {
            const snapStr = localStorage.getItem(snapKey);
            if (snapStr) {
                try {
                    const localSnap = JSON.parse(snapStr);
                    if (data.lastModified !== localSnap.lastModified) {
                        applyServerDataToLocalState(doc.id, data);
                        hasLoadedCurrentGroup = true;
                        showConflictModal(localSnap, data);
                        return;
                    }
                } catch (e) {
                    console.error('Failed to parse offline snapshot', e);
                }
            }
        }

        applyServerDataToLocalState(doc.id, data);
        hasLoadedCurrentGroup = true;

        saveCurrentSettingsSnapshot();
        setUIFromConfig(savedSettingsSnapshot);
        renderTopAccountBar();

        const shareModal = document.getElementById('groupShareModal');
        if (shareModal && shareModal.style.display === 'flex' && sharingModalGroupId === groupId) {
            renderShareModalContent(groupId);
        }

        if (!draggedPlayerId && !clickedPlayerId && !isPlayerEditMode) {
            const currentScrollY = window.scrollY;
            const currentActiveView = document.querySelector('.view.active');
            renderDatabaseList();
            syncPoolWithPlayers();
            renderMatchUI();
            if (currentActiveView) {
                restoreViewScrollPosition(currentActiveView.id);
            } else {
                window.scrollTo({ top: currentScrollY, behavior: 'instant' });
            }
        }
    }, err => {
        console.error('Group snapshot error:', err);
        if (err && err.code === 'permission-denied') {
            hasLoadedCurrentGroup = false;
            const fallback = userGroups.find(g => g.id !== groupId);
            if (fallback) {
                subscribeToGroupDoc(fallback.id);
            }
        }
    });
}

// Add Player Form
addPlayerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = playerNameInput.value.trim();
    const level = parseInt(playerLevelInput.value);
    const isEmployee = playerIsEmployeeCheckbox ? playerIsEmployeeCheckbox.checked : false;

    if (name) {
        const newPlayer = {
            id: 'p_' + Date.now(),
            name,
            level,
            isPlaying: true,
            isEmployee: isEmployee,
            attendance: 0,
            matchCount: 0,
            priority: getUnplayedPriority(),
            lastDate: null
        };
        players.push(newPlayer);
        playerNameInput.value = '';
        savePlayers();
        renderDatabaseList();
    }
});

window.deletePlayer = (id) => {
    if (confirm('確定要刪除這位球員嗎？')) {
        players = players.filter(p => p.id !== id);
        savePlayers();
        renderDatabaseList();
    }
};

window.updatePlayerName = (id, newName) => {
    const p = players.find(x => x.id === id);
    if (p) {
        p.name = newName.trim();
        savePlayers();
    }
};

window.updatePlayerLevel = (id, newLevel) => {
    const p = players.find(x => x.id === id);
    if (p) {
        p.level = parseInt(newLevel) || 1;
        savePlayers();
    }
};

function resetPlayerOnAttend(p) {
    if (!p) return;
    // 不論跨日或同日重新勾選出席，一律重置為全新未上過場狀態（不帶著上次的記憶）
    p.matchCount = 0;
    p.priority = getUnplayedPriority();
    p.customPriority = false;
    p.lastPartnerId = null;
    p.lastCourtPlayerIds = null;
}

window.toggleIsPlaying = (id, checked) => {
    const p = players.find(x => x.id === id);
    if (p) {
        const wasPlaying = Boolean(p.isPlaying);
        p.isPlaying = checked;
        // 球員由未出席變為出席時，重置為未上過場狀態並清乾淨避開紀錄
        if (checked && !wasPlaying) {
            resetPlayerOnAttend(p);
        }
    }
    syncPoolWithPlayers();
    savePlayersAndMatchState();
    updatePlayingCount();
    renderDatabaseList();

    if (document.getElementById('viewMatch').classList.contains('active')) {
        syncStateBeforeMatchView();
    }
};

window.toggleEmployee = (id, checked) => {
    const p = players.find(x => x.id === id);
    if (p) p.isEmployee = checked;
    savePlayers();
};

function recordAttendance() {
    const today = new Date().toLocaleDateString('zh-TW');
    const unplayedVal = getUnplayedPriority();
    let updated = false;
    players.forEach(p => {
        if (p.isPlaying) {
            if (p.lastDate !== today) {
                p.attendance = (p.attendance || 0) + 1;
                p.matchCount = 0;
                p.priority = unplayedVal;
                p.customPriority = false;
                p.lastPartnerId = null;
                p.lastCourtPlayerIds = null;
                p.lastDate = today;
                if (matchState && matchState.pool) {
                    const poolP = matchState.pool.find(x => x && x.id === p.id);
                    if (poolP && poolP !== p) {
                        poolP.matchCount = 0;
                        poolP.priority = unplayedVal;
                        poolP.customPriority = false;
                        poolP.lastPartnerId = null;
                        poolP.lastCourtPlayerIds = null;
                        poolP.lastDate = today;
                    }
                }
                updated = true;
            }
        }
    });
    if (updated) {
        savePlayers();
        renderDatabaseList();
    }
}

// Attendance batch operations
if (playerSortModeSelect) {
    playerSortModeSelect.addEventListener('change', (e) => {
        playerSortMode = e.target.value;
        renderDatabaseList();
    });
}
if (playerSearchInput) {
    playerSearchInput.addEventListener('input', (e) => {
        playerSearchText = e.target.value.toLowerCase().trim();
        renderDatabaseList();
    });
}
if (btnClearAttendance) {
    btnClearAttendance.addEventListener('click', () => {
        if (confirm('確定要取消所有人的出席勾選嗎？')) {
            players.forEach(p => p.isPlaying = false);
            syncPoolWithPlayers();
            savePlayersAndMatchState();
            renderDatabaseList();
            updatePlayingCount();
        }
    });
}
const btnSelectAllAttendance = document.getElementById('btnSelectAllAttendance');
if (btnSelectAllAttendance) {
    btnSelectAllAttendance.addEventListener('click', () => {
        if (confirm('確定要將所有人設為出席嗎？')) {
            const today = new Date().toLocaleDateString('zh-TW');
            players.forEach(p => {
                const wasPlaying = Boolean(p.isPlaying);
                p.isPlaying = true;
                if (!wasPlaying || p.lastDate !== today) {
                    resetPlayerOnAttend(p);
                }
            });
            syncPoolWithPlayers();
            savePlayersAndMatchState();
            renderDatabaseList();
            updatePlayingCount();
        }
    });
}
const btnClearRecords = document.getElementById('btnClearRecords');
if (btnClearRecords) {
    btnClearRecords.addEventListener('click', () => {
        if (confirm('確定要清空所有人的出席累計次數嗎？')) {
            players.forEach(p => {
                p.attendance = 0;
                p.lastDate = null;
            });
            savePlayers();
            renderDatabaseList();
        }
    });
}

// Clear match counts & Reset priority
const btnClearPoolMatches = document.getElementById('btnClearPoolMatches');
if (btnClearPoolMatches) {
    btnClearPoolMatches.addEventListener('click', () => {
        if (confirm('確定要清空所有人的當日上場次數嗎？')) {
            const unplayedVal = getUnplayedPriority();
            players.forEach(p => {
                p.matchCount = 0;
                p.priority = unplayedVal;
                p.customPriority = false;
                p.lastPartnerId = null;
                p.lastCourtPlayerIds = null;
            });
            if (matchState && matchState.pool) {
                matchState.pool.forEach(p => {
                    p.matchCount = 0;
                    p.priority = unplayedVal;
                    p.customPriority = false;
                    p.lastPartnerId = null;
                    p.lastCourtPlayerIds = null;
                });
            }
            savePlayers();
            renderMatchUI(true);
        }
    });
}

const btnClearRestStatus = document.getElementById('btnClearRestStatus');
if (btnClearRestStatus) {
    btnClearRestStatus.addEventListener('click', () => {
        const unplayedVal = getUnplayedPriority();
        const maxWaitingVal = getMaxWaitingPriority();
        if (confirm(`確定要重設【候補區】球員的等待優先值嗎？\n・未打過者恢復最高值（${unplayedVal} 點）\n・已打過者重設為封頂上限（${maxWaitingVal} 點）\n(正在場上打球者不受影響，下場時正常歸 0 休息)`)) {
            if (matchState && matchState.pool) {
                matchState.pool.forEach(p => {
                    const isUnplayed = !p.matchCount || p.matchCount === 0;
                    p.priority = isUnplayed ? unplayedVal : maxWaitingVal;
                    p.customPriority = false;
                    const globalP = players.find(x => x.id === p.id);
                    if (globalP) {
                        globalP.priority = p.priority;
                        globalP.customPriority = false;
                    }
                });
            }
            savePlayers();
            renderMatchUI(true);
            renderDatabaseList();
        }
    });
}

// Edit Players Toggle
const btnEditPlayersToggle = document.getElementById('btnEditPlayersToggle');
if (btnEditPlayersToggle) {
    btnEditPlayersToggle.addEventListener('click', () => {
        isPlayerEditMode = !isPlayerEditMode;
        if (isPlayerEditMode) {
            btnEditPlayersToggle.classList.add('primary-btn');
            btnEditPlayersToggle.classList.remove('outline-btn');
            btnEditPlayersToggle.innerHTML = `<i data-lucide="check"></i> 完成編輯`;
        } else {
            btnEditPlayersToggle.classList.remove('primary-btn');
            btnEditPlayersToggle.classList.add('outline-btn');
            btnEditPlayersToggle.innerHTML = `<i data-lucide="edit"></i> 進入編輯`;
        }
        lucide.createIcons();
        renderDatabaseList();
    });
}

// Global Clear Buttons in Match View
const btnClear = document.getElementById('btnClear');
if (btnClear) {
    btnClear.addEventListener('click', () => {
        matchState = readStateFromDOM();
        matchState.courts.forEach(c => {
            if (c.teamA[0]) matchState.pool.push(c.teamA[0]);
            if (c.teamA[1]) matchState.pool.push(c.teamA[1]);
            if (c.teamB[0]) matchState.pool.push(c.teamB[0]);
            if (c.teamB[1]) matchState.pool.push(c.teamB[1]);
            c.teamA = [null, null];
            c.teamB = [null, null];
        });
        renderMatchUI(true);
    });
}

const btnClearActive = document.getElementById('btnClearActive');
if (btnClearActive) {
    btnClearActive.addEventListener('click', () => {
        matchState = readStateFromDOM();
        matchState.activeCourts.forEach(c => {
            if (c.teamA[0]) matchState.pool.push(c.teamA[0]);
            if (c.teamA[1]) matchState.pool.push(c.teamA[1]);
            if (c.teamB[0]) matchState.pool.push(c.teamB[0]);
            if (c.teamB[1]) matchState.pool.push(c.teamB[1]);
            c.teamA = [null, null];
            c.teamB = [null, null];
        });
        renderMatchUI(true);
    });
}

// ----------------------------------------------------
// PLAYER LIST RENDERING (出席者排最前面 + 明顯標示)
// ----------------------------------------------------
function renderDatabaseList() {
    playerListEl.innerHTML = '';
    totalPlayerCountEl.textContent = `${players.length} 人`;

    let sorted = [...players];
    if (playerSearchText) {
        sorted = sorted.filter(p => p.name.toLowerCase().includes(playerSearchText));
    }

    // 1. 出席者排到最前面
    // 2. 次層級依 playerSortMode
    sorted.sort((a, b) => {
        const aPlay = a.isPlaying ? 1 : 0;
        const bPlay = b.isPlaying ? 1 : 0;
        if (aPlay !== bPlay) {
            return bPlay - aPlay; // 1 (出席) 排在 0 (未出席) 前面
        }
        if (playerSortMode === 'levelDesc') {
            return b.level - a.level;
        } else if (playerSortMode === 'levelAsc') {
            return a.level - b.level;
        } else if (playerSortMode === 'name') {
            return a.name.localeCompare(b.name, 'zh-TW');
        }
        return 0;
    });

    sorted.forEach(p => {
        const li = document.createElement('li');
        li.className = 'player-item' + (p.isPlaying ? ' is-attending' : '');

        const employeeTag = p.isEmployee ? `<span style="font-size: 0.7rem; background: rgba(59,130,246,0.2); color: #3b82f6; padding: 0.1rem 0.3rem; border-radius: 0.2rem; margin-left: 0.25rem;">員工</span>` : '';
        const attendancePill = p.isPlaying ? `<span class="attendance-pill"><i data-lucide="check"></i> 出席</span>` : '';

        let editActions = '';
        let nameHtml = `<span>${p.name}${employeeTag}${attendancePill}</span>`;
        let levelHtml = `<span class="level-badge level-${p.level}">${p.level}</span>`;
        let attendanceCheckbox = `<input type="checkbox" style="width: 20px; height: 20px; accent-color: var(--primary); cursor: pointer;" 
                       onchange="toggleIsPlaying('${p.id}', this.checked)" ${p.isPlaying ? 'checked' : ''} title="今日出席">`;
        let employeeCheckbox = `<label style="display:flex; align-items:center; gap:0.25rem; margin-left:0.5rem; cursor:pointer;">
                            <input type="checkbox" onchange="toggleEmployee('${p.id}', this.checked)" ${p.isEmployee ? 'checked' : ''} style="width:12px;height:12px;"> 員工
                        </label>`;

        if (isPlayerEditMode) {
            nameHtml = `<input type="text" class="player-edit-name-input" value="${p.name}" onchange="updatePlayerName('${p.id}', this.value)" placeholder="姓名">`;
            levelHtml = `<input type="number" class="player-edit-level-input" min="1" max="8" value="${p.level}" onchange="updatePlayerLevel('${p.id}', this.value)" title="等級 (1-8)">`;
            attendanceCheckbox = '';
            employeeCheckbox = '';
            editActions = `
                <button class="player-delete-btn" onclick="deletePlayer('${p.id}')" title="刪除此球員">
                    <i data-lucide="trash-2"></i>
                </button>
            `;
        }

        li.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.65rem; flex: 1 1 0; min-width: 0;">
                ${attendanceCheckbox}
                <div class="player-info-detailed" style="flex: 1 1 0; min-width: 0;">
                    <div class="player-main-line" style="display: flex; gap: 0.5rem; align-items: center; width: 100%;">
                        ${levelHtml}
                        ${nameHtml}
                    </div>
                    <div class="player-stats" style="align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.72rem; gap: 0.5rem; margin-top: 0.2rem; min-width: 0;">
                        <span>出席: ${p.attendance || 0} 次</span>
                        <span>上次: ${p.lastDate || '無'}</span>
                        ${employeeCheckbox}
                    </div>
                </div>
            </div>
            ${editActions}
        `;
        playerListEl.appendChild(li);
    });
    lucide.createIcons();
    updatePlayingCount();
}

function updatePlayingCount() {
    const count = players.filter(p => p.isPlaying).length;
    playingCountEl.textContent = `上場: ${count} 人`;
}

// ----------------------------------------------------
// STATE SYNCHRONIZATION FOR MATCH UI
// ----------------------------------------------------
function readStateFromDOM() {
    const activeCourts = [];
    if (activeCourtsContainer && activeCourtsContainer.children.length > 0) {
        document.querySelectorAll('#activeCourtsContainer .court').forEach((courtEl, idx) => {
            const nameInput = courtEl.querySelector('.court-name-input');
            const name = nameInput ? nameInput.value.trim() : (`場地 ${idx + 1}`);
            const isSingles = courtEl.dataset.issingles === 'true';
            const teamA_slots = courtEl.querySelectorAll('.team:first-child .slot');
            const teamB_slots = courtEl.querySelectorAll('.team:last-child .slot');

            const getP = (slot) => {
                if (!slot) return null;
                const pEl = slot.querySelector('.draggable-player');
                if (!pEl) return null;
                return players.find(x => x.id === pEl.dataset.id) || null;
            };

            activeCourts.push({
                name,
                isSingles,
                teamA: [getP(teamA_slots[0]), isSingles ? null : getP(teamA_slots[1])],
                teamB: [getP(teamB_slots[0]), isSingles ? null : getP(teamB_slots[1])]
            });
        });
    }

    const courts = [];
    if (courtsContainer && courtsContainer.children.length > 0) {
        document.querySelectorAll('#preCourtsContainer .court').forEach((courtEl, idx) => {
            const nameSpan = courtEl.querySelector('.court-header span');
            const name = nameSpan ? nameSpan.textContent.trim() : (`預備場 ${idx + 1}`);
            const isSingles = courtEl.dataset.issingles === 'true';
            const teamA_slots = courtEl.querySelectorAll('.team:first-child .slot');
            const teamB_slots = courtEl.querySelectorAll('.team:last-child .slot');

            const getP = (slot) => {
                if (!slot) return null;
                const pEl = slot.querySelector('.draggable-player');
                if (!pEl) return null;
                return players.find(x => x.id === pEl.dataset.id) || null;
            };

            courts.push({
                name,
                isSingles,
                teamA: [getP(teamA_slots[0]), isSingles ? null : getP(teamA_slots[1])],
                teamB: [getP(teamB_slots[0]), isSingles ? null : getP(teamB_slots[1])]
            });
        });
    }

    const pool = [];
    document.querySelectorAll('#restingPlayersList .draggable-player:not(.ghost-player)').forEach(pEl => {
        const p = players.find(x => x.id === pEl.dataset.id);
        if (p) pool.push(p);
    });

    return {
        activeCourts: activeCourts.length ? activeCourts : (matchState.activeCourts || []),
        courts: courts.length ? courts : (matchState.courts || []),
        pool: pool.length ? pool : (matchState.pool || [])
    };
}

function syncPoolWithPlayers() {
    const activeMap = new Map();
    players.forEach(p => {
        if (p.isPlaying !== false) activeMap.set(p.id, p);
    });
    matchState.activeCourts = matchState.activeCourts || [];
    matchState.courts = matchState.courts || [];
    matchState.pool = matchState.pool || [];

    for (let c of matchState.activeCourts) {
        c.teamA = c.teamA.map(p => (p && activeMap.has(p.id)) ? activeMap.get(p.id) : null);
        c.teamB = c.teamB.map(p => (p && activeMap.has(p.id)) ? activeMap.get(p.id) : null);
    }
    for (let c of matchState.courts) {
        c.teamA = c.teamA.map(p => (p && activeMap.has(p.id)) ? activeMap.get(p.id) : null);
        c.teamB = c.teamB.map(p => (p && activeMap.has(p.id)) ? activeMap.get(p.id) : null);
    }

    matchState.pool = matchState.pool
        .filter(p => p && activeMap.has(p.id))
        .map(p => activeMap.get(p.id));

    const assignedIds = new Set();
    matchState.activeCourts.forEach(c => {
        c.teamA.forEach(p => p && assignedIds.add(p.id));
        c.teamB.forEach(p => p && assignedIds.add(p.id));
    });
    matchState.courts.forEach(c => {
        c.teamA.forEach(p => p && assignedIds.add(p.id));
        c.teamB.forEach(p => p && assignedIds.add(p.id));
    });
    matchState.pool.forEach(p => p && assignedIds.add(p.id));

    players.forEach(p => {
        if (p.isPlaying !== false && !assignedIds.has(p.id)) {
            matchState.pool.push(p);
        }
    });
}

function syncStateBeforeMatchView() {
    matchState = readStateFromDOM();
    syncPoolWithPlayers();
    renderMatchUI(true);
}

function updateCourtsArray(arr, newCount, poolRef, prefix = '場地 ') {
    while (arr.length > newCount) {
        const removed = arr.pop();
        if (removed) {
            removed.teamA.forEach(p => p && poolRef.push(p));
            removed.teamB.forEach(p => p && poolRef.push(p));
        }
    }
    while (arr.length < newCount) {
        const idx = arr.length + 1;
        arr.push({
            name: `${prefix}${idx}`,
            isSingles: false,
            teamA: [null, null],
            teamB: [null, null]
        });
    }
}

// ----------------------------------------------------
// COURT MODES & CLEARING
// ----------------------------------------------------
window.toggleActiveCourtMode = (courtIndex) => {
    matchState = readStateFromDOM();
    const court = matchState.activeCourts[courtIndex];
    if (!court) return;
    court.isSingles = !court.isSingles;

    if (court.isSingles) {
        if (court.teamA[1]) matchState.pool.push(court.teamA[1]);
        if (court.teamB[1]) matchState.pool.push(court.teamB[1]);
        court.teamA[1] = null;
        court.teamB[1] = null;
    }
    renderMatchUI(true);
};

window.toggleCourtMode = (courtIndex) => {
    matchState = readStateFromDOM();
    const court = matchState.courts[courtIndex];
    if (!court) return;
    court.isSingles = !court.isSingles;

    if (court.isSingles) {
        if (court.teamA[1]) matchState.pool.push(court.teamA[1]);
        if (court.teamB[1]) matchState.pool.push(court.teamB[1]);
        court.teamA[1] = null;
        court.teamB[1] = null;
    }
    renderMatchUI(true);
};

window.clearActiveCourt = (courtIndex) => {
    matchState = readStateFromDOM();
    const court = matchState.activeCourts[courtIndex];
    if (court) {
        if (court.teamA[0]) matchState.pool.push(court.teamA[0]);
        if (court.teamA[1]) matchState.pool.push(court.teamA[1]);
        if (court.teamB[0]) matchState.pool.push(court.teamB[0]);
        if (court.teamB[1]) matchState.pool.push(court.teamB[1]);
        court.teamA = [null, null];
        court.teamB = [null, null];
        renderMatchUI(true);
    }
};

window.clearCourt = (courtIndex) => {
    matchState = readStateFromDOM();
    const court = matchState.courts[courtIndex];
    if (court) {
        if (court.teamA[0]) matchState.pool.push(court.teamA[0]);
        if (court.teamA[1]) matchState.pool.push(court.teamA[1]);
        if (court.teamB[0]) matchState.pool.push(court.teamB[0]);
        if (court.teamB[1]) matchState.pool.push(court.teamB[1]);
        court.teamA = [null, null];
        court.teamB = [null, null];
        renderMatchUI(true);
    }
};

function recordCourtPartners(court) {
    if (!court) return;
    const allCourtPlayers = [];
    if (court.teamA[0]) allCourtPlayers.push(court.teamA[0]);
    if (court.teamA[1]) allCourtPlayers.push(court.teamA[1]);
    if (court.teamB[0]) allCourtPlayers.push(court.teamB[0]);
    if (court.teamB[1]) allCourtPlayers.push(court.teamB[1]);
    const courtPlayerIds = allCourtPlayers.map(p => p.id);

    allCourtPlayers.forEach(p => {
        const others = courtPlayerIds.filter(id => id !== p.id);
        p.lastCourtPlayerIds = others;
        const globalP = players.find(x => x.id === p.id);
        if (globalP) globalP.lastCourtPlayerIds = others;
    });

    if (!court.isSingles) {
        if (court.teamA[0] && court.teamA[1]) {
            const p0 = players.find(x => x.id === court.teamA[0].id);
            const p1 = players.find(x => x.id === court.teamA[1].id);
            if (p0) p0.lastPartnerId = court.teamA[1].id;
            if (p1) p1.lastPartnerId = court.teamA[0].id;
            court.teamA[0].lastPartnerId = court.teamA[1].id;
            court.teamA[1].lastPartnerId = court.teamA[0].id;
        }
        if (court.teamB[0] && court.teamB[1]) {
            const p2 = players.find(x => x.id === court.teamB[0].id);
            const p3 = players.find(x => x.id === court.teamB[1].id);
            if (p2) p2.lastPartnerId = court.teamB[1].id;
            if (p3) p3.lastPartnerId = court.teamB[0].id;
            court.teamB[0].lastPartnerId = court.teamB[1].id;
            court.teamB[1].lastPartnerId = court.teamB[0].id;
        }
    }
}

// ----------------------------------------------------
// FINISH ACTIVE MATCH & PUSH TO ACTIVE COURT
// (規則 1：上場中場地按下場，優先值才歸 0，候補區每過一場 +step)
// (排到預備場不算真正上場，不會清空優先值)
// ----------------------------------------------------
window.finishActiveMatch = (courtIndex) => {
    matchState = readStateFromDOM();
    const court = matchState.activeCourts[courtIndex];
    if (!court) return;

    const playersInCourt = [];
    if (court.teamA[0]) playersInCourt.push(court.teamA[0]);
    if (court.teamA[1]) playersInCourt.push(court.teamA[1]);
    if (court.teamB[0]) playersInCourt.push(court.teamB[0]);
    if (court.teamB[1]) playersInCourt.push(court.teamB[1]);

    if (playersInCourt.length === 0) {
        alert('該場地目前沒有任何球員！');
        return;
    }

    const courtName = court.name || (`場地 ${courtIndex + 1}`);
    const isFull = court.isSingles ? (playersInCourt.length === 2) : (playersInCourt.length === 4);
    const playerNames = playersInCourt.map(p => p.name).join('、');

    if (isFull) {
        if (matchConfig.confirmFinishMatch) {
            if (!confirm(`【${courtName}】確定比賽已打完並下場結算？\n\n球員：${playerNames}\n・球員場次 +1\n・球員優先值歸 0 休息\n・候補區等待者累積點數\n\n（若只是要換人重排不計分，請按「取消」後點擊「清空」）`)) {
                return;
            }
        }

        recordAttendance();
        recordCourtPartners(court);

        // 1. 候補區等待中的球員增加優先值 (最高上限為 場地數 x 點數，一場未打者維持 (場地數+1) x 點數)
        const step = (matchConfig && matchConfig.priorityStep) ? matchConfig.priorityStep : 100;
        const maxWaitingPrio = getMaxWaitingPriority();
        const unplayedPrio = getUnplayedPriority();

        if (matchConfig.enablePriority) {
            matchState.pool.forEach(poolP => {
                const globalP = players.find(x => x.id === poolP.id);
                const isUnplayed = !poolP.matchCount || poolP.matchCount === 0;
                const curPrio = getPlayerPriority(poolP);
                if (poolP.customPriority) {
                    const cap = isUnplayed ? Math.max(unplayedPrio, curPrio) : Math.max(maxWaitingPrio, curPrio);
                    poolP.priority = Math.min(curPrio + step, cap);
                } else if (isUnplayed) {
                    poolP.priority = unplayedPrio;
                } else {
                    poolP.priority = Math.min(curPrio + step, maxWaitingPrio);
                }
                if (globalP) globalP.priority = poolP.priority;
            });
        }

        // 2. 剛下場的球員：場次 +1，優先值歸 0 休息
        playersInCourt.forEach(p => {
            const globalPlayer = players.find(x => x.id === p.id);
            if (globalPlayer) {
                globalPlayer.matchCount = (globalPlayer.matchCount || 0) + 1;
                globalPlayer.priority = 0;
                globalPlayer.customPriority = false;
            }
            if (p !== globalPlayer) {
                p.matchCount = (p.matchCount || 0) + 1;
            }
            p.priority = 0;
            p.customPriority = false;
            matchState.pool.push(globalPlayer || p);
        });
    } else {
        // 未打滿即結束：不計場次與優先值
        if (matchConfig.confirmFinishMatch) {
            if (!confirm(`【${courtName}】人數未滿，將直接退回候補區（不計場次與優先值）？`)) {
                return;
            }
        }
        playersInCourt.forEach(p => {
            const globalPlayer = players.find(x => x.id === p.id);
            matchState.pool.push(globalPlayer || p);
        });
    }

    court.teamA = [null, null];
    court.teamB = [null, null];

    savePlayers();
    renderMatchUI(true);
};

window.pushToActiveCourt = (preIdx, activeIdxStr) => {
    const activeIdx = parseInt(activeIdxStr);
    if (isNaN(activeIdx)) return;

    matchState = readStateFromDOM();
    const preCourt = matchState.courts[preIdx];
    const activeCourt = matchState.activeCourts[activeIdx];
    if (!preCourt || !activeCourt) return;

    // 檢查預備場是否有人
    const prePlayers = [];
    if (preCourt.teamA[0]) prePlayers.push(preCourt.teamA[0]);
    if (preCourt.teamA[1]) prePlayers.push(preCourt.teamA[1]);
    if (preCourt.teamB[0]) prePlayers.push(preCourt.teamB[0]);
    if (preCourt.teamB[1]) prePlayers.push(preCourt.teamB[1]);

    if (prePlayers.length === 0) {
        alert('預備場目前沒有任何球員可推上場！');
        return;
    }

    // 檢查目標場地目前是否有人
    const activePlayers = [];
    if (activeCourt.teamA[0]) activePlayers.push(activeCourt.teamA[0]);
    if (activeCourt.teamA[1]) activePlayers.push(activeCourt.teamA[1]);
    if (activeCourt.teamB[0]) activePlayers.push(activeCourt.teamB[0]);
    if (activeCourt.teamB[1]) activePlayers.push(activeCourt.teamB[1]);

    if (activePlayers.length > 0) {
        // 目標場地已有人：跳出防呆視窗確認處理方式
        showPushConfirmModal({
            courtName: activeCourt.name || (`場地 ${activeIdx + 1}`),
            activePlayers,
            onFinish: () => {
                executePushToActive(preIdx, activeIdx, 'finish');
            },
            onClearOnly: () => {
                executePushToActive(preIdx, activeIdx, 'clearOnly');
            }
        });
    } else {
        // 目標場地為空：直接推入
        executePushToActive(preIdx, activeIdx, 'none');
    }
};

function executePushToActive(preIdx, activeIdx, mode) {
    matchState = readStateFromDOM();
    const preCourt = matchState.courts[preIdx];
    const activeCourt = matchState.activeCourts[activeIdx];
    if (!preCourt || !activeCourt) return;

    const activePlayers = [];
    if (activeCourt.teamA[0]) activePlayers.push(activeCourt.teamA[0]);
    if (activeCourt.teamA[1]) activePlayers.push(activeCourt.teamA[1]);
    if (activeCourt.teamB[0]) activePlayers.push(activeCourt.teamB[0]);
    if (activeCourt.teamB[1]) activePlayers.push(activeCourt.teamB[1]);

    if (activePlayers.length > 0) {
        if (mode === 'finish') {
            // 打完下場：紀錄出席、搭檔、場次+1、優先值歸0、候補區+step
            recordAttendance();
            recordCourtPartners(activeCourt);

            // 候補區等待中的球員增加優先值
            const step = (matchConfig && matchConfig.priorityStep) ? matchConfig.priorityStep : 100;
            const maxWaitingPrio = getMaxWaitingPriority();
            const unplayedPrio = getUnplayedPriority();

            if (matchConfig.enablePriority) {
                matchState.pool.forEach(poolP => {
                    const globalP = players.find(x => x.id === poolP.id);
                    const isUnplayed = !poolP.matchCount || poolP.matchCount === 0;
                    const curPrio = getPlayerPriority(poolP);
                    if (poolP.customPriority) {
                        const cap = isUnplayed ? Math.max(unplayedPrio, curPrio) : Math.max(maxWaitingPrio, curPrio);
                        poolP.priority = Math.min(curPrio + step, cap);
                    } else if (isUnplayed) {
                        poolP.priority = unplayedPrio;
                    } else {
                        poolP.priority = Math.min(curPrio + step, maxWaitingPrio);
                    }
                    if (globalP) globalP.priority = poolP.priority;
                });
            }

            activePlayers.forEach(p => {
                const globalPlayer = players.find(x => x.id === p.id);
                if (globalPlayer) {
                    globalPlayer.matchCount = (globalPlayer.matchCount || 0) + 1;
                    globalPlayer.priority = 0;
                    globalPlayer.customPriority = false;
                }
                if (p !== globalPlayer) {
                    p.matchCount = (p.matchCount || 0) + 1;
                }
                p.priority = 0;
                p.customPriority = false;
                matchState.pool.push(globalPlayer || p);
            });
        } else if (mode === 'clearOnly') {
            // 僅清除換人：直接退回候補區，不加場次、不變更優先值
            activePlayers.forEach(p => {
                const globalPlayer = players.find(x => x.id === p.id);
                matchState.pool.push(globalPlayer || p);
            });
        }
    }

    // 將預備場球員推至上場場地
    activeCourt.teamA = [...preCourt.teamA];
    activeCourt.teamB = [...preCourt.teamB];
    activeCourt.isSingles = preCourt.isSingles;

    // 後續預備場依序向前遞補 (例如預備場2遞補上預備場1，預備場3遞補上預備場2，以此類推)
    for (let i = preIdx; i < matchState.courts.length - 1; i++) {
        matchState.courts[i].teamA = [...matchState.courts[i + 1].teamA];
        matchState.courts[i].teamB = [...matchState.courts[i + 1].teamB];
        matchState.courts[i].isSingles = matchState.courts[i + 1].isSingles;
    }
    const lastPreIdx = matchState.courts.length - 1;
    matchState.courts[lastPreIdx].teamA = [null, null];
    matchState.courts[lastPreIdx].teamB = [null, null];
    matchState.courts[lastPreIdx].isSingles = false;

    savePlayers();
    renderMatchUI(true);
}

function showPushConfirmModal(params) {
    const modal = document.getElementById('pushConfirmModal');
    const desc = document.getElementById('pushModalDesc');
    const list = document.getElementById('pushModalPlayersList');
    const btnFinish = document.getElementById('btnPushModalFinish');
    const btnClearOnly = document.getElementById('btnPushModalClearOnly');
    const btnCancel = document.getElementById('btnPushModalCancel');
    const btnClose = document.getElementById('btnClosePushModal');

    if (!modal) {
        const isFinish = confirm(`【${params.courtName}】目前已有球員在場上！\n\n點選【確定】：視為「打完下場」(計入場次、優先值歸 0)\n點選【取消】：視為「僅清除換人」(不計場次、退回候補區)`);
        if (isFinish) params.onFinish();
        else params.onClearOnly();
        return;
    }

    desc.innerHTML = `您正準備將預備場球員推入 <b>【${params.courtName}】</b>，但該場地目前已有球員在場上：`;

    const names = params.activePlayers.map(p => `<span style="display: inline-block; background: rgba(255,255,255,0.08); padding: 0.15rem 0.45rem; border-radius: 0.3rem; margin: 0.15rem;"><b>${p.name}</b> (★${p.level})</span>`).join(' ');
    list.innerHTML = `<div style="color: var(--text-muted); margin-bottom: 0.35rem; font-size: 0.8rem;">原場內球員：</div>${names}`;

    const hide = () => {
        modal.style.display = 'none';
        btnFinish.onclick = null;
        btnClearOnly.onclick = null;
        btnCancel.onclick = null;
        if (btnClose) btnClose.onclick = null;
    };

    btnFinish.onclick = () => {
        hide();
        params.onFinish();
    };

    btnClearOnly.onclick = () => {
        hide();
        params.onClearOnly();
    };

    btnCancel.onclick = () => {
        hide();
    };
    if (btnClose) {
        btnClose.onclick = () => {
            hide();
        };
    }

    modal.style.display = 'flex';
    lucide.createIcons();
}

// ----------------------------------------------------
// INTELLIGENT MATCHMAKING (分層規則演算法)
// ----------------------------------------------------
function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function pickOneMatch(pool, neededSize, maxTeamDiff, maxPlayerGap, avoidRecentPartner, avoidSameCourt) {
    if (pool.length < neededSize) return null;

    const avoidSame = (avoidSameCourt !== undefined) ? avoidSameCourt : ((matchConfig && matchConfig.avoidSameCourt !== undefined) ? matchConfig.avoidSameCourt : true);

    let candidatePool = [...pool];
    candidatePool = shuffleArray(candidatePool);

    // 依設定進行候補排序：
    // 規則 1 (等待優先值)：優先值高者排在前面
    // 規則 2 (今日場次平衡)：若開啟，同優先值內場次少者優先
    candidatePool.sort((a, b) => {
        if (matchConfig.enablePriority) {
            const prioA = getPlayerPriority(a);
            const prioB = getPlayerPriority(b);
            if (prioB !== prioA) {
                return prioB - prioA;
            }
        }
        if (matchConfig.balanceMatchCount) {
            const mA = a.matchCount || 0;
            const mB = b.matchCount || 0;
            if (mA !== mB) {
                return mA - mB;
            }
        }
        return 0;
    });

    if (neededSize === 2) {
        // 單打模式
        const searchPool = candidatePool.length > 16 ? candidatePool.slice(0, 16) : candidatePool;
        const pairs = [];
        for (let i = 0; i < searchPool.length; i++) {
            for (let j = i + 1; j < searchPool.length; j++) {
                const diff = Math.abs(searchPool[i].level - searchPool[j].level);
                const gapCheck = (maxPlayerGap === 0) || (diff <= maxPlayerGap);
                const diffCheck = (maxTeamDiff === 0) || (diff <= maxTeamDiff);
                const sameCourt = Boolean(searchPool[i].lastCourtPlayerIds && searchPool[i].lastCourtPlayerIds.includes(searchPool[j].id));
                if (avoidSame && sameCourt) continue;
                if (gapCheck && diffCheck) {
                    const totalPriority = getPlayerPriority(searchPool[i]) + getPlayerPriority(searchPool[j]);
                    const totalMatches = (searchPool[i].matchCount || 0) + (searchPool[j].matchCount || 0);
                    pairs.push({
                        diff,
                        totalPriority,
                        totalMatches,
                        teamA: [searchPool[i], null],
                        teamB: [searchPool[j], null]
                    });
                }
            }
        }

        if (pairs.length === 0) {
            if (avoidSame) {
                return pickOneMatch(pool, neededSize, maxTeamDiff, maxPlayerGap, avoidRecentPartner, false);
            }
            if ((maxPlayerGap > 0 && maxPlayerGap < 8) || (maxTeamDiff > 0 && maxTeamDiff < 8)) {
                return pickOneMatch(pool, neededSize, maxTeamDiff === 0 ? 0 : maxTeamDiff + 1, maxPlayerGap === 0 ? 0 : maxPlayerGap + 2, false, false);
            }
            return {
                teamA: [candidatePool[0], null],
                teamB: [candidatePool[1], null]
            };
        }

        pairs.sort((a, b) => {
            if (matchConfig.enablePriority && b.totalPriority !== a.totalPriority) {
                return b.totalPriority - a.totalPriority;
            }
            if (matchConfig.balanceMatchCount && a.totalMatches !== b.totalMatches) {
                return a.totalMatches - b.totalMatches;
            }
            return a.diff - b.diff;
        });

        const bestScore = pairs[0];
        const topPairs = pairs.filter(p => 
            (!matchConfig.enablePriority || p.totalPriority === bestScore.totalPriority) &&
            (!matchConfig.balanceMatchCount || p.totalMatches === bestScore.totalMatches)
        );
        return topPairs[Math.floor(Math.random() * topPairs.length)];
    }

    // 雙打模式 (neededSize === 4)
    const searchPool = candidatePool.length > 20 ? candidatePool.slice(0, 20) : candidatePool;

    function findQuads(currMaxTeamDiff, currMaxPlayerGap, currAvoidPartner, currAvoidSameCourt) {
        const quads = [];
        for (let i = 0; i < searchPool.length; i++) {
            for (let j = i + 1; j < searchPool.length; j++) {
                for (let k = j + 1; k < searchPool.length; k++) {
                    for (let l = k + 1; l < searchPool.length; l++) {
                        const p = [searchPool[i], searchPool[j], searchPool[k], searchPool[l]];
                        const lvls = [p[0].level, p[1].level, p[2].level, p[3].level];
                        const gap = Math.max(...lvls) - Math.min(...lvls);
                        if (currMaxPlayerGap > 0 && gap > currMaxPlayerGap) continue;

                        let sameCourtRepeats = 0;
                        for (let m = 0; m < 4; m++) {
                            for (let n = m + 1; n < 4; n++) {
                                if (p[m].lastCourtPlayerIds && p[m].lastCourtPlayerIds.includes(p[n].id)) {
                                    sameCourtRepeats++;
                                }
                            }
                        }
                        if (currAvoidSameCourt && sameCourtRepeats > 0) continue;

                        const splits = [
                            [[0,1], [2,3]],
                            [[0,2], [1,3]],
                            [[0,3], [1,2]]
                        ];
                        const validSplits = [];
                        for (let s of splits) {
                            const pA1 = p[s[0][0]];
                            const pA2 = p[s[0][1]];
                            const pB1 = p[s[1][0]];
                            const pB2 = p[s[1][1]];
                            const sumA = pA1.level + pA2.level;
                            const sumB = pB1.level + pB2.level;
                            const diff = Math.abs(sumA - sumB);
                            if (currMaxTeamDiff === 0 || diff <= currMaxTeamDiff) {
                                const repA = currAvoidPartner && pA1.lastPartnerId && pA1.lastPartnerId === pA2.id;
                                const repB = currAvoidPartner && pB1.lastPartnerId && pB1.lastPartnerId === pB2.id;
                                validSplits.push({
                                    diff,
                                    isRepeat: Boolean(repA || repB),
                                    teamA: [pA1, pA2],
                                    teamB: [pB1, pB2]
                                });
                            }
                        }

                        if (validSplits.length > 0) {
                            validSplits.sort((a, b) => {
                                if (a.isRepeat !== b.isRepeat) return a.isRepeat ? 1 : -1;
                                return a.diff - b.diff;
                            });
                            const bestDiff = validSplits[0].diff;
                            const bestRepeat = validSplits[0].isRepeat;
                            const topSplits = validSplits.filter(s => s.isRepeat === bestRepeat && s.diff === bestDiff);
                            const chosenSplit = topSplits[Math.floor(Math.random() * topSplits.length)];

                            const totalPriority = getPlayerPriority(p[0]) + getPlayerPriority(p[1]) + getPlayerPriority(p[2]) + getPlayerPriority(p[3]);
                            const totalMatches = (p[0].matchCount || 0) + (p[1].matchCount || 0) + (p[2].matchCount || 0) + (p[3].matchCount || 0);

                            quads.push({
                                match: chosenSplit,
                                totalPriority,
                                totalMatches,
                                hasRepeat: chosenSplit.isRepeat,
                                sameCourtRepeats,
                                avgIndex: i + j + k + l
                            });
                        }
                    }
                }
            }
        }
        return quads;
    }

    let candidates = findQuads(maxTeamDiff, maxPlayerGap, avoidRecentPartner, avoidSame);

    if (candidates.length === 0 && avoidSame) {
        candidates = findQuads(maxTeamDiff, maxPlayerGap, avoidRecentPartner, false);
    }

    if (candidates.length === 0 && avoidRecentPartner) {
        candidates = findQuads(maxTeamDiff, maxPlayerGap, false, false);
    }

    let relaxGap = maxPlayerGap;
    let relaxDiff = maxTeamDiff;
    while (candidates.length === 0 && ((relaxGap > 0 && relaxGap < 10) || (relaxDiff > 0 && relaxDiff < 10))) {
        if (relaxGap > 0) relaxGap += 1;
        if (relaxDiff > 0) relaxDiff += 1;
        candidates = findQuads(relaxDiff, relaxGap, false, false);
    }

    if (candidates.length === 0) {
        return {
            teamA: [candidatePool[0], candidatePool[1]],
            teamB: [candidatePool[2], candidatePool[3]],
            diff: 0
        };
    }

    if (avoidSame) {
        const nonSame = candidates.filter(c => (c.sameCourtRepeats || 0) === 0);
        if (nonSame.length > 0) candidates = nonSame;
    }
    if (avoidRecentPartner) {
        const nonRepeats = candidates.filter(c => !c.hasRepeat);
        if (nonRepeats.length > 0) candidates = nonRepeats;
    }

    candidates.sort((a, b) => {
        if (matchConfig.enablePriority && b.totalPriority !== a.totalPriority) {
            return b.totalPriority - a.totalPriority;
        }
        if (matchConfig.balanceMatchCount && a.totalMatches !== b.totalMatches) {
            return a.totalMatches - b.totalMatches;
        }
        return a.avgIndex - b.avgIndex;
    });

    const bestCand = candidates[0];
    const topCandidates = candidates.filter(c => 
        (!matchConfig.enablePriority || c.totalPriority === bestCand.totalPriority) &&
        (!matchConfig.balanceMatchCount || c.totalMatches === bestCand.totalMatches)
    );

    const picked = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    return picked.match;
}

function getCourtMissingSlots(court) {
    if (!court) return [];
    const missing = [];
    const checkIndices = court.isSingles ? [0] : [0, 1];
    checkIndices.forEach(idx => {
        if (!court.teamA || !court.teamA[idx]) missing.push({ team: 'teamA', idx });
    });
    checkIndices.forEach(idx => {
        if (!court.teamB || !court.teamB[idx]) missing.push({ team: 'teamB', idx });
    });
    return missing;
}

function fillPartialCourt(court, pool, maxTeamDiff, maxPlayerGap, avoidRecentPartner, avoidSameCourt) {
    const missingSlots = getCourtMissingSlots(court);
    const missingCount = missingSlots.length;
    if (missingCount === 0 || !pool || pool.length < missingCount) return pool;

    let sortedPool = [...pool];
    for (let i = sortedPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sortedPool[i], sortedPool[j]] = [sortedPool[j], sortedPool[i]];
    }
    sortedPool.sort((a, b) => {
        if (matchConfig.enablePriority) {
            const pA = getPlayerPriority(a);
            const pB = getPlayerPriority(b);
            if (pB !== pA) return pB - pA;
        }
        if (matchConfig.balanceMatchCount) {
            const mA = a.matchCount || 0;
            const mB = b.matchCount || 0;
            if (mA !== mB) return mA - mB;
        }
        return 0;
    });

    const limit = missingCount === 1 ? sortedPool.length : (missingCount === 2 ? 20 : 14);
    const candPool = sortedPool.slice(0, limit);

    function evaluatePartial(chosenPlayers, currMaxDiff, currMaxGap, currAvoidPartner, currAvoidSame) {
        const simA = court.isSingles ? [court.teamA[0] || null] : [court.teamA[0] || null, court.teamA[1] || null];
        const simB = court.isSingles ? [court.teamB[0] || null] : [court.teamB[0] || null, court.teamB[1] || null];

        missingSlots.forEach((slot, idx) => {
            if (slot.team === 'teamA') simA[slot.idx] = chosenPlayers[idx];
            else simB[slot.idx] = chosenPlayers[idx];
        });

        const allPlayers = [...simA, ...simB].filter(Boolean);
        const lvls = allPlayers.map(p => p.level);
        const gap = Math.max(...lvls) - Math.min(...lvls);
        if (currMaxGap > 0 && gap > currMaxGap) return null;

        const sumA = simA.reduce((acc, p) => acc + (p ? p.level : 0), 0);
        const sumB = simB.reduce((acc, p) => acc + (p ? p.level : 0), 0);
        const diff = Math.abs(sumA - sumB);
        if (currMaxDiff > 0 && diff > currMaxDiff) return null;

        let sameCourtRepeats = 0;
        for (let m = 0; m < allPlayers.length; m++) {
            for (let n = m + 1; n < allPlayers.length; n++) {
                const hitMN = allPlayers[m].lastCourtPlayerIds && allPlayers[m].lastCourtPlayerIds.includes(allPlayers[n].id);
                const hitNM = allPlayers[n].lastCourtPlayerIds && allPlayers[n].lastCourtPlayerIds.includes(allPlayers[m].id);
                if (hitMN || hitNM) sameCourtRepeats++;
            }
        }
        if (currAvoidSame && sameCourtRepeats > 0) return null;

        let repA = false;
        let repB = false;
        if (!court.isSingles) {
            if (simA[0] && simA[1] && simA[0].lastPartnerId && simA[0].lastPartnerId === simA[1].id) repA = true;
            if (simB[0] && simB[1] && simB[0].lastPartnerId && simB[0].lastPartnerId === simB[1].id) repB = true;
        }
        const isRepeat = Boolean(repA || repB);
        if (currAvoidPartner && isRepeat) return null;

        const totalPriority = chosenPlayers.reduce((acc, p) => acc + getPlayerPriority(p), 0);
        const totalMatches = chosenPlayers.reduce((acc, p) => acc + (p.matchCount || 0), 0);

        return {
            chosenPlayers,
            diff,
            isRepeat,
            sameCourtRepeats,
            totalPriority,
            totalMatches
        };
    }

    function searchAssignments(currMaxDiff, currMaxGap, currAvoidPartner, currAvoidSame) {
        const results = [];
        const n = candPool.length;
        if (missingCount === 1) {
            for (let i = 0; i < n; i++) {
                const res = evaluatePartial([candPool[i]], currMaxDiff, currMaxGap, currAvoidPartner, currAvoidSame);
                if (res) { res.avgIndex = i; results.push(res); }
            }
        } else if (missingCount === 2) {
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    if (i === j) continue;
                    const res = evaluatePartial([candPool[i], candPool[j]], currMaxDiff, currMaxGap, currAvoidPartner, currAvoidSame);
                    if (res) { res.avgIndex = i + j; results.push(res); }
                }
            }
        } else if (missingCount === 3) {
            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    if (i === j) continue;
                    for (let k = 0; k < n; k++) {
                        if (k === i || k === j) continue;
                        const res = evaluatePartial([candPool[i], candPool[j], candPool[k]], currMaxDiff, currMaxGap, currAvoidPartner, currAvoidSame);
                        if (res) { res.avgIndex = i + j + k; results.push(res); }
                    }
                }
            }
        }
        return results;
    }

    let candidates = searchAssignments(maxTeamDiff, maxPlayerGap, avoidRecentPartner, avoidSameCourt);
    if (candidates.length === 0 && avoidSameCourt) {
        candidates = searchAssignments(maxTeamDiff, maxPlayerGap, avoidRecentPartner, false);
    }
    if (candidates.length === 0 && avoidRecentPartner) {
        candidates = searchAssignments(maxTeamDiff, maxPlayerGap, false, false);
    }
    let relaxGap = maxPlayerGap;
    let relaxDiff = maxTeamDiff;
    while (candidates.length === 0 && ((relaxGap > 0 && relaxGap < 10) || (relaxDiff > 0 && relaxDiff < 10))) {
        if (relaxGap > 0) relaxGap += 1;
        if (relaxDiff > 0) relaxDiff += 1;
        candidates = searchAssignments(relaxDiff, relaxGap, false, false);
    }

    let pickedChosen = null;
    if (candidates.length === 0) {
        pickedChosen = candPool.slice(0, missingCount);
    } else {
        if (avoidSameCourt) {
            const nonSame = candidates.filter(c => (c.sameCourtRepeats || 0) === 0);
            if (nonSame.length > 0) candidates = nonSame;
        }
        if (avoidRecentPartner) {
            const nonRepeat = candidates.filter(c => !c.isRepeat);
            if (nonRepeat.length > 0) candidates = nonRepeat;
        }
        candidates.sort((a, b) => {
            if (matchConfig.enablePriority && b.totalPriority !== a.totalPriority) {
                return b.totalPriority - a.totalPriority;
            }
            if (matchConfig.balanceMatchCount && a.totalMatches !== b.totalMatches) {
                return a.totalMatches - b.totalMatches;
            }
            if (a.sameCourtRepeats !== b.sameCourtRepeats) {
                return a.sameCourtRepeats - b.sameCourtRepeats;
            }
            if (a.isRepeat !== b.isRepeat) {
                return a.isRepeat ? 1 : -1;
            }
            if (a.diff !== b.diff) {
                return a.diff - b.diff;
            }
            return a.avgIndex - b.avgIndex;
        });

        const best = candidates[0];
        const topCands = candidates.filter(c =>
            (!matchConfig.enablePriority || c.totalPriority === best.totalPriority) &&
            (!matchConfig.balanceMatchCount || c.totalMatches === best.totalMatches) &&
            c.sameCourtRepeats === best.sameCourtRepeats &&
            c.isRepeat === best.isRepeat &&
            c.diff === best.diff
        );
        pickedChosen = topCands[Math.floor(Math.random() * topCands.length)].chosenPlayers;
    }

    const chosenIds = new Set();
    missingSlots.forEach((slot, idx) => {
        const player = pickedChosen[idx] || null;
        if (!court[slot.team]) court[slot.team] = [null, null];
        court[slot.team][slot.idx] = player;
        if (player) chosenIds.add(player.id);
    });
    return pool.filter(p => !chosenIds.has(p.id));
}

function fillCourtsIntelligently(courts, pool) {
    const maxTeamDiff = (matchConfig && matchConfig.maxTeamDiff !== undefined) ? matchConfig.maxTeamDiff : 2;
    const maxPlayerGap = (matchConfig && matchConfig.maxPlayerGap !== undefined) ? matchConfig.maxPlayerGap : 4;
    const avoidPartner = (matchConfig && matchConfig.avoidRecentPartner !== undefined) ? matchConfig.avoidRecentPartner : true;
    const avoidSameCourt = (matchConfig && matchConfig.avoidSameCourt !== undefined) ? matchConfig.avoidSameCourt : true;

    for (let c of courts) {
        const needed = c.isSingles ? 2 : 4;
        const missingSlots = getCourtMissingSlots(c);
        if (missingSlots.length === 0) continue;
        if (pool.length < missingSlots.length) continue;

        if (missingSlots.length === needed) {
            const resultMatch = pickOneMatch(pool, needed, maxTeamDiff, maxPlayerGap, avoidPartner, avoidSameCourt);
            if (resultMatch) {
                if (needed === 2) {
                    c.teamA[0] = resultMatch.teamA[0];
                    c.teamA[1] = null;
                    c.teamB[0] = resultMatch.teamB[0];
                    c.teamB[1] = null;
                    const chosenIds = new Set([resultMatch.teamA[0].id, resultMatch.teamB[0].id]);
                    pool = pool.filter(p => !chosenIds.has(p.id));
                } else {
                    c.teamA[0] = resultMatch.teamA[0];
                    c.teamA[1] = resultMatch.teamA[1];
                    c.teamB[0] = resultMatch.teamB[0];
                    c.teamB[1] = resultMatch.teamB[1];
                    const chosenIds = new Set([
                        resultMatch.teamA[0].id,
                        resultMatch.teamA[1].id,
                        resultMatch.teamB[0].id,
                        resultMatch.teamB[1].id
                    ]);
                    pool = pool.filter(p => !chosenIds.has(p.id));
                }
            }
        } else {
            // 已有部分手動排人：保留既有隊員位置，自動補齊剩餘空位
            pool = fillPartialCourt(c, pool, maxTeamDiff, maxPlayerGap, avoidPartner, avoidSameCourt);
        }
    }
    return pool;
}

function handleGenerate() {
    matchState.courts = matchState.courts || [];
    matchState.activeCourts = matchState.activeCourts || [];
    matchState = readStateFromDOM();
    const targetCourtsArray = matchState.courts.length > 0 ? matchState.courts : matchState.activeCourts;

    let availablePool = [...matchState.pool];

    const unfilledCourts = targetCourtsArray.filter(c => getCourtMissingSlots(c).length > 0);

    if (unfilledCourts.length === 0 && availablePool.length > 0) {
        alert('所有場地皆已排滿球員，請先「清空」或移出球員。');
        return;
    }

    // 優先將已部分排人的場地補齊，再排全空場地
    unfilledCourts.sort((a, b) => getCourtMissingSlots(a).length - getCourtMissingSlots(b).length);
    availablePool = fillCourtsIntelligently(unfilledCourts, availablePool);

    const remainingUnfilled = unfilledCourts.filter(c => getCourtMissingSlots(c).length > 0).length;
    if (remainingUnfilled > 0) {
        alert('安排完畢！但候補人數不足，還有 ' + remainingUnfilled + ' 個場地未排滿。');
    }

    matchState.pool = availablePool;
    renderMatchUI(true);
}

window.autoFillCourt = (courtIndex) => {
    matchState = readStateFromDOM();
    const court = matchState.courts[courtIndex];
    if (!court) return;

    const missingSlots = getCourtMissingSlots(court);
    if (missingSlots.length === 0) {
        alert('此場地已經排滿球員了，若要重排請先清空或移出球員。');
        return;
    }

    let availablePool = [...matchState.pool];
    if (availablePool.length < missingSlots.length) {
        alert(`候補區人數不足（此場地還缺 ${missingSlots.length} 人），無法安排。`);
        return;
    }

    availablePool = fillCourtsIntelligently([court], availablePool);
    matchState.pool = availablePool;
    renderMatchUI(true);
};

window.autoFillActiveCourt = (courtIndex) => {
    matchState = readStateFromDOM();
    const court = matchState.activeCourts[courtIndex];
    if (!court) return;

    const missingSlots = getCourtMissingSlots(court);
    if (missingSlots.length === 0) {
        alert('此場地已經排滿球員了，若要重排請先清空或移出球員。');
        return;
    }

    let availablePool = [...matchState.pool];
    if (availablePool.length < missingSlots.length) {
        alert(`候補區人數不足（此場地還缺 ${missingSlots.length} 人），無法安排。`);
        return;
    }

    availablePool = fillCourtsIntelligently([court], availablePool);
    matchState.pool = availablePool;
    renderMatchUI(true);
};

const btnAutoPre = document.getElementById('btnAutoPre');
if (btnAutoPre) btnAutoPre.addEventListener('click', handleGenerate);

const btnAutoActive = document.getElementById('btnAutoActive');
if (btnAutoActive) btnAutoActive.addEventListener('click', handleGenerate);

// ----------------------------------------------------
// UI RENDERING & DRAG-AND-DROP
// ----------------------------------------------------
function createPlayerEl(p, state) {
    const el = document.createElement('div');
    el.className = 'draggable-player';

    if (state === 'ghost') {
        el.style.opacity = '0.3';
        el.style.cursor = 'not-allowed';
        el.classList.add('ghost-player');
    }

    el.draggable = (state !== 'ghost');
    el.dataset.id = p.id;

    const prio = getPlayerPriority(p);
    const unplayedPrio = getUnplayedPriority();
    let prioClass = 'priority-badge';
    if (prio === 0) prioClass += ' zero';
    else if (prio >= unplayedPrio) prioClass += ' max';

    const prioHtml = (state === 'pool' && matchConfig.enablePriority) ? `<span class="${prioClass}" title="等待優先值（點擊修改狀態）">⚡${prio}</span>` : '';
    const matchCountHtml = (state === 'pool' || state === 'ghost') ? `<span class="match-count-badge" title="${state === 'pool' ? '今日場數（點擊修改狀態）' : '今日場數'}">${p.matchCount || 0}場</span>` : '';

    el.innerHTML = `
        <span class="level-badge level-${p.level}">${p.level}</span>
        <span class="player-name">${p.name}</span>
        ${prioHtml}
        ${matchCountHtml}
    `;

    if (state !== 'ghost') {
        if (state === 'pool') {
            // 方案 A：點擊候補區球員卡上的「⚡優先值」或「X場」標籤直接開啟狀態編輯欄（不與單點換位/拖曳衝突）
            el.querySelectorAll('.priority-badge, .match-count-badge').forEach(badge => {
                badge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openPlayerStatusModal(p.id);
                });
            });
            // 電腦版雙擊卡片亦可開啟狀態編輯欄
            el.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                openPlayerStatusModal(p.id);
            });
        }

        el.addEventListener('dragstart', (e) => {
            draggedPlayerId = p.id;
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => el.style.opacity = '0.5', 0);
        });
        el.addEventListener('dragend', () => {
            draggedPlayerId = null;
            el.style.opacity = '1';
            removeHighlights();
        });

        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (clickedPlayerId === p.id) {
                clickedPlayerId = null;
                el.classList.remove('selected-click');
            } else {
                if (clickedPlayerId) {
                    swapPlayersInDOM(clickedPlayerId, p.id);
                    clickedPlayerId = null;
                    removeHighlights();
                } else {
                    removeHighlights();
                    clickedPlayerId = p.id;
                    el.classList.add('selected-click');
                }
            }
        });

        // --- 手機與平板觸控拖曳支援 (解決行動裝置滑動會拉扯視窗/無法拖曳的問題) ---
        let touchStartX = 0;
        let touchStartY = 0;
        let isTouchDragging = false;
        let touchStartedOnBadge = false;
        let touchAvatar = null;

        el.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            touchStartedOnBadge = Boolean(state === 'pool' && e.target.closest('.priority-badge, .match-count-badge'));
            if (touchStartedOnBadge) return;
            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            isTouchDragging = false;
        }, { passive: true });

        el.addEventListener('touchmove', (e) => {
            if (e.touches.length !== 1 || touchStartedOnBadge) return;
            const touch = e.touches[0];
            const dx = touch.clientX - touchStartX;
            const dy = touch.clientY - touchStartY;

            // 超過 8px 判定為開始拖曳
            if (!isTouchDragging && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
                isTouchDragging = true;
                touchAvatar = el.cloneNode(true);
                touchAvatar.classList.add('touch-drag-avatar');
                touchAvatar.style.width = el.offsetWidth + 'px';
                touchAvatar.style.height = el.offsetHeight + 'px';
                touchAvatar.style.left = touch.clientX + 'px';
                touchAvatar.style.top = touch.clientY + 'px';
                document.body.appendChild(touchAvatar);
                el.style.opacity = '0.35';
            }

            if (isTouchDragging) {
                // 阻止瀏覽器預設滾動，避免手機畫面拉扯跳動
                if (e.cancelable) e.preventDefault();
                if (touchAvatar) {
                    touchAvatar.style.left = touch.clientX + 'px';
                    touchAvatar.style.top = touch.clientY + 'px';
                }

                // 偵測手指正下方對應的位置並標註高亮
                const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
                document.querySelectorAll('.slot.drag-over').forEach(s => s.classList.remove('drag-over'));
                if (elemBelow) {
                    const slot = elemBelow.closest('.slot');
                    if (slot) {
                        slot.classList.add('drag-over');
                    }
                }
            }
        }, { passive: false });

        const handleTouchEnd = (e) => {
            if (isTouchDragging) {
                isTouchDragging = false;
                el.style.opacity = '1';
                document.querySelectorAll('.slot.drag-over').forEach(s => s.classList.remove('drag-over'));

                if (touchAvatar) {
                    touchAvatar.remove();
                    touchAvatar = null;
                }

                const lastTouch = e.changedTouches ? e.changedTouches[0] : null;
                if (lastTouch) {
                    const dropTarget = document.elementFromPoint(lastTouch.clientX, lastTouch.clientY);
                    if (dropTarget) {
                        const targetSlot = dropTarget.closest('.slot');
                        const targetPool = dropTarget.closest('#restingPlayersList');

                        if (targetSlot) {
                            const existingPlayerEl = targetSlot.querySelector('.draggable-player');
                            if (existingPlayerEl && existingPlayerEl.dataset.id !== p.id) {
                                swapPlayersInDOM(p.id, existingPlayerEl.dataset.id);
                            } else if (!existingPlayerEl) {
                                movePlayerInDOM(p.id, targetSlot);
                            }
                        } else if (targetPool && state !== 'pool') {
                            movePlayerInDOM(p.id, restingPlayersList);
                        }
                    }
                }
            } else {
                if (touchAvatar) {
                    touchAvatar.remove();
                    touchAvatar = null;
                }
                el.style.opacity = '1';
            }
        };

        el.addEventListener('touchend', handleTouchEnd);
        el.addEventListener('touchcancel', () => {
            isTouchDragging = false;
            el.style.opacity = '1';
            if (touchAvatar) {
                touchAvatar.remove();
                touchAvatar = null;
            }
            document.querySelectorAll('.slot.drag-over').forEach(s => s.classList.remove('drag-over'));
        });
    }

    return el;
}

function removeHighlights() {
    document.querySelectorAll('.selected-click').forEach(el => el.classList.remove('selected-click'));
}

function setupSlot(slotEl) {
    slotEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        slotEl.classList.add('drag-over');
    });
    slotEl.addEventListener('dragleave', () => {
        slotEl.classList.remove('drag-over');
    });

    slotEl.addEventListener('drop', (e) => {
        e.preventDefault();
        slotEl.classList.remove('drag-over');
        if (draggedPlayerId) {
            movePlayerInDOM(draggedPlayerId, slotEl);
        }
    });

    slotEl.addEventListener('click', () => {
        if (clickedPlayerId) {
            movePlayerInDOM(clickedPlayerId, slotEl);
            clickedPlayerId = null;
            removeHighlights();
        }
    });
}

function movePlayerInDOM(playerId, targetSlot) {
    const playerEl = document.querySelector(`.draggable-player[data-id="${playerId}"]`);
    if (!playerEl) return;

    const sourceSlot = playerEl.parentElement;
    const selectEl = targetSlot.querySelector('.slot-select');
    if (selectEl) selectEl.remove();

    if (targetSlot.children.length > 0 && targetSlot !== sourceSlot && !targetSlot.classList.contains('resting-list')) {
        const existingPlayer = targetSlot.children[0];
        sourceSlot.appendChild(existingPlayer);
    }

    targetSlot.appendChild(playerEl);
    forceStateSync();
}

function swapPlayersInDOM(id1, id2) {
    const el1 = document.querySelector(`.draggable-player[data-id="${id1}"]`);
    const el2 = document.querySelector(`.draggable-player[data-id="${id2}"]`);
    if (!el1 || !el2) return;

    const p1 = el1.parentNode;
    const p2 = el2.parentNode;
    const next1 = el1.nextSibling;
    const next2 = el2.nextSibling;

    p1.insertBefore(el2, next1);
    p2.insertBefore(el1, next2);
    forceStateSync();
}

function forceStateSync() {
    matchState = readStateFromDOM();
    const groupRef = getCurrentGroupDocRef();
    if (!groupRef || !hasLoadedCurrentGroup) return;
    const now = Date.now();
    recordLocalModification();
    groupRef.set({ matchState, lastModified: now }, { merge: true });
}

function updateCourtLevelSums() {
    document.querySelectorAll('.court').forEach(court => {
        const teamA = court.querySelector('.team:first-child');
        const teamB = court.querySelector('.team:last-child');

        [teamA, teamB].forEach(team => {
            if (!team) return;
            let sum = 0;
            team.querySelectorAll('.draggable-player').forEach(pEl => {
                const id = pEl.dataset.id;
                const pObj = players.find(x => x.id === id);
                if (pObj) sum += pObj.level;
            });
            const span = team.querySelector('.team-header span');
            if (span) span.textContent = sum;
        });
    });
}

// ----------------------------------------------------
// MAIN RENDER MATCH UI
// (橫版：上場中在上方、預備場地在下方；直版：預備場地在左邊、上場中在右邊)
// ----------------------------------------------------
function renderMatchUI(shouldSave = false) {
    const courtsWrapper = document.getElementById('courtsWrapper');
    if (courtsWrapper) {
        courtsWrapper.classList.toggle('is-vertical-layout', isCourtVertical);
    }

    matchState.courts = matchState.courts || [];
    matchState.activeCourts = matchState.activeCourts || [];

    if (matchState.activeCourts.length === 0) {
        matchState.activeCourts = [
            { name: '場地 1', isSingles: false, teamA: [null, null], teamB: [null, null] },
            { name: '場地 2', isSingles: false, teamA: [null, null], teamB: [null, null] },
            { name: '場地 3', isSingles: false, teamA: [null, null], teamB: [null, null] }
        ];
    }

    if (shouldSave) {
        saveMatchState();
    }

    // 1. 上場中場地 (上方)
    activeCourtsContainer.innerHTML = '';
    matchState.activeCourts.forEach((c, idx) => {
        const courtEl = document.createElement('div');
        courtEl.className = 'court' + (isCourtVertical ? ' is-vertical' : '');
        courtEl.dataset.issingles = c.isSingles ? 'true' : 'false';

        const finishBtnHtml = `<button class="icon-btn finish-btn" onclick="finishActiveMatch(${idx})" title="完成比賽並下場計算">
            <i data-lucide="check-circle-2"></i> 下場
        </button>`;

        const clearBtnHtml = `<button class="icon-btn court-clear-btn" onclick="clearActiveCourt(${idx})" title="清空此場地">
            <i data-lucide="rotate-ccw"></i>
        </button>`;

        let autoBtnHtml = '';
        if (matchState.courts.length === 0) {
            autoBtnHtml = `<button class="icon-btn primary-btn btn-pure-text" onclick="autoFillActiveCourt(${idx})" title="自動安排此場地">
                安排
            </button>`;
        }

        const slotsAHtml = `<div class="slot"></div>` + (c.isSingles ? '' : `<div class="slot"></div>`);
        const slotsBHtml = `<div class="slot"></div>` + (c.isSingles ? '' : `<div class="slot"></div>`);

        courtEl.innerHTML = `
            <div class="court-header">
                <input type="text" class="court-name-input" maxlength="6" value="${c.name || ('場地 ' + (idx + 1))}" onchange="forceStateSync()">
                ${clearBtnHtml}
            </div>
            <div class="teams-wrapper">
                <div class="team">
                    <div class="team-header">A 隊 (總星數 <span>0</span>)</div>
                    <div class="team-slots">
                        ${slotsAHtml}
                    </div>
                </div>
                <div class="vs-divider">
                    <span class="vs-text">VS</span>
                    <button class="mode-badge-btn ${c.isSingles ? 'is-singles' : ''}" onclick="toggleActiveCourtMode(${idx})" title="點擊切換 單打 / 雙打">
                        ${c.isSingles ? '單' : '雙'}
                    </button>
                </div>
                <div class="team">
                    <div class="team-header">B 隊 (總星數 <span>0</span>)</div>
                    <div class="team-slots">
                        ${slotsBHtml}
                    </div>
                </div>
            </div>
            <div class="court-actions">
                ${autoBtnHtml}
                ${finishBtnHtml}
            </div>
        `;
        activeCourtsContainer.appendChild(courtEl);

        const slots = courtEl.querySelectorAll('.slot');
        slots.forEach(setupSlot);

        if (c.teamA[0]) slots[0].appendChild(createPlayerEl(c.teamA[0], 'court'));
        if (!c.isSingles && c.teamA[1]) slots[1].appendChild(createPlayerEl(c.teamA[1], 'court'));
        if (c.teamB[0]) slots[c.isSingles ? 1 : 2].appendChild(createPlayerEl(c.teamB[0], 'court'));
        if (!c.isSingles && c.teamB[1]) slots[3].appendChild(createPlayerEl(c.teamB[1], 'court'));
    });

    // 2. 預備場地 (下方)
    const preCourtsCard = document.getElementById('preCourtsCard');
    const btnAutoActive = document.getElementById('btnAutoActive');

    if (matchState.courts.length === 0) {
        if (preCourtsCard) preCourtsCard.style.display = 'none';
        if (btnAutoActive) btnAutoActive.style.display = 'flex';
        courtsContainer.innerHTML = '';
    } else {
        if (preCourtsCard) preCourtsCard.style.display = 'block';
        if (btnAutoActive) btnAutoActive.style.display = 'none';
        courtsContainer.innerHTML = '';

        matchState.courts.forEach((c, idx) => {
            const courtEl = document.createElement('div');
            courtEl.className = 'court' + (isCourtVertical ? ' is-vertical' : '');
            courtEl.dataset.issingles = c.isSingles ? 'true' : 'false';

            const emptyActiveCourts = [];
            matchState.activeCourts.forEach((ac, aIdx) => {
                const isAcEmpty = (!ac.teamA || (!ac.teamA[0] && !ac.teamA[1])) && (!ac.teamB || (!ac.teamB[0] && !ac.teamB[1]));
                if (isAcEmpty) {
                    emptyActiveCourts.push({ aIdx, name: ac.name || ('場地 ' + (aIdx + 1)) });
                }
            });

            let pushOptions = '';
            let pushDisabled = false;
            if (emptyActiveCourts.length > 0) {
                pushOptions = '<option value="" disabled selected>推至空場...</option>';
                emptyActiveCourts.forEach(ec => {
                    pushOptions += `<option value="${ec.aIdx}">${ec.name}</option>`;
                });
            } else {
                pushOptions = '<option value="" disabled selected>無空場地</option>';
                pushDisabled = true;
            }

            const pushSelectHtml = `<select class="push-select" ${pushDisabled ? 'disabled style="opacity: 0.45; cursor: not-allowed;"' : ''} onchange="pushToActiveCourt(${idx}, this.value); this.value='';">
                ${pushOptions}
            </select>`;

            const autoBtnHtml = `<button class="icon-btn primary-btn btn-pure-text" onclick="autoFillCourt(${idx})" title="自動安排此預備場">安排</button>`;

            const clearCourtBtnHtml = `<button class="icon-btn court-clear-btn" onclick="clearCourt(${idx})" title="清空此預備場">
                <i data-lucide="rotate-ccw"></i>
            </button>`;

            const slotsAHtml = `<div class="slot"></div>` + (c.isSingles ? '' : `<div class="slot"></div>`);
            const slotsBHtml = `<div class="slot"></div>` + (c.isSingles ? '' : `<div class="slot"></div>`);

            courtEl.innerHTML = `
                <div class="court-header">
                    <span class="court-title-text">${c.name || ('預備場 ' + (idx + 1))}</span>
                    ${clearCourtBtnHtml}
                </div>
                <div class="teams-wrapper">
                    <div class="team">
                        <div class="team-header">A 隊 (總星數 <span>0</span>)</div>
                        <div class="team-slots">
                            ${slotsAHtml}
                        </div>
                    </div>
                    <div class="vs-divider">
                        <span class="vs-text">VS</span>
                        <button class="mode-badge-btn ${c.isSingles ? 'is-singles' : ''}" onclick="toggleCourtMode(${idx})" title="點擊切換 單打 / 雙打">
                            ${c.isSingles ? '單' : '雙'}
                        </button>
                    </div>
                    <div class="team">
                        <div class="team-header">B 隊 (總星數 <span>0</span>)</div>
                        <div class="team-slots">
                            ${slotsBHtml}
                        </div>
                    </div>
                </div>
                <div class="court-actions">
                    ${autoBtnHtml}
                    ${pushSelectHtml}
                </div>
            `;
            courtsContainer.appendChild(courtEl);

            const slots = courtEl.querySelectorAll('.slot');
            slots.forEach(setupSlot);

            if (c.teamA[0]) slots[0].appendChild(createPlayerEl(c.teamA[0], 'court'));
            if (!c.isSingles && c.teamA[1]) slots[1].appendChild(createPlayerEl(c.teamA[1], 'court'));
            if (c.teamB[0]) slots[c.isSingles ? 1 : 2].appendChild(createPlayerEl(c.teamB[0], 'court'));
            if (!c.isSingles && c.teamB[1]) slots[3].appendChild(createPlayerEl(c.teamB[1], 'court'));
        });
    }

    // 3. 候補區球員名單
    restingPlayersList.innerHTML = '';
    setupSlot(restingPlayersList);

    matchState.pool.sort((a, b) => {
        if (matchConfig.enablePriority) {
            const pA = getPlayerPriority(a);
            const pB = getPlayerPriority(b);
            if (pB !== pA) return pB - pA;
        }
        if (matchConfig.balanceMatchCount) {
            const mA = a.matchCount || 0;
            const mB = b.matchCount || 0;
            if (mA !== mB) return mA - mB;
        }
        if (b.level !== a.level) return b.level - a.level;
        return a.name.localeCompare(b.name, 'zh-TW');
    });

    matchState.pool.forEach(p => {
        restingPlayersList.appendChild(createPlayerEl(p, 'pool'));
    });

    // 幽靈球員 (場上打球者，以半透明放在候補區尾端)
    const ghostPlayers = [];
    matchState.courts.forEach(c => {
        if (c.teamA[0]) ghostPlayers.push(c.teamA[0]);
        if (c.teamA[1]) ghostPlayers.push(c.teamA[1]);
        if (c.teamB[0]) ghostPlayers.push(c.teamB[0]);
        if (c.teamB[1]) ghostPlayers.push(c.teamB[1]);
    });
    matchState.activeCourts.forEach(c => {
        if (c.teamA[0]) ghostPlayers.push(c.teamA[0]);
        if (c.teamA[1]) ghostPlayers.push(c.teamA[1]);
        if (c.teamB[0]) ghostPlayers.push(c.teamB[0]);
        if (c.teamB[1]) ghostPlayers.push(c.teamB[1]);
    });

    ghostPlayers.forEach(p => {
        restingPlayersList.appendChild(createPlayerEl(p, 'ghost'));
    });

    // 空 Slot 下拉快速點選球員
    let allSlots = Array.from(courtsContainer.querySelectorAll('.slot'));
    if (matchState.courts.length === 0) {
        allSlots = Array.from(activeCourtsContainer.querySelectorAll('.slot'));
    }

    allSlots.forEach(slot => {
        if (slot.children.length === 0) {
            let optionsHtml = `<option value="" disabled selected>選球員</option>`;
            matchState.pool.forEach(p => {
                const prioTag = matchConfig.enablePriority ? ` [⚡${getPlayerPriority(p)}]` : '';
                optionsHtml += `<option value="${p.id}">${p.level}-${p.name}${prioTag}</option>`;
            });
            const select = document.createElement('select');
            select.className = 'slot-select';
            select.innerHTML = optionsHtml;
            select.addEventListener('click', e => e.stopPropagation());
            select.addEventListener('mousedown', e => e.stopPropagation());
            select.addEventListener('change', (e) => {
                const pId = e.target.value;
                if (pId) {
                    const playerEl = document.querySelector(`.draggable-player[data-id="${pId}"]`);
                    if (playerEl) {
                        slot.innerHTML = '';
                        slot.appendChild(playerEl);
                        forceStateSync();
                    }
                }
            });
            slot.appendChild(select);
        }
    });

    updateCourtLevelSums();
    lucide.createIcons();
}

// ----------------------------------------------------
// PLAYER STATUS EDIT MODAL (候補區即時修改球員狀態)
// ----------------------------------------------------
let editingStatusPlayerId = null;
let editingStatusClearHistory = false;
let editingStatusManualClear = false;
let editingStatusClearedByZero = false;
let editingStatusOrigPrio = 0;
let editingStatusOrigMatchCount = 0;
let editingStatusPrioTouched = false;

function closePlayerStatusModal() {
    const modal = document.getElementById('playerStatusModal');
    if (modal) modal.style.display = 'none';
    editingStatusPlayerId = null;
    editingStatusClearHistory = false;
    editingStatusManualClear = false;
    editingStatusClearedByZero = false;
    editingStatusPrioTouched = false;
}

function renderStatusHistoryBox(p) {
    const box = document.getElementById('statusHistoryInfo');
    if (!box) return;
    if (editingStatusClearedByZero) {
        box.innerHTML = `<span style="color: #fbbf24;">場數已設為 0：儲存後將恢復未打過優先值，並一併清除上一場搭檔／同場紀錄。</span>`;
        return;
    }
    if (editingStatusClearHistory) {
        box.innerHTML = `<span style="color: #fb923c;">已標記清除避開紀錄（點擊「儲存」後生效）</span>`;
        return;
    }
    const findName = (id) => {
        const found = players.find(x => x.id === id);
        return found ? found.name : null;
    };
    const partnerName = p.lastPartnerId ? findName(p.lastPartnerId) : null;
    const courtNames = Array.isArray(p.lastCourtPlayerIds)
        ? p.lastCourtPlayerIds.map(findName).filter(Boolean)
        : [];
    box.innerHTML =
        `<div>上一場搭檔：<b style="color: white;">${partnerName || '無'}</b></div>` +
        `<div>上一場同場：<b style="color: white;">${courtNames.length > 0 ? courtNames.join('、') : '無'}</b></div>`;
}

function openPlayerStatusModal(playerId) {
    const p = players.find(x => x.id === playerId);
    const modal = document.getElementById('playerStatusModal');
    if (!p || !modal) return;

    // 清除任何點擊選取高亮，避免衝突
    clickedPlayerId = null;
    removeHighlights();

    editingStatusPlayerId = playerId;
    editingStatusClearHistory = false;
    editingStatusManualClear = false;
    editingStatusClearedByZero = false;
    editingStatusOrigPrio = getPlayerPriority(p);
    editingStatusOrigMatchCount = p.matchCount || 0;
    editingStatusPrioTouched = false;

    const titleEl = document.getElementById('statusModalTitle');
    const prioInput = document.getElementById('statusEditPriority');
    const matchInput = document.getElementById('statusEditMatchCount');
    const btnUnplayed = document.getElementById('btnStatusPrioUnplayed');
    const btnCap = document.getElementById('btnStatusPrioCap');

    if (titleEl) titleEl.textContent = `${p.name} — 狀態設定`;
    if (prioInput) prioInput.value = editingStatusOrigPrio;
    if (matchInput) matchInput.value = p.matchCount || 0;
    if (btnUnplayed) btnUnplayed.textContent = `未打過 (${getUnplayedPriority()})`;
    if (btnCap) btnCap.textContent = `上限 (${getMaxWaitingPriority()})`;

    renderStatusHistoryBox(p);

    modal.style.display = 'flex';
    lucide.createIcons();
}

(function initPlayerStatusModal() {
    const modal = document.getElementById('playerStatusModal');
    if (!modal) return;

    const btnClose = document.getElementById('btnCloseStatusModal');
    const btnCancel = document.getElementById('btnStatusCancel');
    const btnSave = document.getElementById('btnStatusSave');
    const btnLeave = document.getElementById('btnStatusLeave');
    const prioInput = document.getElementById('statusEditPriority');
    const matchInput = document.getElementById('statusEditMatchCount');
    const btnUnplayed = document.getElementById('btnStatusPrioUnplayed');
    const btnCap = document.getElementById('btnStatusPrioCap');
    const btnZero = document.getElementById('btnStatusPrioZero');
    const btnMatchMinus = document.getElementById('btnStatusMatchMinus');
    const btnMatchPlus = document.getElementById('btnStatusMatchPlus');
    const btnMatchZero = document.getElementById('btnStatusMatchZero');
    const btnClearHistory = document.getElementById('btnStatusClearHistory');

    if (btnClose) btnClose.addEventListener('click', closePlayerStatusModal);
    if (btnCancel) btnCancel.addEventListener('click', closePlayerStatusModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closePlayerStatusModal();
    });

    function syncPriorityWhenMatchZero() {
        if (!matchInput || !prioInput) return;
        const val = parseInt(matchInput.value, 10);
        const curPlayer = players.find(x => x.id === editingStatusPlayerId);
        if (!isNaN(val) && val === 0) {
            prioInput.value = getUnplayedPriority();
            editingStatusPrioTouched = false;
            editingStatusClearHistory = true;
            editingStatusClearedByZero = true;
            if (curPlayer) renderStatusHistoryBox(curPlayer);
        } else if (!isNaN(val) && val > 0 && editingStatusClearedByZero) {
            editingStatusClearedByZero = false;
            editingStatusClearHistory = editingStatusManualClear;
            if (curPlayer) renderStatusHistoryBox(curPlayer);
        }
    }

    if (prioInput) {
        prioInput.addEventListener('input', () => {
            editingStatusPrioTouched = true;
        });
    }

    if (btnUnplayed && prioInput) {
        btnUnplayed.addEventListener('click', () => {
            prioInput.value = getUnplayedPriority();
            editingStatusPrioTouched = true;
        });
    }
    if (btnCap && prioInput) {
        btnCap.addEventListener('click', () => {
            prioInput.value = getMaxWaitingPriority();
            editingStatusPrioTouched = true;
        });
    }
    if (btnZero && prioInput) {
        btnZero.addEventListener('click', () => {
            prioInput.value = 0;
            editingStatusPrioTouched = true;
        });
    }

    if (matchInput) {
        matchInput.addEventListener('input', syncPriorityWhenMatchZero);
        matchInput.addEventListener('change', syncPriorityWhenMatchZero);
    }

    if (btnMatchMinus && matchInput) {
        btnMatchMinus.addEventListener('click', () => {
            const cur = parseInt(matchInput.value, 10) || 0;
            matchInput.value = Math.max(0, cur - 1);
            syncPriorityWhenMatchZero();
        });
    }
    if (btnMatchPlus && matchInput) {
        btnMatchPlus.addEventListener('click', () => {
            const cur = parseInt(matchInput.value, 10) || 0;
            matchInput.value = cur + 1;
            syncPriorityWhenMatchZero();
        });
    }
    if (btnMatchZero && matchInput) {
        btnMatchZero.addEventListener('click', () => {
            matchInput.value = 0;
            syncPriorityWhenMatchZero();
        });
    }

    if (btnClearHistory) {
        btnClearHistory.addEventListener('click', () => {
            editingStatusClearHistory = true;
            editingStatusManualClear = true;
            const p = players.find(x => x.id === editingStatusPlayerId);
            if (p) renderStatusHistoryBox(p);
        });
    }

    if (btnLeave) {
        btnLeave.addEventListener('click', () => {
            const p = players.find(x => x.id === editingStatusPlayerId);
            if (!p) return;
            if (!confirm(`確定要將【${p.name}】設為取消出席（暫時離場）嗎？`)) return;
            p.isPlaying = false;
            syncPoolWithPlayers();
            savePlayersAndMatchState();
            updatePlayingCount();
            renderMatchUI();
            renderDatabaseList();
            closePlayerStatusModal();
        });
    }

    if (btnSave) {
        btnSave.addEventListener('click', () => {
            const p = players.find(x => x.id === editingStatusPlayerId);
            if (!p) return;

            const parsedPrio = parseInt(prioInput ? prioInput.value : '0', 10);
            let newPrio = (!isNaN(parsedPrio) && parsedPrio >= 0) ? parsedPrio : 0;
            const parsedMatch = parseInt(matchInput ? matchInput.value : '0', 10);
            const newMatchCount = (!isNaN(parsedMatch) && parsedMatch >= 0) ? parsedMatch : 0;

            const unplayedPrio = getUnplayedPriority();
            const maxWaitingPrio = getMaxWaitingPriority();
            if (newMatchCount === 0 && !editingStatusPrioTouched && editingStatusOrigMatchCount > 0) {
                newPrio = unplayedPrio;
            }

            p.matchCount = newMatchCount;
            p.priority = newPrio;

            // 若手動指定的優先值超出/異於預設公式區間，標記 customPriority 以完整保留手動數值
            if (newMatchCount === 0) {
                p.customPriority = (newPrio !== unplayedPrio);
            } else {
                p.customPriority = (newPrio > maxWaitingPrio);
            }

            if (newMatchCount === 0 || editingStatusClearHistory) {
                p.lastPartnerId = null;
                p.lastCourtPlayerIds = null;
            }

            syncPoolWithPlayers();
            savePlayersAndMatchState();
            renderMatchUI();
            renderDatabaseList();
            closePlayerStatusModal();
        });
    }
})();

// ----------------------------------------------------
// MULTI-GROUP MANAGEMENT, CROSS-ACCOUNT SHARING & AUTH
// ----------------------------------------------------
let sharingModalGroupId = null;

function renderTopAccountBar() {
    const selectEl = document.getElementById('activeGroupSelect');
    const userNameEl = document.getElementById('userAccountName');
    if (userNameEl && currentUser) {
        const span = userNameEl.querySelector('span');
        if (span) span.textContent = getUserDisplayName(currentUser);
    }
    if (!selectEl) return;

    selectEl.innerHTML = '';
    userGroups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        const isOwner = currentUser && g.ownerUid === currentUser.uid;
        const sharedTag = (g.memberUids && g.memberUids.length > 1) ? ` (${g.memberUids.length}人)` : '';
        opt.textContent = `${g.name || '未命名群組'}${isOwner ? '' : ' [共享]'}${sharedTag}`;
        if (g.id === currentGroupId) opt.selected = true;
        selectEl.appendChild(opt);
    });
}

function renderGroupManagerList() {
    const listEl = document.getElementById('groupManagerList');
    if (!listEl) return;

    if (!userGroups || userGroups.length === 0) {
        listEl.innerHTML = `<div style="font-size: 0.85rem; color: var(--text-muted); text-align: center; padding: 1rem;">尚無群組，請在上方建立或輸入共享碼加入。</div>`;
        return;
    }

    listEl.innerHTML = '';
    userGroups.forEach(g => {
        const isCurrent = g.id === currentGroupId;
        const isOwner = currentUser && g.ownerUid === currentUser.uid;
        const memberCount = Array.isArray(g.memberUids) ? g.memberUids.length : 1;
        const playerCount = Array.isArray(g.players) ? g.players.length : 0;

        const item = document.createElement('div');
        item.className = 'group-list-item' + (isCurrent ? ' is-current' : '');

        const roleBadge = isOwner
            ? `<span class="group-role-badge owner">建立者</span>`
            : `<span class="group-role-badge member">協作成員</span>`;
        const currentTag = isCurrent ? `<span class="group-role-badge owner">目前使用</span>` : '';

        item.innerHTML = `
            <div class="group-item-info">
                <div class="group-item-name">
                    <span>${g.name || '未命名群組'}</span>
                    ${roleBadge}
                    ${currentTag}
                </div>
                <div class="group-item-meta">球員 ${playerCount} 人 ・ 成員 ${memberCount} 人${g.shareEnabled && g.shareCode ? ` ・ 共享碼 ${g.shareCode}` : ''}</div>
            </div>
            <div class="group-item-actions"></div>
        `;

        const actionsEl = item.querySelector('.group-item-actions');

        if (!isCurrent) {
            const btnSwitch = document.createElement('button');
            btnSwitch.type = 'button';
            btnSwitch.className = 'status-quick-btn';
            btnSwitch.style.color = '#34d399';
            btnSwitch.style.borderColor = 'rgba(16,185,129,0.45)';
            btnSwitch.textContent = '切換';
            btnSwitch.addEventListener('click', () => {
                subscribeToGroupDoc(g.id);
                closeGroupManagerModal();
            });
            actionsEl.appendChild(btnSwitch);
        }

        const btnNewTab = document.createElement('button');
        btnNewTab.type = 'button';
        btnNewTab.className = 'status-quick-btn';
        btnNewTab.title = '在新分頁多開此群組';
        btnNewTab.innerHTML = `<i data-lucide="external-link" style="width:13px;height:13px;"></i>`;
        btnNewTab.addEventListener('click', () => {
            openGroupInNewTab(g.id);
        });
        actionsEl.appendChild(btnNewTab);

        const btnShare = document.createElement('button');
        btnShare.type = 'button';
        btnShare.className = 'status-quick-btn';
        btnShare.style.color = '#38bdf8';
        btnShare.style.borderColor = 'rgba(56,189,248,0.4)';
        btnShare.title = '共享設定';
        btnShare.innerHTML = `<i data-lucide="share-2" style="width:13px;height:13px;"></i>`;
        btnShare.addEventListener('click', () => {
            openGroupShareModal(g.id);
        });
        actionsEl.appendChild(btnShare);

        if (isOwner) {
            const btnRename = document.createElement('button');
            btnRename.type = 'button';
            btnRename.className = 'status-quick-btn';
            btnRename.title = '重新命名';
            btnRename.innerHTML = `<i data-lucide="pencil" style="width:13px;height:13px;"></i>`;
            btnRename.addEventListener('click', () => renameGroup(g.id));
            actionsEl.appendChild(btnRename);

            const btnDelete = document.createElement('button');
            btnDelete.type = 'button';
            btnDelete.className = 'status-quick-btn';
            btnDelete.style.color = '#f87171';
            btnDelete.style.borderColor = 'rgba(248,113,113,0.4)';
            btnDelete.title = '刪除群組';
            btnDelete.innerHTML = `<i data-lucide="trash-2" style="width:13px;height:13px;"></i>`;
            btnDelete.addEventListener('click', () => deleteGroup(g.id));
            actionsEl.appendChild(btnDelete);
        } else {
            const btnLeave = document.createElement('button');
            btnLeave.type = 'button';
            btnLeave.className = 'status-quick-btn';
            btnLeave.style.color = '#fbbf24';
            btnLeave.style.borderColor = 'rgba(251,191,36,0.4)';
            btnLeave.textContent = '退出';
            btnLeave.addEventListener('click', () => leaveGroup(g.id));
            actionsEl.appendChild(btnLeave);
        }

        listEl.appendChild(item);
    });

    lucide.createIcons();
}

function openGroupInNewTab(groupId) {
    if (!groupId) return;
    const url = new URL(window.location.href);
    url.searchParams.set('group', groupId);
    window.open(url.toString(), '_blank');
}

function openGroupManagerModal() {
    const modal = document.getElementById('groupManagerModal');
    if (!modal) return;
    renderGroupManagerList();
    modal.style.display = 'flex';
    lucide.createIcons();
}

function closeGroupManagerModal() {
    const modal = document.getElementById('groupManagerModal');
    if (modal) modal.style.display = 'none';
}

async function createGroup(name, initialData = null) {
    if (!currentUser) return null;
    const trimmedName = (name || '').trim() || '我的羽球群組';
    const uid = currentUser.uid;
    const displayName = getUserDisplayName(currentUser);
    const groupRef = db.collection('groups').doc();
    const shareCode = generateShareCode();
    const now = Date.now();

    const groupDocData = {
        name: trimmedName,
        ownerUid: uid,
        ownerName: displayName,
        memberUids: [uid],
        memberNames: { [uid]: displayName },
        shareCode,
        shareEnabled: false,
        createdAt: now,
        lastModified: now,
        players: (initialData && Array.isArray(initialData.players)) ? initialData.players : [],
        matchState: (initialData && initialData.matchState) ? initialData.matchState : getDefaultMatchState(),
        matchConfig: (initialData && initialData.matchConfig) ? initialData.matchConfig : getDefaultMatchConfig()
    };

    const shareDocData = {
        groupId: groupRef.id,
        groupName: trimmedName,
        ownerUid: uid,
        enabled: false
    };

    const batch = db.batch();
    batch.set(groupRef, groupDocData);
    batch.set(db.collection('shareCodes').doc(shareCode), shareDocData);
    await batch.commit();

    subscribeToGroupDoc(groupRef.id);
    return groupRef.id;
}

async function renameGroup(groupId) {
    const g = userGroups.find(x => x.id === groupId);
    if (!g || !currentUser || g.ownerUid !== currentUser.uid) return;

    const nextName = prompt('請輸入新的群組名稱：', g.name || '');
    if (nextName === null) return;
    const trimmed = nextName.trim();
    if (!trimmed) {
        alert('群組名稱不可為空白！');
        return;
    }

    const batch = db.batch();
    batch.update(db.collection('groups').doc(groupId), { name: trimmed });
    if (g.shareCode) {
        batch.set(db.collection('shareCodes').doc(g.shareCode), { groupName: trimmed }, { merge: true });
    }
    await batch.commit();
}

async function deleteGroup(groupId) {
    const g = userGroups.find(x => x.id === groupId);
    if (!g || !currentUser || g.ownerUid !== currentUser.uid) return;

    if (!confirm(`確定要永久刪除群組「${g.name}」嗎？\n此群組內的球員名單、場地與設定都會一併移除，無法復原。`)) {
        return;
    }

    const batch = db.batch();
    batch.delete(db.collection('groups').doc(groupId));
    if (g.shareCode) {
        batch.delete(db.collection('shareCodes').doc(g.shareCode));
    }
    await batch.commit();
}

async function leaveGroup(groupId) {
    const g = userGroups.find(x => x.id === groupId);
    if (!g || !currentUser || g.ownerUid === currentUser.uid) return;

    if (!confirm(`確定要退出共享群組「${g.name}」嗎？\n（建立者與其他成員的資料不受影響）`)) {
        return;
    }

    const updatePayload = {
        memberUids: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
    };
    updatePayload[`memberNames.${currentUser.uid}`] = firebase.firestore.FieldValue.delete();
    await db.collection('groups').doc(groupId).update(updatePayload);
}

async function joinGroupByShareCode(rawCode) {
    if (!currentUser) return;
    const code = (rawCode || '').trim().toUpperCase();
    if (!code) {
        alert('請先輸入共享碼！');
        return;
    }

    try {
        const codeDoc = await db.collection('shareCodes').doc(code).get();
        if (!codeDoc.exists) {
            alert('找不到此共享碼，請確認輸入是否正確！');
            return;
        }
        const codeData = codeDoc.data();
        if (!codeData.enabled) {
            alert('此群組目前已關閉共享功能，請聯繫群組建立者開啟！');
            return;
        }

        const targetGroupId = codeData.groupId;
        const alreadyMember = userGroups.some(g => g.id === targetGroupId);
        if (alreadyMember) {
            subscribeToGroupDoc(targetGroupId);
            closeGroupManagerModal();
            alert(`您已經在「${codeData.groupName || '該群組'}」中，已為您切換！`);
            return;
        }

        const updatePayload = {
            memberUids: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
        };
        updatePayload[`memberNames.${currentUser.uid}`] = getUserDisplayName(currentUser);

        await db.collection('groups').doc(targetGroupId).update(updatePayload);

        const joinInput = document.getElementById('joinShareCodeInput');
        if (joinInput) joinInput.value = '';

        subscribeToGroupDoc(targetGroupId);
        closeGroupManagerModal();
        alert(`已成功加入共享群組「${codeData.groupName || '羽球群組'}」！`);
    } catch (err) {
        console.error('Join group error:', err);
        alert('加入群組失敗，請確認共享碼或網路連線狀態：' + (err.message || err));
    }
}

function renderShareModalContent(groupId) {
    const g = userGroups.find(x => x.id === groupId) || (currentGroupMeta && currentGroupMeta.id === groupId ? currentGroupMeta : null);
    if (!g) return;

    const isOwner = Boolean(currentUser && g.ownerUid === currentUser.uid);
    const titleEl = document.getElementById('shareModalGroupTitle');
    const btnOn = document.getElementById('btnShareToggleOn');
    const btnOff = document.getElementById('btnShareToggleOff');
    const codeEl = document.getElementById('shareCodeDisplay');
    const btnRegen = document.getElementById('btnRegenerateShareCode');
    const membersListEl = document.getElementById('shareMembersList');

    if (titleEl) titleEl.textContent = `${g.name || '群組'} — 共享設定`;
    setToggleState(btnOn, btnOff, Boolean(g.shareEnabled));
    if (btnOn) btnOn.disabled = !isOwner;
    if (btnOff) btnOff.disabled = !isOwner;
    if (btnRegen) btnRegen.style.display = isOwner ? 'inline-flex' : 'none';
    if (codeEl) codeEl.textContent = g.shareEnabled ? (g.shareCode || '尚未產生') : '（已關閉共享）';

    if (membersListEl) {
        membersListEl.innerHTML = '';
        const uids = Array.isArray(g.memberUids) ? g.memberUids : [];
        const namesMap = g.memberNames || {};
        uids.forEach(uid => {
            const isMemberOwner = (uid === g.ownerUid);
            const isSelf = (currentUser && uid === currentUser.uid);
            const displayName = namesMap[uid] || (isMemberOwner ? (g.ownerName || '建立者') : '協作成員');

            const row = document.createElement('div');
            row.className = 'share-member-row';
            row.innerHTML = `
                <div style="display: flex; align-items: center; gap: 0.45rem;">
                    <span>${displayName}${isSelf ? '（我）' : ''}</span>
                    <span class="group-role-badge ${isMemberOwner ? 'owner' : 'member'}">${isMemberOwner ? '建立者' : '協作者'}</span>
                </div>
            `;
            if (isOwner && !isMemberOwner) {
                const btnRemove = document.createElement('button');
                btnRemove.type = 'button';
                btnRemove.className = 'status-quick-btn';
                btnRemove.style.color = '#f87171';
                btnRemove.style.borderColor = 'rgba(248,113,113,0.4)';
                btnRemove.textContent = '移除';
                btnRemove.addEventListener('click', async () => {
                    if (!confirm(`確定要將「${displayName}」移出此群組嗎？`)) return;
                    const payload = {
                        memberUids: firebase.firestore.FieldValue.arrayRemove(uid)
                    };
                    payload[`memberNames.${uid}`] = firebase.firestore.FieldValue.delete();
                    await db.collection('groups').doc(g.id).update(payload);
                });
                row.appendChild(btnRemove);
            }
            membersListEl.appendChild(row);
        });
    }
    lucide.createIcons();
}

function openGroupShareModal(groupId) {
    const modal = document.getElementById('groupShareModal');
    if (!modal || !groupId) return;
    sharingModalGroupId = groupId;
    renderShareModalContent(groupId);
    modal.style.display = 'flex';
}

function closeGroupShareModal() {
    const modal = document.getElementById('groupShareModal');
    if (modal) modal.style.display = 'none';
    sharingModalGroupId = null;
}

async function setGroupShareEnabled(groupId, enabled) {
    const g = userGroups.find(x => x.id === groupId);
    if (!g || !currentUser || g.ownerUid !== currentUser.uid) return;

    const code = g.shareCode || generateShareCode();
    const batch = db.batch();
    batch.update(db.collection('groups').doc(groupId), {
        shareEnabled: enabled,
        shareCode: code
    });
    batch.set(db.collection('shareCodes').doc(code), {
        groupId,
        groupName: g.name || '未命名群組',
        ownerUid: currentUser.uid,
        enabled
    }, { merge: true });
    await batch.commit();
}

async function regenerateGroupShareCode(groupId) {
    const g = userGroups.find(x => x.id === groupId);
    if (!g || !currentUser || g.ownerUid !== currentUser.uid) return;

    if (!confirm('確定要重設共享代碼嗎？\n重設後舊代碼將立即失效（已加入的成員不受影響）。')) {
        return;
    }

    const oldCode = g.shareCode;
    const newCode = generateShareCode();
    const batch = db.batch();
    if (oldCode) {
        batch.delete(db.collection('shareCodes').doc(oldCode));
    }
    batch.update(db.collection('groups').doc(groupId), {
        shareCode: newCode
    });
    batch.set(db.collection('shareCodes').doc(newCode), {
        groupId,
        groupName: g.name || '未命名群組',
        ownerUid: currentUser.uid,
        enabled: Boolean(g.shareEnabled)
    });
    await batch.commit();
}

async function importLegacyData(mode = 'current') {
    if (!currentUser) return;
    try {
        const legacyDoc = await db.collection('badminton').doc('state').get();
        if (!legacyDoc.exists) {
            alert('雲端找不到舊版 (v1.0.0) 資料！');
            return;
        }
        const legacy = legacyDoc.data() || {};
        const legacyPlayers = Array.isArray(legacy.players) ? legacy.players : [];
        const legacyMatchState = legacy.matchState || getDefaultMatchState();
        const legacyMatchConfig = legacy.matchConfig ? Object.assign(getDefaultMatchConfig(), legacy.matchConfig) : getDefaultMatchConfig();

        if (legacyPlayers.length === 0) {
            alert('舊版 (v1.0.0) 資料中目前沒有任何球員可供匯入。');
            return;
        }

        if (mode === 'current') {
            if (!currentGroupId) {
                alert('目前沒有選取任何群組，請改用「另建新群組匯入」。');
                return;
            }
            const curName = currentGroupMeta ? currentGroupMeta.name : '目前群組';
            const existingCount = Array.isArray(players) ? players.length : 0;
            const overwriteHint = existingCount > 0
                ? `\n⚠️ 注意：目前群組已有 ${existingCount} 位球員，匯入將會覆蓋目前群組的球員與場地狀態！`
                : '';
            if (!confirm(`偵測到舊版資料共有 ${legacyPlayers.length} 位球員。\n\n確定要匯入到目前群組「${curName}」嗎？${overwriteHint}`)) {
                return;
            }
            const now = Date.now();
            await db.collection('groups').doc(currentGroupId).set({
                players: legacyPlayers,
                matchState: legacyMatchState,
                matchConfig: legacyMatchConfig,
                lastModified: now
            }, { merge: true });
            closeGroupManagerModal();
            alert(`已成功匯入 ${legacyPlayers.length} 位球員至「${curName}」！（原始舊版資料仍安全保留）`);
            return;
        }

        // mode === 'new'
        if (!confirm(`偵測到舊版資料共有 ${legacyPlayers.length} 位球員。\n\n確定要另建新群組「舊版匯入群組」並完整匯入嗎？（不會影響目前群組，原始舊版資料亦保持不動）`)) {
            return;
        }

        await createGroup('舊版匯入群組', {
            players: legacyPlayers,
            matchState: legacyMatchState,
            matchConfig: legacyMatchConfig
        });
        closeGroupManagerModal();
        alert(`已成功建立「舊版匯入群組」並匯入 ${legacyPlayers.length} 位球員！`);
    } catch (err) {
        console.error('Import legacy data error:', err);
        alert('匯入舊版資料失敗：' + (err.message || err));
    }
}

function subscribeToUserGroups(user) {
    if (!user) return;
    if (unsubscribeGroupsList) {
        unsubscribeGroupsList();
        unsubscribeGroupsList = null;
    }

    let isCreatingDefaultGroup = false;

    unsubscribeGroupsList = db.collection('groups')
        .where('memberUids', 'array-contains', user.uid)
        .onSnapshot(snapshot => {
            const list = [];
            snapshot.forEach(doc => {
                list.push(Object.assign({ id: doc.id }, doc.data()));
            });
            list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            userGroups = list;

            renderTopAccountBar();
            const mgrModal = document.getElementById('groupManagerModal');
            if (mgrModal && mgrModal.style.display === 'flex') {
                renderGroupManagerList();
            }
            const shareModal = document.getElementById('groupShareModal');
            if (shareModal && shareModal.style.display === 'flex' && sharingModalGroupId) {
                renderShareModalContent(sharingModalGroupId);
            }

            if (userGroups.length === 0) {
                if (!isCreatingDefaultGroup) {
                    isCreatingDefaultGroup = true;
                    createGroup('我的羽球群組').finally(() => {
                        isCreatingDefaultGroup = false;
                    });
                }
                return;
            }

            const currentStillValid = currentGroupId && userGroups.some(g => g.id === currentGroupId);
            if (!currentStillValid) {
                let targetId = null;
                try {
                    const urlGroup = new URLSearchParams(window.location.search).get('group');
                    const sessionGroup = sessionStorage.getItem('activeGroupId');
                    const savedLastGroup = localStorage.getItem('lastGroupId_' + user.uid);

                    if (urlGroup && userGroups.some(g => g.id === urlGroup)) {
                        targetId = urlGroup;
                    } else if (sessionGroup && userGroups.some(g => g.id === sessionGroup)) {
                        targetId = sessionGroup;
                    } else if (savedLastGroup && userGroups.some(g => g.id === savedLastGroup)) {
                        targetId = savedLastGroup;
                    }
                } catch (e) {}

                if (!targetId) targetId = userGroups[0].id;
                subscribeToGroupDoc(targetId);
            }
        }, err => {
            console.error('Groups list snapshot error:', err);
        });
}

function getFriendlyAuthError(err) {
    if (!err || !err.code) return '操作失敗，請稍後再試。';
    switch (err.code) {
        case 'auth/invalid-email': return '電子信箱格式不正確。';
        case 'auth/user-disabled': return '此帳號已被停用。';
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential': return '信箱或密碼錯誤，請重新確認。';
        case 'auth/email-already-in-use': return '此信箱已經註冊過，請直接切換至「登入」。';
        case 'auth/weak-password': return '密碼強度不足，請至少輸入 6 位字元。';
        case 'auth/popup-closed-by-user': return '已取消 Google 登入視窗。';
        case 'auth/network-request-failed': return '網路連線異常，請檢查網路後重試。';
        case 'auth/too-many-requests': return '嘗試次數過多，請稍候再試。';
        case 'auth/unauthorized-domain': return '此網域尚未加入 Firebase Authentication 授權清單，請至 Firebase 後台「已授權網域」新增此網址。';
        default: return err.message || '驗證過程發生錯誤。';
    }
}

(function initAuthAndGroupUI() {
    const authOverlay = document.getElementById('authOverlay');
    const appContainer = document.getElementById('appContainer');
    const btnGoogleLogin = document.getElementById('btnGoogleLogin');
    const tabLogin = document.getElementById('tabAuthLogin');
    const tabRegister = document.getElementById('tabAuthRegister');
    const nameGroup = document.getElementById('authNameGroup');
    const displayNameInput = document.getElementById('authDisplayName');
    const emailInput = document.getElementById('authEmail');
    const passwordInput = document.getElementById('authPassword');
    const emailForm = document.getElementById('emailAuthForm');
    const submitBtn = document.getElementById('btnEmailAuthSubmit');
    const forgotBtn = document.getElementById('btnForgotPassword');
    const errorMsgEl = document.getElementById('authErrorMsg');

    let isRegisterMode = false;

    function showAuthMessage(text, isSuccess = false) {
        if (!errorMsgEl) return;
        if (!text) {
            errorMsgEl.style.display = 'none';
            errorMsgEl.textContent = '';
            errorMsgEl.classList.remove('is-success');
            return;
        }
        errorMsgEl.textContent = text;
        errorMsgEl.classList.toggle('is-success', isSuccess);
        errorMsgEl.style.display = 'block';
    }

    function setAuthMode(register) {
        isRegisterMode = register;
        showAuthMessage('');
        if (tabLogin) tabLogin.classList.toggle('active', !register);
        if (tabRegister) tabRegister.classList.toggle('active', register);
        if (nameGroup) nameGroup.style.display = register ? 'flex' : 'none';
        if (forgotBtn) forgotBtn.style.display = register ? 'none' : 'block';
        if (passwordInput) passwordInput.autocomplete = register ? 'new-password' : 'current-password';
        if (submitBtn) {
            const span = submitBtn.querySelector('span');
            if (span) span.textContent = register ? '註冊並登入' : '登入系統';
        }
    }

    if (tabLogin) tabLogin.addEventListener('click', () => setAuthMode(false));
    if (tabRegister) tabRegister.addEventListener('click', () => setAuthMode(true));

    if (btnGoogleLogin) {
        btnGoogleLogin.addEventListener('click', async () => {
            showAuthMessage('');
            const provider = new firebase.auth.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            try {
                await auth.signInWithPopup(provider);
            } catch (err) {
                if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-browser') {
                    try {
                        await auth.signInWithRedirect(provider);
                    } catch (redirectErr) {
                        showAuthMessage(getFriendlyAuthError(redirectErr));
                    }
                } else {
                    showAuthMessage(getFriendlyAuthError(err));
                }
            }
        });
    }

    if (emailForm) {
        emailForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            showAuthMessage('');
            const email = emailInput ? emailInput.value.trim() : '';
            const password = passwordInput ? passwordInput.value : '';
            const displayName = displayNameInput ? displayNameInput.value.trim() : '';

            if (!email || !password) return;

            try {
                if (isRegisterMode) {
                    const cred = await auth.createUserWithEmailAndPassword(email, password);
                    const finalName = displayName || email.split('@')[0];
                    if (cred.user) {
                        await cred.user.updateProfile({ displayName: finalName });
                    }
                } else {
                    await auth.signInWithEmailAndPassword(email, password);
                }
            } catch (err) {
                showAuthMessage(getFriendlyAuthError(err));
            }
        });
    }

    if (forgotBtn) {
        forgotBtn.addEventListener('click', async () => {
            const email = emailInput ? emailInput.value.trim() : '';
            if (!email) {
                showAuthMessage('請先在上方輸入您的電子信箱，再點擊忘記密碼。');
                return;
            }
            try {
                await auth.sendPasswordResetEmail(email);
                showAuthMessage(`已將重設密碼連結寄送至 ${email}，請查收信件！`, true);
            } catch (err) {
                showAuthMessage(getFriendlyAuthError(err));
            }
        });
    }

    auth.getRedirectResult().catch(err => {
        if (err && err.code) showAuthMessage(getFriendlyAuthError(err));
    });

    // Account Bar & Group Modal listeners
    const activeGroupSelect = document.getElementById('activeGroupSelect');
    const btnOpenGroupManager = document.getElementById('btnOpenGroupManager');
    const btnCloseGroupManager = document.getElementById('btnCloseGroupManager');
    const groupManagerModal = document.getElementById('groupManagerModal');
    const btnOpenGroupNewTab = document.getElementById('btnOpenGroupNewTab');
    const btnQuickShareGroup = document.getElementById('btnQuickShareGroup');
    const btnLogout = document.getElementById('btnLogout');
    const newGroupNameInput = document.getElementById('newGroupNameInput');
    const btnCreateGroup = document.getElementById('btnCreateGroup');
    const joinShareCodeInput = document.getElementById('joinShareCodeInput');
    const btnJoinByShareCode = document.getElementById('btnJoinByShareCode');
    const btnImportLegacyToCurrent = document.getElementById('btnImportLegacyToCurrent');
    const btnImportLegacyNewGroup = document.getElementById('btnImportLegacyNewGroup');

    const groupShareModal = document.getElementById('groupShareModal');
    const btnCloseShareModal = document.getElementById('btnCloseShareModal');
    const btnShareToggleOn = document.getElementById('btnShareToggleOn');
    const btnShareToggleOff = document.getElementById('btnShareToggleOff');
    const btnCopyShareCode = document.getElementById('btnCopyShareCode');
    const btnRegenerateShareCode = document.getElementById('btnRegenerateShareCode');

    if (activeGroupSelect) {
        activeGroupSelect.addEventListener('change', (e) => {
            if (e.target.value && e.target.value !== currentGroupId) {
                subscribeToGroupDoc(e.target.value);
            }
        });
    }
    if (btnOpenGroupManager) btnOpenGroupManager.addEventListener('click', openGroupManagerModal);
    if (btnCloseGroupManager) btnCloseGroupManager.addEventListener('click', closeGroupManagerModal);
    if (groupManagerModal) {
        groupManagerModal.addEventListener('click', (e) => {
            if (e.target === groupManagerModal) closeGroupManagerModal();
        });
    }
    if (btnOpenGroupNewTab) {
        btnOpenGroupNewTab.addEventListener('click', () => {
            if (currentGroupId) openGroupInNewTab(currentGroupId);
        });
    }
    if (btnQuickShareGroup) {
        btnQuickShareGroup.addEventListener('click', () => {
            if (currentGroupId) openGroupShareModal(currentGroupId);
        });
    }

    if (btnCreateGroup) {
        btnCreateGroup.addEventListener('click', async () => {
            const name = newGroupNameInput ? newGroupNameInput.value.trim() : '';
            if (!name) {
                alert('請輸入新群組名稱！');
                return;
            }
            btnCreateGroup.disabled = true;
            try {
                await createGroup(name);
                if (newGroupNameInput) newGroupNameInput.value = '';
                closeGroupManagerModal();
            } catch (err) {
                alert('建立群組失敗：' + (err.message || err));
            } finally {
                btnCreateGroup.disabled = false;
            }
        });
    }

    if (btnJoinByShareCode) {
        btnJoinByShareCode.addEventListener('click', async () => {
            const code = joinShareCodeInput ? joinShareCodeInput.value : '';
            btnJoinByShareCode.disabled = true;
            try {
                await joinGroupByShareCode(code);
            } finally {
                btnJoinByShareCode.disabled = false;
            }
        });
    }

    if (btnImportLegacyToCurrent) {
        btnImportLegacyToCurrent.addEventListener('click', async () => {
            btnImportLegacyToCurrent.disabled = true;
            try {
                await importLegacyData('current');
            } finally {
                btnImportLegacyToCurrent.disabled = false;
            }
        });
    }

    if (btnImportLegacyNewGroup) {
        btnImportLegacyNewGroup.addEventListener('click', async () => {
            btnImportLegacyNewGroup.disabled = true;
            try {
                await importLegacyData('new');
            } finally {
                btnImportLegacyNewGroup.disabled = false;
            }
        });
    }

    if (btnCloseShareModal) btnCloseShareModal.addEventListener('click', closeGroupShareModal);
    if (groupShareModal) {
        groupShareModal.addEventListener('click', (e) => {
            if (e.target === groupShareModal) closeGroupShareModal();
        });
    }
    if (btnShareToggleOn) {
        btnShareToggleOn.addEventListener('click', () => {
            if (sharingModalGroupId) setGroupShareEnabled(sharingModalGroupId, true);
        });
    }
    if (btnShareToggleOff) {
        btnShareToggleOff.addEventListener('click', () => {
            if (sharingModalGroupId) setGroupShareEnabled(sharingModalGroupId, false);
        });
    }
    if (btnCopyShareCode) {
        btnCopyShareCode.addEventListener('click', async () => {
            const g = userGroups.find(x => x.id === sharingModalGroupId);
            if (!g || !g.shareEnabled || !g.shareCode) {
                alert('請先開啟共享功能再複製代碼！');
                return;
            }
            try {
                await navigator.clipboard.writeText(g.shareCode);
                btnCopyShareCode.textContent = '已複製！';
                setTimeout(() => {
                    btnCopyShareCode.innerHTML = `<i data-lucide="copy" style="width: 13px; height: 13px;"></i> 複製`;
                    lucide.createIcons();
                }, 1200);
            } catch (e) {
                prompt('請複製下方共享碼：', g.shareCode);
            }
        });
    }
    if (btnRegenerateShareCode) {
        btnRegenerateShareCode.addEventListener('click', () => {
            if (sharingModalGroupId) regenerateGroupShareCode(sharingModalGroupId);
        });
    }

    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            if (!confirm('確定要登出目前帳號嗎？')) return;
            if (unsubscribeGroupDoc) { unsubscribeGroupDoc(); unsubscribeGroupDoc = null; }
            if (unsubscribeGroupsList) { unsubscribeGroupsList(); unsubscribeGroupsList = null; }
            currentGroupId = null;
            currentGroupMeta = null;
            userGroups = [];
            hasLoadedCurrentGroup = false;
            players = [];
            matchState = getDefaultMatchState();
            matchConfig = getDefaultMatchConfig();
            try {
                sessionStorage.removeItem('activeGroupId');
                const url = new URL(window.location.href);
                url.searchParams.delete('group');
                window.history.replaceState({}, '', url.toString());
            } catch (e) {}
            closeGroupManagerModal();
            closeGroupShareModal();
            closePlayerStatusModal();
            await auth.signOut();
        });
    }

    // Auth State Observer
    auth.onAuthStateChanged(user => {
        if (user) {
            currentUser = user;
            if (authOverlay) authOverlay.style.display = 'none';
            if (appContainer) appContainer.style.display = 'block';
            renderTopAccountBar();
            const savedActiveView = localStorage.getItem('activeView') || 'viewMatch';
            switchView(savedActiveView, true);
            lucide.createIcons();
            subscribeToUserGroups(user);
        } else {
            currentUser = null;
            if (unsubscribeGroupDoc) { unsubscribeGroupDoc(); unsubscribeGroupDoc = null; }
            if (unsubscribeGroupsList) { unsubscribeGroupsList(); unsubscribeGroupsList = null; }
            userGroups = [];
            currentGroupId = null;
            currentGroupMeta = null;
            hasLoadedCurrentGroup = false;
            players = [];
            matchState = getDefaultMatchState();
            matchConfig = getDefaultMatchConfig();
            closeGroupManagerModal();
            closeGroupShareModal();
            closePlayerStatusModal();
            if (appContainer) appContainer.style.display = 'none';
            if (authOverlay) authOverlay.style.display = 'flex';
            lucide.createIcons();
        }
    });
})();

// Initial UI Setup (data loads after auth resolves)
const savedActiveView = localStorage.getItem('activeView') || 'viewMatch';
saveCurrentSettingsSnapshot();
setUIFromConfig(savedSettingsSnapshot);
switchView(savedActiveView, true);
lucide.createIcons();
