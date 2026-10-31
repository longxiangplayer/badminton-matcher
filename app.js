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

// 啟用 Firestore 本地離線快取（離線可讀可寫，連網時自動同步）
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    if (err.code === 'failed-precondition') {
        console.warn('Firestore 離線快取：多個分頁同時開啟，僅在主分頁啟用');
    } else if (err.code === 'unimplemented') {
        console.warn('當前瀏覽器不支援 Firestore 離線持久化');
    }
});

// --- STATE ---
let players = [];
let matchState = {
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
    priorityStep: 25,
    avoidRecentPartner: true,
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
const hintUnplayedVal = document.getElementById('hintUnplayedVal');
const btnAvoidPartnerOn = document.getElementById('btnAvoidPartnerOn');
const btnAvoidPartnerOff = document.getElementById('btnAvoidPartnerOff');
const btnBalanceMatchesOn = document.getElementById('btnBalanceMatchesOn');
const btnBalanceMatchesOff = document.getElementById('btnBalanceMatchesOff');
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
    const courtCount = getActiveCourtCount();
    const step = (matchConfig && matchConfig.priorityStep) ? matchConfig.priorityStep : 25;
    return (courtCount + 1) * step;
}

function getPlayerPriority(p) {
    if (p.priority !== undefined && p.priority !== null) {
        return Number(p.priority);
    }
    return getUnplayedPriority();
}

function updateUnplayedHint() {
    if (!hintUnplayedVal) return;
    const courts = activeCourtCountSelect ? (parseInt(activeCourtCountSelect.value) || 3) : 3;
    const step = cfgPriorityStep ? (parseInt(cfgPriorityStep.value) || 25) : 25;
    hintUnplayedVal.textContent = (courts + 1) * step;
}

// --- SETTINGS SNAPSHOT & DIRTY CHECKING (防呆保護) ---
let savedSettingsSnapshot = null;

