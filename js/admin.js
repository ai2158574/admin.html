/* ============================================================
   NIXERS PRO — admin.js
   Full admin console logic
   ============================================================ */

'use strict';

/* ============================================================
   1. DATA STORE
   ============================================================ */
const DB = window.APP_DATA?.DB;
if (!DB) {
  throw new Error('Missing shared data store. Load js/data.js before js/admin.js');
}

/* next IDs */
const nextId = {};
['users','sites','categories','posts','groups','leaveRequests','holidays','timesheets','payroll','projects','tasks','equipment','incidents','documents','notifications','emailLog','auditLog','clients','tickets'].forEach(k => {
  nextId[k] = (DB[k]?.length || 0) + 1;
});

let currentUser = DB.users[0];
let impersonating = null;
let currentGroup = null;
let currentSite = null;
let chartInstances = {};
let selectedUserIds = new Set();
let postAssignees = [];
let postVoiceRecording = false;
let projectTeamMembers = [];
let taskAssignees = [];
let taskVoiceRecording = false;
let taskAttachments = [];
let leaveCalDate = new Date();
let shiftWeekOffset = 0;
let currentPayrollPeriod = '2025-06';

/* ============================================================
   2. UTILITIES
   ============================================================ */
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

function userById(id)     { return DB.users.find(u => u.id === id); }
function siteById(id)     { return DB.sites.find(s => s.id === id); }
function catById(id)      { return DB.categories.find(c => c.id === id); }
function projectById(id)  { return DB.projects.find(p => p.id === id); }
function taskAssigneeIds(task) {
  if (!task) return [];
  if (Array.isArray(task.assigneeIds) && task.assigneeIds.length) return task.assigneeIds.map(Number).filter(Boolean);
  return task.assigneeId ? [Number(task.assigneeId)] : [];
}
function fmt(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (isNaN(d)) return date;
  return d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
}

function fmtMoney(n) { return '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}); }

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
}

function avatarEl(user, size=34) {
  const u = typeof user === 'number' ? userById(user) : user;
  if (!u) return `<div class="u-av" style="width:${size}px;height:${size}px;background:#334155;color:#94a3b8;">${'?'}</div>`;
  const bg = u.avatarColor || '#eab308';
  const img = u.avatarImg ? `<img src="${u.avatarImg}" alt="">` : '';
  return `<div class="u-av" style="width:${size}px;height:${size}px;background:${img?'transparent':bg+'22'};color:${bg};font-size:${size*0.35}px;">${img || initials(u.name)}</div>`;
}

function roleBadge(role) {
  const map = {admin:'b-admin',manager:'b-manager',worker:'b-worker'};
  return `<span class="badge ${map[role]||''}">${role}</span>`;
}

function statusBadge(s) {
  return `<span class="badge b-${s}">${s.replace(/-/g,' ')}</span>`;
}

function severityBadge(s) {
  const map = {critical:'b-critical',high:'b-high',medium:'b-medium',low:'b-low'};
  return `<span class="badge ${map[s]||'b-low'}">${s}</span>`;
}

function priorityBadge(p) { return severityBadge(p); }

function onlineDot(user) {
  const u = typeof user === 'number' ? userById(user) : user;
  const st = u?.online || 'offline';
  return `<span class="online-dot ${st}" title="${st}"></span>`;
}

function generateId(key) { return nextId[key]++; }

function logAction(action, target, details) {
  DB.auditLog.unshift({ id: generateId('auditLog'), time: nowStr(), userId: currentUser.id, action, target, details, ip:'127.0.0.1', status:'success' });
}

function nowStr() {
  return new Date().toISOString().slice(0,16).replace('T',' ');
}

function destroyChart(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

function makeChart(id, config) {
  destroyChart(id);
  const el = $(id);
  if (!el) return;
  chartInstances[id] = new Chart(el.getContext('2d'), config);
  return chartInstances[id];
}

function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
function chartTextColor() { return isDark() ? '#94a3b8' : '#64748b'; }
function chartGridColor()  { return isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'; }

function chartDefaults() {
  return {
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{ labels:{ color:chartTextColor(), font:{family:'DM Sans',size:11} } } },
    scales:{
      x:{ ticks:{ color:chartTextColor() }, grid:{ color:chartGridColor() } },
      y:{ ticks:{ color:chartTextColor() }, grid:{ color:chartGridColor() } },
    }
  };
}

function exportCSV(rows, filename) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(','), ...rows.map(r => keys.map(k => JSON.stringify(r[k]??'')).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = filename;
  a.click();
}

/* ============================================================
   3. TOAST
   ============================================================ */
function toast(msg, type='info', duration=3000) {
  const icons = { success:'fa-check-circle', error:'fa-circle-xmark', info:'fa-circle-info', warn:'fa-triangle-exclamation' };
  const colors = { success:'#34d399', error:'#f87171', info:'#60a5fa', warn:'#eab308' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fas ${icons[type]||'fa-circle-info'}" style="color:${colors[type]};font-size:1rem;flex-shrink:0;"></i><span>${msg}</span>`;
  $('toastWrap').appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(100%)'; t.style.transition='0.3s'; setTimeout(() => t.remove(), 300); }, duration);
}

/* ============================================================
   4. MODAL HELPERS
   ============================================================ */
function openM(id) { const el=$(id); if(el){ el.classList.add('open'); } }
function closeM(id) { const el=$(id); if(el){ el.classList.remove('open'); } }

/* Auto-wire all [data-close] buttons */
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-close]');
  if (btn) closeM(btn.dataset.close);
  /* close modals on overlay click */
  if (e.target.classList.contains('modal-ov')) closeM(e.target.id);
  /* close profile dropdown */
  if (!e.target.closest('#topAvatar') && !e.target.closest('#profileDropdown')) {
    $('profileDropdown')?.classList.remove('open');
  }
});

/* ============================================================
   5. THEME
   ============================================================ */
function initTheme() {
  const saved = localStorage.getItem('nxTheme') || 'light';
  setTheme(saved, false);
}

function setTheme(theme, save=true) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = $('themeBtn');
  if (btn) btn.innerHTML = theme === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
  if (save) localStorage.setItem('nxTheme', theme);
  /* redraw charts */
  Object.values(chartInstances).forEach(c => {
    if (c.options.plugins?.legend?.labels) c.options.plugins.legend.labels.color = chartTextColor();
    c.update();
  });
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  setTheme(cur === 'dark' ? 'light' : 'dark');
}

/* ============================================================
   6. SIDEBAR + NAVIGATION
   ============================================================ */
function initNav() {
  $$('.sb-nav a').forEach(a => {
    a.addEventListener('click', () => {
      const page = a.dataset.page;
      if (!page) return;
      showPage(page);
      /* mobile: close sidebar */
      if (window.innerWidth < 768) closeMobileSidebar();
    });
  });

  $('menuBtn')?.addEventListener('click', toggleMobileSidebar);
  $('sidebarOv')?.addEventListener('click', closeMobileSidebar);
}

function showPage(pageKey) {
  /* hide all pages */
  $$('[id^="page-"]').forEach(el => el.style.display = 'none');
  /* show target */
  const target = $(`page-${pageKey}`);
  if (target) target.style.display = 'block';
  /* update nav active state */
  $$('.sb-nav a').forEach(a => a.classList.toggle('active', a.dataset.page === pageKey));
  /* update topbar title */
  const titles = {
    dashboard:'Dashboard', analytics:'Analytics', reports:'Reports',
    users:'Users', leave:'Leave Management', timesheets:'Timesheets', payroll:'Payroll Preview',
    tasks:'Tasks & Projects', shifts:'Shift Scheduling', equipment:'Equipment & Inventory',
    sites:'Sites', posts:'Posts', documents:'Documents', categories:'Categories',
    messages:'Messages', notifications:'Notifications', emailcenter:'Email Center',
    safety:'Safety & Incidents', auditlog:'Audit Log',
    rbac:'RBAC Permissions', clientportal:'Client Portal', settings:'Settings',
  };
  $('pageTitle').textContent = titles[pageKey] || pageKey;
  /* render page */
  renderPage(pageKey);
}

function toggleMobileSidebar() {
  $('sidebar').classList.toggle('mobile-open');
  $('sidebarOv').classList.toggle('show');
}
function closeMobileSidebar() {
  $('sidebar').classList.remove('mobile-open');
  $('sidebarOv').classList.remove('show');
}

/* ============================================================
   7. TOPBAR WIRING
   ============================================================ */
function initTopbar() {
  $('themeBtn')?.addEventListener('click', toggleTheme);
  $('topAvatar')?.addEventListener('click', () => $('profileDropdown')?.classList.toggle('open'));
  $('pdMyProfile')?.addEventListener('click', () => { openProfileModal(currentUser.id); $('profileDropdown').classList.remove('open'); });
  $('pdMyIdCard')?.addEventListener('click',  () => { openProfileModal(currentUser.id,'pmIdCard'); $('profileDropdown').classList.remove('open'); });
  $('pdSettings')?.addEventListener('click',  () => { showPage('settings'); $('profileDropdown').classList.remove('open'); });
  $('pdLogout')?.addEventListener('click',    doLogout);
  $('notifBtn')?.addEventListener('click',    () => showPage('notifications'));
  $('msgTopBtn')?.addEventListener('click',   () => showPage('messages'));
  $('globalSearch')?.addEventListener('input', doGlobalSearch);

  /* Ctrl+K focus search */
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); $('globalSearch')?.focus(); }
    if (e.key === 'Escape') { $$('.modal-ov.open').forEach(m => m.classList.remove('open')); }
  });

  /* Dashboard quick actions */
  $('qaAddUser')?.addEventListener('click', () => openUserModal());
  $('qaCreatePost')?.addEventListener('click', () => { showPage('posts'); openPostModal(); });
  $('qaNewTask')?.addEventListener('click', () => { showPage('tasks'); openTaskModal(); });
  $('qaAddSite')?.addEventListener('click', () => { showPage('sites'); openSiteModal(); });
  $('dashAuditMore')?.addEventListener('click', () => showPage('auditlog'));
}

function doLogout() {
  if (!confirm('Log out?')) return;
  logAction('logout','system','Admin logged out');
  toast('Logged out successfully', 'info');
  setTimeout(() => window.location.reload(), 1000);
}

function doGlobalSearch() {
  const q = $('globalSearch').value.toLowerCase().trim();
  if (!q) return;
  const user = DB.users.find(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  if (user) { showPage('users'); toast(`Showing results for "${q}"`, 'info'); return; }
  const site = DB.sites.find(s => s.name.toLowerCase().includes(q));
  if (site) { showPage('sites'); toast(`Showing results for "${q}"`, 'info'); return; }
  const post = DB.posts.find(p => p.title.toLowerCase().includes(q));
  if (post) { showPage('posts'); toast(`Showing results for "${q}"`, 'info'); }
}

/* ============================================================
   8. IMPERSONATION
   ============================================================ */
function impersonateUser(userId) {
  const u = userById(userId);
  if (!u || u.role === 'admin') { toast('Cannot impersonate this user','warn'); return; }
  impersonating = u;
  $('impersonateBanner').style.display = 'flex';
  $('impersonateName').textContent = u.name;
  toast(`Viewing as ${u.name}`, 'warn');
  logAction('impersonate', `User #${userId}`, `Admin viewed as ${u.name}`);
}

function exitImpersonate() {
  impersonating = null;
  $('impersonateBanner').style.display = 'none';
  toast('Exited impersonation', 'info');
}

/* ============================================================
   9. PAGE RENDERER
   ============================================================ */
function renderPage(page) {
  const map = {
    dashboard:     renderDashboard,
    analytics:     renderAnalytics,
    reports:       renderReports,
    users:         renderUsers,
    leave:         renderLeave,
    timesheets:    renderTimesheets,
    payroll:       renderPayroll,
    tasks:         renderTasks,
    shifts:        renderShifts,
    equipment:     renderEquipment,
    sites:         renderSites,
    posts:         renderPosts,
    documents:     renderDocuments,
    categories:    renderCategories,
    messages:      renderMessages,
    notifications: renderNotifications,
    emailcenter:   renderEmailCenter,
    safety:        renderSafety,
    auditlog:      renderAuditLog,
    rbac:          renderRBAC,
    clientportal:  renderClientPortal,
    settings:      renderSettings,
  };
  map[page]?.();
}

/* ============================================================
   10. DASHBOARD
   ============================================================ */
function renderDashboard() {
  /* Pending approvals bar */
  const pendingUsers = DB.users.filter(u => u.status === 'pending').length;
  const pendingLeave = DB.leaveRequests.filter(l => l.status === 'pending').length;
  const pendingDocs  = DB.documents.filter(d => d.status === 'pending').length;
  const totalPending = pendingUsers + pendingLeave + pendingDocs;
  const bar = $('pendingBar');
  if (totalPending > 0) {
    bar.style.display = 'flex';
    $('pendingBarText').textContent = `${totalPending} pending approval${totalPending>1?'s':''}: ${pendingUsers} users, ${pendingLeave} leave requests, ${pendingDocs} documents`;
    $('pendingBarActions').innerHTML = `
      <button class="btn btn-accent btn-sm" onclick="showPage('users')">Users</button>
      <button class="btn btn-outline btn-sm" onclick="showPage('leave')">Leave</button>
      <button class="btn btn-outline btn-sm" onclick="showPage('documents')">Docs</button>`;
  } else { bar.style.display = 'none'; }

  /* Stats */
  const activeUsers = DB.users.filter(u => u.status==='active').length;
  const activeSites = DB.sites.filter(s => s.status==='active').length;
  const openIncidents = DB.incidents.filter(i => i.status==='open').length;
  const totalTasks = DB.tasks.length;
  const doneTasks = DB.tasks.filter(t => t.status==='done').length;

  $('statsGrid').innerHTML = statCard('fa-users','blue', activeUsers,'Active Users','+2 this month','up') +
    statCard('fa-building','yellow', activeSites,'Active Sites','','flat') +
    statCard('fa-list-check','green', doneTasks+'/'+totalTasks,'Tasks Complete','','flat') +
    statCard('fa-money-bill-wave','purple', fmtMoney(DB.payroll.reduce((s,p)=>s+netPay(p),0)),'Total Payroll','This month','flat') +
    statCard('fa-triangle-exclamation','red', openIncidents,'Open Incidents',openIncidents>0?'Action needed':'All clear', openIncidents>0?'down':'up') +
    statCard('fa-folder-open','orange', DB.documents.filter(d=>d.status==='pending').length,'Docs Pending Review','','flat');

  /* Notification badge */
  const unread = DB.notifications.filter(n=>!n.read).length;
  $('nbNotifs').textContent = unread;
  $('nbNotifs').style.display = unread > 0 ? '' : 'none';
  $('notifDot').style.display = unread > 0 ? '' : 'none';

  /* Pending users badge */
  $('nbUsers').textContent = pendingUsers;
  $('nbUsers').style.display = pendingUsers > 0 ? '' : 'none';

  /* Charts */
  setTimeout(() => {
    renderMainChart();
    renderRoleChart();
    renderTaskChart();
    renderActivityFeed();
    renderSysHealth();
    renderDashAudit();
  }, 50);
}

function statCard(icon, color, num, label, trend, dir) {
  return `<div class="stat-card">
    <div class="sc-top">
      <div class="sc-icon ${color}"><i class="fas ${icon}"></i></div>
    </div>
    <div class="sc-num">${num}</div>
    <div class="sc-label">${label}</div>
    ${trend ? `<div class="sc-trend trend-${dir==='up'?'up':dir==='down'?'down':'flat'}"><i class="fas fa-arrow-${dir==='up'?'up':dir==='down'?'down':'right'}"></i>${trend}</div>` : ''}
  </div>`;
}

function renderMainChart() {
  makeChart('mainChart', {
    type:'bar',
    data:{
      labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
      datasets:[
        { label:'Completed', data:[4,6,3,8,5,2,1], backgroundColor:'rgba(234,179,8,0.8)', borderRadius:6 },
        { label:'In Progress',data:[2,3,5,2,4,1,0], backgroundColor:'rgba(59,130,246,0.6)', borderRadius:6 },
      ]
    },
    options:{ ...chartDefaults(), plugins:{...chartDefaults().plugins, legend:{...chartDefaults().plugins.legend}} }
  });
}

function renderRoleChart() {
  const counts = ['admin','manager','worker'].map(r => DB.users.filter(u=>u.role===r).length);
  makeChart('roleChart', {
    type:'doughnut',
    data:{
      labels:['Admin','Manager','Worker'],
      datasets:[{ data:counts, backgroundColor:['rgba(139,92,246,0.8)','rgba(234,179,8,0.8)','rgba(59,130,246,0.8)'], borderWidth:0 }]
    },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ color:chartTextColor(), font:{family:'DM Sans',size:11} } } }, cutout:'65%' }
  });
}

function renderTaskChart() {
  const cols = ['todo','inprogress','review','done'];
  const labels = ['To Do','In Progress','Review','Done'];
  const counts = cols.map(c => DB.tasks.filter(t=>t.status===c).length);
  makeChart('taskChart', {
    type:'bar',
    data:{
      labels,
      datasets:[{ label:'Tasks', data:counts, backgroundColor:['rgba(100,116,139,0.7)','rgba(234,179,8,0.7)','rgba(59,130,246,0.7)','rgba(16,185,129,0.7)'], borderRadius:6 }]
    },
    options:{ ...chartDefaults(), indexAxis:'y', plugins:{legend:{display:false}} }
  });
}

function renderActivityFeed() {
  const feed = $('actFeed');
  const items = DB.auditLog.slice(0,8).map(l => {
    const u = userById(l.userId);
    const icons = {login:'fa-sign-in-alt',logout:'fa-sign-out-alt',create:'fa-plus',update:'fa-pen',delete:'fa-trash',approve:'fa-check',reject:'fa-times',impersonate:'fa-user-secret'};
    return `<div style="display:flex;gap:0.6rem;align-items:flex-start;padding:0.4rem 0;border-bottom:1px solid var(--border);">
      <div style="width:28px;height:28px;border-radius:7px;background:var(--accent-glow);display:flex;align-items:center;justify-content:center;font-size:0.72rem;flex-shrink:0;color:var(--accent);">
        <i class="fas ${icons[l.action]||'fa-circle'}"></i></div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:0.78rem;font-weight:500;">${u?.name||'System'} <span style="color:var(--text3);">${l.action}</span> ${l.target}</div>
        <div style="font-size:0.68rem;color:var(--text3);">${l.time}</div>
      </div></div>`;
  }).join('');
  feed.innerHTML = items || '<div class="empty-state"><i class="fas fa-rss"></i>No recent activity</div>';
}

function renderSysHealth() {
  const storePct = 24;
  $('sysHealthGrid').innerHTML = `
    <div class="sys-health-item"><div class="sh-label">Storage</div><div class="sh-val" style="color:var(--accent);">2.4 / 10 MB</div><div class="pb sh-bar" style="height:5px;"><div class="pb-fill" style="width:${storePct}%;"></div></div></div>
    <div class="sys-health-item"><div class="sh-label">Active Users</div><div class="sh-val">${DB.users.filter(u=>u.online==='online').length} online</div></div>
    <div class="sys-health-item"><div class="sh-label">Pending Notifications</div><div class="sh-val">${DB.notifications.filter(n=>!n.read).length} unread</div></div>
    <div class="sys-health-item"><div class="sh-label">Last Backup</div><div class="sh-val" style="color:#34d399;">Today 03:00</div></div>`;
}

