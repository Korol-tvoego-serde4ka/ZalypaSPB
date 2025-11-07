// Progressive API bridge over the demo UI. Falls back to demo data only if API is unavailable.
(function(){
  // Globals and helpers (no demo data)
  if (typeof window.currentUser === 'undefined') {
    window.currentUser = null;
  }

  function sanitizeInput(i){
    const d=document.createElement('div');
    d.textContent=String(i ?? '');
    return d.innerHTML;
  }

  function showNotification(message,type='success'){
    const n=document.createElement('div');
    n.className=`notification ${type}`;
    n.textContent=message;
    document.body.appendChild(n);
    setTimeout(()=>{n.remove()},3000);
  }

  function showDashboard(role){
    document.getElementById('userDashboard').classList.remove('active');
    document.getElementById('resellerDashboard').classList.remove('active');
    document.getElementById('adminDashboard').classList.remove('active');
    if(role==='User'){
      document.getElementById('userDashboard').classList.add('active');
      const el = document.getElementById('userUsername'); if (el && currentUser) el.textContent=currentUser.username;
      loadUserProducts();
      loadLoaderRelease();
    } else if (role==='Reseller'){
      document.getElementById('resellerDashboard').classList.add('active');
      const el = document.getElementById('resellerUsername'); if (el && currentUser) el.textContent=currentUser.username;
      loadResellerUsers();
      loadResellerProducts();
      updateResellerStats();
    } else if (role==='Admin'){
      document.getElementById('adminDashboard').classList.add('active');
      const el = document.getElementById('adminUsername'); if (el && currentUser) el.textContent=currentUser.username;
      loadAdminUsers();
      loadAdminResellers();
      loadAdminLogs();
      updateAdminStats();
    }
  }

  function showSection(btn,sectionId){
    const dash=document.querySelector('.dashboard.active');
    if(dash){
      dash.querySelectorAll('.content-section').forEach(s=>s.classList.remove('active'));
      dash.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    }
    document.getElementById(sectionId).classList.add('active');
    if(btn) btn.classList.add('active');
    // Lazy load per section
    try {
      if (sectionId === 'userLoader') loadLoaderRelease();
      if (sectionId === 'userProducts') loadUserProducts();
      if (sectionId === 'userTelegram') loadUserTelegram();
      if (sectionId === 'resellerUsers') loadResellerUsers();
      if (sectionId === 'resellerProducts') loadResellerProducts();
      if (sectionId === 'resellerStatistics') updateResellerStats();
      if (sectionId === 'resellerTelegram') loadResellerTelegram();
      if (sectionId === 'adminUsers') loadAdminUsers();
      if (sectionId === 'adminResellers') loadAdminResellers();
      if (sectionId === 'adminLogs') loadAdminLogs();
      if (sectionId === 'adminSettings') updateAdminStats();
      if (sectionId === 'adminTelegram') { try { loadAdminTelegramSelf(); } catch(_){} try { loadAdminUnlinkRequests(); } catch(_){} }
      if (sectionId === 'adminInvites') loadAdminInvites();
      if (sectionId === 'adminLoader') loadAdminLoaderReleases();
      if (sectionId === 'adminProducts') loadAdminProducts();
    } catch(_) {}
  }

  window.openModal = function(id){ const el = document.getElementById(id); if (el) el.classList.add('active'); };
  window.closeModal = function(id){ const el = document.getElementById(id); if (el) el.classList.remove('active'); };

  async function api(path, opts={}){
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    if (!res.ok) {
      let err = null;
      try { err = await res.json(); } catch(_) {}
      const e = new Error('API error');
      e.status = res.status;
      e.payload = err;
      throw e;
    }
    return res.json();
  }

  function setLoginError(msg){
    const el = document.getElementById('loginError');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function setRegisterError(msg){
    const el = document.getElementById('registerError');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  window.showRegister = function(){
    const lf = document.getElementById('loginForm');
    const rf = document.getElementById('registerForm');
    const le = document.getElementById('loginError');
    const re = document.getElementById('registerError');
    if (lf) lf.classList.add('hidden');
    if (rf) rf.classList.remove('hidden');
    if (le) le.classList.add('hidden');
    if (re) re.classList.add('hidden');
  };

  // Admin: Loader releases list loader
  window.loadAdminLoaderReleases = async function(){
    const tbody = document.getElementById('adminLoaderReleasesTable');
    if (!tbody) return;
    tbody.innerHTML='';
    try {
      const resp = await api('/api/admin/loader/releases');
      (resp.items || []).forEach(rel => {
        const tr = document.createElement('tr');
        const created = rel.createdAt ? new Date(rel.createdAt).toLocaleString('ru-RU') : '';
        const fileUrl = rel.filePath || '';
        tr.innerHTML = `
          <td>${rel.id}</td>
          <td>${sanitizeInput(rel.version)}</td>
          <td><a href="${sanitizeInput(fileUrl)}" target="_blank" rel="noopener">${sanitizeInput(fileUrl.split('/').pop() || fileUrl)}</a></td>
          <td><code>${sanitizeInput((rel.checksum || '').slice(0, 16))}...</code></td>
          <td>${sanitizeInput(created)}</td>
          <td>
            <button class="btn-action" data-act="ldr-copy" data-url="${fileUrl}">Скопировать ссылку</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
      tbody.querySelectorAll('button[data-act="ldr-copy"]').forEach(btn => {
        btn.addEventListener('click', async (e)=>{
          const url = e.currentTarget.getAttribute('data-url');
          try { await navigator.clipboard.writeText(location.origin + url); showNotification('Ссылка скопирована', 'success'); } catch(_){ showNotification('Не удалось скопировать', 'error'); }
        });
      });
    } catch(_){ }
  };

  // Admin: Products list loader
  window.loadAdminProducts = async function(){
    const tbody = document.getElementById('adminProductsTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    try {
      const resp = await api('/api/admin/products');
      (resp.items || []).forEach(p => {
        const tr = document.createElement('tr');
        const price = ((p.priceCents || 0)/100).toLocaleString('ru-RU');
        tr.innerHTML = `
          <td>${p.id}</td>
          <td>${sanitizeInput(p.name)}</td>
          <td>₽${price}</td>
          <td>${p.defaultDurationDays || 0}</td>
          <td>${p.enabled ? 'Вкл' : 'Выкл'}</td>
          <td>
            <button class="btn-action" data-act="prod-edit" data-id="${p.id}">Изменить</button>
            <button class="btn-action" data-act="prod-toggle" data-id="${p.id}" data-enabled="${p.enabled ? '1':'0'}">${p.enabled ? 'Выключить' : 'Включить'}</button>
            <button class="btn-action btn-delete" data-act="prod-del" data-id="${p.id}">Удалить</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

  // Admin: upload loader form (multipart)
  document.addEventListener('DOMContentLoaded', () => {
    const f = document.getElementById('adminUploadLoaderForm');
    if (!f) return;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('adminLoaderMsg');
      if (msg) { msg.classList.add('hidden'); msg.textContent=''; }
      const fileEl = document.getElementById('ldrFile');
      const verEl = document.getElementById('ldrVersion');
      const sumEl = document.getElementById('ldrChecksum');
      if (!fileEl?.files?.[0] || !verEl?.value) { if (msg) { msg.textContent='Заполните версию и файл'; msg.classList.remove('hidden'); } return; }
      const fd = new FormData();
      fd.append('file', fileEl.files[0]);
      fd.append('version', verEl.value.trim());
      if (sumEl?.value) fd.append('checksum', sumEl.value.trim());
      try {
        const res = await fetch('/api/admin/loader/release', { method: 'POST', body: fd });
        if (!res.ok) throw new Error('upload_fail');
        await res.json();
        showNotification('Релиз загружен', 'success');
        try { await loadAdminLoaderReleases(); } catch(_){}
        verEl.value = '';
        fileEl.value = '';
        if (sumEl) sumEl.value = '';
      } catch(_) {
        if (msg) { msg.textContent='Ошибка загрузки'; msg.classList.remove('hidden'); }
        showNotification('Ошибка загрузки', 'error');
      }
    }, { capture: true });
  });
      tbody.querySelectorAll('button[data-act]').forEach(btn => {
        btn.addEventListener('click', async (e)=>{
          const id = Number(e.currentTarget.getAttribute('data-id'));
          const act = e.currentTarget.getAttribute('data-act');
          try {
            if (act === 'prod-edit') {
              const tr = e.currentTarget.closest('tr');
              const curName = tr.children[1].textContent.trim();
              const curPrice = tr.children[2].textContent.replace(/[₽\s]/g,'').replace(',', '.');
              const curDays = tr.children[3].textContent.trim();
              const name = prompt('Название:', curName);
              if (name == null) return;
              const priceRubStr = prompt('Цена (₽):', curPrice || '0');
              if (priceRubStr == null) return;
              const priceRub = Number(priceRubStr.replace(',', '.'));
              if (Number.isNaN(priceRub) || priceRub < 0) { showNotification('Некорректная цена', 'error'); return; }
              const daysStr = prompt('Срок по умолчанию (дней):', curDays || '30');
              if (daysStr == null) return;
              const days = Number(daysStr);
              if (!Number.isInteger(days) || days < 1) { showNotification('Некорректный срок', 'error'); return; }
              await api(`/api/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify({ name, priceCents: Math.round(priceRub*100), defaultDurationDays: days }) });
              showNotification('Продукт обновлён', 'success');
            } else if (act === 'prod-toggle') {
              const enabled = e.currentTarget.getAttribute('data-enabled') === '1';
              await api(`/api/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !enabled }) });
              showNotification('Статус изменён', 'success');
            } else if (act === 'prod-del') {
              if (!confirm('Удалить продукт?')) return;
              await api(`/api/admin/products/${id}`, { method: 'DELETE' });
              showNotification('Продукт удалён', 'success');
            }
            await loadAdminProducts();
          } catch(_) { showNotification('Ошибка операции', 'error'); }
        });
      });
    } catch(_){ }
  };

  // Admin: self Telegram panel
  window.loadAdminTelegramSelf = async function(){
    const container = document.getElementById('adminTelegramSelfContainer');
    if (!container) return;
    container.innerHTML = '<div class="loader-text">Загрузка...</div>';
    try {
      const status = await api('/api/telegram/link/status');
      await renderLinkInfo(container, status);
    } catch(_) { container.innerHTML = '<div class="error-message">Ошибка загрузки</div>'; }
  };

  window.showLogin = function(){
    const lf = document.getElementById('loginForm');
    const rf = document.getElementById('registerForm');
    const le = document.getElementById('loginError');
    const re = document.getElementById('registerError');
    if (rf) rf.classList.add('hidden');
    if (lf) lf.classList.remove('hidden');
    if (le) le.classList.add('hidden');
    if (re) re.classList.add('hidden');
  };

  // Try restore session on load
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const resp = await api('/api/auth/me');
      if (resp && resp.user) {
        currentUser = { username: resp.user.username, role: resp.user.role, passwordHash: 'api' };
        document.getElementById('loginPage').style.display = 'none';
        showDashboard(resp.user.role);
        if (resp.user.role === 'User') { try { await loadLoaderRelease(); } catch(_) {} }
      }
    } catch(_) { /* ignore if not logged in */ }
  });

  // Admin: create product form
  document.addEventListener('DOMContentLoaded', () => {
    const f = document.getElementById('adminCreateProductForm');
    if (!f) return;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('adminProductsMsg');
      if (msg) { msg.classList.add('hidden'); msg.textContent=''; }
      const name = (document.getElementById('apName')?.value || '').trim();
      const priceRub = Number(document.getElementById('apPrice')?.value || 0);
      const days = Number(document.getElementById('apDays')?.value || 30);
      const enabled = !!document.getElementById('apEnabled')?.checked;
      if (!name || Number.isNaN(priceRub) || priceRub < 0) { if (msg) { msg.textContent='Проверьте поля'; msg.classList.remove('hidden'); } return; }
      try {
        const payload = { name, priceCents: Math.round(priceRub * 100), defaultDurationDays: Math.max(1, days), enabled };
        await api('/api/admin/products', { method: 'POST', body: JSON.stringify(payload) });
        showNotification('Продукт создан', 'success');
        try { await loadAdminProducts(); } catch(_){}
        (document.getElementById('apName')||{}).value='';
        (document.getElementById('apPrice')||{}).value='';
        (document.getElementById('apDays')||{}).value='30';
        if (document.getElementById('apEnabled')) document.getElementById('apEnabled').checked = true;
      } catch (_) {
        if (msg) { msg.textContent='Ошибка создания продукта'; msg.classList.remove('hidden'); }
        showNotification('Ошибка создания продукта', 'error');
      }
    }, { capture: true });
  });

  // Intercept login form submit in capture phase to override demo login handler
  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loginForm');
    if (!form) return;
    const btnShowRegister = document.getElementById('btnShowRegister');
    if (btnShowRegister) btnShowRegister.addEventListener('click', ()=> window.showRegister());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const username = sanitizeInput(document.getElementById('username').value.trim());
      const password = document.getElementById('password').value;
      try {
        const resp = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
        currentUser = { username: resp.user.username, role: resp.user.role, passwordHash: 'api' };
        document.getElementById('loginPage').style.display = 'none';
        showDashboard(resp.user.role);
        if (resp.user.role === 'User') { try { await loadLoaderRelease(); } catch(_) {} }
        showNotification('Успешный вход в систему!', 'success');
      } catch (err) {
        setLoginError('Неверное имя пользователя или пароль');
      }
    }, { capture: true });
  });

  // Admin: create invites form
  document.addEventListener('DOMContentLoaded', () => {
    const f = document.getElementById('adminCreateInvitesForm');
    if (!f) return;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('adminInvitesMsg');
      if (msg) { msg.classList.add('hidden'); msg.textContent = ''; }
      const count = Number(document.getElementById('invCount')?.value || 1);
      const expiresDays = document.getElementById('invExpiresDays')?.value ? Number(document.getElementById('invExpiresDays').value) : undefined;
      const codesRaw = (document.getElementById('invCodes')?.value || '').trim();
      const codes = codesRaw ? codesRaw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean) : undefined;
      const payload = {};
      if (codes && codes.length) payload.codes = codes;
      else payload.count = Math.max(1, Math.min(100, count));
      if (expiresDays) payload.expiresDays = Math.max(1, expiresDays);
      try {
        const r = await api('/api/admin/invites', { method: 'POST', body: JSON.stringify(payload) });
        const items = r.items || [];
        showNotification(`Создано инвайтов: ${items.length}`, 'success');
        try { await loadAdminInvites(); } catch(_){}
      } catch (err) {
        if (msg) { msg.textContent = 'Ошибка создания инвайтов'; msg.classList.remove('hidden'); }
        showNotification('Ошибка создания инвайтов', 'error');
      }
    }, { capture: true });
  });

  // User: change password form
  document.addEventListener('DOMContentLoaded', () => {
    const f = document.getElementById('userChangePasswordForm');
    if (!f) return;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cur = document.getElementById('userCurrentPassword')?.value || '';
      const p1 = document.getElementById('userNewPassword')?.value || '';
      const p2 = document.getElementById('userNewPassword2')?.value || '';
      const msg = document.getElementById('userSettingsMsg');
      if (msg) { msg.classList.add('hidden'); msg.textContent = ''; }
      if (!p1 || p1.length < 6) { if (msg) { msg.textContent='Минимум 6 символов'; msg.classList.remove('hidden'); } return; }
      if (p1 !== p2) { if (msg) { msg.textContent='Пароли не совпадают'; msg.classList.remove('hidden'); } return; }
      try {
        const body = { newPassword: p1 };
        if (cur) body.currentPassword = cur;
        await api('/api/me/password', { method: 'POST', body: JSON.stringify(body) });
        showNotification('Пароль изменён', 'success');
        (document.getElementById('userCurrentPassword')||{}).value='';
        (document.getElementById('userNewPassword')||{}).value='';
        (document.getElementById('userNewPassword2')||{}).value='';
      } catch (e) {
        const code = e && e.payload && e.payload.error;
        let text = 'Ошибка изменения пароля';
        if (code === 'current_required') text = 'Нужен текущий пароль';
        else if (code === 'invalid_current') text = 'Текущий пароль неверен';
        if (msg) { msg.textContent = text; msg.classList.remove('hidden'); }
        showNotification(text, 'error');
      }
    }, { capture: true });
  });

  document.addEventListener('click', (e) => {
    const navBtn = e.target.closest('.nav-btn');
    if (navBtn && navBtn.dataset.section) {
      e.preventDefault();
      showSection(navBtn, navBtn.dataset.section);
      return;
    }
    const genericSectionBtn = e.target.closest('[data-section]');
    if (genericSectionBtn && genericSectionBtn.dataset.section) {
      e.preventDefault();
      showSection(null, genericSectionBtn.dataset.section);
      return;
    }
    const logoutBtn = e.target.closest('.btn-logout');
    if (logoutBtn) {
      e.preventDefault();
      window.logout();
      return;
    }
    const broadcastBtn = e.target.closest('#btnAdminBroadcast');
    if (broadcastBtn) {
      e.preventDefault();
      window.sendAdminBroadcast();
      return;
    }
    const botCheckBtn = e.target.closest('#btnCheckBot');
    if (botCheckBtn) {
      e.preventDefault();
      (async ()=>{
        const out = document.getElementById('adminBotStatusResult');
        if (out) out.textContent = 'Проверка бота...';
        try {
          const r = await api('/api/telegram/status');
          if (out) out.textContent = `OK. Бот @${r.username}`;
          showNotification('Бот доступен', 'success');
        } catch (e) {
          const msg = (e && e.payload && e.payload.error) || 'bot_error';
          if (out) out.textContent = `Ошибка: ${msg}`;
          showNotification('Ошибка проверки бота', 'error');
        }
      })();
      return;
    }
  }, { capture: true });

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('registerForm');
    if (!form) return;
    const btnShowLogin = document.getElementById('btnShowLogin');
    if (btnShowLogin) btnShowLogin.addEventListener('click', ()=> window.showLogin());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const username = sanitizeInput(document.getElementById('regUsername').value.trim());
      const email = document.getElementById('regEmail').value.trim();
      const password = document.getElementById('regPassword').value;
      const invite = document.getElementById('regInvite').value.trim();
      if (!invite) { setRegisterError('Введите код инвайта'); return; }
      try {
        const payload = { username, password, invite };
        if (email) payload.email = email;
        const resp = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
        currentUser = { username: resp.user.username, role: resp.user.role, passwordHash: 'api' };
        document.getElementById('loginPage').style.display = 'none';
        showDashboard(resp.user.role);
        if (resp.user.role === 'User') { try { await loadLoaderRelease(); } catch(_) {} }
        showNotification('Регистрация успешна', 'success');
      } catch (err) {
        let msg = 'Ошибка регистрации';
        const code = err && err.payload && err.payload.error;
        if (code === 'invite_not_found') msg = 'Инвайт не найден';
        else if (code === 'invite_revoked') msg = 'Инвайт отозван';
        else if (code === 'invite_used') msg = 'Инвайт уже использован';
        else if (code === 'invite_expired') msg = 'Инвайт истёк';
        else if (code === 'username_or_email_taken') msg = 'Имя пользователя или email уже заняты';
        setRegisterError(msg);
      }
    }, { capture: true });
  });

  // Loader release renderer
  window.loadLoaderRelease = async function(){
    const section = document.getElementById('userLoader');
    if (!section) return;
    try {
      const { version, url } = await api('/api/loader/latest');
      section.innerHTML = `
        <div class="loader-widget">
          <div class="loader-text">Последняя версия лоадера: v${sanitizeInput(version || '—')}</div>
          <div style="margin-top: 16px;">
            <a class="btn" href="${sanitizeInput(url)}">Скачать</a>
          </div>
        </div>
      `;
    } catch(e) {
      const code = e && e.payload && e.payload.error;
      if (e && e.status === 403 && code === 'telegram_required') {
        section.innerHTML = `
          <div class="loader-widget">
            <div class="loader-text">Чтобы скачать лоадер, привяжите Telegram к аккаунту.</div>
            <div style="margin-top: 16px;">
              <button class="btn" data-section="userTelegram">Привязать Telegram</button>
            </div>
          </div>
        `;
      } else {
        section.innerHTML = `<div class="error-message">Ошибка загрузки информации о лоадере</div>`;
      }
    }
  };

  // Admin: Invites list loader
  window.loadAdminInvites = async function(){
    const tbody = document.getElementById('adminInvitesTable');
    if (!tbody) return;
    tbody.innerHTML='';
    try {
      const resp = await api('/api/admin/invites');
      (resp.items || []).forEach(inv => {
        const tr = document.createElement('tr');
        const exp = inv.expiresAt ? new Date(inv.expiresAt).toLocaleString('ru-RU') : '—';
        const used = inv.usedById ? `Да (ID ${inv.usedById})` : 'Нет';
        tr.innerHTML = `
          <td>${inv.id}</td>
          <td><code>${sanitizeInput(inv.code)}</code></td>
          <td>${sanitizeInput(exp)}</td>
          <td>${sanitizeInput(used)}</td>
          <td>
            <button class="btn-action" data-act="inv-del" data-id="${inv.id}" ${inv.usedById ? 'disabled' : ''}>Удалить</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
      tbody.querySelectorAll('button[data-act="inv-del"]').forEach(btn => {
        btn.addEventListener('click', async (e)=>{
          const id = Number(e.currentTarget.getAttribute('data-id'));
          try { await api(`/api/admin/invites/${id}`, { method: 'DELETE' }); showNotification('Инвайт удалён', 'success'); await loadAdminInvites(); } catch(_){ showNotification('Ошибка удаления', 'error'); }
        });
      });
    } catch(_){ }
  };

  // Admin: Telegram broadcast
  window.sendAdminBroadcast = async function(){
    const textEl = document.getElementById('adminBroadcastText');
    const audEl = document.getElementById('adminBroadcastAudience');
    const grpEl = document.getElementById('adminBroadcastIncludeGroup');
    const resultEl = document.getElementById('adminBroadcastResult');
    if (!textEl || !audEl || !grpEl || !resultEl) return;
    const text = String(textEl.value || '').trim();
    if (!text) { showNotification('Введите текст сообщения', 'error'); return; }
    const audience = audEl.value;
    const include_group = !!grpEl.checked;
    const payload = { text, include_group };
    if (audience && audience !== 'all') payload.roles = [audience];
    resultEl.textContent = 'Отправка...';
    try {
      const resp = await api('/api/telegram/broadcast', { method: 'POST', body: JSON.stringify(payload) });
      resultEl.textContent = `Отправлено: ${resp.sent}, не удалось: ${resp.failed}, получателей: ${resp.recipients}`;
      showNotification('Рассылка завершена', 'success');
    } catch (e) {
      resultEl.textContent = 'Ошибка при отправке';
      showNotification('Ошибка при отправке', 'error');
    }
  };

  // Admin: load unlink requests
  window.loadAdminUnlinkRequests = async function(){
    const tbody = document.getElementById('adminUnlinkRequestsTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    try {
      const resp = await api('/api/telegram/unlink/requests');
      (resp.items || []).forEach(item => {
        const tr = document.createElement('tr');
        const dateStr = item.createdAt ? new Date(item.createdAt).toLocaleString('ru-RU') : '';
        tr.innerHTML = `
          <td>${item.id}</td>
          <td>${sanitizeInput(item.user.username)}</td>
          <td>${sanitizeInput(item.status)}</td>
          <td>${sanitizeInput(item.reason || '')}</td>
          <td>${sanitizeInput(dateStr)}</td>
          <td>
            <button class="btn-action" data-act="approve" data-id="${item.id}" ${item.status !== 'PENDING' ? 'disabled' : ''}>Одобрить</button>
            <button class="btn-action" data-act="reject" data-id="${item.id}" ${item.status !== 'PENDING' ? 'disabled' : ''}>Отклонить</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
      tbody.querySelectorAll('button[data-act]')?.forEach(btn => {
        btn.addEventListener('click', async (e)=>{
          const id = Number(e.currentTarget.getAttribute('data-id'));
          const act = e.currentTarget.getAttribute('data-act');
          try {
            if (act === 'approve') {
              await api(`/api/telegram/unlink/requests/${id}/approve`, { method: 'POST' });
              showNotification('Заявка одобрена', 'success');
            } else {
              const reason = prompt('Укажите причину отказа (опционально)') || '';
              await api(`/api/telegram/unlink/requests/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
              showNotification('Заявка отклонена', 'info');
            }
            await loadAdminUnlinkRequests();
          } catch(_) { showNotification('Ошибка обработки заявки', 'error'); }
        });
      });
    } catch(_) {}
  };

  // Telegram panels
  async function renderLinkInfo(container, status){
    container.innerHTML = '';
    const wrap = document.createElement('div');
    if (status.linked) {
      wrap.innerHTML = `
        <div class="card">
          <div class="card-title">Статус</div>
          <div class="card-value">Привязан</div>
          <div class="card-subtitle">Telegram ID: ${sanitizeInput(status.telegramId || '')}</div>
        </div>
        <div style="margin-top:16px;">
          <button class="btn" id="btnUnlink">Отвязать Telegram</button>
        </div>
      `;
      container.appendChild(wrap);
      const btn = wrap.querySelector('#btnUnlink');
      if (btn) btn.addEventListener('click', async ()=>{
        const reason = prompt('Укажите причину отвязки (опционально)') || '';
        try { await api('/api/telegram/link/unlink', { method: 'POST', body: JSON.stringify({ reason }) }); showNotification('Заявка на отвязку отправлена', 'success'); } catch(_) { showNotification('Ошибка', 'error'); }
        await loadUserTelegram().catch(()=>{});
        await loadResellerTelegram().catch(()=>{});
      });
    } else {
      wrap.innerHTML = `
        <div class="card">
          <div class="card-title">Статус</div>
          <div class="card-value">Не привязан</div>
          <div class="card-subtitle">Нажмите, чтобы получить ссылку для привязки</div>
        </div>
        <div style="margin-top:16px;">
          <button class="btn" id="btnStartLink">Привязать Telegram</button>
        </div>
        <div id="linkResult" style="margin-top:12px;"></div>
      `;
      container.appendChild(wrap);
      const btn = wrap.querySelector('#btnStartLink');
      if (btn) btn.addEventListener('click', async ()=>{
        const resCont = wrap.querySelector('#linkResult');
        try {
          const data = await api('/api/telegram/link/start', { method: 'POST' });
          const link = sanitizeInput(data.link);
          const code = sanitizeInput(data.code);
          resCont.innerHTML = `
            <div>Ссылка для привязки:</div>
            <div style="margin-top:6px;"><a class="btn" href="${link}" target="_blank" rel="noopener">Открыть бота</a></div>
            <div style="margin-top:8px;">Код: <code>${code}</code> <button class="btn" id="btnCopyCode">Копировать</button></div>
          `;
          const copyBtn = wrap.querySelector('#btnCopyCode');
          if (copyBtn) copyBtn.addEventListener('click', async ()=>{
            try { await navigator.clipboard.writeText(data.code); showNotification('Скопировано', 'success'); } catch(_) {}
          });
        } catch(_) {
          resCont.textContent = 'Ошибка. Попробуйте позже.';
        }
      });
    }
  }

  window.loadUserTelegram = async function(){
    const container = document.getElementById('userTelegramContainer');
    if (!container) return;
    container.innerHTML = '<div class="loader-text">Загрузка...</div>';
    try {
      const status = await api('/api/telegram/link/status');
      await renderLinkInfo(container, status);
    } catch(_) { container.innerHTML = '<div class="error-message">Ошибка загрузки</div>'; }
  };

  window.loadResellerTelegram = async function(){
    const container = document.getElementById('resellerTelegramContainer');
    if (!container) return;
    container.innerHTML = '<div class="loader-text">Загрузка...</div>';
    try {
      const status = await api('/api/telegram/link/status');
      await renderLinkInfo(container, status);
    } catch(_) { container.innerHTML = '<div class="error-message">Ошибка загрузки</div>'; }
  };

  // Override logout to call API
  window.logout = async function(){
    try { await api('/api/auth/logout', { method: 'POST' }); } catch(_) {}
    currentUser = null;
    document.getElementById('userDashboard').classList.remove('active');
    document.getElementById('resellerDashboard').classList.remove('active');
    document.getElementById('adminDashboard').classList.remove('active');
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('loginForm').reset();
    const rf=document.getElementById('registerForm'); if (rf) rf.classList.add('hidden');
    const lf=document.getElementById('loginForm'); if (lf) lf.classList.remove('hidden');
    document.getElementById('loginError').classList.add('hidden');
    const re=document.getElementById('registerError'); if (re) re.classList.add('hidden');
    showNotification('Вы вышли из системы', 'info');
  };

  // API-backed data loaders overriding demo ones
  window.loadUserProducts = async function(){
    const container = document.getElementById('userProductsList');
    if (!container) return;
    container.innerHTML = '';
    try {
      const resp = await api('/api/products');
      (resp.items || []).forEach(product => {
        const card = document.createElement('div');
        card.className = 'product-card';
        const cents = (product.price_cents ?? product.priceCents) || 0;
        const price = (cents/100).toLocaleString('ru-RU');
        card.innerHTML = `
          <div class="product-name">${sanitizeInput(product.name)}</div>
          <div class="product-info">Тип: ${sanitizeInput(product.type || '')}</div>
          <div class="product-info">Цена: ₽${price}</div>
        `;
        container.appendChild(card);
      });
    } catch(_) {
      // silent fallback: keep empty or demo
    }
  };

  window.loadResellerUsers = async function(){
    const tbody = document.getElementById('resellerUsersTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    try {
      const resp = await api('/api/reseller/users');
      (resp.items || []).forEach(user => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${user.id}</td>
          <td>${sanitizeInput(user.username)}</td>
          <td>${sanitizeInput(user.email)}</td>
          <td>${sanitizeInput(user.status)}</td>
          <td>
            <button class="btn-action btn-edit" data-act="res-user-edit" data-id="${user.id}">Редактировать</button>
            <button class="btn-action btn-delete" data-act="res-user-del" data-id="${user.id}">Удалить</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
      tbody.querySelectorAll('button[data-act]')?.forEach(btn => {
        btn.addEventListener('click', (ev)=>{
          const act = ev.currentTarget.getAttribute('data-act');
          if (act === 'res-user-edit') showNotification('Редактирование позже', 'info');
          if (act === 'res-user-del') showNotification('Удаление позже', 'info');
        });
      });
    } catch(_) {}
  };

  window.loadResellerProducts = async function(){
    const tbody = document.getElementById('resellerProductsTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    try {
      const resp = await api('/api/reseller/products');
      (resp.items || []).forEach(product => {
        const tr = document.createElement('tr');
        const cents = (product.price_cents ?? product.priceCents) || 0;
        const price = (cents/100).toLocaleString('ru-RU');
        tr.innerHTML = `
          <td>${product.id}</td>
          <td>${sanitizeInput(product.name)}</td>
          <td>${sanitizeInput(product.type || '')}</td>
          <td>₽${price}</td>
          <td>
            <button class="btn-action" data-act="res-prod-buy" data-id="${product.id}">Купить ключ</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
      tbody.querySelectorAll('button[data-act]')?.forEach(btn => {
        btn.addEventListener('click', async (ev)=>{
          const act = ev.currentTarget.getAttribute('data-act');
          const id = Number(ev.currentTarget.getAttribute('data-id'));
          if (act === 'res-prod-buy') {
            try {
              const resp = await api('/api/reseller/keys/buy', { method: 'POST', body: JSON.stringify({ productId: id }) });
              const token = resp && resp.key && resp.key.token ? resp.key.token : null;
              if (token) {
                try { await navigator.clipboard.writeText(token); } catch(_){ }
                showNotification('Ключ куплен и скопирован в буфер', 'success');
              } else {
                showNotification('Ключ куплен', 'success');
              }
              try { await updateResellerStats(); } catch(_){ }
            } catch (e) {
              const code = e && e.payload && e.payload.error;
              if (code === 'insufficient_balance') showNotification('Недостаточно средств', 'error');
              else if (code === 'no_keys_available') showNotification('Нет доступных ключей', 'error');
              else showNotification('Ошибка покупки', 'error');
            }
          }
        });
      });
    } catch(_) {}
  };

  window.updateResellerStats = async function(){
    try {
      const [uResp, pResp] = await Promise.all([
        api('/api/reseller/users'), api('/api/reseller/products')
      ]);
      document.getElementById('resellerUserCount').textContent = (uResp.items || []).length;
      document.getElementById('resellerProductCount').textContent = (pResp.items || []).length;
    } catch(_){}
  };

  window.updateAdminStats = async function(){
    try {
      const [uResp, lResp] = await Promise.all([
        api('/api/admin/users'), api('/api/admin/logs')
      ]);
      const users = uResp.items || [];
      const logs = lResp.items || [];
      const uEl = document.getElementById('adminTotalUsers');
      const rEl = document.getElementById('adminTotalResellers');
      const lEl = document.getElementById('adminTotalLogs');
      if (uEl) uEl.textContent = users.length;
      if (rEl) rEl.textContent = users.filter(u => u.role === 'Reseller').length;
      if (lEl) lEl.textContent = logs.length;
    } catch(_){}
  };

  window.loadAdminUsers = async function(){
    const tbody = document.getElementById('adminUsersTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    try {
      const resp = await api('/api/admin/users');
      (resp.items || []).forEach(user => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${user.id}</td>
          <td>${sanitizeInput(user.username)}</td>
          <td>${sanitizeInput(user.role)}</td>
          <td>${sanitizeInput(user.email)}</td>
          <td><span style="color: ${user.status === 'Активен' ? '#4CAF50' : '#f44336'}">${sanitizeInput(user.status)}</span></td>
          <td>
            <div class="btn-group">
              <button class="btn-action" data-act="adm-user-${user.status === 'Активен' ? 'block' : 'unblock'}" data-id="${user.id}">${user.status === 'Активен' ? 'Блокировать' : 'Разблокировать'}</button>
              <button class="btn-action" data-act="adm-user-role" data-id="${user.id}" data-role="User">User</button>
              <button class="btn-action" data-act="adm-user-role" data-id="${user.id}" data-role="Reseller">Reseller</button>
              <button class="btn-action" data-act="adm-user-role" data-id="${user.id}" data-role="Admin">Admin</button>
              <button class="btn-action" data-act="adm-user-pass" data-id="${user.id}">Сброс пароля</button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
      });
      tbody.querySelectorAll('button[data-act]')?.forEach(btn => {
        btn.addEventListener('click', async (ev)=>{
          const act = ev.currentTarget.getAttribute('data-act');
          const id = Number(ev.currentTarget.getAttribute('data-id'));
          try {
            if (act === 'adm-user-block') {
              await api(`/api/admin/users/${id}/block`, { method: 'POST' });
              showNotification('Пользователь блокирован', 'success');
              return loadAdminUsers();
            }
            if (act === 'adm-user-unblock') {
              await api(`/api/admin/users/${id}/unblock`, { method: 'POST' });
              showNotification('Пользователь разблокирован', 'success');
              return loadAdminUsers();
            }
            if (act === 'adm-user-role') {
              const role = ev.currentTarget.getAttribute('data-role');
              await api(`/api/admin/users/${id}/role`, { method: 'POST', body: JSON.stringify({ role }) });
              showNotification('Роль обновлена', 'success');
              return loadAdminUsers();
            }
            if (act === 'adm-user-pass') {
              const pwd = prompt('Введите новый пароль (минимум 6 символов)');
              if (!pwd || pwd.length < 6) { showNotification('Пароль не изменён', 'info'); return; }
              await api(`/api/admin/users/${id}/password`, { method: 'POST', body: JSON.stringify({ password: pwd }) });
              showNotification('Пароль обновлён', 'success');
              return;
            }
          } catch(_) {
            showNotification('Ошибка выполнения действия', 'error');
          }
        });
      });
    } catch(_){}
  };

  window.loadAdminResellers = async function(){
    try{
      const resp = await api('/api/admin/resellers');
      const items = resp.items || [];
      const tbody = document.getElementById('adminResellersTable');
      if (!tbody) return;
      tbody.innerHTML='';
      items.forEach(r => {
        const tr = document.createElement('tr');
        const balRub = ((r.balanceCents || 0)/100).toLocaleString('ru-RU');
        const statusColor = r.status === 'Активен' ? '#4CAF50' : '#f44336';
        tr.innerHTML = `
          <td>${r.id}</td>
          <td>${sanitizeInput(r.username)}</td>
          <td>${sanitizeInput(r.email || '')}</td>
          <td><span style="color:${statusColor}">${sanitizeInput(r.status)}</span></td>
          <td>₽${balRub}</td>
          <td>
            <button class="btn-action" data-act="res-bal" data-id="${r.id}">Изменить баланс</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
      tbody.querySelectorAll('button[data-act="res-bal"]').forEach(btn => {
        btn.addEventListener('click', async (e)=>{
          const id = Number(e.currentTarget.getAttribute('data-id'));
          const curText = e.currentTarget.closest('tr').children[4].textContent.replace(/[₽\s]/g,'').replace(',', '.');
          const val = prompt('Новый баланс (₽):', curText || '0');
          if (val == null) return;
          const rub = Number(val.replace(',', '.'));
          if (Number.isNaN(rub) || rub < 0) { showNotification('Некорректная сумма', 'error'); return; }
          try { await api(`/api/admin/resellers/${id}/balance`, { method: 'POST', body: JSON.stringify({ balanceCents: Math.round(rub*100) }) }); showNotification('Баланс обновлён', 'success'); await loadAdminResellers(); } catch(_){ showNotification('Ошибка обновления', 'error'); }
        });
      });
    } catch(_){ }
  };

  window.loadAdminLogs = async function(){
    const container = document.getElementById('adminLogsContainer');
    if (!container) return;
    container.innerHTML = '';
    try {
      const resp = await api('/api/admin/logs');
      (resp.items || []).forEach(log => {
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        logEntry.innerHTML = `
          <div class="log-header">
            <span class="log-user">${sanitizeInput(log.who)}</span>
            <span class="log-time">${sanitizeInput(log.when)}</span>
          </div>
          <div class="log-action">${sanitizeInput(log.what)}</div>
        `;
        container.appendChild(logEntry);
      });
    } catch(_) {}
  };
})();