function saveCurrentSettingsSnapshot() {
    savedSettingsSnapshot = {
        enablePriority: matchConfig.enablePriority !== undefined ? Boolean(matchConfig.enablePriority) : true,
        priorityStep: matchConfig.priorityStep !== undefined ? Number(matchConfig.priorityStep) : 25,
        avoidRecentPartner: matchConfig.avoidRecentPartner !== undefined ? Boolean(matchConfig.avoidRecentPartner) : true,
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
        priorityStep: cfgPriorityStep ? (parseInt(cfgPriorityStep.value) || 25) : 25,
        avoidRecentPartner: btnAvoidPartnerOn ? btnAvoidPartnerOn.classList.contains('is-active') : true,
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
    if (cfgPriorityStep) cfgPriorityStep.value = cfg.priorityStep;

    setToggleState(btnAvoidPartnerOn, btnAvoidPartnerOff, cfg.avoidRecentPartner);
    setToggleState(btnBalanceMatchesOn, btnBalanceMatchesOff, cfg.balanceMatchCount);

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
    if (current.avoidRecentPartner !== saved.avoidRecentPartner) {
        diffs.push(`避開前搭檔：${saved.avoidRecentPartner ? '開啟' : '關閉'} ➔ ${current.avoidRecentPartner ? '開啟' : '關閉'}`);
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
    matchConfig.avoidRecentPartner = cur.avoidRecentPartner;
    matchConfig.balanceMatchCount = cur.balanceMatchCount;
    matchConfig.maxTeamDiff = cur.maxTeamDiff;
    matchConfig.maxPlayerGap = cur.maxPlayerGap;

    matchState = readStateFromDOM();
    matchState.activeCourts = matchState.activeCourts || [];
    updateCourtsArray(matchState.activeCourts, cur.activeCourtCount, matchState.pool, '場地 ');
    matchState.courts = matchState.courts || [];
    updateCourtsArray(matchState.courts, cur.preCourtCount, matchState.pool, '預備場 ');

    saveCurrentSettingsSnapshot();
    db.collection('badminton').doc('state').set({ matchConfig, matchState }, { merge: true });
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
if (btnBalanceMatchesOn && btnBalanceMatchesOff) {
    btnBalanceMatchesOn.addEventListener('click', () => setToggleState(btnBalanceMatchesOn, btnBalanceMatchesOff, true));
    btnBalanceMatchesOff.addEventListener('click', () => setToggleState(btnBalanceMatchesOn, btnBalanceMatchesOff, false));
}
if (cfgPriorityStep) {
    cfgPriorityStep.addEventListener('input', updateUnplayedHint);
}
if (activeCourtCountSelect) {
    activeCourtCountSelect.addEventListener('input', updateUnplayedHint);
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
        btnToggleCourtOrientation.innerHTML = '<i data-lucide="columns-2"></i> <span id="orientationLabel">橫式版面</span>';
        btnToggleCourtOrientation.title = '目前為直式 (預備場在左、上場在右)，點擊切換為橫式版面 (上場在上、預備在下)';
    } else {
        btnToggleCourtOrientation.innerHTML = '<i data-lucide="rows-2"></i> <span id="orientationLabel">直式版面</span>';
        btnToggleCourtOrientation.title = '目前為橫式 (上場在上、預備在下)，點擊切換為直式版面 (預備場在左、上場在右)';
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

// --- NAVIGATION WITH DIRTY CHECKING (防呆保護) ---
navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const currentActiveView = document.querySelector('.view.active');
        const targetId = btn.dataset.target;

        // If leaving viewSettings, check for unapplied modifications
        if (currentActiveView && currentActiveView.id === 'viewSettings' && targetId !== 'viewSettings') {
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

        navBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        views.forEach(v => {
            v.classList.remove('active');
            v.style.display = 'none';
        });

        const target = document.getElementById(targetId);
        target.classList.add('active');
        target.style.display = 'block';

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
    });
});

// --- PLAYER MANAGEMENT ---
playerLevelInput.addEventListener('input', (e) => {
    const val = e.target.value;
    levelValueSpan.textContent = val;
    levelValueSpan.className = `level-badge level-${val}`;
});

function recordLocalModification() {
    const now = Date.now();
    localStorage.setItem('localLastModified', now.toString());
    if (!navigator.onLine) {
        localStorage.setItem('hasOfflineEdits', 'true');
        localStorage.setItem('offlineSnapshot', JSON.stringify({
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

    btnKeepLocal.onclick = () => {
        const now = Date.now();
        db.collection('badminton').doc('state').set({
            players,
            matchState,
            matchConfig,
            lastModified: now
        });
        localStorage.removeItem('hasOfflineEdits');
        localStorage.removeItem('offlineSnapshot');
        modal.style.display = 'none';
        alert('已成功以本機離線紀錄覆蓋雲端伺服器！');
    };

    btnKeepServer.onclick = () => {
        if (serverData.players) players = serverData.players;
        if (serverData.matchState) {
            matchState = serverData.matchState;
            matchState.courts = matchState.courts || [];
            matchState.activeCourts = matchState.activeCourts || [];
        }
        if (serverData.matchConfig) {
            matchConfig = Object.assign({}, matchConfig, serverData.matchConfig);
        }
        saveCurrentSettingsSnapshot();
        setUIFromConfig(savedSettingsSnapshot);
        renderDatabaseList();
        syncPoolWithPlayers();
        renderMatchUI();

        localStorage.removeItem('hasOfflineEdits');
        localStorage.removeItem('offlineSnapshot');
        modal.style.display = 'none';
        alert('已成功載入雲端伺服器紀錄！');
    };
}

function savePlayers() {
    if (!players || players.length === 0) {
        console.warn("Blocked saving empty players list to prevent accidental overwrite");
        return;
    }
    const now = Date.now();
    recordLocalModification();
    db.collection('badminton').doc('state').set({ players, lastModified: now }, { merge: true });
}

function saveMatchState() {
    const now = Date.now();
    recordLocalModification();
    db.collection('badminton').doc('state').set({ matchState, lastModified: now }, { merge: true });
}

// --- FIRESTORE REALTIME SYNC ---
db.collection('badminton').doc('state').onSnapshot(doc => {
    if (doc.exists) {
        const data = doc.data();
        const isFromCache = doc.metadata.fromCache;

        // 若有離線修改，且本次收到的是來自雲端的真實更新，檢查衝突
        if (!isFromCache && localStorage.getItem('hasOfflineEdits') === 'true') {
            const snapStr = localStorage.getItem('offlineSnapshot');
            if (snapStr) {
                try {
                    const localSnap = JSON.parse(snapStr);
                    if (data.lastModified !== localSnap.lastModified) {
                        showConflictModal(localSnap, data);
                        return; // 暫停自動覆蓋，等待使用者確認選擇
                    }
                } catch (e) {
                    console.error('Failed to parse offline snapshot', e);
                }
            }
        }

        if (data.players) players = data.players;
        if (data.matchState) {
            matchState = data.matchState;
            matchState.courts = matchState.courts || [];
            matchState.activeCourts = matchState.activeCourts || [];
            if (matchState.activeCourts.length === 0) {
                matchState.activeCourts = [
                    { name: '場地 1', isSingles: false, teamA: [null, null], teamB: [null, null] },
                    { name: '場地 2', isSingles: false, teamA: [null, null], teamB: [null, null] },
                    { name: '場地 3', isSingles: false, teamA: [null, null], teamB: [null, null] }
                ];
            }
        }
        if (data.matchConfig) {
            matchConfig = {
                enablePriority: data.matchConfig.enablePriority !== undefined ? data.matchConfig.enablePriority : true,
                priorityStep: data.matchConfig.priorityStep !== undefined ? data.matchConfig.priorityStep : 25,
                avoidRecentPartner: data.matchConfig.avoidRecentPartner !== undefined ? data.matchConfig.avoidRecentPartner : true,
                balanceMatchCount: data.matchConfig.balanceMatchCount !== undefined ? data.matchConfig.balanceMatchCount : false,
                maxTeamDiff: data.matchConfig.maxTeamDiff !== undefined ? data.matchConfig.maxTeamDiff : 2,
                maxPlayerGap: data.matchConfig.maxPlayerGap !== undefined ? data.matchConfig.maxPlayerGap : 4
            };
        }

        saveCurrentSettingsSnapshot();
        setUIFromConfig(savedSettingsSnapshot);

        if (!draggedPlayerId && !clickedPlayerId && !isPlayerEditMode) {
            renderDatabaseList();
            syncPoolWithPlayers();
            renderMatchUI();
        }
    }
});

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

window.toggleIsPlaying = (id, checked) => {
    const p = players.find(x => x.id === id);
    if (p) {
        p.isPlaying = checked;
        // If becoming active and has no priority, initialize with formula value
        if (checked && (p.priority === undefined || p.priority === null)) {
            p.priority = getUnplayedPriority();
        }
    }
    savePlayers();
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
    let updated = false;
    players.forEach(p => {
        if (p.isPlaying) {
            if (p.lastDate !== today) {
                p.attendance = (p.attendance || 0) + 1;
                p.matchCount = 0;
                p.lastPartnerId = null;
                p.lastDate = today;
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
            savePlayers();
            renderDatabaseList();
            updatePlayingCount();
        }
    });
}
const btnSelectAllAttendance = document.getElementById('btnSelectAllAttendance');
if (btnSelectAllAttendance) {
    btnSelectAllAttendance.addEventListener('click', () => {
        if (confirm('確定要將所有人設為出席嗎？')) {
            players.forEach(p => p.isPlaying = true);
            savePlayers();
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
            players.forEach(p => {
                p.matchCount = 0;
                p.lastPartnerId = null;
            });
            if (matchState && matchState.pool) {
                matchState.pool.forEach(p => {
                    p.matchCount = 0;
                    p.lastPartnerId = null;
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
        if (confirm('確定要重設所有人的等待優先值嗎？\n(未打過者與候補者將恢復初始優先值)')) {
            const initialVal = getUnplayedPriority();
            players.forEach(p => {
                p.priority = initialVal;
            });
            if (matchState && matchState.pool) {
                matchState.pool.forEach(p => {
                    p.priority = initialVal;
                });
            }
            savePlayers();
            renderMatchUI(true);
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
    const activeIds = players.filter(p => p.isPlaying !== false).map(p => p.id);
    matchState.activeCourts = matchState.activeCourts || [];
    matchState.courts = matchState.courts || [];
    matchState.pool = matchState.pool || [];

    for (let c of matchState.activeCourts) {
        c.teamA = c.teamA.map(p => p && activeIds.includes(p.id) ? p : null);
        c.teamB = c.teamB.map(p => p && activeIds.includes(p.id) ? p : null);
    }
    for (let c of matchState.courts) {
        c.teamA = c.teamA.map(p => p && activeIds.includes(p.id) ? p : null);
        c.teamB = c.teamB.map(p => p && activeIds.includes(p.id) ? p : null);
    }

    matchState.pool = matchState.pool.filter(p => p && activeIds.includes(p.id));

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
    if (!court || court.isSingles) return;
    if (court.teamA[0] && court.teamA[1]) {
        const p0 = players.find(x => x.id === court.teamA[0].id);
        const p1 = players.find(x => x.id === court.teamA[1].id);
        if (p0) p0.lastPartnerId = court.teamA[1].id;
        if (p1) p1.lastPartnerId = court.teamA[0].id;
    }
    if (court.teamB[0] && court.teamB[1]) {
        const p2 = players.find(x => x.id === court.teamB[0].id);
        const p3 = players.find(x => x.id === court.teamB[1].id);
        if (p2) p2.lastPartnerId = court.teamB[1].id;
        if (p3) p3.lastPartnerId = court.teamB[0].id;
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

    const isFull = court.isSingles ? (playersInCourt.length === 2) : (playersInCourt.length === 4);

    if (isFull) {
        recordAttendance();
        recordCourtPartners(court);

        // 1. 候補區等待中的球員增加優先值
        const step = (matchConfig && matchConfig.priorityStep) ? matchConfig.priorityStep : 25;
        if (matchConfig.enablePriority) {
            matchState.pool.forEach(poolP => {
                const curPrio = getPlayerPriority(poolP);
                poolP.priority = curPrio + step;
                const globalP = players.find(x => x.id === poolP.id);
                if (globalP) globalP.priority = poolP.priority;
            });
        }

        // 2. 剛下場的球員：場次 +1，優先值歸 0 休息
        playersInCourt.forEach(p => {
            const globalPlayer = players.find(x => x.id === p.id);
            if (globalPlayer) {
                globalPlayer.matchCount = (globalPlayer.matchCount || 0) + 1;
                globalPlayer.priority = 0;
            }
            p.matchCount = (p.matchCount || 0) + 1;
            p.priority = 0;
            matchState.pool.push(globalPlayer || p);
        });
    } else {
        // 未打滿即結束：不計場次與優先值
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

            const step = (matchConfig && matchConfig.priorityStep) ? matchConfig.priorityStep : 25;
            if (matchConfig.enablePriority) {
                matchState.pool.forEach(poolP => {
                    const curPrio = getPlayerPriority(poolP);
                    poolP.priority = curPrio + step;
                    const globalP = players.find(x => x.id === poolP.id);
                    if (globalP) globalP.priority = poolP.priority;
                });
            }

            activePlayers.forEach(p => {
                const globalPlayer = players.find(x => x.id === p.id);
                if (globalPlayer) {
                    globalPlayer.matchCount = (globalPlayer.matchCount || 0) + 1;
                    globalPlayer.priority = 0;
                }
                p.matchCount = (p.matchCount || 0) + 1;
                p.priority = 0;
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

    preCourt.teamA = [null, null];
    preCourt.teamB = [null, null];

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

function pickOneMatch(pool, neededSize, maxTeamDiff, maxPlayerGap, avoidRecentPartner) {
    if (pool.length < neededSize) return null;

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
            if ((maxPlayerGap > 0 && maxPlayerGap < 8) || (maxTeamDiff > 0 && maxTeamDiff < 8)) {
                return pickOneMatch(pool, neededSize, maxTeamDiff === 0 ? 0 : maxTeamDiff + 1, maxPlayerGap === 0 ? 0 : maxPlayerGap + 2, false);
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

    function findQuads(currMaxTeamDiff, currMaxPlayerGap, currAvoidPartner) {
        const quads = [];
        for (let i = 0; i < searchPool.length; i++) {
            for (let j = i + 1; j < searchPool.length; j++) {
                for (let k = j + 1; k < searchPool.length; k++) {
                    for (let l = k + 1; l < searchPool.length; l++) {
                        const p = [searchPool[i], searchPool[j], searchPool[k], searchPool[l]];
                        const lvls = [p[0].level, p[1].level, p[2].level, p[3].level];
                        const gap = Math.max(...lvls) - Math.min(...lvls);
                        if (currMaxPlayerGap > 0 && gap > currMaxPlayerGap) continue;

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
                                avgIndex: i + j + k + l
                            });
                        }
                    }
                }
            }
        }
        return quads;
    }

    let candidates = findQuads(maxTeamDiff, maxPlayerGap, avoidRecentPartner);

    if (candidates.length === 0 && avoidRecentPartner) {
        candidates = findQuads(maxTeamDiff, maxPlayerGap, false);
    }

    let relaxGap = maxPlayerGap;
    let relaxDiff = maxTeamDiff;
    while (candidates.length === 0 && ((relaxGap > 0 && relaxGap < 10) || (relaxDiff > 0 && relaxDiff < 10))) {
        if (relaxGap > 0) relaxGap += 1;
        if (relaxDiff > 0) relaxDiff += 1;
        candidates = findQuads(relaxDiff, relaxGap, false);
    }

    if (candidates.length === 0) {
        return {
            teamA: [candidatePool[0], candidatePool[1]],
            teamB: [candidatePool[2], candidatePool[3]],
            diff: 0
        };
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

function fillCourtsIntelligently(courts, pool) {
    const maxTeamDiff = (matchConfig && matchConfig.maxTeamDiff !== undefined) ? matchConfig.maxTeamDiff : 2;
    const maxPlayerGap = (matchConfig && matchConfig.maxPlayerGap !== undefined) ? matchConfig.maxPlayerGap : 4;
    const avoidPartner = (matchConfig && matchConfig.avoidRecentPartner !== undefined) ? matchConfig.avoidRecentPartner : true;

    for (let c of courts) {
        const needed = c.isSingles ? 2 : 4;
        if (pool.length < needed) break;

        const resultMatch = pickOneMatch(pool, needed, maxTeamDiff, maxPlayerGap, avoidPartner);
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
    }
    return pool;
}

function handleGenerate() {
    matchState.courts = matchState.courts || [];
    matchState.activeCourts = matchState.activeCourts || [];
    matchState = readStateFromDOM();
    const targetCourtsArray = matchState.courts.length > 0 ? matchState.courts : matchState.activeCourts;

    let availablePool = [...matchState.pool];

    const emptyCourts = targetCourtsArray.filter(c => {
        return c.teamA.every(p => p === null) && c.teamB.every(p => p === null);
    });

    if (emptyCourts.length === 0 && availablePool.length > 0) {
        alert('沒有空場地可供自動安排，請先「清空」或移出球員。');
        return;
    }

    availablePool = fillCourtsIntelligently(emptyCourts, availablePool);

    const remainingEmpty = emptyCourts.filter(c => {
        return c.teamA.every(p => p === null) && c.teamB.every(p => p === null);
    }).length;
    if (remainingEmpty > 0) {
        alert('安排完畢！但候補人數不足，還有 ' + remainingEmpty + ' 個場地為空。');
    }

    matchState.pool = availablePool;
    renderMatchUI(true);
}

window.autoFillCourt = (courtIndex) => {
    matchState = readStateFromDOM();
    const court = matchState.courts[courtIndex];
    if (!court) return;

    const isEmpty = court.teamA.every(p => p === null) && court.teamB.every(p => p === null);
    if (!isEmpty) {
        alert('此場地已經有球員了，請先將他們移至候補區才能重新安排。');
        return;
    }

    let availablePool = [...matchState.pool];
    const needed = court.isSingles ? 2 : 4;
    if (availablePool.length < needed) {
        alert('候補區人數不足，無法為此場地安排');
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

    const isEmpty = court.teamA.every(p => p === null) && court.teamB.every(p => p === null);
    if (!isEmpty) {
        alert('此場地已經有球員了，請先將他們移至候補區才能重新安排。');
        return;
    }

    let availablePool = [...matchState.pool];
    const needed = court.isSingles ? 2 : 4;
    if (availablePool.length < needed) {
        alert('候補區人數不足，無法為此場地安排');
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

    const prioHtml = (state === 'pool' && matchConfig.enablePriority) ? `<span class="${prioClass}" title="等待優先值">⚡${prio}</span>` : '';
    const matchCountHtml = (state === 'pool' || state === 'ghost') ? `<span class="match-count-badge" title="今日場數">${p.matchCount || 0}場</span>` : '';

    el.innerHTML = `
        <span class="level-badge level-${p.level}">${p.level}</span>
        <span class="player-name">${p.name}</span>
        ${prioHtml}
        ${matchCountHtml}
    `;

    if (state !== 'ghost') {
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
    db.collection('badminton').doc('state').set({ matchState }, { merge: true });
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
                <div class="court-header-top">
                    <input type="text" class="court-name-input" maxlength="6" value="${c.name || ('場地 ' + (idx + 1))}" onchange="forceStateSync()">
                </div>
                <div class="court-header-bottom">
                    ${clearBtnHtml}
                    <div style="display: flex; align-items: center; gap: 0.35rem; margin-left: auto;">
                        ${autoBtnHtml}
                        ${finishBtnHtml}
                    </div>
                </div>
            </div>
            <div class="teams-wrapper">
                <div class="team">
                    <div class="team-header">A 隊 (總星數 <span>0</span>)</div>
                    ${slotsAHtml}
                </div>
                <div class="vs-divider">
                    <span class="vs-text">VS</span>
                    <button class="mode-badge-btn ${c.isSingles ? 'is-singles' : ''}" onclick="toggleActiveCourtMode(${idx})" title="點擊切換 單打 / 雙打">
                        ${c.isSingles ? '單' : '雙'}
                    </button>
                </div>
                <div class="team">
                    <div class="team-header">B 隊 (總星數 <span>0</span>)</div>
                    ${slotsBHtml}
                </div>
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

            let pushOptions = '<option value="" disabled selected>推至場地...</option>';
            matchState.activeCourts.forEach((ac, aIdx) => {
                pushOptions += `<option value="${aIdx}">${ac.name || ('場地 ' + (aIdx + 1))}</option>`;
            });

            const pushSelectHtml = `<select class="push-select" onchange="pushToActiveCourt(${idx}, this.value); this.value='';">
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
                    <div class="court-header-top">
                        <span class="court-title-text">${c.name || ('預備場 ' + (idx + 1))}</span>
                        <div style="display: flex; align-items: center; gap: 0.3rem;">
                            ${clearCourtBtnHtml}
                            ${autoBtnHtml}
                        </div>
                    </div>
                    <div class="court-header-bottom">
                        ${pushSelectHtml}
                    </div>
                </div>
                <div class="teams-wrapper">
                    <div class="team">
                        <div class="team-header">A 隊 (總星數 <span>0</span>)</div>
                        ${slotsAHtml}
                    </div>
                    <div class="vs-divider">
                        <span class="vs-text">VS</span>
                        <button class="mode-badge-btn ${c.isSingles ? 'is-singles' : ''}" onclick="toggleCourtMode(${idx})" title="點擊切換 單打 / 雙打">
                            ${c.isSingles ? '單' : '雙'}
                        </button>
                    </div>
                    <div class="team">
                        <div class="team-header">B 隊 (總星數 <span>0</span>)</div>
                        ${slotsBHtml}
                    </div>
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
            let optionsHtml = `<option value="" disabled selected>請選擇球員</option>`;
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

// Initial Boot
saveCurrentSettingsSnapshot();
setUIFromConfig(savedSettingsSnapshot);
renderDatabaseList();
syncPoolWithPlayers();
renderMatchUI();
