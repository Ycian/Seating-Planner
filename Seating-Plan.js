document.addEventListener('DOMContentLoaded', async () => {
  const SUPABASE_URL = "https://dlgecgypzeucpfrcxdzq.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsZ2VjZ3lwemV1Y3BmcmN4ZHpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUwODk4ODUsImV4cCI6MjA3MDY2NTg4NX0.xz0twrBoz9xh3X7LI2uati8EKlTEq3NpKhaorzuiyCE";
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  let version = 0;
  let onlineUsers = 0;
  let seatingChart = null;
  
  const uid = () => Math.random().toString(36).slice(2,9);
  const qs = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
  const escapeHtml = (s) => s.replace(/[&<>\"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[c]));
  
  const seed = () => ({
    guests: [
      { id: uid(), name: '张三', count: 2, category: 'family', related: [] },
      { id: uid(), name: '李四', count: 3, category: 'friend', related: [] },
      { id: uid(), name: '王五', count: 1, category: 'colleague', related: [] },
      { id: uid(), name: '赵六', count: 2, category: 'family', related: [] },
      { id: uid(), name: '钱七', count: 4, category: 'friend', related: [] },
      { id: uid(), name: '孙八', count: 2, category: 'colleague', related: [] },
      { id: uid(), name: '周九', count: 1, category: 'other', related: [] },
      { id: uid(), name: '吴十', count: 2, category: 'family', related: [] }
    ],
    tables: [
      { id: uid(), name: '1号桌', capacity: 10, guests: [] },
      { id: uid(), name: '2号桌', capacity: 10, guests: [] },
      { id: uid(), name: '3号桌', capacity: 8, guests: [] }
    ]
  });
  
  const showLoading = (message = '处理中...') => {
    const indicator = qs('#loadingIndicator');
    qs('#loadingMessage').textContent = message;
    indicator.classList.add('active');
  };
  
  const hideLoading = () => {
    qs('#loadingIndicator').classList.remove('active');
  };
  
  const parseGuestInput = (inputStr) => {
    const nameWithoutNotes = inputStr.replace(/[（(].*?[)）]/g, '').trim();
    const match = nameWithoutNotes.match(/^(.+)\s+(\d+)$/);
    if (match) {
      return {
        name: match[1].trim(),
        count: Math.max(1, parseInt(match[2], 10))
      };
    }
    return {
      name: nameWithoutNotes,
      count: 1
    };
  };
  
  const showToast = (message, type = 'success', duration = 3000) => {
    const container = qs('#toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'check-circle';
    if (type === 'error') icon = 'times-circle';
    if (type === 'warning') icon = 'exclamation-circle';
    if (type === 'info') icon = 'info-circle';
    
    toast.innerHTML = `<i class="fas fa-${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => toast.remove(), duration);
  };

  const validateInput = {
    name: (name) => {
      if (!name || name.trim() === '') return { valid: false, message: '姓名不能为空' };
      if (name.length > 50) return { valid: false, message: '姓名过长，请控制在50字符以内' };
      return { valid: true };
    },
    count: (count) => {
      const num = Number(count);
      if (isNaN(num) || num < 1 || !Number.isInteger(num)) {
        return { valid: false, message: '人数必须是大于0的整数' };
      }
      if (num > 10) return { valid: false, message: '人数过多，请控制在10人以内' };
      return { valid: true };
    },
    tableName: (name) => {
      if (!name || name.trim() === '') return { valid: false, message: '桌名不能为空' };
      if (name.length > 30) return { valid: false, message: '桌名过长，请控制在30字符以内' };
      return { valid: true };
    },
    capacity: (cap) => {
      const num = Number(cap);
      if (isNaN(num) || num < 1 || !Number.isInteger(num)) {
        return { valid: false, message: '容量必须是大于0的整数' };
      }
      if (num > 100) return { valid: false, message: '容量过大，请控制在100以内' };
      return { valid: true };
    }
  };

  const hashParams = new URLSearchParams((location.hash||"").slice(1));
  let planId = hashParams.get("plan");

  const state = { guests: [], tables: [] };
  const localChanges = {
    guests: { added: [], updated: [], removed: [] },
    tables: { added: [], updated: [], removed: [] }
  };
  
  const el = {
    search: qs('#search'), 
    bulkNames: qs('#bulkNames'),
    addGuestsBtn: qs('#addGuestsBtn'), 
    clearGuestsBtn: qs('#clearGuestsBtn'),
    tableName: qs('#tableName'), 
    tableCap: qs('#tableCap'), 
    addTableBtn: qs('#addTableBtn'),
    guestList: qs('#guestList'), 
    canvas: qs('#canvas'), 
    stats: qs('#stats'),
    autoSeatBtn: qs('#autoSeatBtn'), 
    shuffleBtn: qs('#shuffleBtn'),
    exportBtn: qs('#exportBtn'), 
    exportFormat: qs('#exportFormat'),
    importFile: qs('#importFile'), 
    importPreview: qs('#importPreview'),
    confirmImportBtn: qs('#confirmImportBtn'),
    printBtn: qs('#printBtn'),
    printListBtn: qs('#printListBtn'), // 新增打印名单按钮引用
    resetAllBtn: qs('#resetAllBtn'),
    shareBtn: qs('#shareBtn'), 
    shareTip: qs('#shareTip'), 
    planIdLabel: qs('#planIdLabel'),
    colsRange: qs('#colsRange'), 
    colsNumber: qs('#colsNumber'),
    guestCategory: qs('#guestCategory'),
    categoryFilter: qs('#categoryFilter'),
    batchTableSelect: qs('#batchTableSelect'),
    batchMoveBtn: qs('#batchMoveBtn'),
    filterResult: qs('#filterResult'),
    filterCount: qs('#filterCount'),
    groupByCategory: qs('#groupByCategory'),
    optimizeSeating: qs('#optimizeSeating'),
    conflictModal: qs('#conflictModal'),
    keepMineBtn: qs('#keepMineBtn'),
    takeTheirsBtn: qs('#takeTheirsBtn'),
    mergeChangesBtn: qs('#mergeChangesBtn'),
    conflictDetails: qs('#conflictDetails'),
    onlineUsers: qs('#onlineUsers')
  };

  let writing = false, writeTimer = null;
  const SAVE_DELAY = 500;

  function setCols(n){
    n = Math.max(1, Math.min(8, Number(n)||3));
    document.documentElement.style.setProperty('--cols', n);
    el.colsRange.value = n; 
    el.colsNumber.value = n;
    localStorage.setItem('seating_cols', String(n));
  }
  
  setCols(Number(localStorage.getItem('seating_cols')||3));
  el.colsRange.oninput = e => setCols(e.target.value);
  el.colsNumber.oninput = e => setCols(e.target.value);

  async function ensurePlan(){
    if (planId) return planId;
    try {
      showLoading('创建新计划...');
      const seeded = seed();
      const { data, error } = await supabase
        .from('plans')
        .insert({ 
          title: 'Seating Plan', 
          state: seeded,
          version: 1
        })
        .select('id')
        .single();
        
      if (error) { 
        showToast('创建计划失败：' + error.message, 'error');
        throw error; 
      }
      
      planId = data.id;
      version = 1;
      const p = new URL(location.href); 
      p.hash = 'plan=' + planId; 
      history.replaceState(null, '', p);
      showToast('计划创建成功');
      return planId;
    } catch (error) {
      console.error('创建计划失败:', error);
      throw error;
    } finally {
      hideLoading();
    }
  }

  async function loadPlan(){
    try {
      showLoading('加载计划中...');
      const { data, error } = await supabase
        .from('plans')
        .select('state, version')
        .eq('id', planId)
        .single();
        
      if (error) { 
        showToast('加载失败：' + error.message, 'error');
        return; 
      }
      
      Object.assign(state, (data && data.state) ? data.state : { guests:[], tables:[] });
      version = data.version || 1;
      
      state.guests = state.guests.map(guest => {
        if (guest.count === undefined) guest.count = 1;
        if (!guest.category) guest.category = 'other';
        if (!guest.related) guest.related = [];
        return guest;
      });
      
      const _gl = (state && state.guests) ? state.guests.length : 0; 
      const _tl = (state && state.tables) ? state.tables.length : 0; 
      
      if (_gl === 0 && _tl === 0) {
        const s = seed(); 
        state.guests = s.guests; 
        state.tables = s.tables; 
        scheduleSave();
      }
      
      render();
      updateChart();
      updateStats();
      showToast('计划加载成功');
    } catch (error) {
      console.error('加载计划失败:', error);
      showToast('加载计划失败，请刷新页面重试', 'error');
    } finally {
      hideLoading();
    }
  }

  function scheduleSave(){ 
    if (writing) return;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(saveNow, SAVE_DELAY);
  }
  
  async function saveNow(){
    if (!planId) return;
    
    writing = true;
    try {
      const hasConflicts = detectAndFixConflicts();
      const newVersion = version + 1;
      
      const { error } = await supabase
        .from('plans')
        .update({ 
          state,
          version: newVersion,
          updated_at: new Date()
        })
        .eq('id', planId)
        .eq('version', version);
        
      if (error) {
        if (error.code === '23505' || error.message.includes('violates row-level security')) {
          showConflictModal();
        } else {
          console.error('保存失败:', error);
          showToast('保存失败: ' + error.message, 'error');
        }
      } else {
        version = newVersion;
        clearLocalChanges();
      }
    } catch (error) {
      console.error('保存过程出错:', error);
      showToast('保存过程出错，请重试', 'error');
    } finally {
      writing = false;
    }
  }

  async function showConflictModal() {
    try {
      const { data: serverData } = await supabase
        .from('plans')
        .select('state, version')
        .eq('id', planId)
        .single();
      
      const serverState = serverData.state;
      const serverVersion = serverData.version;
      const conflicts = analyzeConflicts(state, serverState);
      
      displayConflicts(conflicts);
      el.conflictModal.classList.add('active');
      
      const handleClose = () => {
        el.conflictModal.classList.remove('active');
        el.keepMineBtn.removeEventListener('click', keepMineHandler);
        el.takeTheirsBtn.removeEventListener('click', takeTheirsHandler);
        el.mergeChangesBtn.removeEventListener('click', mergeChangesHandler);
      };
      
      const keepMineHandler = async () => {
        version = serverVersion;
        await saveNow();
        handleClose();
      };
      
      const takeTheirsHandler = async () => {
        Object.assign(state, serverState);
        version = serverVersion;
        clearLocalChanges();
        render();
        updateChart();
        handleClose();
        showToast('已采用最新的服务器数据');
      };
      
      const mergeChangesHandler = async () => {
        const mergedState = mergeStates(state, serverState);
        Object.assign(state, mergedState);
        version = serverVersion;
        clearLocalChanges();
        await saveNow();
        render();
        updateChart();
        handleClose();
        showToast('已合并本地和服务器的更改');
      };
      
      el.keepMineBtn.addEventListener('click', keepMineHandler);
      el.takeTheirsBtn.addEventListener('click', takeTheirsHandler);
      el.mergeChangesBtn.addEventListener('click', mergeChangesHandler);
      
    } catch (error) {
      console.error('处理冲突失败:', error);
      showToast('处理冲突失败，请刷新页面', 'error');
    }
  }
  
  function analyzeConflicts(localState, serverState) {
    const conflicts = { guests: [], tables: [] };
    
    const localGuestsById = Object.fromEntries(localState.guests.map(g => [g.id, g]));
    const serverGuestsById = Object.fromEntries(serverState.guests.map(g => [g.id, g]));
    
    for (const [id, localGuest] of Object.entries(localGuestsById)) {
      const serverGuest = serverGuestsById[id];
      if (serverGuest && !isEqual(localGuest, serverGuest)) {
        conflicts.guests.push({ id, mine: localGuest, theirs: serverGuest });
      }
    }
    
    const localTablesById = Object.fromEntries(localState.tables.map(t => [t.id, t]));
    const serverTablesById = Object.fromEntries(serverState.tables.map(t => [t.id, t]));
    
    for (const [id, localTable] of Object.entries(localTablesById)) {
      const serverTable = serverTablesById[id];
      if (serverTable && !isEqual(localTable, serverTable)) {
        conflicts.tables.push({ id, mine: localTable, theirs: serverTable });
      }
    }
    
    return conflicts;
  }
  
  function displayConflicts(conflicts) {
    el.conflictDetails.innerHTML = '';
    
    if (conflicts.guests.length === 0 && conflicts.tables.length === 0) {
      el.conflictDetails.innerHTML = '<p>未发现具体冲突，可以安全合并。</p>';
      return;
    }
    
    if (conflicts.guests.length > 0) {
      const guestSection = document.createElement('div');
      guestSection.innerHTML = `<h3 style="margin-bottom:8px;">宾客冲突 (${conflicts.guests.length})</h3>`;
      
      conflicts.guests.forEach(conflict => {
        const item = document.createElement('div');
        item.className = 'conflict-item';
        item.innerHTML = `
          <div style="margin-bottom:6px; font-weight:bold;">${escapeHtml(conflict.mine.name)}</div>
          <div class="conflict-item mine">
            <div style="font-size:12px; color:var(--muted); margin-bottom:2px;">我的修改：</div>
            <div>人数: ${conflict.mine.count}，分类: ${getCategoryName(conflict.mine.category)}</div>
          </div>
          <div class="conflict-item theirs">
            <div style="font-size:12px; color:var(--muted); margin-bottom:2px;">其他人的修改：</div>
            <div>人数: ${conflict.theirs.count}，分类: ${getCategoryName(conflict.theirs.category)}</div>
          </div>
        `;
        guestSection.appendChild(item);
      });
      
      el.conflictDetails.appendChild(guestSection);
    }
    
    if (conflicts.tables.length > 0) {
      const tableSection = document.createElement('div');
      tableSection.innerHTML = `<h3 style="margin-bottom:8px; margin-top:12px;">桌位冲突 (${conflicts.tables.length})</h3>`;
      
      conflicts.tables.forEach(conflict => {
        const item = document.createElement('div');
        item.className = 'conflict-item';
        item.innerHTML = `
          <div style="margin-bottom:6px; font-weight:bold;">${escapeHtml(conflict.mine.name)}</div>
          <div class="conflict-item mine">
            <div style="font-size:12px; color:var(--muted); margin-bottom:2px;">我的修改：</div>
            <div>容量: ${conflict.mine.capacity}，宾客数: ${conflict.mine.guests.length}</div>
          </div>
          <div class="conflict-item theirs">
            <div style="font-size:12px; color:var(--muted); margin-bottom:2px;">其他人的修改：</div>
            <div>容量: ${conflict.theirs.capacity}，宾客数: ${conflict.theirs.guests.length}</div>
          </div>
        `;
        tableSection.appendChild(item);
      });
      
      el.conflictDetails.appendChild(tableSection);
    }
  }
  
  function mergeStates(localState, serverState) {
    const merged = {
      guests: [...serverState.guests],
      tables: [...serverState.tables]
    };
    
    const mergedGuestsById = Object.fromEntries(merged.guests.map(g => [g.id, g]));
    const mergedTablesById = Object.fromEntries(merged.tables.map(t => [t.id, t]));
    
    localState.guests.forEach(localGuest => {
      if (!mergedGuestsById[localGuest.id]) {
        merged.guests.push(localGuest);
        mergedGuestsById[localGuest.id] = localGuest;
      } else {
        const index = merged.guests.findIndex(g => g.id === localGuest.id);
        merged.guests[index] = localGuest;
      }
    });
    
    localState.tables.forEach(localTable => {
      if (!mergedTablesById[localTable.id]) {
        merged.tables.push(localTable);
        mergedTablesById[localTable.id] = localTable;
      } else {
        const index = merged.tables.findIndex(t => t.id === localTable.id);
        merged.tables[index] = localTable;
      }
    });
    
    return merged;
  }
  
  function isEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  
  function clearLocalChanges() {
    localChanges.guests = { added: [], updated: [], removed: [] };
    localChanges.tables = { added: [], updated: [], removed: [] };
  }
  
  function getCategoryName(category) {
    const names = {
      family: '家人',
      friend: '朋友',
      colleague: '同事',
      other: '其他'
    };
    return names[category] || '其他';
  }

  function subscribeRealtime(){
    if (!planId) return;
    
    supabase.channel('plan-'+planId)
      .on('postgres_changes', 
        { event:'UPDATE', schema:'public', table:'plans', filter:'id=eq.'+planId }, 
        async (payload) => {
          if (writing) return;
          
          try {
            if (payload.new.version > version) {
              showLoading('检测到更新，正在同步...');
              
              const newState = payload.new.state || { guests:[], tables:[] };
              state.guests = newState.guests || [];
              state.tables = newState.tables || [];
              version = payload.new.version;
              
              state.guests = state.guests.map(guest => {
                if (guest.count === undefined) guest.count = 1;
                if (!guest.category) guest.category = 'other';
                if (!guest.related) guest.related = [];
                return guest;
              });
              
              clearLocalChanges();
              render();
              updateChart();
              showToast('数据已更新', 'success', 2000);
            }
          } catch (error) {
            console.error('处理实时更新失败:', error);
            showToast('更新数据时出错', 'error');
          } finally {
            hideLoading();
          }
        }
      )
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          showToast('已连接到实时协作', 'success', 2000);
        } else if (status === 'CHANNEL_ERROR') {
          showToast('实时协作连接出错', 'error');
        }
      });
      
    const presenceChannel = supabase.channel('presence-'+planId)
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        onlineUsers = Object.values(state).flat().length;
        el.onlineUsers.textContent = `在线：${onlineUsers}人`;
      })
      .subscribe();
      
    const user = { id: uid(), online: true };
    presenceChannel.track({ users: user });
    
    window.addEventListener('beforeunload', () => {
      presenceChannel.untrack();
    });
  }

  function detectAndFixConflicts() {
    const guestCounts = {};
    
    state.tables.forEach(table => {
      table.guests.forEach(guestId => {
        guestCounts[guestId] = (guestCounts[guestId] || 0) + 1;
      });
    });
    
    const conflictGuests = Object.entries(guestCounts)
      .filter(([_, count]) => count > 1)
      .map(([guestId, _]) => guestId);
      
    if (conflictGuests.length > 0) {
      const seen = new Set();
      state.tables.forEach(table => {
        const newGuests = [];
        table.guests.forEach(guestId => {
          if (conflictGuests.includes(guestId)) {
            if (!seen.has(guestId)) {
              seen.add(guestId);
              newGuests.push(guestId);
            }
          } else {
            newGuests.push(guestId);
          }
        });
        table.guests = newGuests;
      });
      
      showToast(`已自动修复 ${conflictGuests.length} 个座位冲突`, 'warning');
    }
    
    return conflictGuests.length > 0;
  }

  function getTableOccupiedSeats(tableId) {
    const table = state.tables.find(t => t.id === tableId);
    if (!table) return 0;
    
    return table.guests.reduce((total, guestId) => {
      const guest = state.guests.find(g => g.id === guestId);
      return total + (guest ? guest.count : 1);
    }, 0);
  }

  function updateChart() {
    const ctx = document.getElementById('seatingChart').getContext('2d');
    
    const categoryStats = {
      family: { total: 0, seated: 0 },
      friend: { total: 0, seated: 0 },
      colleague: { total: 0, seated: 0 },
      other: { total: 0, seated: 0 }
    };
    
    const seatedIds = new Set(state.tables.flatMap(t => t.guests));
    
    state.guests.forEach(guest => {
      if (categoryStats[guest.category]) {
        categoryStats[guest.category].total += guest.count;
        
        if (seatedIds.has(guest.id)) {
          categoryStats[guest.category].seated += guest.count;
        }
      }
    });
    
    const labels = ['家人', '朋友', '同事', '其他'];
    const totalData = labels.map(label => {
      const key = Object.keys(categoryStats).find(k => getCategoryName(k) === label);
      return categoryStats[key].total;
    });
    
    const seatedData = labels.map(label => {
      const key = Object.keys(categoryStats).find(k => getCategoryName(k) === label);
      return categoryStats[key].seated;
    });
    
    const backgroundColor = [
      'rgba(76, 217, 100, 0.6)',
      'rgba(255, 204, 0, 0.6)',
      'rgba(106, 167, 255, 0.6)',
      'rgba(159, 123, 255, 0.6)'
    ];
    
    const borderColor = [
      'rgba(76, 217, 100, 1)',
      'rgba(255, 204, 0, 1)',
      'rgba(106, 167, 255, 1)',
      'rgba(159, 123, 255, 1)'
    ];
    
    if (seatingChart) seatingChart.destroy();
    
    seatingChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: '已入座',
            data: seatedData,
            backgroundColor: backgroundColor,
            borderColor: borderColor,
            borderWidth: 1
          },
          {
            label: '未入座',
            data: totalData.map((total, i) => total - seatedData[i]),
            backgroundColor: 'rgba(50, 50, 80, 0.6)',
            borderColor: 'rgba(50, 50, 80, 1)',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            grid: { color: 'rgba(255, 255, 255, 0.1)' },
            ticks: { color: 'rgba(255, 255, 255, 0.7)' }
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: 'rgba(255, 255, 255, 0.1)' },
            ticks: { color: 'rgba(255, 255, 255, 0.7)', precision: 0 }
          }
        },
        plugins: {
          legend: { labels: { color: 'rgba(255, 255, 255, 0.7)' } }
        }
      }
    });
  }

  function render(){
    if (!planId) return;
    
    el.planIdLabel.textContent = planId;
    el.shareTip.textContent = location.href;

    updateBatchTableSelect();
    
    const seatedIds = new Set(state.tables.flatMap(t=>t.guests));
    const filterText = (el.search.value||'').trim().toLowerCase();
    const activeCategory = qs('#categoryFilter .category-btn.active').dataset.category;
    
    let pending = state.guests
      .filter(g => !seatedIds.has(g.id))
      .filter(g => !filterText || g.name.toLowerCase().includes(filterText))
      .filter(g => activeCategory === 'all' || g.category === activeCategory);

    const totalPeopleInFilter = pending.reduce((sum, guest) => sum + guest.count, 0);
    const categoryNames = {
      family: '家人',
      friend: '朋友',
      colleague: '同事',
      other: '其他',
      all: '全部'
    };
    
    el.filterResult.querySelector('span:first-child').textContent = 
      `显示 ${categoryNames[activeCategory]} 未入座宾客` + 
      (filterText ? `（搜索: ${filterText}）` : '');
    el.filterCount.textContent = `${pending.length}组 / ${totalPeopleInFilter}人`;

    renderVirtualList(pending);

    el.canvas.innerHTML = '';
    for (const t of state.tables){
      const card = document.createElement('section'); 
      card.className = 'table-card'; 
      card.dataset.tableId = t.id;
      
      const occupiedSeats = getTableOccupiedSeats(t.id);
      const isFull = occupiedSeats >= t.capacity;
      const fullIndicator = isFull ? '<span style="color:var(--warning);margin-left:4px;">(已满)</span>' : '';
      
      const tableGuestIds = t.guests;
      const idCount = {};
      let hasConflict = false;
      
      tableGuestIds.forEach(id => {
        idCount[id] = (idCount[id] || 0) + 1;
        if (idCount[id] > 1) hasConflict = true;
      });
      
      tableGuestIds.forEach(id => {
        if (state.tables.some(otherTable => otherTable.id !== t.id && otherTable.guests.includes(id))) {
          hasConflict = true;
        }
      });
      
      if (hasConflict) card.classList.add('has-conflict');
      
      card.innerHTML = `
        <div class="table-header">
          <span class="badge">🪑 ${escapeHtml(t.name)}${fullIndicator}</span>
          <span class="capacity">容量 ${t.capacity} | 已占用 ${occupiedSeats}</span>
        </div>
        <div class="table-visual"><div class="round-wrap"><div class="round">${escapeHtml(t.name)}</div></div></div>
        <div class="table-footer">
          <a class="link rename">重命名</a> ·
          <a class="link setcap">设置容量</a> ·
          <a class="link clear">清空</a>
          <div class="spacer"></div>
          <a class="link remove-table">删除桌</a>
        </div>`;

      const wrap = qs('.round-wrap', card);
      const seated = t.guests.map(id => state.guests.find(g => g.id === id)).filter(Boolean);
      const seats = t.capacity, R = 95;
      
      const duplicateIds = [];
      const idCountForConflict = {};
      
      tableGuestIds.forEach(id => {
        idCountForConflict[id] = (idCountForConflict[id] || 0) + 1;
        if (idCountForConflict[id] > 1) duplicateIds.push(id);
      });
      
      for (let i = 0; i < seats; i++){
        const angle = (i / seats) * 2 * Math.PI - Math.PI / 2;
        const x = Math.cos(angle) * R + 110; 
        const y = Math.sin(angle) * R + 110;
        
        const chair = document.createElement('div');
        chair.className = 'chair';
        chair.style.left = (x - 32) + 'px'; 
        chair.style.top = (y - 14) + 'px';
        
        let occupiedBy = null;
        let currentSeat = 0;
        
        for (const guest of seated) {
          if (i >= currentSeat && i < currentSeat + guest.count) {
            occupiedBy = guest;
            break;
          }
          currentSeat += guest.count;
        }
        
        if (occupiedBy) {
          const isConflicted = duplicateIds.includes(occupiedBy.id) || 
            state.tables.some(otherTable => 
              otherTable.id !== t.id && otherTable.guests.includes(occupiedBy.id)
            );
          
          if (isConflicted) chair.classList.add('conflict');
          
          const isFirstSeat = i === currentSeat;
          chair.innerHTML = isFirstSeat 
            ? `<span>${escapeHtml(shortName(occupiedBy.name))}</span><span class="count">${occupiedBy.count}</span><span class="kick">×</span>`
            : `<span>${escapeHtml(shortName(occupiedBy.name))}</span><span class="count">+${i - currentSeat}</span>`;
          
          if (isFirstSeat) {
            const kick = chair.querySelector('.kick');
            kick.onclick = (ev) => { 
              ev.stopPropagation(); 
              t.guests = t.guests.filter(id => id !== occupiedBy.id);
              localChanges.tables.updated.push(t.id);
              scheduleSave(); 
              render();
              showToast(`已将 ${occupiedBy.name} 一行(${occupiedBy.count}人)从 ${t.name} 移除`);
            };
            
            chair.draggable = true; 
            chair.dataset.guestId = occupiedBy.id; 
            chair.dataset.tableId = t.id; 
            attachGuestDrag(chair);
          }
        } else {
          chair.classList.add('empty'); 
          chair.textContent = '空位';
        }
        
        wrap.appendChild(chair);
      }

      wrap.addEventListener('dragover', e => { 
        e.preventDefault();
        wrap.style.backgroundColor = 'rgba(255,255,255,0.05)';
      });
      
      wrap.addEventListener('dragleave', () => {
        wrap.style.backgroundColor = '';
      });
      
      wrap.addEventListener('drop', e => {
        e.preventDefault();
        wrap.style.backgroundColor = '';
        
        const gid = draggingId || e.dataTransfer.getData('text/plain'); 
        if (!gid) return;
        
        const guest = state.guests.find(g => g.id === gid);
        if (!guest) return;
        
        const occupiedSeats = getTableOccupiedSeats(t.id);
        if (occupiedSeats + guest.count > t.capacity) {
          showToast(`${t.name} 空间不足，无法容纳 ${guest.name} 一行(${guest.count}人)`, 'warning');
          return;
        }
        
        const fromTable = state.tables.find(tt => tt.guests.includes(gid));
        if (fromTable && fromTable.id !== t.id) {
          fromTable.guests = fromTable.guests.filter(id => id !== gid);
          localChanges.tables.updated.push(fromTable.id);
        }
        
        if (!t.guests.includes(gid)) {
          t.guests.push(gid);
          localChanges.tables.updated.push(t.id);
          scheduleSave(); 
          render();
          showToast(`已将 ${guest.name} 一行(${guest.count}人)安排到 ${t.name}`);
        }
      });

      qs('.rename', card).onclick = () => {
        const name = prompt('桌名：', t.name); 
        if (name && name.trim()) {
          const validation = validateInput.tableName(name);
          if (!validation.valid) {
            showToast(validation.message, 'error');
            return;
          }
          
          t.name = name.trim(); 
          localChanges.tables.updated.push(t.id);
          scheduleSave(); 
          render();
          showToast(`已重命名为 ${t.name}`);
        } 
      };
      
      qs('.setcap', card).onclick = () => {
        const cap = prompt('容量（座位数）：', t.capacity); 
        const n = Number(cap); 
        
        const validation = validateInput.capacity(n);
        if (!validation.valid) {
          showToast(validation.message, 'error');
          return;
        }
        
        const occupiedSeats = getTableOccupiedSeats(t.id);
        let removedGuests = [];
        
        if (n < occupiedSeats) {
          let remainingCapacity = n;
          const newGuests = [];
          
          for (const guestId of t.guests) {
            const guest = state.guests.find(g => g.id === guestId);
            if (!guest) continue;
            
            if (remainingCapacity >= guest.count) {
              newGuests.push(guestId);
              remainingCapacity -= guest.count;
            } else {
              removedGuests.push(guest);
            }
          }
          
          t.guests = newGuests;
        }
        
        t.capacity = n; 
        localChanges.tables.updated.push(t.id);
        scheduleSave(); 
        render();
        
        if (removedGuests.length > 0) {
          showToast(`桌容量调整，${removedGuests.length}组宾客已移除`, 'warning');
        } else {
          showToast(`桌容量已更新为 ${t.capacity}`, 'success');
        }
      };
      
      qs('.clear', card).onclick = () => {
        if (confirm(`确定要清空 ${t.name} 吗？`)) {
          t.guests = [];
          localChanges.tables.updated.push(t.id);
          scheduleSave(); 
          render();
          showToast(`${t.name} 已清空`, 'success');
        }
      };
      
      qs('.remove-table', card).onclick = () => {
        if (confirm(`确定要删除 ${t.name} 吗？桌上的宾客将被移回未入座列表。`)) {
          const index = state.tables.findIndex(tt => tt.id === t.id);
          if (index !== -1) {
            state.tables.splice(index, 1);
            localChanges.tables.removed.push(t.id);
            scheduleSave(); 
            render();
            showToast(`${t.name} 已删除`, 'success');
          }
        }
      };
      
      el.canvas.appendChild(card);
    }
     updateStats();
  }
    // 添加统计数据计算函数
  function calculateStats() {
    // 计算总宾客数(按实际人数计算)
    const totalGuestCount = state.guests.reduce((sum, guest) => sum + guest.count, 0);
    
    // 计算已入座宾客ID集合
    const seatedGuestIds = new Set();
    state.tables.forEach(table => {
      table.guests.forEach(guestId => seatedGuestIds.add(guestId));
    });
    
    // 计算已入座和未入座宾客数
    let seatedCount = 0;
    state.guests.forEach(guest => {
      if (seatedGuestIds.has(guest.id)) {
        seatedCount += guest.count;
      }
    });
    const unseatedCount = totalGuestCount - seatedCount;
    
    // 按分类统计宾客数
    const categoryCounts = {
      family: 0,
      friend: 0,
      colleague: 0,
      other: 0
    };
    state.guests.forEach(guest => {
      if (categoryCounts.hasOwnProperty(guest.category)) {
        categoryCounts[guest.category] += guest.count;
      } else {
        categoryCounts.other += guest.count;
      }
    });
    
    // 桌位统计
    const totalTables = state.tables.length;
    const totalCapacity = state.tables.reduce((sum, table) => sum + table.capacity, 0);
    const usedCapacity = seatedCount;
    const emptyCapacity = totalCapacity - usedCapacity;
    const capacityUsage = totalCapacity > 0 ? Math.round((usedCapacity / totalCapacity) * 100) : 0;
    
    return {
      totalGuestCount,
      seatedCount,
      unseatedCount,
      categoryCounts,
      totalTables,
      totalCapacity,
      usedCapacity,
      emptyCapacity,
      capacityUsage
    };
  }
  
  // 添加更新统计显示的函数
  function updateStats() {
    const stats = calculateStats();
    
    // 构建统计HTML
    el.stats.innerHTML = `
      <div class="pill"><i class="fas fa-users"></i> 总宾客: ${stats.totalGuestCount}</div>
      <div class="pill"><i class="fas fa-chair"></i> 已入座: ${stats.seatedCount}</div>
      <div class="pill"><i class="fas fa-user-clock"></i> 未入座: ${stats.unseatedCount}</div>
      <div class="pill"><i class="fas fa-utensils"></i> 桌位: ${stats.totalTables} (${stats.capacityUsage}% 占用)</div>
      <div class="pill family"><i class="fas fa-home"></i> 家人: ${stats.categoryCounts.family}</div>
      <div class="pill friend"><i class="fas fa-handshake"></i> 朋友: ${stats.categoryCounts.friend}</div>
      <div class="pill colleague"><i class="fas fa-briefcase"></i> 同事: ${stats.categoryCounts.colleague}</div>
      <div class="pill other"><i class="fas fa-ellipsis-h"></i> 其他: ${stats.categoryCounts.other}</div>
    `;
    
    // 更新未入座筛选计数
    el.filterCount.textContent = `${stats.unseatedCount}人`;
  }
  
  // 在CSS中添加统计相关样式
  const style = document.createElement('style');
  style.textContent = `
    .pill.family { border-left: 3px solid var(--family); }
    .pill.friend { border-left: 3px solid var(--friend); }
    .pill.colleague { border-left: 3px solid var(--colleague); }
    .pill.other { border-left: 3px solid var(--other); }
  `;
  document.head.appendChild(style);
  
  // 辅助函数和事件监听器
  function shortName(name) {
    return name.length > 4 ? name.substring(0, 4) + '…' : name;
  }
  
  function renderVirtualList(guests) {
    el.guestList.innerHTML = '';
    if (guests.length === 0) {
      el.guestList.innerHTML = '<div style="text-align:center; padding:10px; color:var(--muted);">没有符合条件的未入座宾客</div>';
      return;
    }
    
    guests.forEach(guest => {
      const item = document.createElement('div');
      item.className = 'guest';
      item.draggable = true;
      item.dataset.guestId = guest.id;
      
      item.innerHTML = `
        <span class="count">${guest.count}人</span>
        <span class="category ${guest.category}">${getCategoryName(guest.category)}</span>
        <span>${escapeHtml(guest.name)}</span>
        <span class="tag">
          <a class="remove-guest" title="删除"><i class="fas fa-times"></i></a>
        </span>
      `;
      
      item.querySelector('.remove-guest').onclick = (e) => {
        e.stopPropagation();
        if (confirm(`确定要删除 ${guest.name} 吗？`)) {
          const index = state.guests.findIndex(g => g.id === guest.id);
          if (index !== -1) {
            state.guests.splice(index, 1);
            // 从所有桌子中移除
            state.tables.forEach(table => {
              if (table.guests.includes(guest.id)) {
                table.guests = table.guests.filter(id => id !== guest.id);
                localChanges.tables.updated.push(table.id);
              }
            });
            localChanges.guests.removed.push(guest.id);
            scheduleSave();
            render();
            showToast(`${guest.name} 已删除`, 'success');
          }
        }
      };
      
      attachGuestDrag(item);
      el.guestList.appendChild(item);
    });
  }
  
  let draggingId = null;
  function attachGuestDrag(el) {
    el.addEventListener('dragstart', e => {
      draggingId = e.target.dataset.guestId;
      e.dataTransfer.setData('text/plain', draggingId);
      e.target.classList.add('dragging');
    });
    
    el.addEventListener('dragend', e => {
      e.target.classList.remove('dragging');
      draggingId = null;
    });
  }
  
  function updateBatchTableSelect() {
    const currentValue = el.batchTableSelect.value;
    el.batchTableSelect.innerHTML = '<option value="">选择目标桌...</option>';
    
    state.tables.forEach(table => {
      const option = document.createElement('option');
      option.value = table.id;
      option.textContent = table.name;
      el.batchTableSelect.appendChild(option);
    });
    
    if (currentValue && state.tables.some(t => t.id === currentValue)) {
      el.batchTableSelect.value = currentValue;
    }
  }

  // 事件监听器
  el.addGuestsBtn.addEventListener('click', () => {
    const text = el.bulkNames.value.trim();
    if (!text) {
      showToast('请输入宾客姓名', 'warning');
      return;
    }
    
    const category = el.guestCategory.value;
    const lines = text.split('\n').filter(line => line.trim() !== '');
    let addedCount = 0;
    
    lines.forEach(line => {
      const parsed = parseGuestInput(line);
      const validation = validateInput.name(parsed.name);
      
      if (!validation.valid) {
        showToast(validation.message, 'error');
        return;
      }
      
      const countValidation = validateInput.count(parsed.count);
      if (!countValidation.valid) {
        showToast(countValidation.message, 'error');
        return;
      }
      
      state.guests.push({
        id: uid(),
        name: parsed.name,
        count: parsed.count,
        category: category,
        related: []
      });
      
      addedCount++;
    });
    
    if (addedCount > 0) {
      localChanges.guests.added.push(...state.guests.slice(-addedCount).map(g => g.id));
      el.bulkNames.value = '';
      scheduleSave();
      render();
      showToast(`已添加 ${addedCount} 组宾客`, 'success');
    }
  });
  
  el.clearGuestsBtn.addEventListener('click', () => {
    if (confirm('确定要清空所有未入座宾客吗？已入座的宾客不受影响。')) {
      const seatedIds = new Set(state.tables.flatMap(t => t.guests));
      const toRemove = state.guests.filter(g => !seatedIds.has(g.id));
      
      if (toRemove.length > 0) {
        state.guests = state.guests.filter(g => seatedIds.has(g.id));
        localChanges.guests.removed.push(...toRemove.map(g => g.id));
        scheduleSave();
        render();
        showToast(`已清空 ${toRemove.length} 组未入座宾客`, 'success');
      } else {
        showToast('没有未入座宾客可清空', 'info');
      }
    }
  });
  
  el.addTableBtn.addEventListener('click', () => {
    const name = el.tableName.value.trim() || `${state.tables.length + 1}号桌`;
    const cap = parseInt(el.tableCap.value, 10) || 10;
    
    const nameValidation = validateInput.tableName(name);
    if (!nameValidation.valid) {
      showToast(nameValidation.message, 'error');
      return;
    }
    
    const capValidation = validateInput.capacity(cap);
    if (!capValidation.valid) {
      showToast(capValidation.message, 'error');
      return;
    }
    
    state.tables.push({
      id: uid(),
      name: name,
      capacity: cap,
      guests: []
    });
    
    localChanges.tables.added.push(state.tables[state.tables.length - 1].id);
    el.tableName.value = '';
    scheduleSave();
    render();
    showToast(`已添加 ${name}（容量 ${cap}）`, 'success');
  });
  
  el.autoSeatBtn.addEventListener('click', () => {
    if (state.tables.length === 0) {
      showToast('请先添加桌位', 'warning');
      return;
    }
    
    const seatedIds = new Set(state.tables.flatMap(t => t.guests));
    let pending = state.guests.filter(g => !seatedIds.has(g.id));
    
    if (pending.length === 0) {
      showToast('所有宾客都已入座', 'info');
      return;
    }
    
    // 按类别分组
    if (el.groupByCategory.checked) {
      const groups = {};
      pending.forEach(guest => {
        if (!groups[guest.category]) groups[guest.category] = [];
        groups[guest.category].push(guest);
      });
      
      pending = [];
      Object.values(groups).forEach(group => pending.push(...group));
    }
    
    // 清空所有桌子
    state.tables.forEach(table => {
      table.guests = [];
      localChanges.tables.updated.push(table.id);
    });
    
    // 按桌分配
    let currentTableIndex = 0;
    pending.forEach(guest => {
      // 找到有足够空间的桌子
      let table = null;
      let attempts = 0;
      
      while (!table && attempts < state.tables.length) {
        const currentTable = state.tables[currentTableIndex];
        const occupied = getTableOccupiedSeats(currentTable.id);
        
        if (occupied + guest.count <= currentTable.capacity) {
          table = currentTable;
        } else {
          currentTableIndex = (currentTableIndex + 1) % state.tables.length;
          attempts++;
        }
      }
      
      if (table) {
        table.guests.push(guest.id);
        localChanges.tables.updated.push(table.id);
      } else {
        showToast(`无法安排 ${guest.name}（${guest.count}人），所有桌子空间不足`, 'warning');
      }
    });
    
    scheduleSave();
    render();
    showToast('自动排座完成', 'success');
  });
  
  el.shuffleBtn.addEventListener('click', () => {
    const seatedIds = new Set(state.tables.flatMap(t => t.guests));
    let pending = state.guests.filter(g => !seatedIds.has(g.id));
    
    if (pending.length <= 1) {
      showToast('没有足够的未入座宾客可打乱', 'info');
      return;
    }
    
    // 随机打乱
    for (let i = pending.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pending[i], pending[j]] = [pending[j], pending[i]];
    }
    
    // 更新顺序
    const newGuestOrder = [
      ...state.guests.filter(g => seatedIds.has(g.id)),
      ...pending
    ];
    
    state.guests = newGuestOrder;
    render();
    showToast('未入座宾客已随机打乱', 'success');
  });
  
  el.exportBtn.addEventListener('click', () => {
    const format = el.exportFormat.value;
    let content, mimeType, extension;
    
    if (format === 'json') {
      content = JSON.stringify({
        planId,
        version,
        guests: state.guests,
        tables: state.tables
      }, null, 2);
      mimeType = 'application/json';
      extension = 'json';
    } else {
      // CSV格式
      let csv = '姓名,人数,分类,座位\n';
      
      state.guests.forEach(guest => {
        let tableName = '';
        for (const table of state.tables) {
          if (table.guests.includes(guest.id)) {
            tableName = table.name;
            break;
          }
        }
        
        csv += `"${guest.name.replace(/"/g, '""')}",${guest.count},"${getCategoryName(guest.category)}","${tableName}"\n`;
      });
      
      content = csv;
      mimeType = 'text/csv';
      extension = 'csv';
    }
    
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `座位表_${new Date().toLocaleDateString()}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast(`已导出为${format.toUpperCase()}文件`, 'success');
  });
  
  el.importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target.result;
        el.importPreview.style.display = 'block';
        el.confirmImportBtn.style.display = 'block';
        el.importPreview.innerHTML = '';
        
        if (file.name.endsWith('.json')) {
          const data = JSON.parse(content);
          
          if (data.guests && Array.isArray(data.guests) && 
              data.tables && Array.isArray(data.tables)) {
              
            let guestCount = 0, tableCount = 0;
            const importPreviewItems = [];
            
            data.guests.forEach(g => {
              guestCount++;
              importPreviewItems.push(`宾客: ${g.name || '未知'} (${g.count || 1}人)`);
            });
            
            data.tables.forEach(t => {
              tableCount++;
              importPreviewItems.push(`桌位: ${t.name || '未知'} (容量: ${t.capacity || 10})`);
            });
            
            // 渲染预览
            el.importPreview.innerHTML = importPreviewItems.map(item => 
              `<div class="import-preview-item">${item}</div>`
            ).join('');
            
            el.confirmImportBtn.onclick = () => {
              if (confirm(`确定要导入吗？这将替换当前的${state.guests.length}组宾客和${state.tables.length}个桌位。`)) {
                // 生成新的宾客ID映射（保留原始入座关系）
                const guestIdMap = {};
                
                // 导入宾客
                state.guests = data.guests.map(g => {
                  const newId = uid();
                  guestIdMap[g.id] = newId; // 记录原始ID到新ID的映射
                  return {
                    id: newId,
                    name: g.name || `宾客${guestCount++}`,
                    count: g.count || 1,
                    category: g.category || 'other',
                    related: g.related || []
                  };
                });
                
                // 导入桌位并映射宾客ID
                state.tables = data.tables.map(t => ({
                  id: uid(),
                  name: t.name || `桌${tableCount++}`,
                  capacity: t.capacity || 10,
                  guests: t.guests ? t.guests.map(originalId => guestIdMap[originalId] || '') : []
                }));
                
                // 清理无效的宾客引用
                state.tables.forEach(table => {
                  table.guests = table.guests.filter(guestId => 
                    state.guests.some(g => g.id === guestId)
                  );
                });
                
                clearLocalChanges();
                localChanges.guests.added.push(...state.guests.map(g => g.id));
                localChanges.tables.added.push(...state.tables.map(t => t.id));
                
                // 强制刷新所有相关UI
                scheduleSave();
                render();          // 刷新主界面
                updateStats();     // 强制更新统计数据
                updateChart();     // 更新图表
                updateBatchTableSelect(); // 更新批量操作的桌位选择器
                
                // 清理导入界面
                el.importPreview.style.display = 'none';
                el.confirmImportBtn.style.display = 'none';
                el.importFile.value = '';
                
                showToast(`已导入 ${state.guests.length} 组宾客和 ${state.tables.length} 个桌位`, 'success');
              }
            };
          } else {
            throw new Error('JSON格式不正确，缺少guests或tables数组');
          }
        }else if (file.name.endsWith('.csv')) {
          const lines = content.split('\n').filter(line => line.trim() !== '');
          const guests = [];
          
          // 跳过标题行
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            // 简单CSV解析
            const parts = line.split(',').map(p => p.replace(/^"/, '').replace(/"$/, '').replace(/""/g, '"'));
            
            if (parts.length >= 1) {
              const name = parts[0].trim();
              const count = parts[1] ? parseInt(parts[1], 10) : 1;
              const category = parts[2] || 'other';
              
              guests.push({ name, count, category });
              
              const item = document.createElement('div');
              item.className = 'import-preview-item';
              item.textContent = `宾客: ${name} (${count || 1}人) - ${getCategoryName(category)}`;
              el.importPreview.appendChild(item);
            }
          }
          
          el.confirmImportBtn.onclick = () => {
            if (confirm(`确定要导入 ${guests.length} 组宾客吗？将添加到当前列表中。`)) {
              guests.forEach(g => {
                state.guests.push({
                  id: uid(),
                  name: g.name,
                  count: Math.max(1, g.count || 1),
                  category: g.category,
                  related: []
                });
              });
              
              localChanges.guests.added.push(...state.guests.slice(-guests.length).map(g => g.id));
              scheduleSave();
              render();
              updateChart();
              
              el.importPreview.style.display = 'none';
              el.confirmImportBtn.style.display = 'none';
              el.importFile.value = '';
              
              showToast(`已导入 ${guests.length} 组宾客`, 'success');
            }
          };
        } else {
          throw new Error('不支持的文件格式，请导入JSON或CSV文件');
        }
      } catch (error) {
        el.importPreview.innerHTML = `<div class="import-preview-item error">导入失败: ${error.message}</div>`;
        el.confirmImportBtn.style.display = 'none';
        console.error('导入错误:', error);
      }
    };
    
    if (file.name.endsWith('.json') || file.name.endsWith('.csv')) {
      reader.readAsText(file);
    } else {
      showToast('请选择JSON或CSV文件', 'error');
      el.importFile.value = '';
    }
  });
  
  el.printBtn.addEventListener('click', () => {
    window.print();
  });

  // 打印宾客名单按钮事件
el.printListBtn.addEventListener('click', printGuestList);

// 打印宾客名单函数
function printGuestList() {
  // 创建临时打印容器
  const printContainer = document.createElement('div');
  printContainer.className = 'print-list-container';
  document.body.appendChild(printContainer);

  // 添加标题
  const title = document.createElement('h1');
  title.style.textAlign = 'center';
  title.style.color = '#000';
  title.style.marginBottom = '30px';
  title.textContent = '宾客座位名单';
  printContainer.appendChild(title);

  // 按桌生成名单
  state.tables.forEach(table => {
    const tableSection = document.createElement('div');
    tableSection.className = 'print-table-section';

    // 桌名（不显示容量）
    const tableTitle = document.createElement('div');
    tableTitle.className = 'print-table-title';
    tableTitle.textContent = `${table.name}`;
    tableSection.appendChild(tableTitle);

    // 宾客列表
    const guestList = document.createElement('div');
    guestList.className = 'print-guest-list';
    
    if (table.guests.length === 0) {
      guestList.textContent = '无宾客';
    } else {
      // 查找桌内所有宾客的详细信息
      const tableGuests = table.guests.map(guestId => 
        state.guests.find(g => g.id === guestId)
      ).filter(Boolean);
      
      // 格式化显示：2人显示"携伴"，3人及以上显示"全家"，每行一个
      const guestNames = tableGuests.map(guest => {
        if (guest.count === 2) {
          return `${guest.name}携伴`;
        } else if (guest.count >= 3) {
          return `${guest.name}全家`;
        } else {
          return guest.name; // 1人时只显示姓名
        }
      });
      
      // 用换行标签分隔
      guestList.innerHTML = guestNames.join('<br>');
    }
    
    tableSection.appendChild(guestList);
    printContainer.appendChild(tableSection);
  });

  // 执行打印
  window.print();

  // 打印完成后移除临时容器
  setTimeout(() => {
    document.body.removeChild(printContainer);
  }, 100);
}
  
  el.resetAllBtn.addEventListener('click', () => {
    if (confirm('确定要重置所有数据吗？这将清除当前的所有宾客和桌位信息，恢复为初始状态。')) {
      const s = seed();
      state.guests = s.guests;
      state.tables = s.tables;
      
      clearLocalChanges();
      localChanges.guests.added.push(...state.guests.map(g => g.id));
      localChanges.tables.added.push(...state.tables.map(t => t.id));
      
      scheduleSave();
      render();
      updateChart();
      
      showToast('已重置所有数据', 'success');
    }
  });
  
  el.shareBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(location.href).then(() => {
      showToast('分享链接已复制到剪贴板', 'success');
    }).catch(err => {
      console.error('复制失败:', err);
      showToast('复制失败，请手动复制链接', 'error');
    });
  });
  
  el.batchMoveBtn.addEventListener('click', () => {
    const tableId = el.batchTableSelect.value;
    if (!tableId) {
      showToast('请先选择目标桌', 'warning');
      return;
    }
    
    const table = state.tables.find(t => t.id === tableId);
    if (!table) {
      showToast('所选桌位不存在', 'error');
      return;
    }
    
    const seatedIds = new Set(state.tables.flatMap(t => t.guests));
    const pending = state.guests.filter(g => !seatedIds.has(g.id));
    
    if (pending.length === 0) {
      showToast('没有未入座宾客可移动', 'info');
      return;
    }
    
    // 计算所需总容量
    const totalNeeded = pending.reduce((sum, guest) => sum + guest.count, 0);
    if (totalNeeded > table.capacity) {
      showToast(`${table.name} 容量不足，无法容纳所有未入座宾客`, 'warning');
      return;
    }
    
    // 移动所有未入座宾客
    pending.forEach(guest => {
      table.guests.push(guest.id);
    });
    
    localChanges.tables.updated.push(table.id);
    scheduleSave();
    render();
    showToast(`已将 ${pending.length} 组宾客移动到 ${table.name}`, 'success');
  });
  
  // 分类筛选按钮
  qsa('#categoryFilter .category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('#categoryFilter .category-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      render();
    });
  });
  
  // 搜索框事件
  el.search.addEventListener('input', render);

  // 初始化
  async function init() {
    await ensurePlan();
    await loadPlan();
    subscribeRealtime();
  }
  
  init();
});



