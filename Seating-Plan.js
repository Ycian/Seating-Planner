// 合并更改处理
const mergeChangesHandler = async () => {
  // 合并更改时补充冲突检测逻辑
  const mergedState = mergeStates(state, serverState);
  // 检查并去重桌位更新记录
  const uniqueUpdatedTables = [...new Set(mergedState.tables.map(t => t.id))];
  Object.assign(state, mergedState);
  version = serverVersion;
  clearLocalChanges();
  // 仅添加唯一的更新记录
  uniqueUpdatedTables.forEach(id => localChanges.tables.updated.push(id));
  await saveNow();
  render();
  updateChart();
  handleClose();
  showToast('已合并本地和服务器的更改');
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
    const needed = (currentOccupied + requiredCapacity) - targetTable.capacity;
    showToast(`${targetTable.name} 空间不足，还需 ${needed} 个座位才能容纳所有筛选结果`, 'warning');
    return;
  }
  
  if (confirm(`确定要将 ${pendingGuests.length} 组宾客（共${requiredCapacity}人）移动到 ${targetTable.name} 吗？`)) {
    // 执行移动
    pendingGuests.forEach(guest => {
      targetTable.guests.push(guest.id);
    });
    
    // 去重更新记录
    if (!localChanges.tables.updated.includes(targetTableId)) {
      localChanges.tables.updated.push(targetTableId);
    }
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
      // 去重更新记录
      const updatedTableIds = [...new Set(state.tables.map(t => t.id))];
      updatedTableIds.forEach(id => {
        if (!localChanges.tables.updated.includes(id)) {
          localChanges.tables.updated.push(id);
        }
      });
      
      scheduleSave();
      render();
      updateChart();
      
      // 计算实际安排的宾客数量
      const assignedCount = pending.filter(g => 
        state.tables.some(t => t.guests.includes(g.id))
      ).length;
      const unassignedCount = pending.length - assignedCount;
      
      let message = `自动排座完成，已安排 ${assignedCount} 组宾客`;
      if (unassignedCount > 0) {
        message += `，${unassignedCount} 组宾客因座位不足未安排`;
      }
      showToast(message);
    } catch (error) {
      console.error('自动排座失败:', error);
      showToast('自动排座失败，请重试', 'error');
    } finally {
      hideLoading();
    }
  }, 600); // 模拟处理时间
};

// 分类筛选按钮增强无障碍属性
qsa('#categoryFilter .category-btn').forEach(btn => {
  const category = btn.dataset.category;
  let label = '筛选全部宾客';
  if (category === 'family') label = '筛选家人';
  if (category === 'friend') label = '筛选朋友';
  if (category === 'colleague') label = '筛选同事';
  if (category === 'other') label = '筛选其他宾客';
  
  btn.setAttribute('role', 'button');
  btn.setAttribute('aria-label', label);
  
  btn.onclick = () => {
    qsa('#categoryFilter .category-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render(); // 重新渲染以应用筛选
  };
});