function renderDashAudit() {
  $('dashAuditBody').innerHTML = DB.auditLog.slice(0,5).map(l => {
    const u = userById(l.userId);
    return `<tr><td>${l.time}</td><td>${avatarEl(u,24)} ${u?.name||'?'}</td><td>${l.action}</td><td>${l.target}</td><td><code style="font-size:0.72rem;">${l.ip}</code></td></tr>`;
  }).join('');
}

/* ============================================================
   11. USERS PAGE
   ============================================================ */
function renderUsers() {
  populateUserFilterSelects();
  renderUserTable();
  wireUserFilters();
  wireUserBulk();

  $('addUserBtn')?.addEventListener('click', () => openUserModal());
  $('csvImportBtn')?.addEventListener('click', () => $('csvImportFile').click());
  $('csvImportFile')?.addEventListener('change', handleCSVImport);
  $('resetF')?.addEventListener('click', () => {
    ['fName','fEmail','fPhone','fRole','fStatus'].forEach(id => { const el=$(id); if(el) el.value=''; });
    renderUserTable();
  });

  $$('[data-utab]').forEach(btn => btn.addEventListener('click', () => {
    $$('[data-utab]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderUserTable(btn.dataset.utab);
  }));
}

function populateUserFilterSelects() {
  const tsUser = $('tsUser');
  if (tsUser) {
    tsUser.innerHTML = '<option value="">All Employees</option>' +
      DB.users.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  }
  const docUser = $('docUser');
  if (docUser) {
    docUser.innerHTML = '<option value="">All Employees</option>' +
      DB.users.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  }
}

function wireUserFilters() {
  ['fName','fEmail','fPhone','fRole','fStatus'].forEach(id => {
    $(id)?.addEventListener('input', () => renderUserTable());
  });
}

function wireUserBulk() {
  $('selectAll')?.addEventListener('change', e => {
    $$('.row-check').forEach(cb => { cb.checked = e.target.checked; });
    selectedUserIds = e.target.checked ? new Set(DB.users.map(u=>u.id)) : new Set();
    updateBulkBar();
  });
  $('bulkActivate')?.addEventListener('click', () => {
    selectedUserIds.forEach(id => { const u=userById(id); if(u) u.status='active'; });
    selectedUserIds.clear(); renderUserTable(); updateBulkBar(); toast('Users activated','success');
  });
  $('bulkDeactivate')?.addEventListener('click', () => {
    selectedUserIds.forEach(id => { const u=userById(id); if(u) u.status='inactive'; });
    selectedUserIds.clear(); renderUserTable(); updateBulkBar(); toast('Users deactivated','warn');
  });
  $('bulkDelete')?.addEventListener('click', () => {
    if (!confirm(`Delete ${selectedUserIds.size} users?`)) return;
    DB.users.splice(0, DB.users.length, ...DB.users.filter(u=>!selectedUserIds.has(u.id)));
    selectedUserIds.clear(); renderUserTable(); updateBulkBar(); toast('Users deleted','success');
  });
  $('bulkClear')?.addEventListener('click', () => {
    selectedUserIds.clear(); $$('.row-check').forEach(cb=>cb.checked=false);
    if($('selectAll')) $('selectAll').checked=false;
    updateBulkBar();
  });
}

function updateBulkBar() {
  const bar = $('bulkBar');
  if (!bar) return;
  bar.style.display = selectedUserIds.size > 0 ? 'flex' : 'none';
  $('bulkCount').textContent = `${selectedUserIds.size} selected`;
}

function renderUserTable(tab='all') {
  const name   = $('fName')?.value.toLowerCase()  || '';
  const email  = $('fEmail')?.value.toLowerCase() || '';
  const phone  = $('fPhone')?.value.toLowerCase() || '';
  const role   = $('fRole')?.value  || '';
  const status = $('fStatus')?.value|| '';

  let users = DB.users.filter(u => {
    if (tab==='pending' && u.status!=='pending') return false;
    if (name   && !u.name.toLowerCase().includes(name))   return false;
    if (email  && !u.email.toLowerCase().includes(email)) return false;
    if (phone  && !u.phone.toLowerCase().includes(phone)) return false;
    if (role   && u.role !== role)   return false;
    if (status && u.status !== status) return false;
    return true;
  });

  $('uCount').textContent = `${users.length} user${users.length!==1?'s':''}`;
  $('pendingCount').textContent = DB.users.filter(u=>u.status==='pending').length;
  $('pendingCount').style.display = DB.users.filter(u=>u.status==='pending').length>0 ? '' : 'none';

  $('uTbody').innerHTML = users.length ? users.map((u,i) => `
    <tr>
      <td><input type="checkbox" class="row-check" data-uid="${u.id}" ${selectedUserIds.has(u.id)?'checked':''}></td>
      <td style="color:var(--text3);font-size:0.75rem;">${i+1}</td>
      <td><div class="user-cell">${avatarEl(u)} <div><div style="font-weight:600;">${u.name}</div><div style="font-size:0.72rem;color:var(--text3);">${u.empId}</div></div></div></td>
      <td>${u.email}</td>
      <td>${u.phone}</td>
      <td>${roleBadge(u.role)}</td>
      <td>${u.dept||'—'}</td>
      <td>${statusBadge(u.status)}</td>
      <td>${onlineDot(u)}</td>
      <td style="font-size:0.75rem;">${fmt(u.registered)}</td>
      <td style="font-size:0.75rem;">${u.lastLogin}</td>
      <td>
        <div style="display:flex;gap:0.2rem;flex-wrap:wrap;">
          <button class="abt inf" title="View Profile" onclick="openProfileModal(${u.id})"><i class="fas fa-eye"></i></button>
          <button class="abt warn" title="Edit" onclick="openUserModal(${u.id})"><i class="fas fa-pen"></i></button>
          ${u.status==='pending'?`<button class="abt suc" title="Approve" onclick="openApprovalModal(${u.id})"><i class="fas fa-check"></i></button>`:''}
          <button class="abt" title="Switch to User" onclick="impersonateUser(${u.id})"><i class="fas fa-user-secret"></i></button>
          <button class="abt dan" title="Delete" onclick="deleteUser(${u.id})"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`).join('') :
    '<tr><td colspan="12"><div class="empty-state"><i class="fas fa-users"></i>No users found</div></td></tr>';

  /* Wire row checkboxes */
  $$('.row-check').forEach(cb => {
    cb.addEventListener('change', e => {
      const uid = +e.target.dataset.uid;
      e.target.checked ? selectedUserIds.add(uid) : selectedUserIds.delete(uid);
      updateBulkBar();
    });
  });
}

function deleteUser(id) {
  if (!confirm('Delete this user?')) return;
  const idx = DB.users.findIndex(u => u.id === id);
  if (idx > -1) { DB.users.splice(idx,1); logAction('delete',`User #${id}`,'User deleted'); renderUserTable(); toast('User deleted','success'); }
}

function handleCSVImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const lines = ev.target.result.split('\n').filter(Boolean);
    const headers = lines[0].split(',').map(h=>h.trim().toLowerCase());
    let added = 0;
    lines.slice(1).forEach(line => {
      const vals = line.split(',').map(v=>v.trim().replace(/^"|"$/g,''));
      const obj = {};
      headers.forEach((h,i) => obj[h] = vals[i]);
      if (obj.name && obj.email) {
        DB.users.push({ id:generateId('users'), name:obj.name, email:obj.email, phone:obj.phone||'', role:obj.role||'worker', dept:obj.dept||'', status:'pending', empId:`EMP-${String(nextId.users).padStart(4,'0')}`, idNum:'', natId:'', dob:'', hired:nowStr().slice(0,10), salary:0, addr:'', emerg:'', bio:'', avatarColor:'#eab308', avatarImg:'', lastLogin:'Never', registered:nowStr().slice(0,10), online:'offline' });
        added++;
      }
    });
    renderUserTable(); toast(`Imported ${added} users`, 'success');
    e.target.value = '';
  };
  reader.readAsText(file);
}

/* ============================================================
   12. USER MODAL (ADD / EDIT)
   ============================================================ */
function openUserModal(userId=null) {
  openProfileModal(userId);
}

/* ============================================================
   13. PROFILE MODAL
   ============================================================ */
function openProfileModal(userId=null, tab='pmEdit') {
  currentSite = null;
  const user = userId ? userById(userId) : { id:null, name:'', email:'', phone:'', role:'worker', dept:'', status:'active', empId:'', idNum:'', natId:'', dob:'', hired:'', salary:0, addr:'', emerg:'', bio:'', avatarColor:'#eab308', avatarImg:'', registered:'', lastLogin:'', online:'offline' };

  $('pmTitle').textContent   = userId ? 'Edit Profile' : 'Add User';
  $('pmName2').textContent   = user.name || 'New User';
  $('pmRole2').textContent   = user.role || '';
  $('pmFName').value  = user.name;
  $('pmEmail').value  = user.email;
  $('pmPhone').value  = user.phone;
  $('pmRole').value   = user.role;
  $('pmStatus').value = user.status;
  $('pmDept').value   = user.dept;
  $('pmEmpId').value  = user.empId;
  $('pmIdNum').value  = user.idNum;
  $('pmNatId').value  = user.natId;
  $('pmDob').value    = user.dob;
  $('pmHired').value  = user.hired;
  $('pmSalary').value = user.salary;
  $('pmAddr').value   = user.addr;
  $('pmEmerg').value  = user.emerg;
  $('pmBio').value    = user.bio;

  /* Avatar */
  const avInit = $('pmAvInit'), avImg = $('pmAvImg');
  avInit.textContent = initials(user.name) || '?';
  avInit.style.color = user.avatarColor || '#eab308';
  if (user.avatarImg) { avImg.src = user.avatarImg; avImg.style.display='block'; avInit.style.display='none'; }
  else { avImg.style.display='none'; avInit.style.display=''; }

  /* Avatar colors */
  const colors = ['#eab308','#3b82f6','#10b981','#8b5cf6','#f43f5e','#f97316','#06b6d4','#84cc16'];
  $('avColorOpts').innerHTML = colors.map(c => `<div class="av-color-opt${user.avatarColor===c?' sel':''}" style="background:${c}22;color:${c};border-color:${user.avatarColor===c?c:'transparent'};" data-color="${c}" onclick="pickAvatarColor(this,'${c}')">${initials(user.name)||'?'}</div>`).join('');

  /* Tab switching */
  switchPMTab(tab);

  /* Performance tab */
  if (userId) renderPMPerf(user);
  /* Documents tab */
  renderPMDocs(userId);
  /* History tab */
  renderPMHist(userId);
  /* ID card tab */
  renderIdCard(user);

  /* Save button */
  const saveBtn = $('pmSaveBtn');
  saveBtn.onclick = () => savePMUser(userId);

  /* Avatar upload */
  $('avUploadDrop')?.addEventListener('click', () => $('avatarFileInput').click());
  $('avatarFileInput').onchange = e => handleAvatarUpload(e, userId);

  openM('profileModal');
}

function switchPMTab(tabId) {
  ['pmEdit','pmPerf','pmDocs','pmHist','pmIdCard'].forEach(id => {
    const el = $(id); if(el) el.style.display = id===tabId ? '' : 'none';
  });
  $$('.pm-tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.pmtab === tabId));
  /* Wire tab buttons */
  $$('.pm-tab-btn').forEach(btn => { btn.onclick = () => switchPMTab(btn.dataset.pmtab); });
}

function pickAvatarColor(el, color) {
  $$('#avColorOpts .av-color-opt').forEach(o => { o.classList.remove('sel'); o.style.borderColor='transparent'; });
  el.classList.add('sel'); el.style.borderColor = color;
}

function handleAvatarUpload(e, userId) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const src = ev.target.result;
    const avImg = $('pmAvImg'), avInit = $('pmAvInit');
    avImg.src = src; avImg.style.display='block'; avInit.style.display='none';
    if (userId) { const u = userById(userId); if(u) u.avatarImg = src; }
    updateTopbarAvatar();
  };
  reader.readAsDataURL(file);
}

function savePMUser(userId) {
  const data = {
    name:$('pmFName').value.trim(), email:$('pmEmail').value.trim(), phone:$('pmPhone').value.trim(),
    role:$('pmRole').value, status:$('pmStatus').value, dept:$('pmDept').value.trim(),
    empId:$('pmEmpId').value.trim(), idNum:$('pmIdNum').value.trim(), natId:$('pmNatId').value.trim(),
    dob:$('pmDob').value, hired:$('pmHired').value, salary:+$('pmSalary').value,
    addr:$('pmAddr').value.trim(), emerg:$('pmEmerg').value.trim(), bio:$('pmBio').value.trim(),
  };
  if (!data.name || !data.email) { toast('Name and email required','error'); return; }

  /* Avatar color */
  const selColor = document.querySelector('#avColorOpts .av-color-opt.sel');
  if (selColor) data.avatarColor = selColor.dataset.color;

  if (userId) {
    const u = userById(userId);
    Object.assign(u, data);
    logAction('update',`User #${userId}`,`Updated ${data.name}`);
    toast('Profile saved','success');
  } else {
    const newUser = { id:generateId('users'), ...data, avatarImg:'', avatarColor: data.avatarColor||'#eab308', lastLogin:'Never', registered:nowStr().slice(0,10), online:'offline' };
    DB.users.push(newUser);
    logAction('create',`User #${newUser.id}`,`Created ${data.name}`);
    toast('User created','success');
  }

  closeM('profileModal');
  if ($('page-users').style.display !== 'none') renderUserTable();
  updateTopbarAvatar();
}

function renderPMPerf(user) {
  const userTasks  = DB.tasks.filter(t => t.assigneeId === user.id);
  $('pf_tasks').textContent = userTasks.filter(t=>t.status==='done').length;
  $('pf_proc').textContent  = userTasks.filter(t=>t.status==='inprogress').length;
  $('pf_pend').textContent  = userTasks.filter(t=>t.status==='todo').length;
  $('pf_issues').textContent= DB.incidents.filter(i=>i.reporterId===user.id).length;
  $('pf_rating').textContent= '4.2';
  $('pf_attendance').textContent= '96%';
  setTimeout(() => {
    makeChart('pmPerfChart',{
      type:'line',
      data:{ labels:['Jan','Feb','Mar','Apr','May','Jun','Jul'], datasets:[{label:'Tasks Done', data:[2,4,3,6,5,8,userTasks.filter(t=>t.status==='done').length], borderColor:'#eab308', backgroundColor:'rgba(234,179,8,0.1)', fill:true, tension:0.4}] },
      options:{...chartDefaults(),plugins:{legend:{display:false}}}
    });
  },100);
}

function renderPMDocs(userId) {
  const docs = userId ? DB.documents.filter(d => d.userId === userId) : [];
  $('pmDocsList').innerHTML = docs.length ? docs.map(d =>
    `<div class="att-file"><i class="fas fa-file"></i><span>${d.name} <span class="badge b-${d.status}" style="margin-left:0.35rem;">${d.status}</span></span><span style="font-size:0.72rem;color:var(--text3);">Expires ${fmt(d.expiry)}</span></div>`
  ).join('') : '<div class="empty-state"><i class="fas fa-folder-open"></i>No documents</div>';
}

function renderPMHist(userId) {
  const logs = DB.auditLog.filter(l => l.userId === userId).slice(0,10);
  $('pmHistList').innerHTML = logs.length ? logs.map(l =>
    `<div style="display:flex;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.8rem;"><span style="color:var(--text3);min-width:120px;">${l.time}</span><span class="badge b-${l.action}">${l.action}</span><span>${l.target} — ${l.details}</span></div>`
  ).join('') : '<div class="empty-state"><i class="fas fa-history"></i>No history</div>';
}

function renderIdCard(user) {
  const u = typeof user==='number' ? userById(user) : user;
  $('icAv').textContent = initials(u.name);
  $('icName').textContent = u.name;
  $('icRole').textContent = u.role?.toUpperCase();
  $('icEmpId').textContent  = u.empId || '—';
  $('icIdNum').textContent  = u.idNum || '—';
  $('icDept').textContent   = u.dept  || '—';
  $('icHired').textContent  = fmt(u.hired);
  $('icBarcode').textContent= u.idNum || `NX-${String(u.id).padStart(3,'0')}-${new Date().getFullYear()}`;
  $('icInfoGrid').innerHTML = `
    <div class="info-item"><div class="il">Email</div><div class="iv">${u.email}</div></div>
    <div class="info-item"><div class="il">Phone</div><div class="iv">${u.phone}</div></div>
    <div class="info-item"><div class="il">National ID</div><div class="iv">${u.natId||'—'}</div></div>
    <div class="info-item"><div class="il">DOB</div><div class="iv">${fmt(u.dob)}</div></div>`;
}

$('printIdBtn')?.addEventListener('click', printIdCard);
function printIdCard() { window.print(); }

/* ============================================================
   14. APPROVAL MODAL
   ============================================================ */
function openApprovalModal(userId) {
  const u = userById(userId);
  if (!u) return;
  $('approvalInfo').innerHTML = `<div class="user-cell">${avatarEl(u,36)}<div><div style="font-weight:600;">${u.name}</div><div style="font-size:0.75rem;color:var(--text3);">${u.email} · ${u.role}</div></div></div>`;
  $('approvalApproveBtn').onclick = () => decideUserApproval(userId, 'active');
  $('approvalRejectBtn').onclick  = () => decideUserApproval(userId, 'inactive');
  openM('approvalModal');
}

function decideUserApproval(userId, decision) {
  const u = userById(userId);
  if (!u) return;
  u.status = decision;
  const comment = $('approvalComment')?.value || '';
  logAction(decision==='active'?'approve':'reject',`User #${userId}`,`${decision==='active'?'Approved':'Rejected'} ${u.name}. ${comment}`);
  closeM('approvalModal');
  renderUserTable();
  toast(`User ${decision==='active'?'approved':'rejected'}`, decision==='active'?'success':'warn');
  sendEmail(u.email, decision==='active'?'Welcome to Nixers Pro':'Account not approved', 'welcome_approved');
}

/* ============================================================
   15. SITES PAGE
   ============================================================ */
function renderSites() {
  $('addSiteBtn')?.addEventListener('click', () => openSiteModal());
  renderSiteTable();
}

