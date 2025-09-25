// 座位规划系统主程序
document.addEventListener('DOMContentLoaded', async () => {
  // 安全性提示：在生产环境中，建议限制Supabase匿名密钥的权限
  // 并考虑添加用户认证机制以控制访问权限
  const SUPABASE_URL = "https://dlgecgypzeucpfrcxdzq.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsZ2VjZ3lwemV1Y3BmcmN4ZHpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUwODk4ODUsImV4cCI6MjA3MDY2NTg4NX0.xz0twrBoz9xh3X7LI2uati8EKlTEq3NpKhaorzuiyCE";
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // 全局变量
  let version = 0; // 数据版本号，用于冲突检测
  let onlineUsers = 0; // 在线用户数
  let seatingChart = null; // 统计图表实例
  
  // 工具函数
  const uid = () => Math.random().toString(36).slice(2,9);
  const qs = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
  const escapeHtml = (s) => s.replace(/[&<>\"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[c]));
  
  // 生成示例数据
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
  
  // 显示加载指示器
  const showLoading = (message = '处理中...') => {
    const indicator = qs('#loadingIndicator');
    qs('#loadingMessage').textContent = message;
    indicator.classList.add('active');
  };
  
  // 隐藏加载指示器
  const hideLoading = () => {
    qs('#loadingIndicator').classList.remove('active');
  };
  
  // 解析宾客输入，支持"姓名 数量"格式
  const parseGuestInput = (inputStr) => {
    // 先去除可能的备注信息（括号内的内容）
    const nameWithoutNotes = inputStr.replace(/[（(].*?[)）]/g, '').trim();
    
    // 匹配"名称 数量"格式
    const match = nameWithoutNotes.match(/^(.+)\s+(\d+)$/);
    if (match) {
      return {
        name: match[1].trim(),
        count: Math.max(1, parseInt(match[2], 10)) // 确保至少1人
      };
    }
    
    // 默认1人
    return {
      name: nameWithoutNotes,
      count: 1
    };
  };
  
  // 显示提示消息
  const showToast = (message, type = 'success', duration = 3000) => {
    const container = qs('#toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // 根据类型添加不同图标
    let icon = 'check-circle';
    if (type === 'error') icon = 'times-circle';
    if (type === 'warning') icon = 'exclamation-circle';
    if (type === 'info') icon = 'info-circle';
    
    toast.innerHTML = `<i class="fas fa-${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.remove();
    }, duration);
  };

  // 输入验证
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

  // 扩展状态结构，增加宾客数量和分类
  const state = { 
    guests: [], // 每个宾客包含 id, name, count, category, related (相关宾客ID数组)
    tables: [] 
  };
  
  // 本地变更记录，用于冲突解决
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
  // 增加节流机制，优化保存性能
  const SAVE_DELAY = 500; // 500ms内的多次修改合并为一次保存

  // 每排桌数设置
  function setCols(n){
    n = Math.max(1, Math.min(8, Number(n)||3));
    document.documentElement.style.setProperty('--cols', n);
    el.colsRange.value = n; 
    el.colsNumber.value = n;
    localStorage.setItem('seating_cols', String(n));
  }
  
  // 初始化列数
  setCols(Number(localStorage.getItem('seating_cols')||3));
  el.colsRange.oninput = e => setCols(e.target.value);
  el.colsNumber.oninput = e => setCols(e.target.value);

  // 确保计划存在
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

  // 加载计划
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
      
      // 处理旧版本数据兼容性（添加count和category字段）
      state.guests = state.guests.map(guest => {
        if (guest.count === undefined) guest.count = 1;
        if (!guest.category) guest.category = 'other';
        if (!guest.related) guest.related = []; // 相关宾客ID数组
        return guest;
      });
      
      // 旧计划为空 → 自动填充示例
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
      showToast('计划加载成功');
    } catch (error) {
      console.error('加载计划失败:', error);
      showToast('加载计划失败，请刷新页面重试', 'error');
    } finally {
      hideLoading();
    }
  }

  // 延迟保存，优化性能
  function scheduleSave(){ 
    if (writing) return;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(saveNow, SAVE_DELAY);
  }
  
  // 执行保存
  async function saveNow(){
    if (!planId) return;
    
    writing = true;
    try {
      // 检测座位冲突并处理
      const hasConflicts = detectAndFixConflicts();
      
      // 增加版本号
      const newVersion = version + 1;
      
      const { error } = await supabase
        .from('plans')
        .update({ 
          state,
          version: newVersion,
          updated_at: new Date()
        })
        .eq('id', planId)
        .eq('version', version); // 乐观锁：只有版本号匹配时才更新
        
      if (error) {
        if (error.code === '23505' || error.message.includes('violates row-level security')) {
          // 版本不匹配，检测到冲突
          showConflictModal();
        } else {
          console.error('保存失败:', error);
          showToast('保存失败: ' + error.message, 'error');
        }
      } else {
        // 保存成功，更新版本号
        version = newVersion;
        // 清除本地变更记录
        clearLocalChanges();
      }
    } catch (error) {
      console.error('保存过程出错:', error);
      showToast('保存过程出错，请重试', 'error');
    } finally {
      writing = false;
    }
  }

  // 显示冲突解决对话框
  async function showConflictModal() {
    try {
      // 获取服务器上的最新数据
      const { data: serverData } = await supabase
        .from('plans')
        .select('state, version')
        .eq('id', planId)
        .single();
      
      const serverState = serverData.state;
      const serverVersion = serverData.version;
      
      // 分析冲突
      const conflicts = analyzeConflicts(state, serverState);
      
      // 显示冲突详情
      displayConflicts(conflicts);
      
      // 显示对话框
      el.conflictModal.classList.add('active');
      
      // 绑定按钮事件
      const handleClose = () => {
        el.conflictModal.classList.remove('active');
        el.keepMineBtn.removeEventListener('click', keepMineHandler);
        el.takeTheirsBtn.removeEventListener('click', takeTheirsHandler);
        el.mergeChangesBtn.removeEventListener('click', mergeChangesHandler);
      };
      
      const keepMineHandler = async () => {
        // 强制保存我的更改，覆盖服务器数据
        version = serverVersion;
        await saveNow();
        handleClose();
      };
      
      const takeTheirsHandler = async () => {
        // 采用服务器数据
        Object.assign(state, serverState);
        version = serverVersion;
        clearLocalChanges();
        render();
        updateChart();
        handleClose();
        showToast('已采用最新的服务器数据');
      };
      
      const mergeChangesHandler = async () => {
        // 合并更改
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
  
  // 分析冲突
  function analyzeConflicts(localState, serverState) {
    const conflicts = {
      guests: [],
      tables: []
    };
    
    // 分析宾客冲突
    const localGuestsById = Object.fromEntries(localState.guests.map(g => [g.id, g]));
    const serverGuestsById = Object.fromEntries(serverState.guests.map(g => [g.id, g]));
    
    // 找出本地和服务器都有的宾客，但内容不同
    for (const [id, localGuest] of Object.entries(localGuestsById)) {
      const serverGuest = serverGuestsById[id];
      if (serverGuest && !isEqual(localGuest, serverGuest)) {
        conflicts.guests.push({
          id,
          mine: localGuest,
          theirs: serverGuest
        });
      }
    }
    
    // 分析桌位冲突
    const localTablesById = Object.fromEntries(localState.tables.map(t => [t.id, t]));
    const serverTablesById = Object.fromEntries(serverState.tables.map(t => [t.id, t]));
    
    for (const [id, localTable] of Object.entries(localTablesById)) {
      const serverTable = serverTablesById[id];
      if (serverTable && !isEqual(localTable, serverTable)) {
        conflicts.tables.push({
          id,
          mine: localTable,
          theirs: serverTable
        });
      }
    }
    
    return conflicts;
  }
  
  // 显示冲突详情
  function displayConflicts(conflicts) {
    el.conflictDetails.innerHTML = '';
    
    if (conflicts.guests.length === 0 && conflicts.tables.length === 0) {
      el.conflictDetails.innerHTML = '<p>未发现具体冲突，可以安全合并。</p>';
      return;
    }
    
    // 显示宾客冲突
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
    
    // 显示桌位冲突
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
  
  // 合并两个状态
  function mergeStates(localState, serverState) {
    // 创建合并后的状态
    const merged = {
      guests: [...serverState.guests],
      tables: [...serverState.tables]
    };
    
    const mergedGuestsById = Object.fromEntries(merged.guests.map(g => [g.id, g]));
    const mergedTablesById = Object.fromEntries(merged.tables.map(t => [t.id, t]));
    
    // 合并宾客：保留双方新增的，冲突的以本地为准
    localState.guests.forEach(localGuest => {
      if (!mergedGuestsById[localGuest.id]) {
        // 本地新增的宾客
        merged.guests.push(localGuest);
        mergedGuestsById[localGuest.id] = localGuest;
      } else {
        // 冲突的宾客，以本地为准
        const index = merged.guests.findIndex(g => g.id === localGuest.id);
        merged.guests[index] = localGuest;
      }
    });
    
    // 合并桌位：保留双方新增的，冲突的以本地为准
    localState.tables.forEach(localTable => {
      if (!mergedTablesById[localTable.id]) {
        // 本地新增的桌位
        merged.tables.push(localTable);
        mergedTablesById[localTable.id] = localTable;
      } else {
        // 冲突的桌位，以本地为准
        const index = merged.tables.findIndex(t => t.id === localTable.id);
        merged.tables[index] = localTable;
      }
    });
    
    return merged;
  }
  
  // 检查两个对象是否相等
  function isEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  
  // 清除本地变更记录
  function clearLocalChanges() {
    localChanges.guests = { added: [], updated: [], removed: [] };
    localChanges.tables = { added: [], updated: [], removed: [] };
  }
  
  // 获取分类名称
  function getCategoryName(category) {
    const names = {
      family: '家人',
      friend: '朋友',
      colleague: '同事',
      other: '其他'
    };
    return names[category] || '其他';
  }

  // 订阅实时更新
  function subscribeRealtime(){
    if (!planId) return;
    
    // 订阅数据更新
    supabase.channel('plan-'+planId)
      .on('postgres_changes', 
        { event:'UPDATE', schema:'public', table:'plans', filter:'id=eq.'+planId }, 
        async (payload) => {
          if (writing) return;
          
          try {
            // 检查版本号，如果服务器版本更高，则更新本地数据
            if (payload.new.version > version) {
              showLoading('检测到更新，正在同步...');
              
              const newState = payload.new.state || { guests:[], tables:[] };
              state.guests = newState.guests || [];
              state.tables = newState.tables || [];
              version = payload.new.version;
              
              // 处理兼容性
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
      
    // 跟踪在线用户数
    const presenceChannel = supabase.channel('presence-'+planId)
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        onlineUsers = Object.values(state).flat().length;
        el.onlineUsers.textContent = `在线：${onlineUsers}人`;
      })
      .subscribe();
      
    // 追踪当前用户
    const user = { id: uid(), online: true };
    presenceChannel.track({ users: user });
    
    // 页面关闭时取消追踪
    window.addEventListener('beforeunload', () => {
      presenceChannel.untrack();
    });
  }

  // 检测并处理座位冲突（同一宾客出现在多个座位）
  function detectAndFixConflicts() {
    const guestCounts = {};
    
    // 统计每个宾客出现的次数
    state.tables.forEach(table => {
      table.guests.forEach(guestId => {
        guestCounts[guestId] = (guestCounts[guestId] || 0) + 1;
      });
    });
    
    // 找出冲突的宾客
    const conflictGuests = Object.entries(guestCounts)
      .filter(([_, count]) => count > 1)
      .map(([guestId, _]) => guestId);
      
    if (conflictGuests.length > 0) {
      // 处理冲突：只保留第一次出现，移除后续出现
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

  // 计算桌子当前已占用的座位数（考虑宾客人数）
  function getTableOccupiedSeats(tableId) {
    const table = state.tables.find(t => t.id === tableId);
    if (!table) return 0;
    
    return table.guests.reduce((total, guestId) => {
      const guest = state.guests.find(g => g.id === guestId);
      return total + (guest ? guest.count : 1);
    }, 0);
  }

  // 更新统计图表
  function updateChart() {
    const ctx = document.getElementById('seatingChart').getContext('2d');
    
    // 计算分类统计
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
    
    // 准备图表数据
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
    
    // 销毁现有图表（如果存在）
    if (seatingChart) {
      seatingChart.destroy();
    }
    
    // 创建新图表
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
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            },
            ticks: {
              color: 'rgba(255, 255, 255, 0.7)'
            }
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            },
            ticks: {
              color: 'rgba(255, 255, 255, 0.7)',
              precision: 0
            }
          }
        },
        plugins: {
          legend: {
            labels: {
              color: 'rgba(255, 255, 255, 0.7)'
            }
          }
        }
      }
    });
  }

  // 渲染界面
  function render(){
    if (!planId) return;
    
    el.planIdLabel.textContent = planId;
    el.shareTip.textContent = location.href;

    // 更新批量操作的桌选择器
    updateBatchTableSelect();
    
    const seatedIds = new Set(state.tables.flatMap(t=>t.guests));
    const filterText = (el.search.value||'').trim().toLowerCase();
    const activeCategory = qs('#categoryFilter .category-btn.active').dataset.category;
    
    // 筛选未入座宾客
    let pending = state.guests
      .filter(g => !seatedIds.has(g.id))
      .filter(g => !filterText || g.name.toLowerCase().includes(filterText))
      .filter(g => activeCategory === 'all' || g.category === activeCategory);

    // 计算筛选结果统计
    const totalPeopleInFilter = pending.reduce((sum, guest) => sum + guest.count, 0);
    const categoryNames = {
      family: '家人',
      friend: '朋友',
      colleague: '同事',
      other: '其他',
      all: '全部'
    };
    
    // 更新筛选结果提示
    el.filterResult.querySelector('span:first-child').textContent = 
      `显示 ${categoryNames[activeCategory]} 未入座宾客` + 
      (filterText ? `（搜索: ${filterText}）` : '');
    el.filterCount.textContent = `${pending.length}组 / ${totalPeopleInFilter}人`;

    // 渲染未入座列表（使用虚拟滚动处理大量数据）
    renderVirtualList(pending);

    // 渲染桌面
    el.canvas.innerHTML = '';
    for (const t of state.tables){
      const card = document.createElement('section'); 
      card.className = 'table-card'; 
      card.dataset.tableId = t.id;
      
      // 计算已占用座位数（考虑宾客人数）
      const occupiedSeats = getTableOccupiedSeats(t.id);
      // 检查桌子是否已满
      const isFull = occupiedSeats >= t.capacity;
      const fullIndicator = isFull ? '<span style="color:var(--warning);margin-left:4px;">(已满)</span>' : '';
      
      // 检查桌子是否有冲突
      const tableGuestIds = t.guests;
      const idCount = {};
      let hasConflict = false;
      
      tableGuestIds.forEach(id => {
        idCount[id] = (idCount[id] || 0) + 1;
        if (idCount[id] > 1) {
          hasConflict = true;
        }
      });
      
      // 检查是否在其他桌子也有该宾客
      tableGuestIds.forEach(id => {
        if (state.tables.some(otherTable => otherTable.id !== t.id && otherTable.guests.includes(id))) {
          hasConflict = true;
        }
      });
      
      if (hasConflict) {
        card.classList.add('has-conflict');
      }
      
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
      
      // 检测当前桌的冲突宾客
      const duplicateIds = [];
      const idCountForConflict = {};
      
      tableGuestIds.forEach(id => {
        idCountForConflict[id] = (idCountForConflict[id] || 0) + 1;
        if (idCountForConflict[id] > 1) {
          duplicateIds.push(id);
        }
      });
      
      // 渲染椅子
      for (let i = 0; i < seats; i++){
        const angle = (i / seats) * 2 * Math.PI - Math.PI / 2;
        const x = Math.cos(angle) * R + 110; 
        const y = Math.sin(angle) * R + 110;
        
        const chair = document.createElement('div');
        chair.className = 'chair';
        chair.style.left = (x - 32) + 'px'; 
        chair.style.top = (y - 14) + 'px';
        
        // 查找这个座位是否被占用
        let occupiedBy = null;
        let currentSeat = 0;
        
        // 计算每个宾客占用的座位范围
        for (const guest of seated) {
          if (i >= currentSeat && i < currentSeat + guest.count) {
            occupiedBy = guest;
            break;
          }
          currentSeat += guest.count;
        }
        
        if (occupiedBy) {
          // 标记冲突的座位
          const isConflicted = duplicateIds.includes(occupiedBy.id) || 
            state.tables.some(otherTable => 
              otherTable.id !== t.id && otherTable.guests.includes(occupiedBy.id)
            );
          
          if (isConflicted) {
            chair.classList.add('conflict');
          }
          
          // 只在第一个座位显示宾客名称和删除按钮
          const isFirstSeat = i === currentSeat;
          chair.innerHTML = isFirstSeat 
            ? `<span>${escapeHtml(shortName(occupiedBy.name))}</span><span class="count">${occupiedBy.count}</span><span class="kick">×</span>`
            : `<span>${escapeHtml(shortName(occupiedBy.name))}</span><span class="count">+${i - currentSeat}</span>`;
          
          if (isFirstSeat) {
            const kick = chair.querySelector('.kick');
            kick.onclick = (ev) => { 
              ev.stopPropagation(); 
              t.guests = t.guests.filter(id => id !== occupiedBy.id);
              // 记录变更
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

      // 允许把宾客拖拽到整张桌
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
        
        // 查找宾客信息
        const guest = state.guests.find(g => g.id === gid);
        if (!guest) return;
        
        // 检查是否有足够空间容纳这组宾客
        const occupiedSeats = getTableOccupiedSeats(t.id);
        if (occupiedSeats + guest.count > t.capacity) {
          showToast(`${t.name} 空间不足，无法容纳 ${guest.name} 一行(${guest.count}人)`, 'warning');
          return;
        }
        
        // 从原桌移除
        const fromTable = state.tables.find(tt => tt.guests.includes(gid));
        if (fromTable && fromTable.id !== t.id) {
          fromTable.guests = fromTable.guests.filter(id => id !== gid);
          localChanges.tables.updated.push(fromTable.id);
        }
        
        // 添加到新桌
        if (!t.guests.includes(gid)) {
          t.guests.push(gid);
          localChanges.tables.updated.push(t.id);
          scheduleSave(); 
          render();
          showToast(`已将 ${guest.name} 一行(${guest.count}人)安排到 ${t.name}`);
        }
      });

      // 桌操作事件
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
        
        // 检查新容量是否能容纳当前宾客
        const occupiedSeats = getTableOccupiedSeats(t.id);
        let removedGuests = [];
        
        if (n < occupiedSeats) {
          // 容量不足，需要移除宾客
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
        
        let message = `已设置 ${t.name} 容量为 ${n}`;
        if (removedGuests.length > 0) {
          message += `，因容量不足已移除 ${removedGuests.length} 组宾客`;
        }
        showToast(message);
      };
      
      qs('.clear', card).onclick = () => {
        if (confirm(`清空 ${t.name} 的入座？`)) {
          const count = t.guests.length;
          const peopleCount = getTableOccupiedSeats(t.id);
          t.guests = []; 
          localChanges.tables.updated.push(t.id);
          scheduleSave(); 
          render();
          showToast(`已清空 ${t.name} 的 ${count} 组宾客（共${peopleCount}人）`);
        }
      };
      
      qs('.table-footer .remove-table', card).onclick = () => {
        if (confirm(`删除桌子“${t.name}”？`)) {
          localChanges.tables.removed.push(t.id);
          state.tables = state.tables.filter(x => x.id !== t.id); 
          scheduleSave(); 
          render();
          showToast(`已删除 ${t.name}`);
        }
      };

      el.canvas.appendChild(card);
    }

    // 更新统计信息
    const totalGroups = state.guests.length;
    const totalPeople = state.guests.reduce((sum, guest) => sum + guest.count, 0);
    const seatedPeople = state.tables.reduce((sum, table) => {
      return sum + table.guests.reduce((tableSum, guestId) => {
        const guest = state.guests.find(g => g.id === guestId);
        return tableSum + (guest ? guest.count : 0);
      }, 0);
    }, 0);
    const unseatedPeople = totalPeople - seatedPeople;
    const tableCount = state.tables.length;
    const fullTables = state.tables.filter(t => getTableOccupiedSeats(t.id) >= t.capacity).length;
    
    // 分类统计
    const categoryStats = {
      family: 0,
      friend: 0,
      colleague: 0,
      other: 0
    };
    
    state.guests.forEach(guest => {
      if (categoryStats.hasOwnProperty(guest.category)) {
        categoryStats[guest.category] += guest.count;
      }
    });
    
    el.stats.innerHTML = `
      <span class="pill">总组数：${totalGroups}</span>
      <span class="pill">总人数：${totalPeople}</span>
      <span class="pill">已入座：${seatedPeople}</span>
      <span class="pill">未入座：${unseatedPeople}</span>
      <span class="pill">桌数：${tableCount}</span>
      <span class="pill">满员桌：${fullTables}</span>
      <span class="pill">家人：${categoryStats.family}</span>
      <span class="pill">朋友：${categoryStats.friend}</span>`;
  }

  // 虚拟列表渲染（处理大量宾客时的性能优化）
  function renderVirtualList(guests) {
    el.guestList.innerHTML = '';
    
    if (guests.length === 0) {
      const empty = document.createElement('div'); 
      empty.style.color = 'var(--muted)'; 
      empty.style.padding = '8px'; 
      empty.style.textAlign = 'center';
      const filterText = (el.search.value||'').trim().toLowerCase();
      const activeCategory = qs('#categoryFilter .category-btn.active').dataset.category;
      const categoryNames = {
        family: '家人',
        friend: '朋友',
        colleague: '同事',
        other: '其他',
        all: '全部'
      };
      
      empty.innerHTML = filterText 
        ? '没有匹配的未入座宾客' 
        : `没有${categoryNames[activeCategory]}未入座宾客`;
      el.guestList.appendChild(empty);
      return;
    }
    
    // 简单的虚拟滚动实现，只渲染可视区域附近的项目
    const itemHeight = 40; // 每个宾客项的高度
    const containerHeight = el.guestList.clientHeight;
    const visibleCount = Math.ceil(containerHeight / itemHeight) + 2; // 可视区域项目数，加2作为缓冲
    
    // 监听滚动事件，只在滚动时更新可见项目
    const updateVisibleItems = () => {
      const scrollTop = el.guestList.scrollTop;
      const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - 1);
      const endIndex = Math.min(guests.length, startIndex + visibleCount);
      
      // 清空容器并添加可见项目
      el.guestList.innerHTML = '';
      
      // 添加顶部占位元素，保持滚动位置
      const topSpacer = document.createElement('div');
      topSpacer.style.height = `${startIndex * itemHeight}px`;
      el.guestList.appendChild(topSpacer);
      
      // 添加可见项目
      for (let i = startIndex; i < endIndex; i++) {
        const g = guests[i];
        const item = document.createElement('div');
        item.className = 'guest'; 
        item.draggable = true; 
        item.dataset.guestId = g.id;
        item.style.height = `${itemHeight}px`;
        
        item.innerHTML = `
          <span>🧑</span>
          <span class="count">${g.count}人</span>
          <span class="category ${g.category}">${getCategoryName(g.category)}</span>
          <span>${escapeHtml(g.name)}</span>
          <span class="tag">拖拽入座</span>`;
          
        attachGuestDrag(item); 
        el.guestList.appendChild(item);
      }
      
      // 添加底部占位元素，保持滚动条长度
      const bottomSpacer = document.createElement('div');
      bottomSpacer.style.height = `${(guests.length - endIndex) * itemHeight}px`;
      el.guestList.appendChild(bottomSpacer);
    };
    
    // 初始化可见项目
    updateVisibleItems();
    
    // 添加滚动事件监听器，使用节流优化性能
    let scrollTimeout;
    el.guestList.onscroll = () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(updateVisibleItems, 50);
    };
  }

  // 更新批量操作的桌选择器
  function updateBatchTableSelect() {
    el.batchTableSelect.innerHTML = '<option value="">选择目标桌...</option>';
    
    state.tables.forEach(table => {
      const occupiedSeats = getTableOccupiedSeats(table.id);
      const availableSeats = table.capacity - occupiedSeats;
      
      const option = document.createElement('option');
      option.value = table.id;
      option.textContent = `${table.name} (${occupiedSeats}/${table.capacity})`;
      // 已满的桌子禁用选择
      option.disabled = availableSeats <= 0;
      el.batchTableSelect.appendChild(option);
    });
  }

  // 简化姓名显示
  function shortName(s) { 
    s = s.replace(/[（(].*?[)）]/g, '').trim(); 
    return s.length <= 4 ? s : s.slice(0, 4); 
  }

  // 拖拽相关
  let draggingId = null;
  function attachGuestDrag(node) {
    node.addEventListener('dragstart', e => {
      draggingId = node.dataset.guestId;
      node.classList.add('dragging');
      e.dataTransfer.setData('text/plain', draggingId);
      e.dataTransfer.effectAllowed = 'move';
    });
    
    node.addEventListener('dragend', () => {
      draggingId = null; 
      node.classList.remove('dragging');
      // 清除所有可能的拖拽样式
      qsa('.round-wrap').forEach(wrap => {
        wrap.style.backgroundColor = '';
      });
    });
  }

  // 解析CSV文件
  function parseCSV(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line);
    const guests = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 简单CSV解析，假设字段用逗号分隔，不包含逗号
      const parts = line.split(',');
      
      // 支持多种格式：
      // 1. 姓名
      // 2. 姓名,人数
      // 3. 姓名,人数,分类
      let name = parts[0] || '';
      let count = parts[1] ? parseInt(parts[1], 10) : 1;
      let category = parts[2] || 'other';
      
      // 验证分类
      const validCategories = ['family', 'friend', 'colleague', 'other'];
      if (!validCategories.includes(category)) {
        // 尝试将中文分类转换为对应值
        const categoryMap = {
          '家人': 'family',
          '朋友': 'friend',
          '同事': 'colleague',
          '其他': 'other'
        };
        category = categoryMap[category] || 'other';
      }
      
      // 验证
      const nameValidation = validateInput.name(name);
      const countValidation = validateInput.count(count);
      
      guests.push({
        name,
        count: countValidation.valid ? count : 1,
        category,
        valid: nameValidation.valid && countValidation.valid,
        error: !nameValidation.valid ? nameValidation.message : 
               !countValidation.valid ? countValidation.message : ''
      });
    }
    
    return guests;
  }

  // 绑定按钮事件
  function bindEvents() {
    // 添加宾客
    el.addGuestsBtn.onclick = () => {
      const lines = el.bulkNames.value
        .split(/\n/)
        .map(s => s.trim())
        .filter(Boolean);
        
      if (lines.length === 0) {
        showToast('请粘贴至少一个姓名', 'warning');
        return;
      }
      
      el.addGuestsBtn.classList.add('loading');
      
      setTimeout(() => {
        const category = el.guestCategory.value;
        let addedCount = 0;
        let duplicateCount = 0;
        
        for (const line of lines) {
          // 解析"姓名 数量"格式
          const { name, count } = parseGuestInput(line);
          
          // 验证
          const nameValidation = validateInput.name(name);
          if (!nameValidation.valid) {
            showToast(nameValidation.message + `: ${line}`, 'error');
            continue;
          }
          
          const countValidation = validateInput.count(count);
          if (!countValidation.valid) {
            showToast(countValidation.message + `: ${line}`, 'error');
            continue;
          }
          
          // 检查是否已存在同名宾客
          const exists = state.guests.some(g => g.name.trim() === name.trim());
          if (exists) {
            duplicateCount++;
            continue;
          }
          
          const guestId = uid();
          state.guests.push({ 
            id: guestId, 
            name,
            count,
            category,
            related: []
          });
          localChanges.guests.added.push(guestId);
          addedCount++;
        }
        
        el.bulkNames.value = ''; 
        scheduleSave(); 
        render();
        updateChart();
        
        let message = `已添加 ${addedCount} 组宾客`;
        if (duplicateCount > 0) {
          message += `，跳过 ${duplicateCount} 组同名宾客`;
        }
        
        showToast(message);
        el.addGuestsBtn.classList.remove('loading');
      }, 300); // 模拟处理时间，显示加载状态
    };
    
    // 清空未入座
    el.clearGuestsBtn.onclick = () => {
      const seated = new Set(state.tables.flatMap(t => t.guests));
      const pendingCount = state.guests.filter(g => !seated.has(g.id)).length;
      const pendingPeopleCount = state.guests
        .filter(g => !seated.has(g.id))
        .reduce((sum, guest) => sum + guest.count, 0);
      
      if (pendingCount === 0) {
        showToast('没有未入座的宾客', 'info');
        return;
      }
      
      if (confirm(`确定要清空所有未入座的 ${pendingCount} 组宾客（共${pendingPeopleCount}人）吗？（已在桌上的不受影响）`)) {
        const toRemove = state.guests.filter(g => !seated.has(g.id)).map(g => g.id);
        state.guests = state.guests.filter(g => seated.has(g.id)); 
        toRemove.forEach(id => localChanges.guests.removed.push(id));
        scheduleSave(); 
        render();
        updateChart();
        showToast(`已清空 ${pendingCount} 组未入座宾客（共${pendingPeopleCount}人）`);
      }
    };
    
    // 添加桌子
    el.addTableBtn.onclick = () => {
      const name = (el.tableName.value.trim() || `${state.tables.length + 1}号桌`);
      const cap = Number(el.tableCap.value);
      
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
      
      const tableId = uid();
      state.tables.push({ 
        id: tableId, 
        name, 
        capacity: cap, 
        guests: [] 
      });
      localChanges.tables.added.push(tableId);
      
      el.tableName.value = ''; 
      scheduleSave(); 
      render();
      showToast(`已添加 ${name}`);
    };
// 批量移动筛选结果到指定桌
    el.batchMoveBtn.onclick = () => {
      const targetTableId = el.batchTableSelect.value;
      if (!targetTableId) {
        showToast('请选择目标桌', 'warning');
        return;
      }
      
      const targetTable = state.tables.find(t => t.id === targetTableId);
      if (!targetTable) {
        showToast('目标桌不存在', 'error');
        return;
      }
      
      // 获取当前筛选结果
      const seatedIds = new Set(state.tables.flatMap(t=>t.guests));
      const filterText = (el.search.value||'').trim().toLowerCase();
      const activeCategory = qs('#categoryFilter .category-btn.active').dataset.category;
      
      const pendingGuests = state.guests
        .filter(g => !seatedIds.has(g.id))
        .filter(g => !filterText || g.name.toLowerCase().includes(filterText))
        .filter(g => activeCategory === 'all' || g.category === activeCategory);
      
      if (pendingGuests.length === 0) {
        showToast('没有可移动的宾客', 'info');
        return;
      }
      
      // 检查目标桌是否能容纳所有待移动宾客
      const currentOccupied = getTableOccupiedSeats(targetTableId);
      const requiredCapacity = pendingGuests.reduce((sum, guest) => sum + guest.count, 0);
      
      if (currentOccupied + requiredCapacity > targetTable.capacity) {
        showToast(`${targetTable.name} 空间不足，无法容纳所有筛选结果`, 'warning');
        return;
      }
      
      if (confirm(`确定要将 ${pendingGuests.length} 组宾客（共${requiredCapacity}人）移动到 ${targetTable.name} 吗？`)) {
        // 执行移动
        pendingGuests.forEach(guest => {
          targetTable.guests.push(guest.id);
        });
        
        localChanges.tables.updated.push(targetTableId);
        scheduleSave();
        render();
        showToast(`已将 ${pendingGuests.length} 组宾客移动到 ${targetTable.name}`);
      }
    };
    
    // 自动排座
    el.autoSeatBtn.onclick = () => {
      const seatedIds = new Set(state.tables.flatMap(t => t.guests));
      const pending = state.guests.filter(g => !seatedIds.has(g.id));
      
      if (pending.length === 0) {
        showToast('没有未入座的宾客', 'info');
        return;
      }
      
      if (state.tables.length === 0) {
        showToast('请先添加桌子', 'warning');
        return;
      }
      
      // 计算总需求和总容量
      const totalRequired = pending.reduce((sum, g) => sum + g.count, 0);
      const totalCapacity = state.tables.reduce((sum, t) => sum + t.capacity, 0);
      const occupiedSeats = state.tables.reduce((sum, t) => sum + getTableOccupiedSeats(t.id), 0);
      const availableCapacity = totalCapacity - occupiedSeats;
      
      if (totalRequired > availableCapacity) {
        showToast(`座位不足，还需要 ${totalRequired - availableCapacity} 个座位`, 'warning');
        if (!confirm('是否继续排座（可能无法安排所有宾客）？')) {
          return;
        }
      }
      
      showLoading('正在自动排座...');
      
      setTimeout(() => {
        try {
          // 复制当前桌位状态，避免直接修改
          const newTables = state.tables.map(t => ({...t, guests: [...t.guests]}));
          
          // 根据是否按分类分组决定排座策略
          const groupByCat = el.groupByCategory.checked;
          
          if (groupByCat) {
            // 按分类分组排座
            const guestsByCategory = {};
            pending.forEach(g => {
              if (!guestsByCategory[g.category]) {
                guestsByCategory[g.category] = [];
              }
              guestsByCategory[g.category].push(g);
            });
            
            // 对每个分类进行排座
            Object.values(guestsByCategory).forEach(categoryGuests => {
              assignGuestsToTables(categoryGuests, newTables);
            });
          } else {
            // 不分组，直接排座
            assignGuestsToTables(pending, newTables);
          }
          
          // 更新状态
          state.tables = newTables;
          state.tables.forEach(t => localChanges.tables.updated.push(t.id));
          
          scheduleSave();
          render();
          updateChart();
          showToast(`自动排座完成，已安排 ${pending.length} 组宾客`);
        } catch (error) {
          console.error('自动排座失败:', error);
          showToast('自动排座失败，请重试', 'error');
        } finally {
          hideLoading();
        }
      }, 600); // 模拟处理时间
    };
    
    // 排座算法：将宾客分配到合适的桌子
    function assignGuestsToTables(guests, tables) {
      // 按人数降序排列，先安排人数多的
      const sortedGuests = [...guests].sort((a, b) => b.count - a.count);
      
      // 按可用容量降序排列桌子
      const sortedTables = [...tables].map(t => ({
        table: t,
        available: t.capacity - getTableOccupiedSeats(t.id)
      })).sort((a, b) => b.available - a.available);
      
      // 为每个宾客找到合适的桌子
      sortedGuests.forEach(guest => {
        // 查找第一个能容纳该宾客的桌子
        const suitableTable = sortedTables.find(t => t.available >= guest.count);
        
        if (suitableTable) {
          // 分配到该桌子
          suitableTable.table.guests.push(guest.id);
          // 更新可用容量
          suitableTable.available -= guest.count;
          // 重新排序桌子
          sortedTables.sort((a, b) => b.available - a.available);
        }
      });
    }
    
    // 打乱座位
    el.shuffleBtn.onclick = () => {
      const seatedGuests = new Set(state.tables.flatMap(t => t.guests));
      if (seatedGuests.size === 0) {
        showToast('没有已入座的宾客', 'info');
        return;
      }
      
      if (confirm('确定要打乱所有已入座宾客的座位吗？')) {
        showLoading('正在打乱座位...');
        
        setTimeout(() => {
          try {
            // 收集所有已入座的宾客
            const allSeated = [...seatedGuests].map(id => 
              state.guests.find(g => g.id === id)
            ).filter(Boolean);
            
            // 清空所有桌子
            state.tables.forEach(t => {
              t.guests = [];
            });
            
            // 重新分配
            assignGuestsToTables(allSeated, state.tables);
            
            state.tables.forEach(t => localChanges.tables.updated.push(t.id));
            scheduleSave();
            render();
            showToast('已打乱所有座位');
          } catch (error) {
            console.error('打乱座位失败:', error);
            showToast('打乱座位失败，请重试', 'error');
          } finally {
            hideLoading();
          }
        }, 500);
      }
    };
    
    // 优化座位（减少空位）
    el.optimizeSeating.onclick = () => {
      // 收集所有已入座宾客
      const allSeated = state.tables.flatMap(t => 
        t.guests.map(id => state.guests.find(g => g.id === id)).filter(Boolean)
      );
      
      if (allSeated.length === 0) {
        showToast('没有已入座的宾客', 'info');
        return;
      }
      
      showLoading('正在优化座位...');
      
      setTimeout(() => {
        try {
          // 记录原始桌子数量
          const originalTableCount = state.tables.length;
          
          // 清空所有桌子
          state.tables.forEach(t => {
            t.guests = [];
          });
          
          // 重新分配，优先填满桌子
          assignGuestsToTables(allSeated, state.tables);
          
          // 计算优化后的空桌数量
          const emptyTables = state.tables.filter(t => t.guests.length === 0).length;
          
          state.tables.forEach(t => localChanges.tables.updated.push(t.id));
          scheduleSave();
          render();
          
          if (emptyTables > 0) {
            showToast(`座位优化完成，空出 ${emptyTables} 张桌子`);
          } else {
            showToast('座位优化完成');
          }
        } catch (error) {
          console.error('优化座位失败:', error);
          showToast('优化座位失败，请重试', 'error');
        } finally {
          hideLoading();
        }
      }, 500);
    };
    
    // 导出功能
    el.exportBtn.onclick = () => {
      const format = el.exportFormat.value;
      let content, mimeType, extension;
      
      if (format === 'csv') {
        // 导出CSV
        let csv = "桌名,宾客名称,人数,分类\n";
        
        state.tables.forEach(table => {
          if (table.guests.length === 0) {
            // 空桌也导出
            csv += `${escapeCsv(table.name)},,,\n`;
          } else {
            table.guests.forEach(guestId => {
              const guest = state.guests.find(g => g.id === guestId);
              if (guest) {
                csv += `${escapeCsv(table.name)},${escapeCsv(guest.name)},${guest.count},${getCategoryName(guest.category)}\n`;
              }
            });
          }
        });
        
        // 添加未入座宾客
        const seatedIds = new Set(state.tables.flatMap(t => t.guests));
        const pending = state.guests.filter(g => !seatedIds.has(g.id));
        
        if (pending.length > 0) {
          csv += ",,,\n未入座,,,\n";
          pending.forEach(guest => {
            csv += `,${escapeCsv(guest.name)},${guest.count},${getCategoryName(guest.category)}\n`;
          });
        }
        
        content = csv;
        mimeType = 'text/csv';
        extension = 'csv';
      } else if (format === 'json') {
        // 导出JSON
        content = JSON.stringify({
          planId,
          created: new Date().toISOString(),
          guests: state.guests,
          tables: state.tables
        }, null, 2);
        mimeType = 'application/json';
        extension = 'json';
      } else if (format === 'text') {
        // 导出文本
        let text = "座位规划\n";
        text += "========================\n\n";
        
        state.tables.forEach(table => {
          text += `${table.name} (容量: ${table.capacity}, 已坐: ${getTableOccupiedSeats(table.id)})\n`;
          text += "--------------------\n";
          
          if (table.guests.length === 0) {
            text += "  空桌\n";
          } else {
            table.guests.forEach(guestId => {
              const guest = state.guests.find(g => g.id === guestId);
              if (guest) {
                text += `  - ${guest.name} (${guest.count}人, ${getCategoryName(guest.category)})\n`;
              }
            });
          }
          text += "\n";
        });
        
        // 添加未入座宾客
        const seatedIds = new Set(state.tables.flatMap(t => t.guests));
        const pending = state.guests.filter(g => !seatedIds.has(g.id));
        
        if (pending.length > 0) {
          text += "未入座宾客\n";
          text += "--------------------\n";
          pending.forEach(guest => {
            text += `  - ${guest.name} (${guest.count}人, ${getCategoryName(guest.category)})\n`;
          });
        }
        
        content = text;
        mimeType = 'text/plain';
        extension = 'txt';
      }
      
      // 创建下载链接
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `座位规划_${new Date().toLocaleDateString().replace(/\//g,'-')}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showToast(`已导出为${format.toUpperCase()}格式`);
    };
    
    // CSV转义辅助函数
    function escapeCsv(value) {
      if (typeof value !== 'string') return value;
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }
    
    // 导入功能
    el.importFile.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      // 只允许CSV、JSON和TXT文件
      const ext = file.name.split('.').pop().toLowerCase();
      if (!['csv', 'json', 'txt'].includes(ext)) {
        showToast('请上传CSV、JSON或TXT格式的文件', 'error');
        el.importFile.value = '';
        return;
      }
      
      const reader = new FileReader();
      
      reader.onload = (event) => {
        try {
          let guests;
          
          if (ext === 'json') {
            // 解析JSON
            const data = JSON.parse(event.target.result);
            guests = data.guests || [];
            
            // 转换格式（如果需要）
            guests = guests.map(g => ({
              name: g.name || '',
              count: g.count || 1,
              category: g.category || 'other'
            }));
          } else if (ext === 'csv') {
            // 解析CSV
            guests = parseCSV(event.target.result);
          } else {
            // 解析文本（每行一个宾客）
            guests = event.target.result.split('\n')
              .map(line => line.trim())
              .filter(Boolean)
              .map(line => {
                const { name, count } = parseGuestInput(line);
                return {
                  name,
                  count,
                  category: 'other',
                  valid: validateInput.name(name).valid && validateInput.count(count).valid,
                  error: !validateInput.name(name).valid ? validateInput.name(name).message : 
                         !validateInput.count(count).valid ? validateInput.count(count).message : ''
                };
              });
          }
          
          // 显示预览
          displayImportPreview(guests);
        } catch (error) {
          console.error('解析文件失败:', error);
          showToast('解析文件失败: ' + error.message, 'error');
          el.importFile.value = '';
        }
      };
      
      reader.readAsText(file);
    };
    
    // 显示导入预览
    function displayImportPreview(guests) {
      const validCount = guests.filter(g => g.valid).length;
      const invalidCount = guests.length - validCount;
      
      let html = `
        <div style="margin-bottom:12px;">
          共 ${guests.length} 组宾客，其中 ${validCount} 组有效，${invalidCount} 组无效
        </div>
        <div class="import-preview-list">
      `;
      
      // 只显示前20条预览
      const previewGuests = guests.slice(0, 20);
      
      previewGuests.forEach(g => {
        const statusClass = g.valid ? 'valid' : 'invalid';
        const statusText = g.valid ? '有效' : `无效: ${g.error}`;
        
        html += `
          <div class="import-item ${statusClass}">
            <span>${escapeHtml(g.name)}</span>
            <span class="count">${g.count}人</span>
            <span class="category ${g.category}">${getCategoryName(g.category)}</span>
            <span class="status">${statusText}</span>
          </div>
        `;
      });
      
      if (guests.length > 20) {
        html += `<div class="import-more">... 还有 ${guests.length - 20} 组未显示</div>`;
      }
      
      html += `</div>`;
      
      el.importPreview.innerHTML = html;
      el.importPreview.style.display = 'block';
      
      // 绑定确认导入事件
      const handleConfirm = () => {
        const category = el.guestCategory.value;
        const validGuests = guests.filter(g => g.valid);
        
        if (validGuests.length === 0) {
          showToast('没有可导入的有效宾客', 'warning');
          return;
        }
        
        let addedCount = 0;
        let duplicateCount = 0;
        
        validGuests.forEach(g => {
          // 检查是否已存在同名宾客
          const exists = state.guests.some(guest => 
            guest.name.trim().toLowerCase() === g.name.trim().toLowerCase()
          );
          
          if (exists) {
            duplicateCount++;
            return;
          }
          
          const guestId = uid();
          state.guests.push({
            id: guestId,
            name: g.name.trim(),
            count: g.count,
            category: g.category || category,
            related: []
          });
          localChanges.guests.added.push(guestId);
          addedCount++;
        });
        
        scheduleSave();
        render();
        updateChart();
        
        let message = `已导入 ${addedCount} 组宾客`;
        if (duplicateCount > 0) {
          message += `，跳过 ${duplicateCount} 组同名宾客`;
        }
        if (invalidCount > 0) {
          message += `，忽略 ${invalidCount} 组无效宾客`;
        }
        
        showToast(message);
        
        // 重置导入控件
        el.importFile.value = '';
        el.importPreview.style.display = 'none';
        el.confirmImportBtn.style.display = 'none';
        el.confirmImportBtn.removeEventListener('click', handleConfirm);
      };
      
      el.confirmImportBtn.style.display = 'block';
      el.confirmImportBtn.onclick = handleConfirm;
    }
    
    // 打印功能
    el.printBtn.onclick = () => {
      showLoading('准备打印...');
      
      setTimeout(() => {
        // 创建打印专用页面
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
          hideLoading();
          showToast('请允许弹出窗口以打印', 'error');
          return;
        }
        
        // 构建打印内容
        const printContent = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>座位规划 - 打印</title>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; padding: 20px; }
                h1 { text-align: center; margin-bottom: 30px; }
                .tables-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; margin-bottom: 40px; }
                .print-table { border: 1px solid #ccc; border-radius: 8px; padding: 15px; }
                .table-header { font-weight: bold; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1px solid #eee; }
                .guest-list { margin-top: 10px; }
                .guest-item { margin: 5px 0; padding-left: 10px; position: relative; }
                .guest-item::before { content: "•"; position: absolute; left: 0; }
                .stats { margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 8px; }
                .category { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
                .category.family { background-color: #4CD964; }
                .category.friend { background-color: #FFCC00; }
                .category.colleague { background-color: #6AA7FF; }
                .category.other { background-color: #9F7BFF; }
                @media print {
                  @page { margin: 15mm; }
                  body { padding: 0; }
                  .no-print { display: none !important; }
                }
              </style>
            </head>
            <body>
              <div class="no-print" style="margin-bottom:20px;">
                <button onclick="window.print()">打印</button>
                <button onclick="window.close()">关闭</button>
              </div>
              
              <h1>座位规划</h1>
              
              <div class="stats">
                <div>总组数：${state.guests.length}</div>
                <div>总人数：${state.guests.reduce((sum, g) => sum + g.count, 0)}</div>
                <div>桌数：${state.tables.length}</div>
                <div>打印时间：${new Date().toLocaleString()}</div>
              </div>
              
              <div class="tables-container">
                ${state.tables.map(table => {
                  const guests = table.guests.map(id => 
                    state.guests.find(g => g.id === id)
                  ).filter(Boolean);
                  
                  return `
                    <div class="print-table">
                      <div class="table-header">
                        ${table.name} (容量: ${table.capacity}, 已坐: ${getTableOccupiedSeats(table.id)})
                      </div>
                      <div class="guest-list">
                        ${guests.length > 0 ? guests.map(guest => `
                          <div class="guest-item">
                            <span class="category ${guest.category}"></span>
                            ${guest.name} (${guest.count}人，${getCategoryName(guest.category)})
                          </div>
                        `).join('') : '<div class="guest-item">空桌</div>'}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
              
              ${(() => {
                const seatedIds = new Set(state.tables.flatMap(t => t.guests));
                const pending = state.guests.filter(g => !seatedIds.has(g.id));
                
                if (pending.length > 0) {
                  return `
                    <div style="margin-top: 40px;">
                      <h2>未入座宾客</h2>
                      <div class="guest-list">
                        ${pending.map(guest => `
                          <div class="guest-item">
                            <span class="category ${guest.category}"></span>
                            ${guest.name} (${guest.count}人，${getCategoryName(guest.category)})
                          </div>
                        `).join('')}
                      </div>
                    </div>
                  `;
                }
                return '';
              })()}
            </body>
          </html>
        `;
        
        printWindow.document.write(printContent);
        printWindow.document.close();
        
        // 等待页面加载完成后打印
        printWindow.onload = () => {
          hideLoading();
          // 给浏览器一点时间渲染
          setTimeout(() => {
            printWindow.print();
          }, 500);
        };
      }, 500);
    };
    
    // 重置所有数据
    el.resetAllBtn.onclick = () => {
      if (confirm('确定要清空所有数据，重置为初始状态吗？此操作不可恢复！')) {
        showLoading('正在重置...');
        
        setTimeout(() => {
          try {
            const s = seed();
            state.guests = s.guests;
            state.tables = s.tables;
            
            // 记录所有变更
            state.guests.forEach(g => localChanges.guests.added.push(g.id));
            state.tables.forEach(t => localChanges.tables.added.push(t.id));
            
            scheduleSave();
            render();
            updateChart();
            showToast('已重置所有数据');
          } catch (error) {
            console.error('重置失败:', error);
            showToast('重置失败，请重试', 'error');
          } finally {
            hideLoading();
          }
        }, 500);
      }
    };
    
    // 分享功能
    el.shareBtn.onclick = () => {
      if (!planId) {
        showToast('计划尚未创建', 'error');
        return;
      }
      
      // 复制链接到剪贴板
      navigator.clipboard.writeText(location.href)
        .then(() => {
          showToast('分享链接已复制到剪贴板');
          el.shareTip.classList.add('copied');
          setTimeout(() => {
            el.shareTip.classList.remove('copied');
          }, 2000);
        })
        .catch(err => {
          console.error('无法复制链接:', err);
          showToast('复制失败，请手动复制链接', 'error');
        });
    };
    
    // 分类筛选
    qsa('#categoryFilter .category-btn').forEach(btn => {
      btn.onclick = () => {
        qsa('#categoryFilter .category-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        render(); // 重新渲染以应用筛选
      };
    });
    
    // 搜索功能
    el.search.oninput = () => {
      render(); // 重新渲染以应用搜索
    };
  }

  // 初始化应用
  async function init() {
    try {
      await ensurePlan();
      await loadPlan();
      subscribeRealtime();
      bindEvents();
    } catch (error) {
      console.error('初始化失败:', error);
      showToast('初始化失败，请刷新页面重试', 'error');
      hideLoading();
    }
  }

  // 启动应用
  init();
});
