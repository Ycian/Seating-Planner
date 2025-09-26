// 座位规划系统 - 优化版
document.addEventListener('DOMContentLoaded', async () => {
  // 配置与初始化
  const config = {
    supabaseUrl: "https://dlgecgypzeucpfrcxdzq.supabase.co",
    supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsZ2VjZ3lwemV1Y3BmcmN4ZHpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUwODk4ODUsImV4cCI6MjA3MDY2NTg4NX0.xz0twrBoz9xh3X7LI2uati8EKlTEq3NpKhaorzuiyCE",
    saveDelay: 500,
    defaultCols: 3,
    maxCols: 8,
    minCols: 1
  };

  // 初始化Supabase
  const supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
  
  // 状态管理
  const state = {
    guests: [],
    tables: [],
    planId: new URLSearchParams((location.hash || "").slice(1)).get("plan"),
    version: 0,
    onlineUsers: 0,
    seatingChart: null,
    localChanges: {
      guests: { added: [], updated: [], removed: [] },
      tables: { added: [], updated: [], removed: [] }
    },
    draggingId: null,
    writing: false,
    writeTimer: null
  };

  // DOM元素缓存
  const el = {};
  const selectors = [
    'loadingIndicator', 'loadingMessage', 'toastContainer', 'search', 'bulkNames',
    'addGuestsBtn', 'clearGuestsBtn', 'tableName', 'tableCap', 'addTableBtn',
    'guestList', 'canvas', 'stats', 'autoSeatBtn', 'shuffleBtn', 'exportBtn',
    'exportFormat', 'importFile', 'importPreview', 'confirmImportBtn', 'printBtn',
    'resetAllBtn', 'shareBtn', 'shareTip', 'planIdLabel', 'colsRange', 'colsNumber',
    'guestCategory', 'categoryFilter', 'batchTableSelect', 'batchMoveBtn',
    'filterResult', 'filterCount', 'groupByCategory', 'optimizeSeating',
    'conflictModal', 'keepMineBtn', 'takeTheirsBtn', 'mergeChangesBtn',
    'conflictDetails', 'onlineUsers', 'seatingChart'
  ];
  selectors.forEach(id => el[id] = document.getElementById(id));

  // 工具函数
  const utils = {
    uid: () => Math.random().toString(36).slice(2, 9),
    qs: (s, r = document) => r.querySelector(s),
    qsa: (s, r = document) => Array.from(r.querySelectorAll(s)),
    escapeHtml: s => s.replace(/[&<>\"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c])),
    shortName: s => (s.replace(/[（(].*?[)）]/g, '').trim()).length <= 4 
      ? s : s.slice(0, 4),
    isEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    getCategoryName: category => ({
      family: '家人', friend: '朋友', colleague: '同事', other: '其他'
    }[category] || '其他'),
    escapeCsv: value => {
      if (typeof value !== 'string') return value;
      return (value.includes(',') || value.includes('"') || value.includes('\n'))
        ? `"${value.replace(/"/g, '""')}"` : value;
    }
  };

  // 验证工具
  const validator = {
    name: name => {
      if (!name || name.trim() === '') return { valid: false, message: '姓名不能为空' };
      if (name.length > 50) return { valid: false, message: '姓名过长，请控制在50字符以内' };
      return { valid: true };
    },
    count: count => {
      const num = Number(count);
      if (isNaN(num) || num < 1 || !Number.isInteger(num)) {
        return { valid: false, message: '人数必须是大于0的整数' };
      }
      if (num > 10) return { valid: false, message: '人数过多，请控制在10人以内' };
      return { valid: true };
    },
    tableName: name => {
      if (!name || name.trim() === '') return { valid: false, message: '桌名不能为空' };
      if (name.length > 30) return { valid: false, message: '桌名过长，请控制在30字符以内' };
      return { valid: true };
    },
    capacity: cap => {
      const num = Number(cap);
      if (isNaN(num) || num < 1 || !Number.isInteger(num)) {
        return { valid: false, message: '容量必须是大于0的整数' };
      }
      if (num > 100) return { valid: false, message: '容量过大，请控制在100以内' };
      return { valid: true };
    }
  };

  // UI工具
  const ui = {
    showLoading: (message = '处理中...') => {
      el.loadingMessage.textContent = message;
      el.loadingIndicator.classList.add('active');
    },
    hideLoading: () => el.loadingIndicator.classList.remove('active'),
    showToast: (message, type = 'success', duration = 3000) => {
      const toast = document.createElement('div');
      const icons = { success: 'check-circle', error: 'times-circle', warning: 'exclamation-circle', info: 'info-circle' };
      toast.className = `toast ${type}`;
      toast.innerHTML = `<i class="fas fa-${icons[type]}"></i><span>${message}</span>`;
      el.toastContainer.appendChild(toast);
      setTimeout(() => toast.remove(), duration);
    },
    setCols: n => {
      n = Math.max(config.minCols, Math.min(config.maxCols, Number(n) || config.defaultCols));
      document.documentElement.style.setProperty('--cols', n);
      el.colsRange.value = n;
      el.colsNumber.value = n;
      localStorage.setItem('seating_cols', String(n));
    }
  };

  // 数据管理
  const dataManager = {
    seed: () => ({
      guests: [
        { id: utils.uid(), name: '张三', count: 2, category: 'family', related: [] },
        { id: utils.uid(), name: '李四', count: 3, category: 'friend', related: [] },
        { id: utils.uid(), name: '王五', count: 1, category: 'colleague', related: [] },
        { id: utils.uid(), name: '赵六', count: 2, category: 'family', related: [] },
        { id: utils.uid(), name: '钱七', count: 4, category: 'friend', related: [] },
        { id: utils.uid(), name: '孙八', count: 2, category: 'colleague', related: [] },
        { id: utils.uid(), name: '周九', count: 1, category: 'other', related: [] },
        { id: utils.uid(), name: '吴十', count: 2, category: 'family', related: [] }
      ],
      tables: [
        { id: utils.uid(), name: '1号桌', capacity: 10, guests: [] },
        { id: utils.uid(), name: '2号桌', capacity: 10, guests: [] },
        { id: utils.uid(), name: '3号桌', capacity: 8, guests: [] }
      ]
    }),

    async ensurePlan() {
      if (state.planId) return state.planId;
      try {
        ui.showLoading('创建新计划...');
        const seeded = this.seed();
        const { data, error } = await supabase
          .from('plans')
          .insert({ title: 'Seating Plan', state: seeded, version: 1 })
          .select('id')
          .single();
        
        if (error) throw error;
        state.planId = data.id;
        state.version = 1;
        const url = new URL(location.href);
        url.hash = `plan=${state.planId}`;
        history.replaceState(null, '', url);
        ui.showToast('计划创建成功');
        return state.planId;
      } catch (error) {
        ui.showToast('创建计划失败：' + error.message, 'error');
        throw error;
      } finally {
        ui.hideLoading();
      }
    },

    async loadPlan() {
      try {
        ui.showLoading('加载计划中...');
        const { data, error } = await supabase
          .from('plans')
          .select('state, version')
          .eq('id', state.planId)
          .single();
        
        if (error) throw error;
        
        // 合并状态并处理兼容性
        Object.assign(state, {
          ...data.state,
          version: data.version || 1
        });
        
        // 数据兼容性处理
        state.guests = (state.guests || []).map(guest => ({
          ...guest,
          count: guest.count ?? 1,
          category: guest.category ?? 'other',
          related: guest.related ?? []
        }));
        
        // 初始化空计划
        if (!state.guests.length && !state.tables.length) {
          const seeded = this.seed();
          state.guests = seeded.guests;
          state.tables = seeded.tables;
          this.scheduleSave();
        }
        
        renderer.render();
        renderer.updateChart();
        ui.showToast('计划加载成功');
      } catch (error) {
        ui.showToast('加载计划失败，请刷新页面重试', 'error');
      } finally {
        ui.hideLoading();
      }
    },

    scheduleSave() {
      if (state.writing) return;
      clearTimeout(state.writeTimer);
      state.writeTimer = setTimeout(() => this.saveNow(), config.saveDelay);
    },

    async saveNow() {
      if (!state.planId) return;
      
      state.writing = true;
      try {
        this.detectAndFixConflicts();
        const newVersion = state.version + 1;
        
        const { error } = await supabase
          .from('plans')
          .update({ state: { guests: state.guests, tables: state.tables }, version: newVersion })
          .eq('id', state.planId)
          .eq('version', state.version);
        
        if (error) {
          if (error.code === '23505' || error.message.includes('violates row-level security')) {
            this.showConflictModal();
          } else {
            ui.showToast('保存失败: ' + error.message, 'error');
          }
        } else {
          state.version = newVersion;
          this.clearLocalChanges();
        }
      } catch (error) {
        ui.showToast('保存过程出错，请重试', 'error');
      } finally {
        state.writing = false;
      }
    },

    detectAndFixConflicts() {
      const guestCounts = {};
      state.tables.forEach(table => {
        table.guests.forEach(guestId => {
          guestCounts[guestId] = (guestCounts[guestId] || 0) + 1;
        });
      });
      
      const conflictGuests = Object.entries(guestCounts)
        .filter(([_, count]) => count > 1)
        .map(([guestId, _]) => guestId);
      
      if (conflictGuests.length) {
        const seen = new Set();
        state.tables.forEach(table => {
          table.guests = table.guests.filter(guestId => {
            if (conflictGuests.includes(guestId)) {
              if (!seen.has(guestId)) {
                seen.add(guestId);
                return true;
              }
              return false;
            }
            return true;
          });
        });
        ui.showToast(`已自动修复 ${conflictGuests.length} 个座位冲突`, 'warning');
      }
      return conflictGuests.length > 0;
    },

    clearLocalChanges() {
      state.localChanges = {
        guests: { added: [], updated: [], removed: [] },
        tables: { added: [], updated: [], removed: [] }
      };
    },

    async showConflictModal() {
      try {
        const { data: serverData } = await supabase
          .from('plans')
          .select('state, version')
          .eq('id', state.planId)
          .single();
        
        const serverState = serverData.state;
        const serverVersion = serverData.version;
        const conflicts = this.analyzeConflicts(state, serverState);
        
        renderer.displayConflicts(conflicts);
        el.conflictModal.classList.add('active');
        
        const handleClose = () => {
          el.conflictModal.classList.remove('active');
          el.keepMineBtn.removeEventListener('click', keepMineHandler);
          el.takeTheirsBtn.removeEventListener('click', takeTheirsHandler);
          el.mergeChangesBtn.removeEventListener('click', mergeChangesHandler);
        };
        
        const keepMineHandler = async () => {
          state.version = serverVersion;
          await this.saveNow();
          handleClose();
        };
        
        const takeTheirsHandler = async () => {
          Object.assign(state, serverState);
          state.version = serverVersion;
          this.clearLocalChanges();
          renderer.render();
          renderer.updateChart();
          handleClose();
          ui.showToast('已采用最新的服务器数据');
        };
        
        const mergeChangesHandler = async () => {
          const mergedState = this.mergeStates(state, serverState);
          Object.assign(state, mergedState);
          state.version = serverVersion;
          this.clearLocalChanges();
          await this.saveNow();
          renderer.render();
          renderer.updateChart();
          handleClose();
          ui.showToast('已合并本地和服务器的更改');
        };
        
        el.keepMineBtn.addEventListener('click', keepMineHandler);
        el.takeTheirsBtn.addEventListener('click', takeTheirsHandler);
        el.mergeChangesBtn.addEventListener('click', mergeChangesHandler);
        
      } catch (error) {
        ui.showToast('处理冲突失败，请刷新页面', 'error');
      }
    },

    analyzeConflicts(localState, serverState) {
      const conflicts = { guests: [], tables: [] };
      
      // 分析宾客冲突
      const localGuestsById = Object.fromEntries(localState.guests.map(g => [g.id, g]));
      const serverGuestsById = Object.fromEntries(serverState.guests.map(g => [g.id, g]));
      
      Object.entries(localGuestsById).forEach(([id, localGuest]) => {
        const serverGuest = serverGuestsById[id];
        if (serverGuest && !utils.isEqual(localGuest, serverGuest)) {
          conflicts.guests.push({ id, mine: localGuest, theirs: serverGuest });
        }
      });
      
      // 分析桌位冲突
      const localTablesById = Object.fromEntries(localState.tables.map(t => [t.id, t]));
      const serverTablesById = Object.fromEntries(serverState.tables.map(t => [t.id, t]));
      
      Object.entries(localTablesById).forEach(([id, localTable]) => {
        const serverTable = serverTablesById[id];
        if (serverTable && !utils.isEqual(localTable, serverTable)) {
          conflicts.tables.push({ id, mine: localTable, theirs: serverTable });
        }
      });
      
      return conflicts;
    },

    mergeStates(localState, serverState) {
      const merged = {
        guests: [...serverState.guests],
        tables: [...serverState.tables]
      };
      
      const mergedGuestsById = Object.fromEntries(merged.guests.map(g => [g.id, g]));
      const mergedTablesById = Object.fromEntries(merged.tables.map(t => [t.id, t]));
      
      // 合并宾客
      localState.guests.forEach(localGuest => {
        if (!mergedGuestsById[localGuest.id]) {
          merged.guests.push(localGuest);
          mergedGuestsById[localGuest.id] = localGuest;
        } else {
          const index = merged.guests.findIndex(g => g.id === localGuest.id);
          merged.guests[index] = localGuest;
        }
      });
      
      // 合并桌位
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
    },

    subscribeRealtime() {
      if (!state.planId) return;
      
      // 订阅数据更新
      supabase.channel(`plan-${state.planId}`)
        .on('postgres_changes', 
          { event: 'UPDATE', schema: 'public', table: 'plans', filter: `id=eq.${state.planId}` }, 
          async (payload) => {
            if (state.writing) return;
            
            try {
              if (payload.new.version > state.version) {
                ui.showLoading('检测到更新，正在同步...');
                const newState = payload.new.state || { guests: [], tables: [] };
                
                state.guests = newState.guests.map(guest => ({
                  ...guest,
                  count: guest.count ?? 1,
                  category: guest.category ?? 'other',
                  related: guest.related ?? []
                }));
                
                state.tables = newState.tables || [];
                state.version = payload.new.version;
                this.clearLocalChanges();
                
                renderer.render();
                renderer.updateChart();
                ui.showToast('数据已更新', 'success', 2000);
              }
            } catch (error) {
              ui.showToast('更新数据时出错', 'error');
            } finally {
              ui.hideLoading();
            }
          }
        )
        .subscribe(status => {
          if (status === 'SUBSCRIBED') ui.showToast('已连接到实时协作', 'success', 2000);
          if (status === 'CHANNEL_ERROR') ui.showToast('实时协作连接出错', 'error');
        });
      
      // 跟踪在线用户
      const presenceChannel = supabase.channel(`presence-${state.planId}`)
        .on('presence', { event: 'sync' }, () => {
          const presenceState = presenceChannel.presenceState();
          state.onlineUsers = Object.values(presenceState).flat().length;
          el.onlineUsers.textContent = `在线：${state.onlineUsers}人`;
        })
        .subscribe();
      
      // 追踪当前用户
      presenceChannel.track({ users: { id: utils.uid(), online: true } });
      window.addEventListener('beforeunload', () => presenceChannel.untrack());
    }
  };

  // 渲染器
  const renderer = {
    render() {
      if (!state.planId) return;
      
      el.planIdLabel.textContent = state.planId;
      el.shareTip.textContent = location.href;
      this.updateBatchTableSelect();
      
      // 筛选未入座宾客
      const seatedIds = new Set(state.tables.flatMap(t => t.guests));
      const filterText = (el.search.value || '').trim().toLowerCase();
      const activeCategory = utils.qs('#categoryFilter .category-btn.active').dataset.category;
      
      const pending = state.guests
        .filter(g => !seatedIds.has(g.id))
        .filter(g => !filterText || g.name.toLowerCase().includes(filterText))
        .filter(g => activeCategory === 'all' || g.category === activeCategory);
      
      // 更新筛选统计
      const totalPeopleInFilter = pending.reduce((sum, guest) => sum + guest.count, 0);
      const categoryNames = { all: '全部', family: '家人', friend: '朋友', colleague: '同事', other: '其他' };
      
      el.filterResult.querySelector('span:first-child').textContent = 
        `显示 ${categoryNames[activeCategory]} 未入座宾客` + (filterText ? `（搜索: ${filterText}）` : '');
      el.filterCount.textContent = `${pending.length}组 / ${totalPeopleInFilter}人`;
      
      // 渲染宾客列表和桌位
      this.renderVirtualList(pending);
      this.renderTables();
      this.updateStats();
    },

    renderVirtualList(guests) {
      el.guestList.innerHTML = '';
      
      if (!guests.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = '没有匹配的未入座宾客';
        el.guestList.appendChild(empty);
        return;
      }
      
      // 虚拟滚动实现
      const itemHeight = 40;
      const containerHeight = el.guestList.clientHeight;
      const visibleCount = Math.ceil(containerHeight / itemHeight) + 2;
      
      const updateVisibleItems = () => {
        const scrollTop = el.guestList.scrollTop;
        const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - 1);
        const endIndex = Math.min(guests.length, startIndex + visibleCount);
        
        el.guestList.innerHTML = '';
        
        // 顶部占位
        const topSpacer = document.createElement('div');
        topSpacer.style.height = `${startIndex * itemHeight}px`;
        el.guestList.appendChild(topSpacer);
        
        // 可见项
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
            <span class="category ${g.category}">${utils.getCategoryName(g.category)}</span>
            <span>${utils.escapeHtml(g.name)}</span>
            <span class="tag">拖拽入座</span>`;
            
          this.attachGuestDrag(item);
          el.guestList.appendChild(item);
        }
        
        // 底部占位
        const bottomSpacer = document.createElement('div');
        bottomSpacer.style.height = `${(guests.length - endIndex) * itemHeight}px`;
        el.guestList.appendChild(bottomSpacer);
      };
      
      updateVisibleItems();
      
      // 滚动节流
      let scrollTimeout;
      el.guestList.onscroll = () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(updateVisibleItems, 50);
      };
    },

    renderTables() {
      el.canvas.innerHTML = '';
      
      state.tables.forEach(table => {
        const occupiedSeats = this.getTableOccupiedSeats(table.id);
        const isFull = occupiedSeats >= table.capacity;
        const fullIndicator = isFull ? '<span class="full-indicator">(已满)</span>' : '';
        
        // 冲突检测
        const tableGuestIds = table.guests;
        const idCount = {};
        let hasConflict = false;
        
        tableGuestIds.forEach(id => {
          idCount[id] = (idCount[id] || 0) + 1;
          if (idCount[id] > 1) hasConflict = true;
        });
        
        state.tables.forEach(otherTable => {
          if (otherTable.id !== table.id && 
              otherTable.guests.some(id => tableGuestIds.includes(id))) {
            hasConflict = true;
          }
        });
        
        // 创建桌位卡片
        const card = document.createElement('section');
        card.className = `table-card ${hasConflict ? 'has-conflict' : ''}`;
        card.dataset.tableId = table.id;
        
        card.innerHTML = `
          <div class="table-header">
            <span class="badge">🪑 ${utils.escapeHtml(table.name)}${fullIndicator}</span>
            <span class="capacity">容量 ${table.capacity} | 已占用 ${occupiedSeats}</span>
          </div>
          <div class="table-visual"><div class="round-wrap"><div class="round">${utils.escapeHtml(table.name)}</div></div></div>
          <div class="table-footer">
            <a class="link rename">重命名</a> ·
            <a class="link setcap">设置容量</a> ·
            <a class="link clear">清空</a>
            <div class="spacer"></div>
            <a class="link remove-table">删除桌</a>
          </div>`;
        
        // 渲染椅子
        const wrap = utils.qs('.round-wrap', card);
        const seated = table.guests.map(id => state.guests.find(g => g.id === id)).filter(Boolean);
        const seats = table.capacity, R = 95;
        const duplicateIds = [];
        const idCountForConflict = {};
        
        tableGuestIds.forEach(id => {
          idCountForConflict[id] = (idCountForConflict[id] || 0) + 1;
          if (idCountForConflict[id] > 1) duplicateIds.push(id);
        });
        
        for (let i = 0; i < seats; i++) {
          const angle = (i / seats) * 2 * Math.PI - Math.PI / 2;
          const x = Math.cos(angle) * R + 110;
          const y = Math.sin(angle) * R + 110;
          
          const chair = document.createElement('div');
          chair.className = 'chair';
          chair.style.left = (x - 32) + 'px';
          chair.style.top = (y - 14) + 'px';
          
          // 检查座位占用
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
                otherTable.id !== table.id && otherTable.guests.includes(occupiedBy.id)
              );
            
            if (isConflicted) chair.classList.add('conflict');
            
            const isFirstSeat = i === currentSeat;
            chair.innerHTML = isFirstSeat
              ? `<span>${utils.escapeHtml(utils.shortName(occupiedBy.name))}</span><span class="count">${occupiedBy.count}</span><span class="kick">×</span>`
              : `<span>${utils.escapeHtml(utils.shortName(occupiedBy.name))}</span><span class="count">+${i - currentSeat}</span>`;
            
            if (isFirstSeat) {
              chair.querySelector('.kick').onclick = (ev) => {
                ev.stopPropagation();
                table.guests = table.guests.filter(id => id !== occupiedBy.id);
                state.localChanges.tables.updated.push(table.id);
                dataManager.scheduleSave();
                this.render();
                ui.showToast(`已将 ${occupiedBy.name} 一行(${occupiedBy.count}人)从 ${table.name} 移除`);
              };
              
              chair.draggable = true;
              chair.dataset.guestId = occupiedBy.id;
              chair.dataset.tableId = table.id;
              this.attachGuestDrag(chair);
            }
          } else {
            chair.classList.add('empty');
            chair.textContent = '空位';
          }
          
          wrap.appendChild(chair);
        }
        
        // 桌位拖拽接收
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
          
          const gid = state.draggingId || e.dataTransfer.getData('text/plain');
          if (!gid) return;
          
          const guest = state.guests.find(g => g.id === gid);
          if (!guest) return;
          
          const occupiedSeats = this.getTableOccupiedSeats(table.id);
          if (occupiedSeats + guest.count > table.capacity) {
            ui.showToast(`${table.name} 空间不足，无法容纳 ${guest.name} 一行(${guest.count}人)`, 'warning');
            return;
          }
          
          // 从原桌移除
          const fromTable = state.tables.find(tt => tt.guests.includes(gid));
          if (fromTable && fromTable.id !== table.id) {
            fromTable.guests = fromTable.guests.filter(id => id !== gid);
            state.localChanges.tables.updated.push(fromTable.id);
          }
          
          // 添加到新桌
          if (!table.guests.includes(gid)) {
            table.guests.push(gid);
            state.localChanges.tables.updated.push(table.id);
            dataManager.scheduleSave();
            this.render();
            ui.showToast(`已将 ${guest.name} 一行(${guest.count}人)安排到 ${table.name}`);
          }
        });
        
        // 桌位操作事件
        utils.qs('.rename', card).onclick = () => this.handleRenameTable(table);
        utils.qs('.setcap', card).onclick = () => this.handleSetTableCapacity(table);
        utils.qs('.clear', card).onclick = () => this.handleClearTable(table);
        utils.qs('.remove-table', card).onclick = () => this.handleRemoveTable(table.id);
        
        el.canvas.appendChild(card);
      });
    },

    updateStats() {
      const totalGroups = state.guests.length;
      const totalPeople = state.guests.reduce((sum, g) => sum + g.count, 0);
      const seatedPeople = state.tables.reduce((sum, table) => 
        sum + table.guests.reduce((tableSum, guestId) => {
          const guest = state.guests.find(g => g.id === guestId);
          return tableSum + (guest ? guest.count : 0);
        }, 0), 0);
      
      const categoryStats = { family: 0, friend: 0, colleague: 0, other: 0 };
      state.guests.forEach(g => {
        if (categoryStats[g.category]) categoryStats[g.category] += g.count;
      });
      
      el.stats.innerHTML = `
        <span class="pill">总组数：${totalGroups}</span>
        <span class="pill">总人数：${totalPeople}</span>
        <span class="pill">已入座：${seatedPeople}</span>
        <span class="pill">未入座：${totalPeople - seatedPeople}</span>
        <span class="pill">桌数：${state.tables.length}</span>
        <span class="pill">满员桌：${state.tables.filter(t => this.getTableOccupiedSeats(t.id) >= t.capacity).length}</span>
        <span class="pill">家人：${categoryStats.family}</span>
        <span class="pill">朋友：${categoryStats.friend}</span>`;
    },

    updateChart() {
      const ctx = el.seatingChart.getContext('2d');
      
      // 分类统计
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
      
      // 图表数据
      const labels = ['家人', '朋友', '同事', '其他'];
      const totalData = labels.map(label => {
        const key = Object.keys(categoryStats).find(k => utils.getCategoryName(k) === label);
        return categoryStats[key].total;
      });
      
      const seatedData = labels.map(label => {
        const key = Object.keys(categoryStats).find(k => utils.getCategoryName(k) === label);
        return categoryStats[key].seated;
      });
      
      // 销毁现有图表
      if (state.seatingChart) state.seatingChart.destroy();
      
      // 创建新图表
      state.seatingChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              label: '已入座',
              data: seatedData,
              backgroundColor: ['rgba(76, 217, 100, 0.6)', 'rgba(255, 204, 0, 0.6)', 'rgba(106, 167, 255, 0.6)', 'rgba(159, 123, 255, 0.6)'],
              borderColor: ['rgba(76, 217, 100, 1)', 'rgba(255, 204, 0, 1)', 'rgba(106, 167, 255, 1)', 'rgba(159, 123, 255, 1)'],
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
            x: { stacked: true, grid: { color: 'rgba(255, 255, 255, 0.1)' }, ticks: { color: 'rgba(255, 255, 255, 0.7)' } },
            y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.1)' }, ticks: { color: 'rgba(255, 255, 255, 0.7)', precision: 0 } }
          },
          plugins: { legend: { labels: { color: 'rgba(255, 255, 255, 0.7)' } } }
        }
      });
    },

    updateBatchTableSelect() {
      el.batchTableSelect.innerHTML = '<option value="">选择目标桌...</option>';
      
      state.tables.forEach(table => {
        const occupiedSeats = this.getTableOccupiedSeats(table.id);
        const option = document.createElement('option');
        option.value = table.id;
        option.textContent = `${table.name} (${occupiedSeats}/${table.capacity})`;
        option.disabled = occupiedSeats >= table.capacity;
        el.batchTableSelect.appendChild(option);
      });
    },

    displayConflicts(conflicts) {
      el.conflictDetails.innerHTML = '';
      
      if (!conflicts.guests.length && !conflicts.tables.length) {
        el.conflictDetails.innerHTML = '<p>未发现具体冲突，可以安全合并。</p>';
        return;
      }
      
      // 显示宾客冲突
      if (conflicts.guests.length) {
        const section = document.createElement('div');
        section.innerHTML = `<h3>宾客冲突 (${conflicts.guests.length})</h3>`;
        
        conflicts.guests.forEach(conflict => {
          const item = document.createElement('div');
          item.className = 'conflict-item';
          item.innerHTML = `
            <div>${utils.escapeHtml(conflict.mine.name)}</div>
            <div class="conflict-item mine">我的修改：人数 ${conflict.mine.count}，分类 ${utils.getCategoryName(conflict.mine.category)}</div>
            <div class="conflict-item theirs">其他人的修改：人数 ${conflict.theirs.count}，分类 ${utils.getCategoryName(conflict.theirs.category)}</div>
          `;
          section.appendChild(item);
        });
        
        el.conflictDetails.appendChild(section);
      }
      
      // 显示桌位冲突
      if (conflicts.tables.length) {
        const section = document.createElement('div');
        section.innerHTML = `<h3>桌位冲突 (${conflicts.tables.length})</h3>`;
        
        conflicts.tables.forEach(conflict => {
          const item = document.createElement('div');
          item.className = 'conflict-item';
          item.innerHTML = `
            <div>${utils.escapeHtml(conflict.mine.name)}</div>
            <div class="conflict-item mine">我的修改：容量 ${conflict.mine.capacity}，宾客数 ${conflict.mine.guests.length}</div>
            <div class="conflict-item theirs">其他人的修改：容量 ${conflict.theirs.capacity}，宾客数 ${conflict.theirs.guests.length}</div>
          `;
          section.appendChild(item);
        });
        
        el.conflictDetails.appendChild(section);
      }
    },

    // 桌位操作处理函数
    handleRenameTable(table) {
      const name = prompt('桌名：', table.name);
      if (name && name.trim()) {
        const validation = validator.tableName(name);
        if (!validation.valid) {
          ui.showToast(validation.message, 'error');
          return;
        }
        
        table.name = name.trim();
        state.localChanges.tables.updated.push(table.id);
        dataManager.scheduleSave();
        this.render();
        ui.showToast(`已重命名为 ${table.name}`);
      }
    },

    handleSetTableCapacity(table) {
      const cap = prompt('容量（座位数）：', table.capacity);
      const n = Number(cap);
      
      const validation = validator.capacity(n);
      if (!validation.valid) {
        ui.showToast(validation.message, 'error');
        return;
      }
      
      // 检查容量是否足够
      const occupiedSeats = this.getTableOccupiedSeats(table.id);
      let removedGuests = [];
      
      if (n < occupiedSeats) {
        let remainingCapacity = n;
        const newGuests = [];
        
        for (const guestId of table.guests) {
          const guest = state.guests.find(g => g.id === guestId);
          if (!guest) continue;
          
          if (remainingCapacity >= guest.count) {
            newGuests.push(guestId);
            remainingCapacity -= guest.count;
          } else {
            removedGuests.push(guest);
          }
        }
        
        table.guests = newGuests;
      }
      
      table.capacity = n;
      state.localChanges.tables.updated.push(table.id);
      dataManager.scheduleSave();
      this.render();
      
      let message = `已设置 ${table.name} 容量为 ${n}`;
      if (removedGuests.length) {
        message += `，因容量不足已移除 ${removedGuests.length} 组宾客`;
      }
      ui.showToast(message);
    },

    handleClearTable(table) {
      if (confirm(`清空 ${table.name} 的入座？`)) {
        const count = table.guests.length;
        const peopleCount = this.getTableOccupiedSeats(table.id);
        table.guests = [];
        state.localChanges.tables.updated.push(table.id);
        dataManager.scheduleSave();
        this.render();
        ui.showToast(`已清空 ${table.name} 的 ${count} 组宾客（共${peopleCount}人）`);
      }
    },

    handleRemoveTable(tableId) {
      const table = state.tables.find(t => t.id === tableId);
      if (confirm(`删除桌子“${table.name}”？`)) {
        state.localChanges.tables.removed.push(tableId);
        state.tables = state.tables.filter(x => x.id !== tableId);
        dataManager.scheduleSave();
        this.render();
        ui.showToast(`已删除 ${table.name}`);
      }
    },

    // 拖拽处理
    attachGuestDrag(node) {
      node.addEventListener('dragstart', e => {
        state.draggingId = node.dataset.guestId;
        node.classList.add('dragging');
        e.dataTransfer.setData('text/plain', state.draggingId);
        e.dataTransfer.effectAllowed = 'move';
      });
      
      node.addEventListener('dragend', () => {
        state.draggingId = null;
        node.classList.remove('dragging');
        utils.qsa('.round-wrap').forEach(wrap => {
          wrap.style.backgroundColor = '';
        });
      });
    },

    // 辅助方法
    getTableOccupiedSeats(tableId) {
      const table = state.tables.find(t => t.id === tableId);
      if (!table) return 0;
      
      return table.guests.reduce((total, guestId) => {
        const guest = state.guests.find(g => g.id === guestId);
        return total + (guest ? guest.count : 1);
      }, 0);
    }
  };

  // 事件绑定
  const eventBinder = {
    bind() {
      // 列数设置
      ui.setCols(Number(localStorage.getItem('seating_cols') || config.defaultCols));
      el.colsRange.oninput = e => ui.setCols(e.target.value);
      el.colsNumber.oninput = e => ui.setCols(e.target.value);
      
      // 添加宾客
      el.addGuestsBtn.onclick = this.handleAddGuests;
      
      // 清空未入座
      el.clearGuestsBtn.onclick = this.handleClearGuests;
      
      // 添加桌子
      el.addTableBtn.onclick = this.handleAddTable;
      
      // 批量移动
      el.batchMoveBtn.onclick = this.handleBatchMove;
      
      // 自动排座
      el.autoSeatBtn.onclick = this.handleAutoSeat;
      
      // 打乱座位
      el.shuffleBtn.onclick = this.handleShuffle;
      
      // 优化座位
      el.optimizeSeating.onclick = this.handleOptimizeSeating;
      
      // 导出
      el.exportBtn.onclick = this.handleExport;
      
      // 导入
      el.importFile.onchange = this.handleImportFile;
      
      // 打印
      el.printBtn.onclick = this.handlePrint;
      
      // 重置
      el.resetAllBtn.onclick = this.handleResetAll;
      
      // 分享
      el.shareBtn.onclick = this.handleShare;
      
      // 分类筛选
      utils.qsa('#categoryFilter .category-btn').forEach(btn => {
        btn.onclick = () => {
          utils.qsa('#categoryFilter .category-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          renderer.render();
        };
      });
      
      // 搜索
      el.search.oninput = () => renderer.render();
    },

    handleAddGuests() {
      const lines = el.bulkNames.value
        .split(/\n/)
        .map(s => s.trim())
        .filter(Boolean);
      
      if (!lines.length) {
        ui.showToast('请粘贴至少一个姓名', 'warning');
        return;
      }
      
      el.addGuestsBtn.classList.add('loading');
      
      setTimeout(() => {
        const category = el.guestCategory.value;
        let addedCount = 0;
        let duplicateCount = 0;
        
        lines.forEach(line => {
          // 解析"姓名 数量"格式
          const nameWithoutNotes = line.replace(/[（(].*?[)）]/g, '').trim();
          const match = nameWithoutNotes.match(/^(.+)\s+(\d+)$/);
          
          const name = match ? match[1].trim() : nameWithoutNotes;
          const count = match ? Math.max(1, parseInt(match[2], 10)) : 1;
          
          // 验证
          const nameValidation = validator.name(name);
          if (!nameValidation.valid) {
            ui.showToast(nameValidation.message + `: ${line}`, 'error');
            return;
          }
          
          const countValidation = validator.count(count);
          if (!countValidation.valid) {
            ui.showToast(countValidation.message + `: ${line}`, 'error');
            return;
          }
          
          // 检查重复
          if (state.guests.some(g => g.name.trim() === name.trim())) {
            duplicateCount++;
            return;
          }
          
          const guestId = utils.uid();
          state.guests.push({ id: guestId, name, count, category, related: [] });
          state.localChanges.guests.added.push(guestId);
          addedCount++;
        });
        
        el.bulkNames.value = '';
        dataManager.scheduleSave();
        renderer.render();
        renderer.updateChart();
        
        let message = `已添加 ${addedCount} 组宾客`;
        if (duplicateCount) message += `，跳过 ${duplicateCount} 组同名宾客`;
        ui.showToast(message);
        el.addGuestsBtn.classList.remove('loading');
      }, 300);
    },

    handleClearGuests() {
      const seated = new Set(state.tables.flatMap(t => t.guests));
      const pendingCount = state.guests.filter(g => !seated.has(g.id)).length;
      const pendingPeopleCount = state.guests
        .filter(g => !seated.has(g.id))
        .reduce((sum, guest) => sum + guest.count, 0);
      
      if (!pendingCount) {
        ui.showToast('没有未入座的宾客', 'info');
        return;
      }
      
      if (confirm(`确定要清空所有未入座的 ${pendingCount} 组宾客（共${pendingPeopleCount}人）吗？`)) {
        const toRemove = state.guests.filter(g => !seated.has(g.id)).map(g => g.id);
        state.guests = state.guests.filter(g => seated.has(g.id));
        toRemove.forEach(id => state.localChanges.guests.removed.push(id));
        dataManager.scheduleSave();
        renderer.render();
        renderer.updateChart();
        ui.showToast(`已清空 ${pendingCount} 组未入座宾客（共${pendingPeopleCount}人）`);
      }
    },

    handleAddTable() {
      const name = (el.tableName.value.trim() || `${state.tables.length + 1}号桌`);
      const cap = Number(el.tableCap.value);
      
      const nameValidation = validator.tableName(name);
      if (!nameValidation.valid) {
        ui.showToast(nameValidation.message, 'error');
        return;
      }
      
      const capValidation = validator.capacity(cap);
      if (!capValidation.valid) {
        ui.showToast(capValidation.message, 'error');
        return;
      }
      
      const tableId = utils.uid();
      state.tables.push({ id: tableId, name, capacity: cap, guests: [] });
      state.localChanges.tables.added.push(tableId);
      
      el.tableName.value = '';
      dataManager.scheduleSave();
      renderer.render();
      ui.showToast(`已添加 ${name}`);
    },

    handleBatchMove() {
      const targetTableId = el.batchTableSelect.value;
      if (!targetTableId) {
        ui.showToast('请选择目标桌', 'warning');
        return;
      }
      
      const targetTable = state.tables.find(t => t.id === targetTableId);
      if (!targetTable) {
        ui.showToast('目标桌不存在', 'error');
        return;
      }
      
      // 获取筛选结果
      const seatedIds = new Set(state.tables.flatMap(t => t.guests));
      const filterText = (el.search.value || '').trim().toLowerCase();
      const activeCategory = utils.qs('#categoryFilter .category-btn.active').dataset.category;
      
      const pendingGuests = state.guests
        .filter(g => !seatedIds.has(g.id))
        .filter(g => !filterText || g.name.toLowerCase().includes(filterText))
        .filter(g => activeCategory === 'all' || g.category === activeCategory);
      
      if (!pendingGuests.length) {
        ui.showToast('没有可移动的宾客', 'info');
        return;
      }
      
      // 检查容量
      const currentOccupied = renderer.getTableOccupiedSeats(targetTableId);
      const requiredCapacity = pendingGuests.reduce((sum, g) => sum + g.count, 0);
      
      if (currentOccupied + requiredCapacity > targetTable.capacity) {
        ui.showToast(`${targetTable.name} 空间不足，无法容纳所有筛选结果`, 'warning');
        return;
      }
      
      if (confirm(`确定要将 ${pendingGuests.length} 组宾客（共${requiredCapacity}人）移动到 ${targetTable.name} 吗？`)) {
        pendingGuests.forEach(guest => targetTable.guests.push(guest.id));
        state.localChanges.tables.updated.push(targetTableId);
        dataManager.scheduleSave();
        renderer.render();
        ui.showToast(`已将 ${pendingGuests.length} 组宾客移动到 ${targetTable.name}`);
      }
    },

    handleAutoSeat() {
      const seatedIds = new Set(state.tables.flatMap(t => t.guests));
      const pending = state.guests.filter(g => !seatedIds.has(g.id));
      
      if (!pending.length) {
        ui.showToast('没有未入座的宾客', 'info');
        return;
      }
      
      if (!state.tables.length) {
        ui.showToast('请先添加桌子', 'warning');
        return;
      }
      
      // 容量检查
      const totalRequired = pending.reduce((sum, g) => sum + g.count, 0);
      const totalCapacity = state.tables.reduce((sum, t) => sum + t.capacity, 0);
      const occupiedSeats = state.tables.reduce((sum, t) => sum + renderer.getTableOccupiedSeats(t.id), 0);
      const availableCapacity = totalCapacity - occupiedSeats;
      
      if (totalRequired > availableCapacity && 
          !confirm(`座位不足，还需要 ${totalRequired - availableCapacity} 个座位，是否继续？`)) {
        return;
      }
      
      ui.showLoading('正在自动排座...');
      
      setTimeout(() => {
        try {
          // 复制并清空桌位
          const newTables = state.tables.map(t => ({ ...t, guests: [...t.guests] }));
          const groupByCat = el.groupByCategory.checked;
          
          if (groupByCat) {
            // 按分类分组
            const guestsByCategory = {};
            pending.forEach(g => {
              if (!guestsByCategory[g.category]) guestsByCategory[g.category] = [];
              guestsByCategory[g.category].push(g);
            });
            
            Object.values(guestsByCategory).forEach(categoryGuests => {
              this.assignGuestsToTables(categoryGuests, newTables);
            });
          } else {
            // 直接排座
            this.assignGuestsToTables(pending, newTables);
          }
          
          // 更新状态
          state.tables = newTables;
          state.tables.forEach(t => state.localChanges.tables.updated.push(t.id));
          
          dataManager.scheduleSave();
          renderer.render();
          renderer.updateChart();
          ui.showToast(`自动排座完成，已安排 ${pending.length} 组宾客`);
        } catch (error) {
          ui.showToast('自动排座失败，请重试', 'error');
        } finally {
          ui.hideLoading();
        }
      }, 600);
    },

    handleShuffle() {
      const seatedGuests = new Set(state.tables.flatMap(t => t.guests));
      if (!seatedGuests.size) {
        ui.showToast('没有已入座的宾客', 'info');
        return;
      }
      
      if (confirm('确定要打乱所有已入座宾客的座位吗？')) {
        ui.showLoading('正在打乱座位...');
        
        setTimeout(() => {
          try {
            // 收集并重新分配
            const allSeated = [...seatedGuests].map(id => 
              state.guests.find(g => g.id === id)
            ).filter(Boolean);
            
            state.tables.forEach(t => t.guests = []);
            this.assignGuestsToTables(allSeated, state.tables);
            
            state.tables.forEach(t => state.localChanges.tables.updated.push(t.id));
            dataManager.scheduleSave();
            renderer.render();
            ui.showToast('已打乱所有座位');
          } catch (error) {
            ui.showToast('打乱座位失败，请重试', 'error');
          } finally {
            ui.hideLoading();
          }
        }, 500);
      }
    },

    handleOptimizeSeating() {
      const allSeated = state.tables.flatMap(t => 
        t.guests.map(id => state.guests.find(g => g.id === id)).filter(Boolean)
      );
      
      if (!allSeated.length) {
        ui.showToast('没有已入座的宾客', 'info');
        return;
      }
      
      ui.showLoading('正在优化座位...');
      
      setTimeout(() => {
        try {
          // 清空并重新分配
          state.tables.forEach(t => t.guests = []);
          this.assignGuestsToTables(allSeated, state.tables);
          
          // 计算空桌
          const emptyTables = state.tables.filter(t => t.guests.length === 0).length;
          
          state.tables.forEach(t => state.localChanges.tables.updated.push(t.id));
          dataManager.scheduleSave();
          renderer.render();
          
          ui.showToast(emptyTables ? `座位优化完成，空出 ${emptyTables} 张桌子` : '座位优化完成');
        } catch (error) {
          ui.showToast('优化座位失败，请重试', 'error');
        } finally {
          ui.hideLoading();
        }
      }, 500);
    },

    handleExport() {
      const format = el.exportFormat.value;
      let content, mimeType, extension;
      
      if (format === 'csv') {
        // CSV导出
        let csv = "桌名,宾客名称,人数,分类\n";
        
        state.tables.forEach(table => {
          if (!table.guests.length) {
            csv += `${utils.escapeCsv(table.name)},,,\n`;
          } else {
            table.guests.forEach(guestId => {
              const guest = state.guests.find(g => g.id === guestId);
              if (guest) {
                csv += `${utils.escapeCsv(table.name)},${utils.escapeCsv(guest.name)},${guest.count},${utils.getCategoryName(guest.category)}\n`;
              }
            });
          }
        });
        
        // 未入座宾客
        const seatedIds = new Set(state.tables.flatMap(t => t.guests));
        const pending = state.guests.filter(g => !seatedIds.has(g.id));
        
        if (pending.length) {
          csv += ",,,\n未入座,,,\n";
          pending.forEach(guest => {
            csv += `,${utils.escapeCsv(guest.name)},${guest.count},${utils.getCategoryName(guest.category)}\n`;
          });
        }
        
        content = csv;
        mimeType = 'text/csv';
        extension = 'csv';
      } else if (format === 'json') {
        // JSON导出
        content = JSON.stringify({
          planId: state.planId,
          created: new Date().toISOString(),
          guests: state.guests,
          tables: state.tables
        }, null, 2);
        mimeType = 'application/json';
        extension = 'json';
      } else {
        // 文本导出
        let text = "座位规划\n========================\n\n";
        
        state.tables.forEach(table => {
          text += `${table.name} (容量: ${table.capacity}, 已坐: ${renderer.getTableOccupiedSeats(table.id)})\n`;
          text += "--------------------\n";
          
          text += table.guests.length 
            ? table.guests.map(guestId => {
                const g = state.guests.find(g => g.id === guestId);
                return g ? `  - ${g.name} (${g.count}人, ${utils.getCategoryName(g.category)})\n` : '';
              }).join('')
            : "  空桌\n";
          
          text += "\n";
        });
        
        // 未入座
        const seatedIds = new Set(state.tables.flatMap(t => t.guests));
        const pending = state.guests.filter(g => !seatedIds.has(g.id));
        
        if (pending.length) {
          text += "未入座宾客\n--------------------\n";
          pending.forEach(guest => {
            text += `  - ${guest.name} (${guest.count}人, ${utils.getCategoryName(guest.category)})\n`;
          });
        }
        
        content = text;
        mimeType = 'text/plain';
        extension = 'txt';
      }
      
      // 下载处理
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `座位规划_${new Date().toLocaleDateString().replace(/\//g, '-')}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      ui.showToast(`已导出为${format.toUpperCase()}格式`);
    },

    handleImportFile(e) {
      const file = e.target.files[0];
      if (!file) return;
      
      const ext = file.name.split('.').pop().toLowerCase();
      if (!['csv', 'json', 'txt'].includes(ext)) {
        ui.showToast('请上传CSV、JSON或TXT格式的文件', 'error');
        el.importFile.value = '';
        return;
      }
      
      const reader = new FileReader();
      
      reader.onload = (event) => {
        try {
          let guests;
          
          if (ext === 'json') {
            // JSON解析
            const data = JSON.parse(event.target.result);
            guests = (data.guests || []).map(g => ({
              name: g.name || '',
              count: g.count || 1,
              category: g.category || 'other',
              valid: true,
              error: ''
            }));
          } else if (ext === 'csv') {
            // CSV解析
            guests = this.parseCSV(event.target.result);
          } else {
            // 文本解析
            guests = event.target.result.split('\n')
              .map(line => line.trim())
              .filter(Boolean)
              .map(line => {
                const nameWithoutNotes = line.replace(/[（(].*?[)）]/g, '').trim();
                const match = nameWithoutNotes.match(/^(.+)\s+(\d+)$/);
                
                const name = match ? match[1].trim() : nameWithoutNotes;
                const count = match ? Math.max(1, parseInt(match[2], 10)) : 1;
                
                const validName = validator.name(name);
                const validCount = validator.count(count);
                
                return {
                  name,
                  count,
                  category: 'other',
                  valid: validName.valid && validCount.valid,
                  error: !validName.valid ? validName.message : validCount.message
                };
              });
          }
          
          // 显示预览
          this.displayImportPreview(guests);
        } catch (error) {
          ui.showToast('解析文件失败: ' + error.message, 'error');
          el.importFile.value = '';
        }
      };
      
      reader.readAsText(file);
    },

    parseCSV(text) {
      return text.split('\n')
        .map(line => line.trim())
        .filter(line => line)
        .map(line => {
          const parts = line.split(',');
          let name = parts[0] || '';
          let count = parts[1] ? parseInt(parts[1], 10) : 1;
          let category = parts[2] || 'other';
          
          // 分类转换
          const categoryMap = { '家人': 'family', '朋友': 'friend', '同事': 'colleague', '其他': 'other' };
          if (!['family', 'friend', 'colleague', 'other'].includes(category)) {
            category = categoryMap[category] || 'other';
          }
          
          // 验证
          const nameValidation = validator.name(name);
          const countValidation = validator.count(count);
          
          return {
            name,
            count: countValidation.valid ? count : 1,
            category,
            valid: nameValidation.valid && countValidation.valid,
            error: !nameValidation.valid ? nameValidation.message : countValidation.message
          };
        });
    },

    displayImportPreview(guests) {
      const validCount = guests.filter(g => g.valid).length;
      const invalidCount = guests.length - validCount;
      
      let html = `
        <div>共 ${guests.length} 组宾客，其中 ${validCount} 组有效，${invalidCount} 组无效</div>
        <div class="import-preview-list">
      `;
      
      // 显示前20条
      guests.slice(0, 20).forEach(g => {
        const statusClass = g.valid ? 'valid' : 'invalid';
        const statusText = g.valid ? '有效' : `无效: ${g.error}`;
        
        html += `
          <div class="import-item ${statusClass}">
            <span>${utils.escapeHtml(g.name)}</span>
            <span class="count">${g.count}人</span>
            <span class="category ${g.category}">${utils.getCategoryName(g.category)}</span>
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
      
      // 确认导入事件
      const handleConfirm = () => {
        const category = el.guestCategory.value;
        const validGuests = guests.filter(g => g.valid);
        
        if (!validGuests.length) {
          ui.showToast('没有可导入的有效宾客', 'warning');
          return;
        }
        
        let addedCount = 0;
        let duplicateCount = 0;
        
        validGuests.forEach(g => {
          if (state.guests.some(guest => 
            guest.name.trim().toLowerCase() === g.name.trim().toLowerCase()
          )) {
            duplicateCount++;
            return;
          }
          
          const guestId = utils.uid();
          state.guests.push({
            id: guestId,
            name: g.name.trim(),
            count: g.count,
            category: g.category || category,
            related: []
          });
          state.localChanges.guests.added.push(guestId);
          addedCount++;
        });
        
        dataManager.scheduleSave();
        renderer.render();
        renderer.updateChart();
        
        let message = `已导入 ${addedCount} 组宾客`;
        if (duplicateCount) message += `，跳过 ${duplicateCount} 组同名宾客`;
        if (invalidCount) message += `，忽略 ${invalidCount} 组无效宾客`;
        
        ui.showToast(message);
        
        // 重置导入控件
        el.importFile.value = '';
        el.importPreview.style.display = 'none';
        el.confirmImportBtn.style.display = 'none';
        el.confirmImportBtn.removeEventListener('click', handleConfirm);
      };
      
      el.confirmImportBtn.style.display = 'block';
      el.confirmImportBtn.onclick = handleConfirm;
    },

    handlePrint() {
      ui.showLoading('准备打印...');
      
      setTimeout(() => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
          ui.hideLoading();
          ui.showToast('请允许弹出窗口以打印', 'error');
          return;
        }
        
        // 打印内容
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
                @media print { .no-print { display: none !important; } }
              </style>
            </head>
            <body>
              <div class="no-print"><button onclick="window.print()">打印</button><button onclick="window.close()">关闭</button></div>
              <h1>座位规划</h1>
              <div class="stats">
                <div>总组数：${state.guests.length}</div>
                <div>总人数：${state.guests.reduce((sum, g) => sum + g.count, 0)}</div>
                <div>桌数：${state.tables.length}</div>
                <div>打印时间：${new Date().toLocaleString()}</div>
              </div>
              <div class="tables-container">
                ${state.tables.map(table => {
                  const guests = table.guests.map(id => state.guests.find(g => g.id === id)).filter(Boolean);
                  
                  return `
                    <div class="print-table">
                      <div class="table-header">${table.name} (容量: ${table.capacity}, 已坐: ${renderer.getTableOccupiedSeats(table.id)})</div>
                      <div class="guest-list">
                        ${guests.length ? guests.map(guest => `
                          <div class="guest-item">
                            <span class="category ${guest.category}"></span>
                            ${guest.name} (${guest.count}人，${utils.getCategoryName(guest.category)})
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
                
                return pending.length ? `
                  <div>
                    <h2>未入座宾客</h2>
                    <div class="guest-list">
                      ${pending.map(guest => `
                        <div class="guest-item">
                          <span class="category ${guest.category}"></span>
                          ${guest.name} (${guest.count}人，${utils.getCategoryName(guest.category)})
                        </div>
                      `).join('')}
                    </div>
                  </div>
                ` : '';
              })()}
            </body>
          </html>
        `;
        
        printWindow.document.write(printContent);
        printWindow.document.close();
        
        printWindow.onload = () => {
          ui.hideLoading();
          setTimeout(() => printWindow.print(), 500);
        };
      }, 500);
    },

    handleResetAll() {
      if (confirm('确定要清空所有数据，重置为初始状态吗？此操作不可恢复！')) {
        ui.showLoading('正在重置...');
        
        setTimeout(() => {
          try {
            const s = dataManager.seed();
            state.guests = s.guests;
            state.tables = s.tables;
            
            state.guests.forEach(g => state.localChanges.guests.added.push(g.id));
            state.tables.forEach(t => state.localChanges.tables.added.push(t.id));
            
            dataManager.scheduleSave();
            renderer.render();
            renderer.updateChart();
            ui.showToast('已重置所有数据');
          } catch (error) {
            ui.showToast('重置失败，请重试', 'error');
          } finally {
            ui.hideLoading();
          }
        }, 500);
      }
    },

    handleShare() {
      if (!state.planId) {
        ui.showToast('计划尚未创建', 'error');
        return;
      }
      
      navigator.clipboard.writeText(location.href)
        .then(() => {
          ui.showToast('分享链接已复制到剪贴板');
          el.shareTip.classList.add('copied');
          setTimeout(() => el.shareTip.classList.remove('copied'), 2000);
        })
        .catch(() => {
          ui.showToast('复制失败，请手动复制链接', 'error');
        });
    },

    // 排座算法
    assignGuestsToTables(guests, tables) {
      // 按人数降序排列
      const sortedGuests = [...guests].sort((a, b) => b.count - a.count);
      
      // 按可用容量排序
      const sortedTables = [...tables].map(t => ({
        table: t,
        available: t.capacity - renderer.getTableOccupiedSeats(t.id)
      })).sort((a, b) => b.available - a.available);
      
      // 分配宾客
      sortedGuests.forEach(guest => {
        const suitableTable = sortedTables.find(t => t.available >= guest.count);
        
        if (suitableTable) {
          suitableTable.table.guests.push(guest.id);
          suitableTable.available -= guest.count;
          sortedTables.sort((a, b) => b.available - a.available);
        }
      });
    }
  };

  // 初始化应用
  async function init() {
    try {
      await dataManager.ensurePlan();
      await dataManager.loadPlan();
      dataManager.subscribeRealtime();
      eventBinder.bind();
    } catch (error) {
      console.error('初始化失败:', error);
      ui.showToast('初始化失败，请刷新页面重试', 'error');
      ui.hideLoading();
    }
  }

  // 启动应用
  init();
});