function renderSiteTable() {
  const managers = DB.users.filter(u=>u.role==='manager');
  $('sTbody').innerHTML = DB.sites.map(s => {
    const mgr = userById(s.managerId);
    const workers = s.workerIds.length;
    const pct = s.progress;
    return `<tr>
      <td><div style="font-weight:600;">${s.name}</div></td>
      <td><div class="user-cell">${avatarEl(mgr,26)}<span style="font-size:0.82rem;">${mgr?.name||'—'}</span></div></td>
      <td>${workers}</td>
      <td><div style="display:flex;align-items:center;gap:0.5rem;min-width:100px;"><div class="pb" style="flex:1;height:7px;"><div class="pb-fill" style="width:${pct}%;"></div></div><span style="font-size:0.75rem;color:var(--text3);">${pct}%</span></div></td>
      <td>${fmtMoney(s.budget)}</td>
      <td>${fmtMoney(s.spent)}</td>
      <td>${statusBadge(s.status)}</td>
      <td style="font-size:0.78rem;">${fmt(s.endDate)}</td>
      <td>
        <button class="abt inf" onclick="openSiteDetail(${s.id})"><i class="fas fa-eye"></i></button>
        <button class="abt warn" onclick="openSiteModal(${s.id})"><i class="fas fa-pen"></i></button>
        <button class="abt dan" onclick="deleteSite(${s.id})"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-building"></i>No sites found</div></td></tr>';
}

function openSiteModal(siteId=null) {
  const managers = DB.users.filter(u=>u.role==='manager');
  $('sm_mgr').innerHTML = managers.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
  const s = siteId ? siteById(siteId) : null;
  $('smTitle').textContent = s ? 'Edit Site' : 'Add Site';
  $('sm_name').value   = s?.name   || '';
  $('sm_mgr').value    = s?.managerId || managers[0]?.id || '';
  $('sm_budget').value = s?.budget  || '';
    $('sm_spent').value  = s?.spent   || '';
  $('sm_status').value = s?.status  || 'planning';
  $('sm_start').value  = s?.startDate|| '';
  $('sm_end').value    = s?.endDate  || '';
  $('sm_prog').value   = s?.progress || 0;
  $('sm_desc').value   = s?.desc     || '';
  $('sm_save').onclick = () => saveSite(siteId);
  openM('siteModal');
}

function saveSite(siteId) {
  const data = {
    name:$('sm_name').value.trim(), managerId:+$('sm_mgr').value,
    budget:+$('sm_budget').value||0, status:$('sm_status').value,
      spent:+$('sm_spent').value||0,
    startDate:$('sm_start').value, endDate:$('sm_end').value,
    progress:+$('sm_prog').value||0, desc:$('sm_desc').value.trim(), workerIds:[],
  if (!data.name) { toast('Site name required','error'); return; }
  if (siteId) { Object.assign(siteById(siteId), data); logAction('update',`Site #${siteId}`,`Updated ${data.name}`); }
  else { DB.sites.push({id:generateId('sites'),...data}); logAction('create','Site',`Created ${data.name}`); }
  closeM('siteModal'); renderSiteTable(); toast('Site saved','success');
}

function deleteSite(id) {
  if (!confirm('Delete this site?')) return;
  DB.sites.splice(DB.sites.findIndex(s=>s.id===id),1);
  logAction('delete',`Site #${id}`,'Site deleted'); renderSiteTable(); toast('Site deleted','success');
}

function openSiteDetail(siteId) {
  const s = siteById(siteId);
  if (!s) return;
  const mgr = userById(s.managerId);
  const workers = s.workerIds.map(id=>userById(id)).filter(Boolean);
  $('sdTitle').textContent = s.name;
  $('sdBody').innerHTML = `
    <div class="info-grid" style="margin-bottom:1rem;">
      <div class="info-item"><div class="il">Manager</div><div class="iv">${mgr?.name||'—'}</div></div>
      <div class="info-item"><div class="il">Status</div><div class="iv">${statusBadge(s.status)}</div></div>
      <div class="info-item"><div class="il">Budget</div><div class="iv">${fmtMoney(s.budget)}</div></div>
      <div class="info-item"><div class="il">Spent</div><div class="iv">${fmtMoney(s.spent)}</div></div>
      <div class="info-item"><div class="il">Start</div><div class="iv">${fmt(s.startDate)}</div></div>
      <div class="info-item"><div class="il">End</div><div class="iv">${fmt(s.endDate)}</div></div>
    </div>
    <div style="margin-bottom:1rem;"><div class="il fl">Progress</div>
      <div class="pb" style="height:10px;"><div class="pb-fill" style="width:${s.progress}%;"></div></div>
      <div style="font-size:0.75rem;color:var(--text3);margin-top:0.25rem;">${s.progress}% complete</div>
    </div>
    <div class="il fl">Workers (${workers.length})</div>
    <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.35rem;">
      ${workers.map(w=>`<div class="user-cell" style="background:var(--surface2);padding:0.35rem 0.65rem;border-radius:8px;">${avatarEl(w,24)}<span style="font-size:0.8rem;">${w.name}</span></div>`).join('')||'<span style="color:var(--text3);font-size:0.82rem;">No workers assigned</span>'}
    </div>
    ${s.desc?`<hr class="div"><div style="font-size:0.83rem;">${s.desc}</div>`:''}`;
  openM('siteDetailModal');
}

/* ============================================================
   16. POSTS PAGE
   ============================================================ */
function renderPosts() {
  populateCatFilter();
  renderPostTable();
  $('addPostBtn')?.addEventListener('click', () => openPostModal());
  $('fPost')?.addEventListener('input', renderPostTable);
  $('fVis')?.addEventListener('change', renderPostTable);
  $('fCat')?.addEventListener('change', renderPostTable);
}

function populateCatFilter() {
  const el = $('fCat'); if(!el) return;
  el.innerHTML = '<option value="">All Categories</option>' + DB.categories.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  const pmCat = $('pm_cat'); if(!pmCat) return;
  pmCat.innerHTML = DB.categories.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
}

function renderPostTable() {
  const q   = $('fPost')?.value.toLowerCase()||'';
  const vis = $('fVis')?.value ||'';
  const cat = $('fCat')?.value ||'';
  const posts = DB.posts.filter(p => {
    if (q   && !p.title.toLowerCase().includes(q)) return false;
    if (vis && p.visibility!==vis) return false;
    if (cat && p.catId!==+cat) return false;
    return true;
  });
  $('pTbody').innerHTML = posts.map(p => {
    const author = userById(p.authorId);
    const cat = catById(p.catId);
    const assigned = p.assignedIds.map(id=>userById(id)?.name).filter(Boolean).join(', ');
    return `<tr>
      <td style="font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.title}</td>
      <td><div class="user-cell">${avatarEl(author,26)}<span style="font-size:0.82rem;">${author?.name||'—'}</span></div></td>
      <td>${cat?`<span class="badge" style="background:${cat.color}22;color:${cat.color};"><i class="fas ${cat.icon}" style="font-size:0.65rem;"></i> ${cat.name}</span>`:'—'}</td>
      <td>${statusBadge(p.visibility==='all'?'published':p.visibility)}</td>
      <td style="font-size:0.75rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${assigned||'Everyone'}</td>
      <td style="font-size:0.75rem;">${fmt(p.created)}</td>
      <td>${statusBadge(p.status)}</td>
      <td>${p.views}</td>
      <td>
        <button class="abt warn" onclick="openPostModal(${p.id})"><i class="fas fa-pen"></i></button>
        <button class="abt dan" onclick="deletePost(${p.id})"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-newspaper"></i>No posts found</div></td></tr>';
}

function openPostModal(postId=null) {
  populateCatFilter();
  postAssignees = [];
  $('pm_assignTags').innerHTML = '';
  $('pm_attFiles').innerHTML = '';
  const p = postId ? DB.posts.find(x=>x.id===postId) : null;
  $('pomTitle').textContent = p ? 'Edit Post' : 'New Post';
  $('pm_title').value    = p?.title   || '';
  $('pm_cat').value      = p?.catId   || (DB.categories[0]?.id||'');
  $('pm_vis').value      = p?.visibility||'all';
  $('pm_content').value  = p?.content || '';
  $('pm_loc').value      = p?.location|| '';
  if (p) postAssignees = [...(p.assignedIds||[])];
  renderAssignTags();
  $('pm_save').onclick = () => savePost(postId);
  $('detectLocBtn')?.addEventListener('click', detectLocation);
  $('pm_assignSearch')?.addEventListener('input', e => searchAssignees(e.target.value));
  $('pmAttachBtn')?.addEventListener('click', () => $('pm_files').click());
  $('pmVideoBtn')?.addEventListener('click', () => $('pm_video').click());
  $('pm_files')?.addEventListener('change', e => addPostFiles(e.target));
  $('pm_video')?.addEventListener('change', e => addPostFiles(e.target));
  $('voiceRecBtn')?.addEventListener('click', togglePostVoice);
  openM('postModal');
}

function searchAssignees(q) {
  const res = $('pm_assignResults');
  if (!q) { res.classList.remove('show'); return; }
  const workers = DB.users.filter(u => u.role==='worker' && u.name.toLowerCase().includes(q.toLowerCase()) && !postAssignees.includes(u.id));
  res.innerHTML = workers.map(w=>`<div class="assign-opt" onclick="addAssignee(${w.id})">${avatarEl(w,24)}<span>${w.name}</span></div>`).join('') || '<div style="padding:0.5rem;color:var(--text3);font-size:0.8rem;">No results</div>';
  res.classList.toggle('show', !!workers.length);
}

function addAssignee(id) {
  if (!postAssignees.includes(id)) { postAssignees.push(id); }
  renderAssignTags();
  $('pm_assignResults').classList.remove('show');
  $('pm_assignSearch').value = '';
}

function renderAssignTags() {
  $('pm_assignTags').innerHTML = postAssignees.map(id => {
    const u = userById(id);
    return `<div class="assign-tag">${u?.name||id}<button onclick="removeAssignee(${id})">×</button></div>`;
  }).join('');
}

function removeAssignee(id) { postAssignees = postAssignees.filter(x=>x!==id); renderAssignTags(); }

function addPostFiles(input) {
  Array.from(input.files).forEach(file => {
    $('pm_attFiles').innerHTML += `<div class="att-file"><i class="fas fa-file"></i><span>${file.name}</span><span style="color:var(--text3);font-size:0.72rem;">${(file.size/1024).toFixed(1)} KB</span></div>`;
  });
}

function detectLocation() {
  if (!navigator.geolocation) { toast('Geolocation not supported','error'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    $('pm_loc').value = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
    toast('Location detected','success');
  }, () => toast('Could not detect location','error'));
}

function togglePostVoice() {
  postVoiceRecording = !postVoiceRecording;
  const btn = $('voiceRecBtn');
  btn.classList.toggle('recording', postVoiceRecording);
  btn.innerHTML = postVoiceRecording ? '<i class="fas fa-stop"></i> Stop Recording' : '<i class="fas fa-microphone"></i> Record Voice';
  $('pm_voiceStatus').style.display = postVoiceRecording ? '' : 'none';
  if (!postVoiceRecording) toast('Voice note saved','success');
}

function savePost(postId) {
  const data = {
    title:$('pm_title').value.trim(), catId:+$('pm_cat').value,
    visibility:$('pm_vis').value, content:$('pm_content').value.trim(),
    location:$('pm_loc').value.trim(), assignedIds:[...postAssignees], files:[],
  };
  if (!data.title) { toast('Title required','error'); return; }
  if (postId) {
    const p = DB.posts.find(x=>x.id===postId);
    Object.assign(p, data);
    logAction('update',`Post #${postId}`,`Updated "${data.title}"`);
  } else {
    DB.posts.push({id:generateId('posts'),...data, authorId:currentUser.id, created:nowStr().slice(0,10), status:'published', views:0});
    logAction('create','Post',`Created "${data.title}"`);
  }
  closeM('postModal'); renderPostTable(); toast('Post saved','success');
}

function deletePost(id) {
  if (!confirm('Delete this post?')) return;
  DB.posts.splice(DB.posts.findIndex(p=>p.id===id),1);
  logAction('delete',`Post #${id}`,'Post deleted'); renderPostTable(); toast('Post deleted','success');
}

/* ============================================================
   17. CATEGORIES PAGE
   ============================================================ */
function renderCategories() {
  renderCatList();
  renderCatChart();
  $('addCatBtn')?.addEventListener('click', () => openM('addCatModal'));
  $('addCatSaveBtn')?.addEventListener('click', addCategory);
}

function renderCatList() {
  $('catList').innerHTML = DB.categories.map(c => `
    <div class="cat-item">
      <div class="ci-color" style="background:${c.color};"></div>
      <i class="fas ${c.icon}" style="color:${c.color};font-size:0.85rem;"></i>
      <span class="ci-name">${c.name}</span>
      <span style="font-size:0.72rem;color:var(--text3);">${DB.posts.filter(p=>p.catId===c.id).length} posts</span>
      <button class="abt dan" onclick="deleteCat(${c.id})"><i class="fas fa-trash"></i></button>
    </div>`).join('') || '<div class="empty-state"><i class="fas fa-tags"></i>No categories</div>';
}

function renderCatChart() {
  const labels = DB.categories.map(c=>c.name);
  const data   = DB.categories.map(c=>DB.posts.filter(p=>p.catId===c.id).length);
  const colors = DB.categories.map(c=>c.color+'cc');
  makeChart('catChart',{
    type:'doughnut',
    data:{labels, datasets:[{data, backgroundColor:colors, borderWidth:0}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom',labels:{color:chartTextColor(),font:{family:'DM Sans',size:11}}}}, cutout:'60%'}
  });
}

function addCategory() {
  const name = $('cat_name').value.trim();
  const color= $('cat_color').value;
  const icon = $('cat_icon').value.trim() || 'fa-tag';
  if (!name) { toast('Name required','error'); return; }
  DB.categories.push({id:generateId('categories'),name,color,icon});
  logAction('create','Category',`Created "${name}"`);
  closeM('addCatModal');
  renderCatList(); renderCatChart(); populateCatFilter();
  $('cat_name').value=''; toast('Category added','success');
}

function deleteCat(id) {
  if (!confirm('Delete this category?')) return;
  DB.categories.splice(DB.categories.findIndex(c=>c.id===id),1);
  renderCatList(); renderCatChart(); toast('Category deleted','success');
}

/* ============================================================
   18. MESSAGES PAGE
   ============================================================ */
function renderMessages() {
  renderGroupList();
  $('createGroupBtn')?.addEventListener('click', openCreateGroupModal);
  $('sendChatBtn')?.addEventListener('click', sendMessage);
  $('chatTxt')?.addEventListener('keydown', e => { if(e.key==='Enter') sendMessage(); });
  $('chatMembersBtn')?.addEventListener('click', openGroupMembers);
  $('chatDeleteBtn')?.addEventListener('click', deleteCurrentGroup);
  $('chatAttachBtn')?.addEventListener('click', () => $('msgFileInput').click());
  $('chatVideoBtn')?.addEventListener('click', () => $('msgVideoInput').click());
  $('voiceNoteBtn')?.addEventListener('click', () => toast('Voice note recording (demo)','info'));
}

function renderGroupList() {
  const box = $('gListBox'); if(!box) return;
  box.innerHTML = DB.groups.map(g => {
    const msgs = DB.messages[g.id]||[];
    const last = msgs[msgs.length-1];
    const active = currentGroup?.id === g.id ? ' active' : '';
    return `<div class="g-item${active}" onclick="selectGroup(${g.id})">
      <div class="gi-icon" style="background:var(--accent-glow);font-size:1.1rem;">${g.icon}</div>
      <div class="gi-info">
        <div class="gi-name">${g.name}</div>
        <div class="gi-last">${last?userById(last.authorId)?.name+': '+last.text.slice(0,30):'No messages'}</div>
      </div>
      ${msgs.length?`<div class="gi-cnt">${msgs.length}</div>`:''}
    </div>`;
  }).join('') || '<div class="empty-state"><i class="fas fa-comments"></i>No groups</div>';
  if (!currentGroup && DB.groups.length) selectGroup(DB.groups[0].id);
}

function selectGroup(id) {
  currentGroup = DB.groups.find(g=>g.id===id);
  renderGroupList();
  $('chatGName').textContent = currentGroup?.name || 'Select Group';
  $('chatGMeta').textContent = `${currentGroup?.memberIds.length||0} members`;
  $('chatGIcon').textContent = currentGroup?.icon || '💬';
  renderChatMsgs();
}

function renderChatMsgs() {
  const msgs = DB.messages[currentGroup?.id] || [];
  $('chatMsgsBox').innerHTML = msgs.map(m => {
    const u = userById(m.authorId);
    const mine = m.authorId === currentUser.id;
    return `<div class="msg-bbl${mine?' mine':''}">
      ${avatarEl(u,30)}
      <div class="bbl-body">
        <div class="bbl-content">${m.text}</div>
        <div class="bbl-meta">${u?.name} · ${m.time}</div>
      </div>
    </div>`;
  }).join('') || '<div class="empty-state"><i class="fas fa-comment-slash"></i>No messages yet</div>';
  const box = $('chatMsgsBox');
  box.scrollTop = box.scrollHeight;
}

function sendMessage() {
  const txt = $('chatTxt')?.value.trim();
  if (!txt || !currentGroup) return;
  const msgs = DB.messages[currentGroup.id] = DB.messages[currentGroup.id] || [];
  msgs.push({ id:msgs.length+1, groupId:currentGroup.id, authorId:currentUser.id, text:txt, time:new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}), files:[] });
  $('chatTxt').value = '';
  renderChatMsgs();
  renderGroupList();
}

function openCreateGroupModal() {
  const box = $('cg_members'); if(!box) return;
  box.innerHTML = DB.users.map(u=>`<label style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem;border-radius:7px;cursor:pointer;font-size:0.82rem;">
    <input type="checkbox" value="${u.id}" checked> ${avatarEl(u,24)} ${u.name}</label>`).join('');
  $('cgMemberSearch')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    box.querySelectorAll('label').forEach(l => l.style.display = l.textContent.toLowerCase().includes(q)?'':'none');
  });
  $('cg_name').value = $('cg_icon').value = $('cg_desc').value = '';
  $('cgCreateBtn').onclick = createGroup;
  openM('cgModal');
}

function createGroup() {
  const name = $('cg_name').value.trim();
  if (!name) { toast('Group name required','error'); return; }
  const memberIds = [...$('cg_members').querySelectorAll('input:checked')].map(i=>+i.value);
  const g = { id:generateId('groups'), name, icon:$('cg_icon').value||'💬', desc:$('cg_desc').value, memberIds };
  DB.groups.push(g);
  DB.messages[g.id] = [];
  logAction('create','Group',`Created "${name}"`);
  closeM('cgModal'); renderGroupList(); toast('Group created','success');
}

function openGroupMembers() {
  if (!currentGroup) return;
  $('gmBody').innerHTML = `<div style="display:flex;flex-direction:column;gap:0.35rem;">` +
    currentGroup.memberIds.map(id=>{const u=userById(id);return `<div class="user-cell" style="padding:0.35rem;">${avatarEl(u,30)}<div><div style="font-weight:600;font-size:0.83rem;">${u?.name}</div><div style="font-size:0.72rem;color:var(--text3);">${u?.role}</div></div></div>`;}).join('')
  + `</div>`;
  openM('gmModal');
}

function deleteCurrentGroup() {
  if (!currentGroup || !confirm('Delete this group?')) return;
  DB.groups.splice(DB.groups.findIndex(g=>g.id===currentGroup.id),1);
  delete DB.messages[currentGroup.id];
  currentGroup = null;
  renderGroupList();
  $('chatGName').textContent = 'Select Group';
  $('chatGMeta').textContent = '';
  $('chatMsgsBox').innerHTML = '';
  toast('Group deleted','success');
}

/* ============================================================
   19. ANALYTICS PAGE
   ============================================================ */
function renderAnalytics() {
  const activeUsers = DB.users.filter(u=>u.status==='active').length;
  const totalTasks  = DB.tasks.length;
  const doneTasks   = DB.tasks.filter(t=>t.status==='done').length;
  $('anStatsGrid').innerHTML =
    statCard('fa-users','blue', activeUsers, 'Active Users','','flat') +
    statCard('fa-list-check','green', `${doneTasks}/${totalTasks}`, 'Tasks Done','','flat') +
    statCard('fa-building','yellow', DB.sites.filter(s=>s.status==='active').length, 'Active Sites','','flat') +
    statCard('fa-triangle-exclamation','red', DB.incidents.length, 'Total Incidents','','flat');

  setTimeout(() => {
    makeChart('anMonthly',{
      type:'line',
      data:{ labels:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
        datasets:[{label:'Tasks Completed',data:[8,12,9,15,11,18,14,20,16,22,19,25], borderColor:'#eab308', backgroundColor:'rgba(234,179,8,0.08)', fill:true, tension:0.4}] },
      options:{...chartDefaults(),plugins:{legend:{display:false}}}
    });
    const statuses = ['todo','inprogress','review','done'];
    const counts   = statuses.map(s=>DB.tasks.filter(t=>t.status===s).length);
    makeChart('anStatus',{
      type:'pie',
      data:{labels:['To Do','In Progress','Review','Done'], datasets:[{data:counts, backgroundColor:['rgba(100,116,139,0.7)','rgba(234,179,8,0.7)','rgba(59,130,246,0.7)','rgba(16,185,129,0.7)'], borderWidth:0}]},
      options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom',labels:{color:chartTextColor()}}}}
    });
    /* Top performers */
    const perfs = DB.users.map(u=>({user:u, done:DB.tasks.filter(t=>t.assigneeId===u.id&&t.status==='done').length})).sort((a,b)=>b.done-a.done).slice(0,5);
        $('topPerf').innerHTML = perfs.map((p,i)=>`<div class="perf-row"><span class="perf-rank">${i+1}</span>${avatarEl(p.user,30)}<div style="flex:1;"><div style="font-size:0.83rem;font-weight:600;">${p.user.name}</div><div style="font-size:0.72rem;color:var(--text3);">${p.user.role}</div></div><span style="font-family:'Space Grotesk',sans-serif;font-weight:700;color:var(--accent);">${p.done} tasks</span></div>`).join('');
    /* Site progress */
    makeChart('anSites',{
      type:'bar',
      data:{ labels:DB.sites.map(s=>s.name.length>15?s.name.slice(0,15)+'…':s.name), datasets:[{label:'Progress %', data:DB.sites.map(s=>s.progress), backgroundColor:'rgba(234,179,8,0.75)', borderRadius:6}] },
      options:{...chartDefaults(), indexAxis:'y', plugins:{legend:{display:false}}, scales:{x:{...chartDefaults().scales.x,max:100},y:chartDefaults().scales.y}}
    });
  },100);
}

/* ============================================================
   20. LEAVE MANAGEMENT
   ============================================================ */
function renderLeave() {
  wireLeaveTabs();
  renderLeaveTable();
  renderLeaveBalances();
  renderLeaveCalendar();
  renderHolidays();
  $('lvExport')?.addEventListener('click',()=>exportCSV(DB.leaveRequests.map(l=>({...l, userName:userById(l.userId)?.name})),'leave_requests.csv'));
  $('addHolidayBtn')?.addEventListener('click', addHoliday);
  ['lvStatus','lvType','lvFrom','lvTo'].forEach(id=>$(id)?.addEventListener('change',renderLeaveTable));
}

function wireLeaveTabs() {
  const panels = {'requests':'lv-requests','balances':'lv-balances','calendar':'lv-calendar','holidays':'lv-holidays'};
  $$('[data-lvtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('[data-lvtab]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      Object.values(panels).forEach(id=>{ const el=$(id); if(el) el.style.display='none'; });
      const target = $(panels[btn.dataset.lvtab]);
      if(target) target.style.display='';
    });
  });
}

function renderLeaveTable() {
  const st   = $('lvStatus')?.value||'';
  const type = $('lvType')?.value||'';
  const from = $('lvFrom')?.value||'';
  const to   = $('lvTo')?.value||'';
  const rows = DB.leaveRequests.filter(l=>{
    if(st   && l.status!==st)   return false;
    if(type && l.type!==type)   return false;
    if(from && l.from < from)   return false;
    if(to   && l.to   > to)     return false;
    return true;
  });
  $('lvTbody').innerHTML = rows.map(l=>{
    const u = userById(l.userId);
    return `<tr>
      <td><div class="user-cell">${avatarEl(u,26)}<span>${u?.name}</span></div></td>
      <td><span class="badge b-update">${l.type}</span></td>
      <td>${fmt(l.from)}</td><td>${fmt(l.to)}</td><td>${l.days}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.reason}</td>
      <td>${statusBadge(l.status)}</td>
      <td style="font-size:0.75rem;">${fmt(l.applied)}</td>
      <td>
        ${l.status==='pending'?`<button class="abt suc" title="Approve" onclick="openLeaveDecision(${l.id},'approve')"><i class="fas fa-check"></i></button><button class="abt dan" title="Reject" onclick="openLeaveDecision(${l.id},'reject')"><i class="fas fa-times"></i></button>`:'<span style="color:var(--text3);font-size:0.75rem;">—</span>'}
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="9"><div class="empty-state"><i class="fas fa-calendar"></i>No leave requests</div></td></tr>';
}

function openLeaveDecision(leaveId, action) {
  const l = DB.leaveRequests.find(x=>x.id===leaveId);
  const u = userById(l?.userId);
  $('ldTitle').textContent = action==='approve' ? 'Approve Leave' : 'Reject Leave';
  $('ldInfo').innerHTML = `<strong>${u?.name}</strong> — ${l?.type} leave · ${l?.days} day(s) · ${fmt(l?.from)} to ${fmt(l?.to)}<br><em style="color:var(--text3);font-size:0.8rem;">${l?.reason}</em>`;
  $('ldComment').value = '';
  $('ldApproveBtn').onclick = () => decideLeave(leaveId,'approved');
  $('ldRejectBtn').onclick  = () => decideLeave(leaveId,'rejected');
  openM('leaveDecisionModal');
}

function decideLeave(leaveId, decision) {
  const l = DB.leaveRequests.find(x=>x.id===leaveId);
  const u = userById(l?.userId);
  l.status = decision; l.comment = $('ldComment')?.value||'';
  logAction(decision==='approved'?'approve':'reject',`Leave #${leaveId}`,`${decision} for ${u?.name}`);
  sendEmail(u?.email||'', `Leave ${decision}`, 'leave_decision');
  closeM('leaveDecisionModal'); renderLeaveTable(); toast(`Leave ${decision}`,'success');
}

function renderLeaveBalances() {
  $('lvBalTbody').innerHTML = DB.users.filter(u=>u.status==='active').map(u=>{
    const b = DB.leaveBalance[u.id] || {annual:20,sick:10,emergency:5,annualUsed:0,sickUsed:0,emergencyUsed:0,unpaidUsed:0};
    return `<tr>
      <td><div class="user-cell">${avatarEl(u,26)}<span>${u.name}</span></div></td>
      <td>${b.annual-b.annualUsed} / ${b.annual}</td>
      <td>${b.sick-b.sickUsed} / ${b.sick}</td>
      <td>${b.emergency-b.emergencyUsed} / ${b.emergency}</td>
      <td>${b.unpaidUsed}</td>
      <td>${b.annualUsed+b.sickUsed+b.emergencyUsed+b.unpaidUsed}</td>
    </tr>`;
  }).join('');
}

function renderLeaveCalendar() {
  const label = $('lvCalLabel'), body = $('lvCalBody'); if(!label||!body) return;
  const y = leaveCalDate.getFullYear(), m = leaveCalDate.getMonth();
  label.textContent = leaveCalDate.toLocaleString('default',{month:'long', year:'numeric'});
  const firstDay = new Date(y,m,1).getDay();
  const daysInMonth = new Date(y,m+1,0).getDate();
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html = '<div class="leave-cal">' + dayNames.map(d=>`<div class="cal-day-hdr">${d}</div>`).join('');
  for(let i=0;i<firstDay;i++) html += `<div class="cal-day other-month"></div>`;
  const today = new Date();
  for(let d=1;d<=daysInMonth;d++){
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = y===today.getFullYear()&&m===today.getMonth()&&d===today.getDate();
    const leaves = DB.leaveRequests.filter(l=>l.from<=dateStr&&l.to>=dateStr&&l.status==='approved');
    const holiday = DB.holidays.find(h=>h.date===dateStr);
    html += `<div class="cal-day${isToday?' today':''}">
      <div class="cal-day-num">${d}</div>
      ${holiday?`<div class="cal-leave-tag" style="background:rgba(234,179,8,0.2);color:var(--accent);">${holiday.name}</div>`:''}
      ${leaves.map(l=>{const u=userById(l.userId);return `<div class="cal-leave-tag" style="background:rgba(59,130,246,0.15);color:#60a5fa;">${u?.name?.split(' ')[0]}</div>`;}).join('')}
    </div>`;
  }
  html += '</div>';
  body.innerHTML = html;
  $('lvCalPrev')?.addEventListener('click',()=>{ leaveCalDate.setMonth(leaveCalDate.getMonth()-1); renderLeaveCalendar(); });
  $('lvCalNext')?.addEventListener('click',()=>{ leaveCalDate.setMonth(leaveCalDate.getMonth()+1); renderLeaveCalendar(); });
}

function renderHolidays() {
  $('holidayTbody').innerHTML = DB.holidays.map(h=>`<tr>
    <td>${fmt(h.date)}</td><td style="font-weight:600;">${h.name}</td>
    <td><span class="badge b-update">${h.type}</span></td>
    <td><button class="abt dan" onclick="deleteHoliday(${h.id})"><i class="fas fa-trash"></i></button></td>
  </tr>`).join('') || '<tr><td colspan="4"><div class="empty-state"><i class="fas fa-calendar"></i>No holidays</div></td></tr>';
}

function addHoliday() {
  const name = prompt('Holiday name:'); if(!name) return;
  const date = prompt('Date (YYYY-MM-DD):'); if(!date) return;
  const type = prompt('Type (National/Cultural/Religious):', 'National')||'National';
  DB.holidays.push({id:generateId('holidays'),name,date,type});
  renderHolidays(); toast('Holiday added','success');
}

function deleteHoliday(id) { DB.holidays.splice(DB.holidays.findIndex(h=>h.id===id),1); renderHolidays(); }

/* ============================================================
   21. TIMESHEETS
   ============================================================ */
function renderTimesheets() {
  populateWeekSelect('tsWeek');
  const userSel = $('tsUser');
  if(userSel) userSel.innerHTML = '<option value="">All Employees</option>' + DB.users.filter(u=>u.role!=='admin').map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  renderTimesheetTable();
  ['tsUser','tsWeek','tsStatus2'].forEach(id=>$(id)?.addEventListener('change',renderTimesheetTable));
  $('tsExport')?.addEventListener('click',()=>exportCSV(DB.timesheets.map(t=>({...t,userName:userById(t.userId)?.name})),'timesheets.csv'));
}

function populateWeekSelect(elId) {
  const el = $(elId); if(!el) return;
  const weeks = [];
  for(let i=0;i<8;i++){
    const d = new Date(); d.setDate(d.getDate()-i*7);
    const y = d.getFullYear();
    const w = String(getISOWeek(d)).padStart(2,'0');
    weeks.push(`${y}-W${w}`);
  }
  el.innerHTML = [...new Set(weeks)].map(w=>`<option value="${w}">${w}</option>`).join('');
}

function getISOWeek(d) {
  const date = new Date(d); date.setHours(0,0,0,0);
  date.setDate(date.getDate()+3-(date.getDay()+6)%7);
  const week1=new Date(date.getFullYear(),0,4);
  return 1+Math.round(((date-week1)/86400000-3+(week1.getDay()+6)%7)/7);
}

function renderTimesheetTable() {
  const userId = +$('tsUser')?.value||0;
  const week   = $('tsWeek')?.value||'';
  const status = $('tsStatus2')?.value||'';
  const rows   = DB.timesheets.filter(t=>{
    if(userId && t.userId!==userId) return false;
    if(week   && t.week!==week)   return false;
    if(status && t.status!==status) return false;
    return true;
  });
  const total = rows.reduce((s,t)=>s+(t.mon+t.tue+t.wed+t.thu+t.fri+t.sat+t.sun),0);
  const ot    = rows.reduce((s,t)=>{ const hrs=t.mon+t.tue+t.wed+t.thu+t.fri+t.sat+t.sun; return s+(hrs>40?hrs-40:0); },0);
  $('tsStats').innerHTML =
    statCard('fa-clock','blue', total+'h', 'Total Hours','','flat') +
    statCard('fa-fire','orange', ot+'h', 'Overtime','','flat') +
    statCard('fa-check','green', rows.filter(r=>r.status==='approved').length, 'Approved','','flat') +
    statCard('fa-hourglass','yellow', rows.filter(r=>r.status==='pending').length, 'Pending','','flat');
  $('tsTbody').innerHTML = rows.map(t=>{
    const u=userById(t.userId);
    const total=t.mon+t.tue+t.wed+t.thu+t.fri+t.sat+t.sun;
    const ot=total>40?total-40:0;
    return `<tr>
      <td><div class="user-cell">${avatarEl(u,26)}<span>${u?.name}</span></div></td>
      <td style="font-size:0.75rem;">${t.week}</td>
      ${[t.mon,t.tue,t.wed,t.thu,t.fri,t.sat,t.sun].map(h=>`<td style="text-align:center;${h===0?'color:var(--text3);':''}">${h||'—'}</td>`).join('')}
      <td style="font-weight:700;text-align:center;">${total}h</td>
      <td style="text-align:center;color:${ot>0?'#f97316':'var(--text3)'};">${ot>0?ot+'h':'—'}</td>
      <td>${statusBadge(t.status)}</td>
      <td>
        ${t.status==='pending'?`
          <button class="abt suc" title="Approve" onclick="decideTimesheet(${t.id},'approved')"><i class="fas fa-check"></i></button>
          <button class="abt dan" title="Reject"  onclick="decideTimesheet(${t.id},'rejected')"><i class="fas fa-times"></i></button>
        `:'<span style="color:var(--text3);">—</span>'}
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="13"><div class="empty-state"><i class="fas fa-clock"></i>No timesheets found</div></td></tr>';
}

function decideTimesheet(id, decision) {
  const t=DB.timesheets.find(x=>x.id===id); if(!t) return;
  t.status=decision; renderTimesheetTable(); toast(`Timesheet ${decision}`,'success');
}

/* ============================================================
   22. PAYROLL
   ============================================================ */
function netPay(p) { return p.baseSalary + p.overtime + p.bonus + p.allowances - p.deductions; }

function renderPayroll() {
  populatePeriodSelect();
  renderPayrollTable();
  $('prExport')?.addEventListener('click',()=>exportCSV(DB.payroll.map(p=>({...p,userName:userById(p.userId)?.name,netPay:netPay(p)})),'payroll.csv'));
  $('prProcess')?.addEventListener('click',processPayroll);
  ['prPeriod','prStatus'].forEach(id=>$(id)?.addEventListener('change',renderPayrollTable));
}

function populatePeriodSelect() {
  const el=$('prPeriod'); if(!el) return;
  const periods=['2025-07','2025-06','2025-05','2025-04'];
  el.innerHTML=periods.map(p=>`<option value="${p}">${p}</option>`).join('');
  el.value=currentPayrollPeriod;
}

function renderPayrollTable() {
  const period=$('prPeriod')?.value||currentPayrollPeriod;
  const status=$('prStatus')?.value||'';
  const rows=DB.payroll.filter(p=>{
    if(p.period!==period) return false;
    if(status && p.status!==status) return false;
    return true;
  });
  const totalNet=rows.reduce((s,p)=>s+netPay(p),0);
  $('prStats').innerHTML =
    statCard('fa-users','blue', rows.length,'Employees','','flat')+
    statCard('fa-money-bill','green', fmtMoney(rows.reduce((s,p)=>s+p.baseSalary,0)),'Base Total','','flat')+
    statCard('fa-fire','orange', fmtMoney(rows.reduce((s,p)=>s+p.overtime,0)),'Overtime Total','','flat')+
    statCard('fa-coins','yellow', fmtMoney(totalNet),'Net Payroll','','flat');
  $('prTbody').innerHTML=rows.map(p=>{
    const u=userById(p.userId);
    return `<tr>
      <td><div class="user-cell">${avatarEl(u,26)}<span>${u?.name}</span></div></td>
      <td>${fmtMoney(p.baseSalary)}</td>
      <td style="color:#f97316;">${fmtMoney(p.overtime)}</td>
      <td style="color:#34d399;">${fmtMoney(p.bonus)}</td>
      <td>${fmtMoney(p.allowances)}</td>
      <td style="color:#f87171;">(${fmtMoney(p.deductions)})</td>
      <td style="font-weight:700;color:var(--accent);">${fmtMoney(netPay(p))}</td>
      <td>${statusBadge(p.status)}</td>
      <td>
        <button class="abt inf" onclick="openPayslip(${p.id})"><i class="fas fa-eye"></i></button>
        <button class="abt" onclick="emailPayslip(${p.id})"><i class="fas fa-envelope"></i></button>
      </td>
    </tr>`;
  }).join('')||'<tr><td colspan="9"><div class="empty-state"><i class="fas fa-money-bill-wave"></i>No payroll data</div></td></tr>';
}

function processPayroll() {
  const period=$('prPeriod')?.value||currentPayrollPeriod;
  DB.payroll.filter(p=>p.period===period&&p.status==='draft').forEach(p=>p.status='processed');
  renderPayrollTable(); toast('Payroll processed','success'); logAction('update','Payroll',`Period ${period} processed`);
}

function openPayslip(prId) {
  const p=DB.payroll.find(x=>x.id===prId); if(!p) return;
  const u=userById(p.userId);
  $('payslipBody').innerHTML=`<div class="payslip-wrap">
    <div class="payslip-hdr">
      <div><div style="font-family:'Space Grotesk',sans-serif;font-weight:800;font-size:1.1rem;">NIXERS.pro</div><div style="font-size:0.75rem;color:var(--text3);">Payslip — ${p.period}</div></div>
      <div style="text-align:right;">${avatarEl(u,40)}</div>
    </div>
    <div style="margin-bottom:1rem;">${avatarEl(u,36)} <strong>${u?.name}</strong> · ${u?.dept||u?.role}</div>
    <div class="payslip-row"><span>Basic Salary</span><span>${fmtMoney(p.baseSalary)}</span></div>
    <div class="payslip-row"><span>Overtime</span><span style="color:#f97316;">+${fmtMoney(p.overtime)}</span></div>
    <div class="payslip-row"><span>Bonus</span><span style="color:#34d399;">+${fmtMoney(p.bonus)}</span></div>
    <div class="payslip-row"><span>Allowances</span><span>+${fmtMoney(p.allowances)}</span></div>
    <div class="payslip-row"><span>Deductions</span><span style="color:#f87171;">-${fmtMoney(p.deductions)}</span></div>
    <hr class="div">
    <div class="payslip-row payslip-total"><span>Net Pay</span><span>${fmtMoney(netPay(p))}</span></div>
    <div style="margin-top:0.75rem;font-size:0.72rem;color:var(--text3);">Status: ${statusBadge(p.status)}</div>
  </div>`;
  $('payslipPrintBtn').onclick=()=>window.print();
  $('payslipEmailBtn').onclick=()=>emailPayslip(prId);
  openM('payslipModal');
}

function emailPayslip(prId) {
  const p=DB.payroll.find(x=>x.id===prId); const u=userById(p?.userId);
  sendEmail(u?.email||'','Your Payslip is Ready','payslip');
  toast(`Payslip emailed to ${u?.name}`,'success');
}

/* ============================================================
   23. TASKS & PROJECTS
   ============================================================ */
function renderTasks() {
  populateProjectSelects();
  wireTTabs();
  renderProjectTable();
  renderKanban();
  renderGantt();
   if ($('addProjectBtn')) $('addProjectBtn').onclick = () => openProjectModal();
  if ($('projSearch')) $('projSearch').oninput = renderProjectTable;
  if ($('projStatus')) $('projStatus').onchange = renderProjectTable;
  ['kanbanProject','kanbanAssignee','kanbanPriority'].forEach(id => { if ($(id)) $(id).onchange = renderKanban; });
  $$('.kanban-add-btn').forEach(btn => { btn.onclick = () => openTaskModal(null, btn.dataset.col); });
}

function populateProjectSelects() {
  const kp=$('kanbanProject'); if(kp) kp.innerHTML='<option value="">All Projects</option>'+DB.projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  const ka=$('kanbanAssignee'); if(ka) ka.innerHTML='<option value="">All Assignees</option>'+DB.users.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  const tmProj=$('tm_project'); if(tmProj) tmProj.innerHTML=DB.projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  
  const projSite=$('proj_site'); if(projSite) projSite.innerHTML='<option value="">None</option>'+DB.sites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
}
function renderAssignTags(ids, targetId, removeFn) {
  const target = $(targetId);
  if (!target) return;
  target.innerHTML = ids.map(id => {
    const u = userById(id);
    return `<div class="assign-tag">${u?.name || id}<button onclick="${removeFn}(${id})">×</button></div>`;
  }).join('');
}

function searchProjectTeam(q='') {
  const res = $('proj_teamResults');
  if (!res) return;
  const query = q.trim().toLowerCase();
  const options = DB.users.filter(u => !projectTeamMembers.includes(u.id) && (!query || u.name.toLowerCase().includes(query)));
  res.innerHTML = options.map(u=>`<div class="assign-opt" onclick="addProjectTeamMember(${u.id})">${avatarEl(u,24)}<span>${u.name}</span></div>`).join('') || '<div style="padding:0.5rem;color:var(--text3);font-size:0.8rem;">No results</div>';
  res.classList.add('show');
}
function addProjectTeamMember(id) {
  if (!projectTeamMembers.includes(id)) projectTeamMembers.push(id);
  renderAssignTags(projectTeamMembers, 'proj_teamTags', 'removeProjectTeamMember');
  $('proj_teamResults')?.classList.remove('show');
  if ($('proj_teamSearch')) $('proj_teamSearch').value = '';
}
function removeProjectTeamMember(id) {
  projectTeamMembers = projectTeamMembers.filter(x => x !== id);
  renderAssignTags(projectTeamMembers, 'proj_teamTags', 'removeProjectTeamMember');
}

function searchTaskAssignees(q='') {
  const res = $('tm_assigneeResults');
  if (!res) return;
  const query = q.trim().toLowerCase();
  const options = DB.users.filter(u => !taskAssignees.includes(u.id) && (!query || u.name.toLowerCase().includes(query)));
  res.innerHTML = options.map(u=>`<div class="assign-opt" onclick="addTaskAssignee(${u.id})">${avatarEl(u,24)}<span>${u.name}</span></div>`).join('') || '<div style="padding:0.5rem;color:var(--text3);font-size:0.8rem;">No results</div>';
  res.classList.add('show');
}
function addTaskAssignee(id) {
  if (!taskAssignees.includes(id)) taskAssignees.push(id);
  renderAssignTags(taskAssignees, 'tm_assigneeTags', 'removeTaskAssignee');
  $('tm_assigneeResults')?.classList.remove('show');
  if ($('tm_assigneeSearch')) $('tm_assigneeSearch').value = '';
}
function removeTaskAssignee(id) {
  taskAssignees = taskAssignees.filter(x => x !== id);
  renderAssignTags(taskAssignees, 'tm_assigneeTags', 'removeTaskAssignee');
}
function renderTaskAttachments() {
  const box = $('tm_attFiles');
  if (!box) return;
  box.innerHTML = taskAttachments.map((f, i) => `<div class="af-item"><i class="fas fa-file"></i><span>${f.name}</span><button class="abt dan" onclick="removeTaskAttachment(${i})"><i class="fas fa-times"></i></button></div>`).join('') || '<div style="font-size:0.78rem;color:var(--text3);">No attachments added</div>';
}
function removeTaskAttachment(index) {
  taskAttachments.splice(index, 1);
  renderTaskAttachments();
}
function toggleTaskVoice() {
  taskVoiceRecording = !taskVoiceRecording;
  const btn = $('tm_voiceBtn');
  if (btn) btn.classList.toggle('recording', taskVoiceRecording);
  if (btn) btn.innerHTML = taskVoiceRecording ? '<i class="fas fa-stop"></i> Stop Recording' : '<i class="fas fa-microphone"></i> Record Voice';
  if ($('tm_voiceStatus')) $('tm_voiceStatus').style.display = taskVoiceRecording ? '' : 'none';
  toast(taskVoiceRecording ? 'Voice recording started (demo)' : 'Voice recording stopped', 'info');
}
function wireTTabs() {
  const panels={'projects':'tt-projects','kanban':'tt-kanban','gantt':'tt-gantt'};
  $$('[data-ttab]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $$('[data-ttab]').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
      Object.values(panels).forEach(id=>{const el=$(id);if(el)el.style.display='none';});
      const target=$(panels[btn.dataset.ttab]); if(target) target.style.display='';
    });
  });
}

function renderProjectTable() {
  const q=$('projSearch')?.value.toLowerCase()||'';
  const st=$('projStatus')?.value||'';
  const rows=DB.projects.filter(p=>{
    if(q&&!p.name.toLowerCase().includes(q)) return false;
    if(st&&p.status!==st) return false;
    return true;
  });
  $('projTbody').innerHTML=rows.map(p=>{
    const tasks=DB.tasks.filter(t=>t.projectId===p.id);
    const done=tasks.filter(t=>t.status==='done').length;
    return `<tr>
      <td style="font-weight:600;">${p.name}</td>
      <td><div style="display:flex;gap:-6px;">${p.teamIds.slice(0,3).map(id=>avatarEl(userById(id),26)).join('')}${p.teamIds.length>3?`<span style="font-size:0.72rem;color:var(--text3);padding-left:4px;">+${p.teamIds.length-3}</span>`:''}</div></td>
      <td><div style="display:flex;align-items:center;gap:0.5rem;min-width:80px;"><div class="pb" style="flex:1;height:6px;"><div class="pb-fill" style="width:${p.progress}%;"></div></div><span style="font-size:0.72rem;">${p.progress}%</span></div></td>
      <td>${priorityBadge(p.priority)}</td>
      <td style="font-size:0.78rem;">${fmt(p.dueDate)}</td>
      <td style="font-size:0.82rem;">${done}/${tasks.length}</td>
      <td>${statusBadge(p.status)}</td>
      <td>
        <button class="abt warn" onclick="openProjectModal(${p.id})"><i class="fas fa-pen"></i></button>
        <button class="abt dan" onclick="deleteProject(${p.id})"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('')||'<tr><td colspan="8"><div class="empty-state"><i class="fas fa-folder-open"></i>No projects</div></td></tr>';
}

function openProjectModal(projId=null) {
  populateProjectSelects();
  const p=projId?projectById(projId):null;
  $('projTitle').textContent=p?'Edit Project':'New Project';
  $('proj_name').value=p?.name||'';
  $('proj_status').value=p?.status||'planning';
  $('proj_priority').value=p?.priority||'medium';
  $('proj_due').value=p?.dueDate||'';
    $('proj_site').value=p?.siteId||'';
  $('proj_desc').value=p?.desc||'';
   projectTeamMembers = [...(p?.teamIds||[])];
  renderAssignTags(projectTeamMembers, 'proj_teamTags', 'removeProjectTeamMember');
  if ($('proj_teamSearch')) {
    $('proj_teamSearch').oninput = e => searchProjectTeam(e.target.value);
    $('proj_teamSearch').onfocus = e => searchProjectTeam(e.target.value);
  }
  $('proj_save').onclick=()=>saveProject(projId);
  openM('projectModal');
}

function saveProject(projId) {
   const current = projId ? projectById(projId) : null;
  const data={name:$('proj_name').value.trim(),status:$('proj_status').value,priority:$('proj_priority').value,dueDate:$('proj_due').value,desc:$('proj_desc').value.trim(),siteId:+$('proj_site')?.value||null,teamIds:[...projectTeamMembers],progress:current?.progress||0};
  if(!data.name){toast('Name required','error');return;}
  if(projId){Object.assign(projectById(projId),data);logAction('update',`Project #${projId}`,`Updated ${data.name}`);}
  else{DB.projects.push({id:generateId('projects'),...data});logAction('create','Project',`Created ${data.name}`);}
  closeM('projectModal');renderProjectTable();renderKanban();renderGantt();toast('Project saved','success');
}

function deleteProject(id){
  if(!confirm('Delete this project?'))return;
  DB.projects.splice(DB.projects.findIndex(p=>p.id===id),1);
  DB.tasks=DB.tasks.filter(t=>t.projectId!==id);
  renderProjectTable();renderKanban();toast('Project deleted','success');
}

function renderKanban() {
  const cols=['todo','inprogress','review','done'];
    const projectFilter = +($('kanbanProject')?.value || 0);
  const assigneeFilter = +($('kanbanAssignee')?.value || 0);
  const priorityFilter = $('kanbanPriority')?.value || '';
  cols.forEach(col=>{
    const cards=$(`kCards-${col}`); if(!cards) return;
       const tasks=DB.tasks.filter(t=>{
      if (t.status !== col) return false;
      if (projectFilter && t.projectId !== projectFilter) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (assigneeFilter && !taskAssigneeIds(t).includes(assigneeFilter)) return false;
      return true;
    });
    $(`kc-${col}`).textContent=tasks.length;
    cards.innerHTML=tasks.map(t=>{
      const assignees = taskAssigneeIds(t).map(userById).filter(Boolean);
      const proj=projectById(t.projectId);
      return `<div class="kanban-card" onclick="openTaskModal(${t.id})">
        <div class="kc-title">${t.title}</div>
        ${proj?`<div style="font-size:0.7rem;color:var(--text3);margin-bottom:0.3rem;">${proj.name}</div>`:''}
        <div class="kc-meta">
          ${priorityBadge(t.priority)}
          ${t.dueDate?`<span style="font-size:0.68rem;color:var(--text3);">📅 ${fmt(t.dueDate)}</span>`:''}
          <div class="kc-assignee">${assignees.slice(0,2).map(u=>avatarEl(u,20)).join('')}${assignees.length>2?`<span>+${assignees.length-2}</span>`:''}</div>
        </div>
      </div>`;
    }).join('')||'<div style="text-align:center;padding:1rem;color:var(--text3);font-size:0.75rem;">Drop tasks here</div>';
  });
}

function openTaskModal(taskId=null, col='todo') {
  populateProjectSelects();
  const t=taskId?DB.tasks.find(x=>x.id===taskId):null;
  $('tmTitle').textContent=t?'Edit Task':'New Task';
  $('tm_title').value=t?.title||'';
  $('tm_project').value=t?.projectId||DB.projects[0]?.id||'';
  $('tm_priority').value=t?.priority||'medium';

  $('tm_due').value=t?.dueDate||'';
  $('tm_desc').value=t?.desc||'';
  $('tm_status').value=t?.status||col;
    taskAssignees = [...taskAssigneeIds(t)];
  taskAttachments = [...(t?.attachments || [])];
  taskVoiceRecording = false;
  renderAssignTags(taskAssignees, 'tm_assigneeTags', 'removeTaskAssignee');
  renderTaskAttachments();
  if ($('tm_assigneeSearch')) {
    $('tm_assigneeSearch').oninput = e => searchTaskAssignees(e.target.value);
    $('tm_assigneeSearch').onfocus = e => searchTaskAssignees(e.target.value);
  }
  if ($('tm_voiceBtn')) $('tm_voiceBtn').onclick = toggleTaskVoice;
  if ($('tm_attachBtn')) $('tm_attachBtn').onclick = () => $('tm_files')?.click();
  if ($('tm_files')) $('tm_files').onchange = e => {
    const files = [...(e.target.files || [])].map(f => ({name:f.name, size:f.size, type:f.type}));
    if (files.length) taskAttachments.push(...files);
    renderTaskAttachments();
    e.target.value = '';
  };
  $('tm_save').onclick=()=>saveTask(taskId);
  openM('taskModal');
}

function saveTask(taskId) {
  const assigneeIds = taskAssignees.length ? [...taskAssignees] : [DB.users[0]?.id].filter(Boolean);
  const data={title:$('tm_title').value.trim(),projectId:+$('tm_project').value,priority:$('tm_priority').value,assigneeId:assigneeIds[0]||null,assigneeIds,dueDate:$('tm_due').value,desc:$('tm_desc').value.trim(),status:$('tm_status').value,attachments:[...taskAttachments]};
  if(!data.title){toast('Title required','error');return;}
  if(taskId){Object.assign(DB.tasks.find(t=>t.id===taskId),data);logAction('update',`Task #${taskId}`,`Updated ${data.title}`);}
  else{
    DB.tasks.push({id:generateId('tasks'),...data});
       const assignedNames = assigneeIds.map(id=>userById(id)?.name).filter(Boolean).join(', ');
    logAction('create','Task',`Created "${data.title}" assigned to ${assignedNames || 'team'}`);
    assigneeIds.forEach(id => sendEmail(userById(id)?.email||'','New Task Assigned','task_assigned'));
  }
  closeM('taskModal');renderKanban();renderProjectTable();toast('Task saved','success');
}

function renderGantt() {
  const body=$('ganttBody'); if(!body) return;
  if(!DB.projects.length){body.innerHTML='<div class="empty-state"><i class="fas fa-timeline"></i>No projects</div>';return;}
  const allDates=DB.projects.flatMap(p=>[new Date(p.dueDate||new Date())]);
  const minDate=new Date(Math.min(...allDates)); minDate.setMonth(minDate.getMonth()-2);
  const maxDate=new Date(Math.max(...allDates)); maxDate.setMonth(maxDate.getMonth()+1);
  const totalDays=(maxDate-minDate)/86400000||1;
  const headerDays=Math.min(totalDays,12);
  const monthLabels=[];
  for(let i=0;i<headerDays;i++){const d=new Date(minDate);d.setDate(d.getDate()+i*Math.floor(totalDays/headerDays));monthLabels.push(d.toLocaleString('default',{month:'short'}));}
  body.innerHTML=`<div class="gantt-wrap"><table style="width:100%;border-collapse:collapse;">
    <thead><tr><th style="width:200px;text-align:left;padding:0.5rem;font-size:0.72rem;color:var(--text3);">Project</th>${monthLabels.map(m=>`<th style="font-size:0.72rem;color:var(--text3);padding:0.25rem;">${m}</th>`).join('')}</tr></thead>
    <tbody>${DB.projects.map(p=>{
      const due=new Date(p.dueDate||new Date());
      const start=new Date(due); start.setMonth(start.getMonth()-2);
      const leftPct=Math.max(0,((start-minDate)/86400000/totalDays)*100);
      const widthPct=Math.max(5,((due-start)/86400000/totalDays)*100);
      return `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:0.75rem 0.5rem;font-size:0.82rem;font-weight:500;white-space:nowrap;">${p.name.slice(0,25)}</td>
        <td colspan="${headerDays}" style="position:relative;height:40px;">
          <div style="position:absolute;left:${leftPct}%;width:${widthPct}%;top:8px;height:24px;background:rgba(234,179,8,0.75);border-radius:6px;display:flex;align-items:center;padding:0 0.5rem;font-size:0.68rem;font-weight:600;color:#0a0f1a;white-space:nowrap;overflow:hidden;">${p.name.slice(0,20)}</div>
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

/* ============================================================
   24. SHIFT SCHEDULING
   ============================================================ */
const SHIFT_TYPES=['Morning','Afternoon','Night','Off'];
const SHIFT_KEYS=['morning','afternoon','night','off'];

function renderShifts() {
  const siteSel=$('shiftSite'); if(siteSel) siteSel.innerHTML='<option value="">All Sites</option>'+DB.sites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  populateWeekSelect('shiftWeek');
  renderShiftGrid();
  renderShiftSwaps();
  $('shiftPrev')?.addEventListener('click',()=>{shiftWeekOffset--;renderShiftGrid();});
  $('shiftNext')?.addEventListener('click',()=>{shiftWeekOffset++;renderShiftGrid();});
  $('shiftExport')?.addEventListener('click',()=>toast('Shift schedule exported','success'));
}

function renderShiftGrid() {
  const grid=$('shiftGrid'); if(!grid) return;
  const workers=DB.users.filter(u=>u.role==='worker');
  const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const d=new Date(); d.setDate(d.getDate()-d.getDay()+1+shiftWeekOffset*7);
  const weekStart=new Date(d);
  $('shiftWeekLabel').textContent=`Week of ${weekStart.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}`;
  grid.innerHTML=`<thead><tr><th>Worker</th>${days.map((day,i)=>{const dd=new Date(weekStart);dd.setDate(dd.getDate()+i);return`<th>${day}<br><span style="font-size:0.65rem;font-weight:400;">${dd.getDate()}/${dd.getMonth()+1}</span></th>`;}).join('')}</tr></thead>
    <tbody>${workers.map(w=>`<tr>
      <td><div class="user-cell">${avatarEl(w,26)}<span style="font-size:0.8rem;">${w.name}</span></div></td>
      ${days.map((day,i)=>{
        const key=`${w.id}_${day}_${shiftWeekOffset}`;
        const shift=DB.shifts[key]||'off';
        const colorMap={morning:'shift-morning',afternoon:'shift-afternoon',night:'shift-night',off:'shift-off'};
        const labelMap={morning:'Morning','afternoon':'Afternoon',night:'Night',off:'Off'};
        return`<td class="shift-cell"><select class="shift-badge ${colorMap[shift]}" style="border:none;background:transparent;cursor:pointer;font-size:0.7rem;font-weight:600;" onchange="setShift('${key}',this.value,this)">${SHIFT_KEYS.map(s=>`<option value="${s}"${shift===s?' selected':''}>${SHIFT_TYPES[SHIFT_KEYS.indexOf(s)]}</option>`).join('')}</select></td>`;
      }).join('')}
    </tr>`).join('')}</tbody>`;
}

function setShift(key,val,el){
  DB.shifts[key]=val;
  const colorMap={morning:'shift-morning',afternoon:'shift-afternoon',night:'shift-night',off:'shift-off'};
  el.className=`shift-badge ${colorMap[val]}`;
  el.style.border='none'; el.style.background='transparent'; el.style.cursor='pointer'; el.style.fontSize='0.7rem'; el.style.fontWeight='600';
}

function renderShiftSwaps() {
  $('shiftSwapTbody').innerHTML='<tr><td colspan="7"><div class="empty-state"><i class="fas fa-arrows-rotate"></i>No swap requests</div></td></tr>';
}

/* ============================================================
   25. EQUIPMENT & INVENTORY
   ============================================================ */
function renderEquipment() {
  populateEqSelects();
  renderEqTable();
  $('addEqBtn')?.addEventListener('click',()=>openEqModal());
  $('eqExport')?.addEventListener('click',()=>exportCSV(DB.equipment,'equipment.csv'));
  ['eqSearch','eqCondition','eqStatus2'].forEach(id=>$(id)?.addEventListener('input',renderEqTable));
}

function populateEqSelects(){
  const eqAss=$('eq_assignee'); if(eqAss) eqAss.innerHTML='<option value="">Unassigned</option>'+DB.users.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  const eqSite=$('eq_site'); if(eqSite) eqSite.innerHTML='<option value="">No Site</option>'+DB.sites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
}

function renderEqTable() {
  const q=$('eqSearch')?.value.toLowerCase()||'';
  const cond=$('eqCondition')?.value||'';
  const st=$('eqStatus2')?.value||'';
  const rows=DB.equipment.filter(e=>{
    if(q&&!e.name.toLowerCase().includes(q)&&!e.serial.toLowerCase().includes(q))return false;
    if(cond&&e.condition!==cond)return false;
    if(st&&e.status!==st)return false;
    return true;
  });
  const avail=DB.equipment.filter(e=>e.status==='available').length;
  const out=DB.equipment.filter(e=>e.status==='checked-out').length;
  const maint=DB.equipment.filter(e=>e.status==='maintenance').length;
  $('eqStats').innerHTML=
    statCard('fa-toolbox','blue',DB.equipment.length,'Total Items','','flat')+
    statCard('fa-check','green',avail,'Available','','flat')+
    statCard('fa-hand-holding','yellow',out,'Checked Out','','flat')+
    statCard('fa-wrench','orange',maint,'In Maintenance','','flat');
  $('eqTbody').innerHTML=rows.map(e=>{
    const u=userById(e.assigneeId);
    const s=siteById(e.siteId);
    const serviceAlert=e.nextService&&new Date(e.nextService)<new Date()?'color:#f87171;':'';
    return `<tr>
      <td style="font-weight:600;">${e.name}</td>
      <td style="font-size:0.78rem;">${e.category}</td>
      <td><div style="display:flex;align-items:center;gap:0.4rem;"><code style="font-size:0.72rem;">${e.serial}</code><button class="abt" onclick="showQR('${e.serial}','${e.name}')" title="QR"><i class="fas fa-qrcode"></i></button></div></td>
      <td>${statusBadge(e.condition==='good'?'good':e.condition==='fair'?'fair':'damaged')}</td>
      <td>${u?`<div class="user-cell">${avatarEl(u,24)}<span style="font-size:0.8rem;">${u.name}</span></div>`:'<span style="color:var(--text3);">—</span>'}</td>
      <td style="font-size:0.78rem;">${s?.name||'—'}</td>
      <td>${statusBadge(e.status==='available'?'active':e.status==='checked-out'?'in-progress':'on-hold')}</td>
      <td style="font-size:0.75rem;${serviceAlert}">${fmt(e.nextService)}</td>
      <td>
        <button class="abt warn" onclick="openEqModal(${e.id})"><i class="fas fa-pen"></i></button>
        <button class="abt dan" onclick="deleteEq(${e.id})"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('')||'<tr><td colspan="9"><div class="empty-state"><i class="fas fa-toolbox"></i>No equipment found</div></td></tr>';
  $('eqReqTbody').innerHTML='<tr><td colspan="6"><div class="empty-state"><i class="fas fa-hand-holding"></i>No checkout requests</div></td></tr>';
}

function openEqModal(eqId=null){
  populateEqSelects();
  const e=eqId?DB.equipment.find(x=>x.id===eqId):null;
  $('eqTitle').textContent=e?'Edit Equipment':'Add Equipment';
  $('eq_name').value=e?.name||'';
  $('eq_cat').value=e?.category||'';
  $('eq_serial').value=e?.serial||'';
  $('eq_condition').value=e?.condition||'good';
  $('eq_assignee').value=e?.assigneeId||'';
  $('eq_site').value=e?.siteId||'';
  $('eq_service').value=e?.nextService||'';
  $('eq_status').value=e?.status||'available';
  $('eq_save').onclick=()=>saveEq(eqId);
  openM('equipModal');
}

function saveEq(eqId){
  const data={name:$('eq_name').value.trim(),category:$('eq_cat').value.trim(),serial:$('eq_serial').value.trim(),condition:$('eq_condition').value,assigneeId:+$('eq_assignee').value||null,siteId:+$('eq_site').value||null,nextService:$('eq_service').value,status:$('eq_status').value};
  if(!data.name){toast('Name required','error');return;}
  if(eqId){Object.assign(DB.equipment.find(e=>e.id===eqId),data);}
  else{DB.equipment.push({id:generateId('equipment'),...data});logAction('create','Equipment',`Added ${data.name}`);}
  closeM('equipModal');renderEqTable();toast('Equipment saved','success');
}

function deleteEq(id){if(!confirm('Delete?'))return;DB.equipment.splice(DB.equipment.findIndex(e=>e.id===id),1);renderEqTable();toast('Equipment deleted','success');}

function showQR(serial,name){
  $('qrBody').innerHTML=`
    <div style="font-weight:700;margin-bottom:1rem;">${name}</div>
    <div style="font-size:4rem;margin:1rem 0;">📦</div>
    <div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:1.1rem;letter-spacing:3px;">${serial}</div>
    <div style="font-size:0.75rem;color:var(--text3);margin-top:0.5rem;">(QR code would render here in production)</div>`;
  openM('qrModal');
}

/* ============================================================
   26. DOCUMENTS
   ============================================================ */
function renderDocuments(){
  renderDocTable();
  $('uploadDocBtn')?.addEventListener('click',()=>toast('Document upload (demo — connect file server)','info'));
  $('docExport')?.addEventListener('click',()=>exportCSV(DB.documents,'documents.csv'));
  ['docSearch','docUser','docStatus'].forEach(id=>$(id)?.addEventListener('input',renderDocTable));
}

function renderDocTable(){
  const q=$('docSearch')?.value.toLowerCase()||'';
  const uid=+$('docUser')?.value||0;
  const st=$('docStatus')?.value||'';
  const today=nowStr().slice(0,10);
  const rows=DB.documents.filter(d=>{
    if(q&&!d.name.toLowerCase().includes(q))return false;
    if(uid&&d.userId!==uid)return false;
    if(st==='expiring'){const exp=d.expiry;const diff=(new Date(exp)-new Date())/86400000;return diff>=0&&diff<=30;}
    if(st&&d.status!==st)return false;
    return true;
  });
  const approved=DB.documents.filter(d=>d.status==='approved').length;
  const pending=DB.documents.filter(d=>d.status==='pending').length;
  const expiring=DB.documents.filter(d=>{const diff=(new Date(d.expiry)-new Date())/86400000;return diff>=0&&diff<=30;}).length;
  $('docStats').innerHTML=
    statCard('fa-folder-open','blue',DB.documents.length,'Total Docs','','flat')+
    statCard('fa-check','green',approved,'Approved','','flat')+
    statCard('fa-hourglass','yellow',pending,'Pending Review','','flat')+
    statCard('fa-triangle-exclamation','orange',expiring,'Expiring Soon','','flat');
  $('docTbody').innerHTML=rows.map(d=>{
    const u=userById(d.userId);
    const diff=(new Date(d.expiry)-new Date())/86400000;
    const expiryCls=diff<0?'color:#f87171;':diff<30?'color:#f97316;':'';
    return `<tr>
      <td><div class="user-cell">${avatarEl(u,26)}<span>${u?.name}</span></div></td>
      <td style="font-weight:600;">${d.name}</td>
      <td><span class="badge b-update">${d.type}</span></td>
      <td style="font-size:0.75rem;">${fmt(d.uploaded)}</td>
      <td style="font-size:0.75rem;${expiryCls}">${fmt(d.expiry)}${diff<30&&diff>=0?' ⚠️':''}</td>
      <td>${statusBadge(d.status)}</td>
      <td style="font-size:0.75rem;">${d.notes||'—'}</td>
      <td>
        ${d.status==='pending'?`<button class="abt suc" onclick="decideDoc(${d.id},'approved')" title="Approve"><i class="fas fa-check"></i></button><button class="abt dan" onclick="decideDoc(${d.id},'rejected')" title="Reject"><i class="fas fa-times"></i></button>`:''}
        <button class="abt inf" title="Preview"><i class="fas fa-eye"></i></button>
        <button class="abt" title="Request doc" onclick="requestDoc(${d.userId})"><i class="fas fa-envelope"></i></button>
      </td>
    </tr>`;
  }).join('')||'<tr><td colspan="8"><div class="empty-state"><i class="fas fa-folder-open"></i>No documents</div></td></tr>';
}

function decideDoc(id,decision){
  const d=DB.documents.find(x=>x.id===id); if(!d)return;
  const u=userById(d.userId);
  d.status=decision; logAction(decision==='approved'?'approve':'reject',`Doc #${id}`,`${decision} "${d.name}" for ${u?.name}`);
  sendEmail(u?.email||'',`Document ${decision}`,'doc_decision');
  renderDocTable(); toast(`Document ${decision}`,'success');
}

function requestDoc(userId){
  const u=userById(userId);
  sendEmail(u?.email||'','Missing Document Request','doc_request');
  toast(`Document request sent to ${u?.name}`,'info');
}

/* ============================================================
   27. NOTIFICATIONS
   ============================================================ */
function renderNotifications(){
  renderNotifList();
  $('markAllReadBtn')?.addEventListener('click',()=>{DB.notifications.forEach(n=>n.read=true);renderNotifList();renderDashboard();toast('All marked read','success');});
  $('clearNotifBtn')?.addEventListener('click',()=>{if(confirm('Clear all notifications?')){DB.notifications=[];renderNotifList();renderDashboard();toast('Notifications cleared','success');}});
  renderNotifPrefs();
  ['notifTypeFilter','notifReadFilter'].forEach(id=>$(id)?.addEventListener('change',renderNotifList));
}

function renderNotifList(){
  const type=$('notifTypeFilter')?.value||'';
  const read=$('notifReadFilter')?.value||'';
  const iconMap={approval:'fa-user-check',task:'fa-list-check',leave:'fa-calendar',system:'fa-server',alert:'fa-triangle-exclamation'};
  const colorMap={approval:'rgba(16,185,129,0.15)',task:'rgba(59,130,246,0.15)',leave:'rgba(234,179,8,0.15)',system:'rgba(100,116,139,0.15)',alert:'rgba(239,68,68,0.15)'};
  const rows=DB.notifications.filter(n=>{
    if(type&&n.type!==type)return false;
    if(read==='unread'&&n.read)return false;
    if(read==='read'&&!n.read)return false;
    return true;
  });
  $('notifList').innerHTML=rows.map(n=>`
    <div class="notif-item${n.read?'':' unread'}" onclick="markNotifRead(${n.id})">
      <div class="notif-icon" style="background:${colorMap[n.type]||'var(--surface2)'};"><i class="fas ${iconMap[n.type]||'fa-bell'}"></i></div>
      <div class="notif-body"><div class="notif-title">${n.title}</div><div class="notif-desc">${n.desc}</div><div class="notif-time">${n.time}</div></div>
      ${n.read?'':'<div class="notif-unread-dot"></div>'}
      <button class="abt dan" onclick="deleteNotif(${n.id});event.stopPropagation()"><i class="fas fa-times"></i></button>
    </div>`).join('')||'<div class="empty-state"><i class="fas fa-bell-slash"></i>No notifications</div>';
}

function markNotifRead(id){const n=DB.notifications.find(x=>x.id===id);if(n)n.read=true;renderNotifList();}
function deleteNotif(id){DB.notifications.splice(DB.notifications.findIndex(n=>n.id===id),1);renderNotifList();}

function renderNotifPrefs(){
  const prefs=[{label:'Approval Notifications',key:'approval'},{label:'Task Assignments',key:'task'},{label:'Leave Decisions',key:'leave'},{label:'System Alerts',key:'system'},{label:'Equipment Alerts',key:'alert'}];
  $('notifPrefs').innerHTML=prefs.map(p=>`<div class="sw-row"><div class="sw-info"><div class="sw-label">${p.label}</div></div><label class="sw"><input type="checkbox" checked><span class="sw-sl"></span></label></div>`).join('');
}

/* ============================================================
   28. EMAIL CENTER
   ============================================================ */
function renderEmailCenter(){
  wireETabs();
  renderEmailLog();
  renderEmailTemplates();
  $('compSendBtn')?.addEventListener('click',sendComposedEmail);
  $('bulkSendBtn')?.addEventListener('click',sendBulkEmail);
}

function wireETabs(){
  const panels={log:'et-log',compose:'et-compose',bulk:'et-bulk',templates:'et-templates'};
  $$('[data-etab]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $$('[data-etab]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
      Object.values(panels).forEach(id=>{const el=$(id);if(el)el.style.display='none';});
      const target=$(panels[btn.dataset.etab]);if(target)target.style.display='';
    });
  });
}

function renderEmailLog(){
  const st=$('emailLogStatus')?.value||'';
  const q=$('emailLogSearch')?.value.toLowerCase()||'';
  const rows=DB.emailLog.filter(e=>{
    if(st&&e.status!==st)return false;
    if(q&&!e.to.includes(q)&&!e.subject.toLowerCase().includes(q))return false;
    return true;
  });
  $('emailLogTbody').innerHTML=rows.map(e=>`<tr>
    <td>${e.to}</td><td>${e.subject}</td>
    <td style="font-size:0.75rem;"><code>${e.template}</code></td>
    <td style="font-size:0.75rem;">${e.sentAt}</td>
    <td>${statusBadge(e.status==='sent'?'active':e.status==='failed'?'inactive':'pending')}</td>
    <td><button class="abt inf" title="Resend" onclick="toast('Email resent','info')"><i class="fas fa-rotate-right"></i></button></td>
  </tr>`).join('')||'<tr><td colspan="6"><div class="empty-state"><i class="fas fa-inbox"></i>No emails</div></td></tr>';
  $('emailLogSearch')?.addEventListener('input',renderEmailLog);
  $('emailLogStatus')?.addEventListener('change',renderEmailLog);
}

function sendComposedEmail(){
  const to=$('compTo')?.value.trim();
  const subject=$('compSubject')?.value.trim();
  if(!to||!subject){toast('To and Subject required','error');return;}
  sendEmail(to,subject,'manual');toast(`Email sent to ${to}`,'success');
  $('compTo').value=$('compSubject').value=$('compBody').value='';
  renderEmailLog();
}

function sendBulkEmail(){
  const targets=[...$('bulkEmailTargets').querySelectorAll('input:checked')].map(i=>i.value);
  if(!targets.length){toast('Select at least one group','warn');return;}
  let count=0;
  if(targets.includes('all')) count=DB.users.length;
  else targets.forEach(t=>{count+=DB.users.filter(u=>u.role===t).length;});
  toast(`Bulk email queued for ${count} recipients`,'success');
  logAction('create','Email',`Bulk email to: ${targets.join(', ')}`);
}

function renderEmailTemplates(){
  const templates=[
    {id:'welcome_approved',name:'Welcome / Approved',desc:'Sent when a user is approved.'},
    {id:'leave_decision',name:'Leave Decision',desc:'Sent on leave approve/reject.'},
    {id:'task_assigned',name:'Task Assigned',desc:'Sent when a task is assigned.'},
    {id:'payslip',name:'Payslip Ready',desc:'Sent when payslip is generated.'},
    {id:'incident_alert',name:'Critical Incident',desc:'Sent on critical safety incident.'},
    {id:'doc_request',name:'Document Request',desc:'Sent to request missing documents.'},
    {id:'ticket_update',name:'Ticket Update',desc:'Sent when a ticket status changes.'},
  ];
  $('emailTemplatesList').innerHTML=templates.map(t=>`<div class="cat-item" style="margin-bottom:0.5rem;">
    <i class="fas fa-file-lines" style="color:var(--accent);"></i>
    <div style="flex:1;"><div class="ci-name">${t.name}</div><div style="font-size:0.72rem;color:var(--text3);">${t.desc}</div></div>
    <code style="font-size:0.68rem;color:var(--text3);">${t.id}</code>
  </div>`).join('');
}

/* ============================================================
   29. SAFETY & INCIDENTS
   ============================================================ */
function renderSafety(){
  wireSTabs();
  renderSafetyOverview();
  renderInductions();
  renderHazards();
  renderIncidentTable();
  renderChecklist();
  renderTraining();
  renderSafetyScores();
  populateSafetySelects();
  $('reportIncidentBtn')?.addEventListener('click',()=>openM('incidentModal'));
  $('inc_save')?.addEventListener('click',saveIncident);
  $('incExport')?.addEventListener('click',()=>exportCSV(DB.incidents,'incidents.csv'));
  $('addTrainingBtn')?.addEventListener('click',()=>toast('Training record form (demo)','info'));
  ['incSeverity','incSite'].forEach(id=>$(id)?.addEventListener('change',renderIncidentTable));
  ['indSearch','indStatus'].forEach(id=>$(id)?.addEventListener('input',renderInductions));
  ['hazSearch','hazStatus','hazType'].forEach(id=>$(id)?.addEventListener('input',renderHazards));
  $('hazApply')?.addEventListener('click',renderHazards);
  $('safeRptGenerate')?.addEventListener('click',generateSafetyExport);
  if ($('safeRptFrom') && !$('safeRptFrom').value) $('safeRptFrom').value = new Date().toISOString().slice(0,10);
  if ($('safeRptTo') && !$('safeRptTo').value) $('safeRptTo').value = new Date().toISOString().slice(0,10);
}

function wireSTabs(){
  const panels={overview:'st-overview',inductions:'st-inductions',hazards:'st-hazards',exports:'st-exports',incidents:'st-incidents',checklist:'st-checklist',training:'st-training',score:'st-score'};
  $$('[data-stab]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $$('[data-stab]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
      Object.values(panels).forEach(id=>{const el=$(id);if(el)el.style.display='none';});
      const target=$(panels[btn.dataset.stab]);if(target)target.style.display='';
    });
  });
}

function populateSafetySelects(){
  const siteOpts='<option value="">All Sites</option>'+DB.sites.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
   ['incSite','checklistSite','inc_site','safeActiveSite'].forEach(id=>{const el=$(id);if(el)el.innerHTML=siteOpts;});
}

function renderSafetyOverview(){
  const openHazards = DB.incidents.filter(i=>i.status==='open').length;
  const overdueHazards = DB.incidents.filter(i=>i.status==='open' && i.severity!=='low').length;
  const inducted = DB.users.filter(u=>u.status==='active').length;
  $('safeOverviewStats').innerHTML =
    statCard('fa-users','blue',DB.users.length,'Total Workers','','flat') +
    statCard('fa-user-check','green',inducted,'Inducted','','flat') +
    statCard('fa-triangle-exclamation','red',openHazards,'Open Safety Issues','','flat') +
    statCard('fa-clock','yellow',overdueHazards,'Overdue Hazards','','flat');
}

function renderInductions(){
  const q = ($('indSearch')?.value || '').toLowerCase();
  const st = $('indStatus')?.value || '';
  const rows = DB.users
    .filter(u=>u.role!=='admin')
    .map((u,idx)=>{
      const statusMap = ['Inducted','Pending Review','In Progress','Not Started','Expired'];
      const status = statusMap[idx % statusMap.length];
      return { user:u, company:siteById(DB.sites[idx % DB.sites.length]?.id)?.name || 'Main Contractor', status, updated:nowStr().slice(0,10) };
    })
    .filter(r => (!q || r.user.name.toLowerCase().includes(q) || r.company.toLowerCase().includes(q)) && (!st || r.status===st));
  $('indTbody').innerHTML = rows.map(r=>`<tr>
    <td><div class="user-cell">${avatarEl(r.user,26)}<span>${r.user.name}</span></div></td>
    <td>${r.company}</td>
    <td>${statusBadge(r.status.toLowerCase().replace(/\s+/g,'' )==='inducted'?'active':r.status==='Expired'?'inactive':'pending')}</td>
    <td style="font-size:0.76rem;">${r.updated}</td>
  </tr>`).join('') || '<tr><td colspan="4"><div class="empty-state"><i class="fas fa-id-card"></i>No inductions found</div></td></tr>';
}

function renderHazards(){
  const q = ($('hazSearch')?.value || '').toLowerCase();
  const st = $('hazStatus')?.value || '';
  const type = $('hazType')?.value || '';
  const rows = DB.incidents.filter(i=>{
    if (st && i.status!==st) return false;
    if (type && i.type!==type) return false;
    if (q && !(`${i.desc} ${siteById(i.siteId)?.name||''}`).toLowerCase().includes(q)) return false;
    return true;
  });
  $('hazardStats').innerHTML =
    statCard('fa-folder-open','yellow',DB.incidents.filter(i=>i.status==='open').length,'Open','','flat') +
    statCard('fa-clock','red',DB.incidents.filter(i=>i.status==='open'&&i.severity!=='low').length,'Overdue','','flat') +
    statCard('fa-check','green',DB.incidents.filter(i=>i.status==='resolved').length,'Closed','','flat');
  $('hazTbody').innerHTML = rows.map(i=>`<tr>
    <td style="font-size:0.75rem;">${i.date}</td>
    <td>${siteById(i.siteId)?.name||'—'}</td>
    <td><span class="badge b-update">${i.type}</span></td>
    <td style="font-size:0.8rem;">${i.desc}</td>
    <td>${statusBadge(i.status==='open'?'active':'completed')}</td>
  </tr>`).join('') || '<tr><td colspan="5"><div class="empty-state"><i class="fas fa-triangle-exclamation"></i>No hazards found</div></td></tr>';
}

function generateSafetyExport(){
  const type = $('safeRptType')?.value;
  const fmt = $('safeRptFmt')?.value || 'csv';
  if (!type) { toast('Select report type','error'); return; }
  if (type==='incidents' || type==='hazards') {
    if (fmt==='json') downloadJSON(DB.incidents, `${type}.json`);
    else exportCSV(DB.incidents, `${type}.csv`);
  } else {
    const rows = DB.users.filter(u=>u.role!=='admin').map((u, idx)=>({name:u.name, status:['Inducted','Pending Review','In Progress','Not Started','Expired'][idx%5]}));
    if (fmt==='json') downloadJSON(rows, 'inductions.json');
    else exportCSV(rows, 'inductions.csv');
  }
  toast('Safety export generated','success');
}

function renderIncidentTable(){
  const sev=$('incSeverity')?.value||'';
  const site=+$('incSite')?.value||0;
  const rows=DB.incidents.filter(i=>{if(sev&&i.severity!==sev)return false;if(site&&i.siteId!==site)return false;return true;});
  const critical=DB.incidents.filter(i=>i.severity==='critical').length;
  const open=DB.incidents.filter(i=>i.status==='open').length;
  $('safetyStats').innerHTML=
    statCard('fa-triangle-exclamation','red',DB.incidents.length,'Total Incidents','','flat')+
    statCard('fa-skull','red',critical,'Critical','','flat')+
    statCard('fa-folder-open','yellow',open,'Open','','flat')+
    statCard('fa-check','green',DB.incidents.filter(i=>i.status==='resolved').length,'Resolved','','flat');
  $('incTbody').innerHTML=rows.map(i=>{
    const s=siteById(i.siteId);const r=userById(i.reporterId);
    return `<tr>
      <td style="font-size:0.75rem;">${i.date}</td>
      <td style="font-size:0.8rem;">${s?.name||'—'}</td>
      <td><div class="user-cell">${avatarEl(r,24)}<span style="font-size:0.78rem;">${r?.name}</span></div></td>
      <td><span class="badge b-update">${i.type}</span></td>
      <td>${severityBadge(i.severity)}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8rem;">${i.desc}</td>
      <td>${statusBadge(i.status==='open'?'active':'completed')}</td>
      <td>
        <button class="abt inf" title="Details" onclick="toast('Incident details (demo)','info')"><i class="fas fa-eye"></i></button>
        ${i.status==='open'?`<button class="abt suc" title="Resolve" onclick="resolveIncident(${i.id})"><i class="fas fa-check"></i></button>`:''}
      </td>
    </tr>`;
  }).join('')||'<tr><td colspan="8"><div class="empty-state"><i class="fas fa-shield-check"></i>No incidents found</div></td></tr>';
}

function saveIncident(){
  const data={date:$('inc_date')?.value||nowStr(),siteId:+$('inc_site')?.value||1,reporterId:currentUser.id,type:$('inc_type')?.value,severity:$('inc_severity')?.value,desc:$('inc_desc')?.value.trim(),actions:$('inc_actions')?.value.trim(),status:'open'};
  if(!data.desc){toast('Description required','error');return;}
  DB.incidents.unshift({id:generateId('incidents'),...data});
  logAction('create','Incident',`${data.severity} incident at site #${data.siteId}`);
  if(data.severity==='critical')sendEmail('admin@nixers.pro','CRITICAL: Safety Incident Reported','incident_alert');
  closeM('incidentModal');renderIncidentTable();toast('Incident reported','success');
}

function resolveIncident(id){const i=DB.incidents.find(x=>x.id===id);if(i)i.status='resolved';renderIncidentTable();toast('Incident resolved','success');}

function renderChecklist(){
  const checks=['All workers have PPE','Emergency exits clear','Scaffolding inspected','Tools accounted for','First aid kit stocked','Hazard zones marked','Morning briefing done'];
  $('checklistBody').innerHTML=checks.map((c,i)=>`<div class="sw-row"><div class="sw-info"><div class="sw-label">${c}</div></div><label class="sw"><input type="checkbox" id="chk${i}"><span class="sw-sl"></span></label></div>`).join('')+
  `<div style="margin-top:1rem;"><button class="btn btn-accent btn-sm" onclick="submitChecklist()"><i class="fas fa-save"></i> Submit Checklist</button></div>`;
}

function submitChecklist(){logAction('create','Checklist','Daily safety checklist submitted');toast('Checklist submitted','success');}

function renderTraining(){
  const trainings=[{userId:3,training:'Working at Height',completed:'2025-01-15',expiry:'2026-01-15',status:'valid'},{userId:4,training:'First Aid',completed:'2024-06-01',expiry:'2025-06-01',status:'expired'},{userId:5,training:'Fire Safety',completed:'2025-03-10',expiry:'2026-03-10',status:'valid'},{userId:6,training:'Scaffolding Safety',completed:'2025-02-20',expiry:'2026-02-20',status:'valid'}];
  $('trainingTbody').innerHTML=trainings.map(t=>{const u=userById(t.userId);return`<tr>
    <td><div class="user-cell">${avatarEl(u,26)}<span>${u?.name}</span></div></td>
    <td>${t.training}</td>
    <td style="font-size:0.75rem;">${fmt(t.completed)}</td>
    <td style="font-size:0.75rem;">${fmt(t.expiry)}</td>
    <td>${statusBadge(t.status==='valid'?'active':'inactive')}</td>
    <td><button class="abt warn"><i class="fas fa-pen"></i></button></td>
  </tr>`;}).join('');
}

function renderSafetyScores(){
  $('safetyScoreBody').innerHTML=DB.sites.map(s=>{
    const incidents=DB.incidents.filter(i=>i.siteId===s.id);
    const score=Math.max(0,100-incidents.length*15);
    const color=score>=80?'#34d399':score>=60?'var(--accent)':'#f87171';
    return `<div class="safety-score-card">
      <div class="ss-site">${s.name}</div>
      <div style="display:flex;align-items:center;gap:1rem;">
        <div class="ss-score" style="color:${color};">${score}</div>
        <div style="flex:1;"><div class="pb ss-bar"><div class="pb-fill" style="width:${score}%;background:${color};"></div></div>
        <div style="font-size:0.72rem;color:var(--text3);margin-top:0.25rem;">${incidents.length} incident${incidents.length!==1?'s':''} recorded</div></div>
      </div>
    </div>`;
  }).join('')||'<div class="empty-state"><i class="fas fa-star"></i>No sites found</div>';
}

/* ============================================================
   30. AUDIT LOG
   ============================================================ */
function renderAuditLog(){
  renderAuditTable();
  renderAuditHeatmap();
  $('auditExport')?.addEventListener('click',()=>exportCSV(DB.auditLog,'audit_log.csv'));
  ['auditSearch','auditUser','auditAction','auditFrom','auditTo'].forEach(id=>$(id)?.addEventListener('input',renderAuditTable));
  const userSel=$('auditUser');
  if(userSel)userSel.innerHTML='<option value="">All Users</option>'+DB.users.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
}

function renderAuditTable(){
  const q=$('auditSearch')?.value.toLowerCase()||'';
  const uid=+$('auditUser')?.value||0;
  const action=$('auditAction')?.value||'';
  const from=$('auditFrom')?.value||'';
  const to=$('auditTo')?.value||'';
  const rows=DB.auditLog.filter(l=>{
    if(q&&!l.details.toLowerCase().includes(q)&&!l.target.toLowerCase().includes(q))return false;
    if(uid&&l.userId!==uid)return false;
    if(action&&l.action!==action)return false;
    if(from&&l.time.slice(0,10)<from)return false;
    if(to&&l.time.slice(0,10)>to)return false;
    return true;
  });
  $('auditTbody').innerHTML=rows.map(l=>{const u=userById(l.userId);return`<tr>
    <td style="font-size:0.75rem;white-space:nowrap;">${l.time}</td>
    <td><div class="user-cell">${avatarEl(u,24)}<span style="font-size:0.8rem;">${u?.name||'System'}</span></div></td>
    <td>${roleBadge(u?.role||'worker')}</td>
    <td><span class="badge b-${l.action==='login'||l.action==='logout'?'update':l.action==='delete'?'inactive':l.action==='approve'?'active':'update'}">${l.action}</span></td>
    <td style="font-size:0.8rem;">${l.target}</td>
    <td style="font-size:0.78rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.details}</td>
    <td><code style="font-size:0.7rem;">${l.ip}</code></td>
    <td>${statusBadge(l.status==='success'?'active':'inactive')}</td>
  </tr>`;}).join('')||'<tr><td colspan="8"><div class="empty-state"><i class="fas fa-scroll"></i>No log entries</div></td></tr>';
}

function renderAuditHeatmap(){
  const el=$('auditHeatmap');if(!el)return;
  const counts={};
  DB.auditLog.forEach(l=>{const d=l.time.slice(0,10);counts[d]=(counts[d]||0)+1;});
  const today=new Date();
  let html='<div class="heatmap-grid">';
  for(let i=51;i>=0;i--){
    for(let j=0;j<7;j++){
      const d=new Date(today);d.setDate(d.getDate()-(i*7+j));
      const key=d.toISOString().slice(0,10);
      const n=counts[key]||0;
      const level=n===0?0:n<=1?1:n<=3?2:n<=5?3:4;
      html+=`<div class="hm-cell hm-l${level}" title="${key}: ${n} actions"></div>`;
    }
  }
  html+='</div><div style="font-size:0.72rem;color:var(--text3);margin-top:0.5rem;">Last 52 weeks — each cell = 1 day</div>';
  el.innerHTML=html;
}

/* ============================================================
   31. RBAC PERMISSIONS
   ============================================================ */
function renderRBAC(){
  wireRTabs();
  renderRBACMatrix();
  renderRolesTable();
  renderOverridesTable();
  $('addRoleBtn')?.addEventListener('click',()=>openRoleModal());
}

function wireRTabs(){
  const panels={matrix:'rt-matrix',roles:'rt-roles',overrides:'rt-overrides'};
  $$('[data-rtab]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $$('[data-rtab]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
      Object.values(panels).forEach(id=>{const el=$(id);if(el)el.style.display='none';});
      const target=$(panels[btn.dataset.rtab]);if(target)target.style.display='';
    });
  });
}

function renderRBACMatrix(){
  const perms=['users','sites','tasks','posts','leave','payroll','reports','settings','audit'];
  const roles=['admin','manager','worker'];
  let html=`<table class="rbac-table"><thead><tr><th>Permission / Module</th>${roles.map(r=>`<th>${r.charAt(0).toUpperCase()+r.slice(1)}</th>`).join('')}</tr></thead><tbody>`;
  perms.forEach(perm=>{
    html+=`<tr><td>${perm.charAt(0).toUpperCase()+perm.slice(1)}</td>`;
    roles.forEach(role=>{html+=`<td><input type="checkbox" class="perm-check" ${DB.rbacPerms[role]?.[perm]?'checked':''} data-role="${role}" data-perm="${perm}"></td>`;});
    html+='</tr>';
  });
  html+='</tbody></table>';
  $('rbacMatrix').innerHTML=html;
  $$('.perm-check').forEach(cb=>cb.addEventListener('change',e=>{
    DB.rbacPerms[e.target.dataset.role][e.target.dataset.perm]=e.target.checked;
    toast('Permission updated','success');
  }));
}

function renderRolesTable(){
  $('rolesTbody').innerHTML=DB.roles.map(r=>`<tr>
    <td><span class="badge" style="background:${r.color}22;color:${r.color};">${r.name}</span></td>
    <td><div style="width:20px;height:20px;background:${r.color};border-radius:4px;"></div></td>
    <td>${DB.users.filter(u=>u.role===r.id).length}</td>
    <td style="font-size:0.75rem;">${Array.isArray(r.perms)?r.perms.join(', '):'Custom'}</td>
    <td>
      <button class="abt warn" onclick="openRoleModal('${r.id}')"><i class="fas fa-pen"></i></button>
      ${r.id==='admin'||r.id==='manager'||r.id==='worker'?'':`<button class="abt dan" onclick="deleteRole('${r.id}')"><i class="fas fa-trash"></i></button>`}
    </td>
  </tr>`).join('');
}

function openRoleModal(roleId=null){
  const r=roleId?DB.roles.find(x=>x.id===roleId):null;
  $('roleModalTitle').textContent=r?'Edit Role':'Create Role';
  $('rm_name').value=r?.name||'';
  $('rm_color').value=r?.color||'#3b82f6';
  const perms=['users.view','users.edit','sites.view','sites.manage','tasks.view','tasks.manage','posts.view','posts.create','leave.apply','leave.approve','payroll.view','payroll.manage','reports.view','settings.edit','audit.view'];
  $('rm_perms').innerHTML=perms.map(p=>`<label style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;"><input type="checkbox" value="${p}" ${r&&Array.isArray(r.perms)&&r.perms.includes(p)?'checked':''}> ${p}</label>`).join('');
  $('rm_save').onclick=()=>saveRole(roleId);
  openM('roleModal');
}

function saveRole(roleId){
  const name=$('rm_name').value.trim();if(!name){toast('Name required','error');return;}
  const color=$('rm_color').value;
  const perms=[...$('rm_perms').querySelectorAll('input:checked')].map(i=>i.value);
  if(roleId){const r=DB.roles.find(x=>x.id===roleId);Object.assign(r,{name,color,perms});}
  else{DB.roles.push({id:name.toLowerCase().replace(/\s+/g,'_'),name,color,perms});}
  closeM('roleModal');renderRolesTable();toast('Role saved','success');
}

function deleteRole(id){if(!confirm('Delete role?'))return;DB.roles.splice(DB.roles.findIndex(r=>r.id===id),1);renderRolesTable();toast('Role deleted','success');}

function renderOverridesTable(){
  $('overrideTbody').innerHTML='<tr><td colspan="5"><div class="empty-state"><i class="fas fa-user-shield"></i>No overrides configured</div></td></tr>';
}

/* ============================================================
   32. CLIENT PORTAL
   ============================================================ */
function renderClientPortal(){
  wireCPTabs();
  renderClientTable();
  renderTicketTable();
  populateCPSelects();
  $('addClientBtn')?.addEventListener('click',()=>openClientModal());
  $('addTicketBtn')?.addEventListener('click',()=>openTicketModal());
  $('cl_save')?.addEventListener('click',()=>saveClient(null));
  $('tk_save')?.addEventListener('click',()=>saveTicket(null));
  ['clientSearch'].forEach(id=>$(id)?.addEventListener('input',renderClientTable));
  ['ticketStatus','ticketClient'].forEach(id=>$(id)?.addEventListener('change',renderTicketTable));
}

function wireCPTabs(){
  const panels={clients:'cp-clients',tickets:'cp-tickets'};
  $$('[data-cptab]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $$('[data-cptab]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
      Object.values(panels).forEach(id=>{const el=$(id);if(el)el.style.display='none';});
      const target=$(panels[btn.dataset.cptab]);if(target)target.style.display='';
    });
  });
}

function populateCPSelects(){
  const tkClient=$('tk_client');if(tkClient)tkClient.innerHTML=DB.clients.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  const tkAss=$('tk_assignee');if(tkAss)tkAss.innerHTML=DB.users.filter(u=>u.role!=='worker').map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  const ticketClient=$('ticketClient');if(ticketClient)ticketClient.innerHTML='<option value="">All Clients</option>'+DB.clients.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  const cl_sites=$('cl_sitesCheck');if(cl_sites)cl_sites.innerHTML=DB.sites.map(s=>`<label style="display:flex;align-items:center;gap:0.35rem;font-size:0.82rem;"><input type="checkbox" value="${s.id}"> ${s.name}</label>`).join('');
}

function renderClientTable(){
  const q=$('clientSearch')?.value.toLowerCase()||'';
  const rows=DB.clients.filter(c=>!q||c.name.toLowerCase().includes(q)||c.contact.toLowerCase().includes(q));
  $('clientTbody').innerHTML=rows.map(c=>`<tr>
    <td style="font-weight:600;">${c.name}</td>
    <td>${c.contact}</td>
    <td>${c.email}</td>
    <td style="font-size:0.78rem;">${c.siteIds.map(id=>siteById(id)?.name).filter(Boolean).join(', ')||'None'}</td>
    <td>${DB.tickets.filter(t=>t.clientId===c.id).length}</td>
    <td>${statusBadge(c.status)}</td>
    <td>
      <button class="abt warn" onclick="openClientModal(${c.id})"><i class="fas fa-pen"></i></button>
      <button class="abt dan" onclick="deleteClient(${c.id})"><i class="fas fa-trash"></i></button>
    </td>
  </tr>`).join('')||'<tr><td colspan="7"><div class="empty-state"><i class="fas fa-briefcase"></i>No clients</div></td></tr>';
}

function openClientModal(clientId=null){
  populateCPSelects();
  const c=clientId?DB.clients.find(x=>x.id===clientId):null;
  $('clientTitle').textContent=c?'Edit Client':'Add Client';
  $('cl_name').value=c?.name||'';
  $('cl_contact').value=c?.contact||'';
  $('cl_email').value=c?.email||'';
  $('cl_phone').value=c?.phone||'';
  if(c){$('cl_sitesCheck').querySelectorAll('input').forEach(cb=>{cb.checked=c.siteIds.includes(+cb.value);});}
  $('cl_save').onclick=()=>saveClient(clientId);
  openM('clientModal');
}

function saveClient(clientId){
  const data={name:$('cl_name').value.trim(),contact:$('cl_contact').value.trim(),email:$('cl_email').value.trim(),phone:$('cl_phone')?.value.trim(),siteIds:[...$('cl_sitesCheck').querySelectorAll('input:checked')].map(i=>+i.value),status:'active'};
  if(!data.name){toast('Name required','error');return;}
  if(clientId){Object.assign(DB.clients.find(c=>c.id===clientId),data);}
  else{DB.clients.push({id:generateId('clients'),...data});}
  closeM('clientModal');renderClientTable();toast('Client saved','success');
}

function deleteClient(id){if(!confirm('Delete client?'))return;DB.clients.splice(DB.clients.findIndex(c=>c.id===id),1);renderClientTable();toast('Client deleted','success');}

function renderTicketTable(){
  const st=$('ticketStatus')?.value||'';
  const cid=+$('ticketClient')?.value||0;
  const rows=DB.tickets.filter(t=>{if(st&&t.status!==st)return false;if(cid&&t.clientId!==cid)return false;return true;});
  $('ticketTbody').innerHTML=rows.map(t=>{
    const c=DB.clients.find(x=>x.id===t.clientId);
    const a=userById(t.assigneeId);
    return`<tr>
      <td style="font-family:'Space Grotesk',sans-serif;font-weight:700;">#${String(t.id).padStart(4,'0')}</td>
      <td>${c?.name||'—'}</td>
      <td style="font-weight:500;">${t.subject}</td>
      <td>${priorityBadge(t.priority)}</td>
      <td><div class="user-cell">${avatarEl(a,24)}<span style="font-size:0.78rem;">${a?.name||'—'}</span></div></td>
      <td style="font-size:0.75rem;">${fmt(t.created)}</td>
      <td style="font-size:0.75rem;">${fmt(t.updated)}</td>
      <td>${statusBadge(t.status==='open'?'active':t.status==='in-progress'?'in-progress':'completed')}</td>
      <td>
        <button class="abt warn" onclick="openTicketModal(${t.id})"><i class="fas fa-pen"></i></button>
        <button class="abt dan" onclick="deleteTicket(${t.id})"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('')||'<tr><td colspan="9"><div class="empty-state"><i class="fas fa-ticket"></i>No tickets</div></td></tr>';
}

function openTicketModal(ticketId=null){
  populateCPSelects();
  const t=ticketId?DB.tickets.find(x=>x.id===ticketId):null;
  $('ticketTitle').textContent=t?'Edit Ticket':'New Ticket';
  $('tk_client').value=t?.clientId||DB.clients[0]?.id||'';
  $('tk_priority').value=t?.priority||'medium';
  $('tk_subject').value=t?.subject||'';
  $('tk_desc').value=t?.desc||'';
  $('tk_assignee').value=t?.assigneeId||'';
  $('tk_save').onclick=()=>saveTicket(ticketId);
  openM('ticketModal');
}

function saveTicket(ticketId){
  const data={clientId:+$('tk_client').value,priority:$('tk_priority').value,subject:$('tk_subject').value.trim(),desc:$('tk_desc').value.trim(),assigneeId:+$('tk_assignee').value,status:'open',created:nowStr().slice(0,10),updated:nowStr().slice(0,10)};
  if(!data.subject){toast('Subject required','error');return;}
  if(ticketId){Object.assign(DB.tickets.find(t=>t.id===ticketId),{...data,updated:nowStr().slice(0,10)});sendEmail(DB.clients.find(c=>c.id===data.clientId)?.email||'','Ticket Updated','ticket_update');}
  else{DB.tickets.push({id:generateId('tickets'),...data});logAction('create',`Ticket #${nextId.tickets-1}`,`Created for client`);}
  closeM('ticketModal');renderTicketTable();toast('Ticket saved','success');
}

function deleteTicket(id){if(!confirm('Delete ticket?'))return;DB.tickets.splice(DB.tickets.findIndex(t=>t.id===id),1);renderTicketTable();toast('Ticket deleted','success');}

/* ============================================================
   33. REPORTS
   ============================================================ */
function renderReports(){
  $('rptGenerate')?.addEventListener('click',generateReport);
  $('rptExport')?.addEventListener('click',()=>toast('Report exported to CSV','success'));
  $('rptPrint')?.addEventListener('click',()=>window.print());
}

function generateReport(){
  const type=$('rptType')?.value;
  const output=$('rptOutput');
  const reports={
    leave:()=>{
      const data=DB.leaveRequests.map(l=>({User:userById(l.userId)?.name,Type:l.type,From:l.from,To:l.to,Days:l.days,Status:l.status}));
      return tableFromData(data,'Leave Summary');
    },
    documents:()=>{
      const data=DB.users.map(u=>({User:u.name,Docs:DB.documents.filter(d=>d.userId===u.id).length,Approved:DB.documents.filter(d=>d.userId===u.id&&d.status==='approved').length,Pending:DB.documents.filter(d=>d.userId===u.id&&d.status==='pending').length}));
      return tableFromData(data,'Document Completion');
    },
    activity:()=>{
      const data=DB.auditLog.slice(0,20).map(l=>({Time:l.time,User:userById(l.userId)?.name,Action:l.action,Target:l.target}));
      return tableFromData(data,'User Activity');
    },
    payroll:()=>{
      const data=DB.payroll.map(p=>({Employee:userById(p.userId)?.name,Base:fmtMoney(p.baseSalary),Net:fmtMoney(netPay(p)),Status:p.status}));
      return tableFromData(data,'Payroll Cost');
    },
    tasks:()=>{
      const data=DB.tasks.map(t=>({Task:t.title,Project:projectById(t.projectId)?.name,Assignee:userById(t.assigneeId)?.name,Status:t.status,Priority:t.priority}));
      return tableFromData(data,'Task Completion');
    },
    safety:()=>{
      const data=DB.incidents.map(i=>({Date:i.date,Site:siteById(i.siteId)?.name,Severity:i.severity,Type:i.type,Status:i.status}));
      return tableFromData(data,'Safety Incidents');
    },
  };
  output.innerHTML=reports[type]?.()||'<div class="empty-state">No data</div>';
}

function tableFromData(data,title){
  if(!data.length)return`<div class="empty-state">No data for this report</div>`;
  const keys=Object.keys(data[0]);
    return`<div style="font-family:'Space Grotesk',sans-serif;font-weight:700;margin-bottom:1rem;">${title}</div>
  <div style="overflow-x:auto;"><table class="dt"><thead><tr>${keys.map(k=>`<th>${k}</th>`).join('')}</tr></thead><tbody>
  ${data.map(row=>`<tr>${keys.map(k=>`<td>${row[k]}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`;
}

/* ============================================================
   34. SETTINGS
   ============================================================ */
function renderSettings(){
  wireSettingsTabs();
  loadSettingsValues();
  wireSettingsEvents();
}

function wireSettingsTabs(){
  const panels={general:'set-general',security:'set-security',appearance:'set-appearance',emailjs:'set-emailjs',company:'set-company','leave-policy':'set-leave-policy',data:'set-data'};
  $$('[data-settab]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $$('[data-settab]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
      Object.values(panels).forEach(id=>{const el=$(id);if(el)el.style.display='none';});
      const target=$(panels[btn.dataset.settab]);if(target)target.style.display='';
    });
  });
}

function loadSettingsValues(){
  const s=DB.settings;
  const set=(id,val)=>{const el=$(id);if(!el)return;if(el.type==='checkbox')el.checked=val;else el.value=val;};
  set('sysName',s.systemName);set('sysTz',s.timezone);set('sysDateFmt',s.dateFormat);
  set('swEmail',s.emailNotif);set('swSms',s.smsAlerts);set('swPush',s.pushNotif);set('swMaintenance',s.maintenanceMode);
  set('workStart',s.workStart);set('workEnd',s.workEnd);
  set('sesTimeout',s.sessionTimeout);set('maxLogin',s.maxLoginAttempts);set('pwdLen',s.passwordMinLen);
  set('sw2fa',s.twoFactor);set('swIp',s.ipWhitelist);set('swAudit',s.auditLogging);
  set('swCompact',s.compactMode);set('swAnims',s.animations);
  set('ejsService',s.ejsService);set('ejsPublicKey',s.ejsPublicKey);
  set('ejsTplWelcome',s.ejsTplWelcome);set('ejsTplLeave',s.ejsTplLeave);set('ejsTplDoc',s.ejsTplDoc);
  set('ejsTplTask',s.ejsTplTask);set('ejsTplPayslip',s.ejsTplPayslip);set('ejsTplIncident',s.ejsTplIncident);set('ejsTplTicket',s.ejsTplTicket);
  set('coName',s.companyName);set('coAddr',s.companyAddress);set('coPhone',s.companyPhone);set('coEmail',s.companyEmail);set('coWeb',s.companyWeb);
  set('lpAnnual',s.lpAnnual);set('lpSick',s.lpSick);set('lpEmergency',s.lpEmergency);set('lpMaxConsec',s.lpMaxConsec);set('lpNotice',s.lpNotice);
  set('swCarry',s.carryForward);set('swApproval',s.requireApproval);
}

function wireSettingsEvents(){
  $('saveSettingsBtn')?.addEventListener('click',saveSettings);
  $('clearCacheBtn')?.addEventListener('click',()=>{if(confirm('Clear cache?'))toast('Cache cleared','success');});
  $('wipeDataBtn')?.addEventListener('click',()=>{if(confirm('WARNING: This will delete ALL data. Are you sure?')){if(confirm('Are you REALLY sure?'))toast('Data wipe cancelled (demo only)','warn');}});
  $('exportAllBtn')?.addEventListener('click',()=>exportCSV(DB.users,'all_users.csv'));
  $('ejsTestBtn')?.addEventListener('click',()=>{sendEmail('test@nixers.pro','Test Email from Nixers Pro','welcome_approved');toast('Test email sent','success');});
  $('logoDropZone')?.addEventListener('click',()=>$('logoInput')?.click());
  $('logoInput')?.addEventListener('change',e=>{
    const f=e.target.files[0];if(!f)return;
    const r=new FileReader();r.onload=ev=>{$('logoPreview').src=ev.target.result;$('logoPreview').style.display='block';};r.readAsDataURL(f);
  });
  $$('#colorSwatches .color-sw').forEach(sw=>{
    sw.addEventListener('click',()=>{
      $$('#colorSwatches .color-sw').forEach(s=>s.classList.remove('sel'));
      sw.classList.add('sel');
      setAccentColor(sw.dataset.color);
    });
  });
  $('tplPreviewSelect')?.addEventListener('change',updateTplPreview);
  updateTplPreview();
}

function saveSettings(){
  const s=DB.settings;
  const get=(id,def='')=>{const el=$(id);if(!el)return def;if(el.type==='checkbox')return el.checked;return el.value;};
  s.systemName=get('sysName');s.timezone=get('sysTz');s.dateFormat=get('sysDateFmt');
  s.emailNotif=get('swEmail');s.smsAlerts=get('swSms');s.pushNotif=get('swPush');s.maintenanceMode=get('swMaintenance');
  s.workStart=get('workStart');s.workEnd=get('workEnd');
  s.sessionTimeout=+get('sesTimeout');s.maxLoginAttempts=+get('maxLogin');s.passwordMinLen=+get('pwdLen');
  s.twoFactor=get('sw2fa');s.ipWhitelist=get('swIp');s.auditLogging=get('swAudit');
  s.compactMode=get('swCompact');s.animations=get('swAnims');
  s.ejsService=get('ejsService');s.ejsPublicKey=get('ejsPublicKey');
  s.ejsTplWelcome=get('ejsTplWelcome');s.ejsTplLeave=get('ejsTplLeave');s.ejsTplDoc=get('ejsTplDoc');
  s.ejsTplTask=get('ejsTplTask');s.ejsTplPayslip=get('ejsTplPayslip');s.ejsTplIncident=get('ejsTplIncident');s.ejsTplTicket=get('ejsTplTicket');
  s.companyName=get('coName');s.companyAddress=get('coAddr');s.companyPhone=get('coPhone');s.companyEmail=get('coEmail');s.companyWeb=get('coWeb');
  s.lpAnnual=+get('lpAnnual');s.lpSick=+get('lpSick');s.lpEmergency=+get('lpEmergency');s.lpMaxConsec=+get('lpMaxConsec');s.lpNotice=+get('lpNotice');
  s.carryForward=get('swCarry');s.requireApproval=get('swApproval');
  document.body.classList.toggle('compact',s.compactMode);
  logAction('update','Settings','System settings updated');
  toast('Settings saved','success');
}

function setAccentColor(color){
  document.documentElement.style.setProperty('--accent',color);
  DB.settings.accentColor=color;
  toast('Accent color updated','success');
}

function updateTplPreview(){
  const type=$('tplPreviewSelect')?.value||'welcome';
  const previews={
    welcome:`<div style="padding:0.5rem;"><strong style="color:var(--accent);">Subject:</strong> Welcome to Nixers Pro<br><br>Dear <strong>{name}</strong>,<br><br>Your account has been approved. You can now log in to Nixers Pro.<br><br>Best regards,<br>Nixers Admin Team</div>`,
    leave:`<div style="padding:0.5rem;"><strong style="color:var(--accent);">Subject:</strong> Leave Request Update<br><br>Dear <strong>{name}</strong>,<br><br>Your leave request for <strong>{type}</strong> leave from {from} to {to} has been <strong>{status}</strong>.<br><br>{comment}<br><br>Regards,<br>HR Team</div>`,
    task:`<div style="padding:0.5rem;"><strong style="color:var(--accent);">Subject:</strong> New Task Assigned<br><br>Hi <strong>{name}</strong>,<br><br>You have been assigned a new task: <strong>{task_title}</strong><br>Project: {project}<br>Due: {due_date}<br><br>Please log in to view details.<br><br>Thanks,<br>Nixers Team</div>`,
    payslip:`<div style="padding:0.5rem;"><strong style="color:var(--accent);">Subject:</strong> Your Payslip is Ready<br><br>Dear <strong>{name}</strong>,<br><br>Your payslip for <strong>{period}</strong> is ready.<br>Net Pay: <strong>{net_pay}</strong><br><br>Please log in to download.<br><br>Payroll Team</div>`,
  };
  if($('tplPreviewBox'))$('tplPreviewBox').innerHTML=previews[type]||'Select a template';
}

/* ============================================================
   35. EMAIL HELPER
   ============================================================ */
function sendEmail(to, subject, template){
  const entry={id:generateId('emailLog'),to,subject,template,sentAt:nowStr(),status:'sent'};
  DB.emailLog.unshift(entry);
  /* If EmailJS is configured, send real email */
  const s=DB.settings;
  if(s.ejsService&&s.ejsPublicKey&&window.emailjs){
    const tplId=s[`ejsTpl${template.split('_').map(w=>w[0].toUpperCase()+w.slice(1)).join('')}`]||template;
    window.emailjs.send(s.ejsService,tplId,{to_email:to,subject},{publicKey:s.ejsPublicKey})
      .catch(()=>{ entry.status='failed'; });
  }
}

/* ============================================================
   36. FLOATING CHAT WIDGET
   ============================================================ */
function initFloatChat(){
  $('fcBtn')?.addEventListener('click',()=>$('fcWidget').classList.toggle('open'));
  $('fcCloseBtn')?.addEventListener('click',()=>$('fcWidget').classList.remove('open'));
  $('fcSendBtn')?.addEventListener('click',sendFCMsg);
  $('fcInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')sendFCMsg();});
  /* initial message */
  addFCMsg('system','Hello! How can I help you today?');
}

function sendFCMsg(){
  const txt=$('fcInput')?.value.trim();if(!txt)return;
  addFCMsg('mine',txt);
  $('fcInput').value='';
  setTimeout(()=>addFCMsg('system','Got it! I\'ll look into that for you.'),600);
}

function addFCMsg(who,text){
  const box=$('fcMsgs');if(!box)return;
  const isSystem=who==='system';
  const div=document.createElement('div');
  div.style.cssText=`display:flex;gap:0.4rem;align-items:flex-end;${isSystem?'':'flex-direction:row-reverse;'}`;
  div.innerHTML=`<div style="max-width:80%;background:${isSystem?'var(--surface2)':'rgba(234,179,8,0.18)'};border-radius:12px;padding:0.5rem 0.75rem;font-size:0.8rem;line-height:1.4;">${text}</div>`;
  box.appendChild(div);box.scrollTop=box.scrollHeight;
}

/* ============================================================
   37. TOPBAR AVATAR SYNC
   ============================================================ */
function updateTopbarAvatar(){
  const u=currentUser;
  const topAv=$('topAvatar');
  const pdAv=$('pdAvatar');
  const sbAv=$('sbAvatar');
  if(!topAv)return;
  if(u.avatarImg){
    topAv.innerHTML=`<img src="${u.avatarImg}" alt="">`;
    if(pdAv)pdAv.innerHTML=`<img src="${u.avatarImg}" alt="">`;
    if(sbAv)sbAv.innerHTML=`<img src="${u.avatarImg}" alt="">`;
  } else {
    topAv.textContent=initials(u.name);
    topAv.style.background=u.avatarColor+'22';
    topAv.style.color=u.avatarColor;
    if(pdAv){pdAv.textContent=initials(u.name);pdAv.style.background=u.avatarColor+'22';pdAv.style.color=u.avatarColor;}
    if(sbAv){sbAv.textContent=initials(u.name);sbAv.style.background=u.avatarColor+'22';sbAv.style.color=u.avatarColor;}
  }
  if($('sbName'))$('sbName').textContent=u.name;
  if($('pdName'))$('pdName').textContent=u.name;
}

/* ============================================================
   38. SIDEBAR ADMIN CARD
   ============================================================ */
function initSidebarCard(){
  $('sbAdminCard')?.addEventListener('click',()=>openProfileModal(currentUser.id));
}

/* ============================================================
   39. KEYBOARD SHORTCUTS
   ============================================================ */
function initShortcuts(){
  document.addEventListener('keydown',e=>{
    if(e.altKey){
      const map={'d':'dashboard','u':'users','s':'sites','p':'posts','m':'messages','a':'analytics','t':'tasks'};
      if(map[e.key]){e.preventDefault();showPage(map[e.key]);}
    }
  });
}

/* ============================================================
   40. INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded',()=>{
  initTheme();
  initNav();
  initTopbar();
  initFloatChat();
  initSidebarCard();
  initShortcuts();
  updateTopbarAvatar();
  showPage('dashboard');
  /* Log login */
  logAction('login','system',`${currentUser.name} logged in`);
  console.log('%c NIXERS PRO ADMIN %c v2.0 ', 'background:#eab308;color:#0a0f1a;font-weight:800;padding:4px 8px;border-radius:4px 0 0 4px;','background:#111827;color:#eab308;font-weight:600;padding:4px 8px;border-radius:0 4px 4px 0;');
});
