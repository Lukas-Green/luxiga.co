/* ============================================================
   LUXIGA CRM — Admin panel logic
   Ported from Golden Goose Construction's admin portal, reskinned for
   LUXIGA and rewired onto the same-origin /api/admin/* contract.

   Identity is owned by Cloudflare Access at the perimeter: anyone who can
   load this page has already authenticated with email OTP. There is no
   client-side auth here.

   Data layer: plain same-origin fetch() with credentials. Every response
   is read tolerantly — a list may arrive as {contacts:[…]}, {records:[…]},
   or a bare array; a record may be a flat object or an Airtable-style
   {fields:{…}}. When the Worker isn't reachable yet, tables fall back to a
   clean empty state instead of a blank screen.
   ============================================================ */

(function () {
  'use strict';

  var API_BASE = '/api/admin';

  // LUXIGA domain vocabulary (differs from GGC).
  var CONTACT_STAGES = ['New', 'Contacted', 'Discovery Call', 'Proposal Sent', 'Active Client', 'Repeat / Referral', 'Lost'];
  var CONTACT_SOURCES = ['Card Scan', 'Referral', 'Web Form', 'Pulse', 'Partner', 'Manual'];
  var INTERACTION_TYPES = ['Call', 'Text', 'Email', 'Note', 'Meeting'];
  var CONSENT_LEVELS = ['none', 'implied', 'express'];
  var OWNER = 'Lukas'; // solo studio — no owner picker.

  // stage -> { badge class suffix, pipeline color }
  var STAGE_META = {
    'New':               { cls: 'new',       color: '#C4FF53' },
    'Contacted':         { cls: 'contacted', color: '#8B5CF6' },
    'Discovery Call':    { cls: 'discovery', color: '#a78bfa' },
    'Proposal Sent':     { cls: 'proposal',  color: '#fbbf24' },
    'Active Client':     { cls: 'active',    color: '#4ade80' },
    'Repeat / Referral': { cls: 'repeat',    color: '#86efac' },
    'Lost':              { cls: 'lost',       color: '#5a5a6a' }
  };

  // ---- fetch helpers -------------------------------------------------------
  function apiGet(path) {
    return fetch(API_BASE + path, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function apiSend(method, path, body) {
    return fetch(API_BASE + path, {
      method: method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json().catch(function () { return {}; });
    });
  }

  // Pull a list out of a response no matter which envelope the Worker used.
  function listFrom(data, primaryKey) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (primaryKey && Array.isArray(data[primaryKey])) return data[primaryKey];
    if (Array.isArray(data.records)) return data.records;
    if (Array.isArray(data.data)) return data.data;
    return [];
  }

  // A record may be flat or Airtable-style {fields:{…}}.
  function fields(rec) { return rec && rec.fields ? rec.fields : (rec || {}); }
  function recId(rec) { return (rec && rec.id) || fields(rec).id || ''; }

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function fmtDate(v) {
    if (!v) return '—';
    var d = new Date(v);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
  }
  function fmtDateTime(v) {
    if (!v) return '';
    var d = new Date(v);
    return isNaN(d.getTime()) ? '' : d.toLocaleString();
  }

  function stageBadge(stage) {
    var s = stage || 'New';
    var meta = STAGE_META[s] || STAGE_META['New'];
    return '<span class="badge badge--' + meta.cls + '">' + escapeHTML(s) + '</span>';
  }

  var ADMIN = {
    contacts: [],
    interactions: [],
    campaigns: [],
    suppression: [],
    campaignConfig: null,
    _offline: false,
    _noticeShown: false,

    // ---- Init ----
    init: function () {
      this.initCloudflareBanner();
      this.initTabs();
      this.loadData();
    },

    logout: function () {
      window.location.href = '/cdn-cgi/access/logout';
    },

    // Reads /cdn-cgi/access/get-identity to populate the "signed in as" banner.
    // 404s in local dev (no Cloudflare in front) — banner stays hidden, no error.
    initCloudflareBanner: function () {
      fetch('/cdn-cgi/access/get-identity', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data || !data.email) return;
          var banner = document.getElementById('cfAccessBanner');
          var emailEl = document.getElementById('cfAccessEmail');
          if (banner && emailEl) {
            emailEl.textContent = data.email;
            banner.style.display = 'block';
          }
        })
        .catch(function () { /* swallow — banner stays hidden */ });
    },

    // ---- Tabs ----
    initTabs: function () {
      var self = this;
      document.querySelectorAll('.admin-tab').forEach(function (tab) {
        tab.addEventListener('click', function () { self.switchTab(tab.dataset.tab); });
      });
    },

    switchTab: function (tabName) {
      document.querySelectorAll('.admin-tab').forEach(function (t) {
        t.classList.toggle('active', t.dataset.tab === tabName);
      });
      document.querySelectorAll('.admin-content').forEach(function (c) {
        c.style.display = c.id === 'tab-' + tabName ? '' : 'none';
      });
    },

    // ---- Load ----
    // Contacts + interactions drive the dashboard and Contacts tab. Campaign
    // data (campaigns, suppression, channel config) loads in parallel and
    // feeds the Campaigns tab plus the "Campaigns Sent" dashboard card.
    loadData: function () {
      var self = this;
      Promise.all([
        apiGet('/contacts').catch(function () { self._offline = true; return null; }),
        apiGet('/interactions').catch(function () { return null; })
      ]).then(function (res) {
        self.contacts = listFrom(res[0], 'contacts');
        self.interactions = listFrom(res[1], 'interactions');
        self.renderDashboard();
        self.renderContacts();
        if (self._offline) self.showOfflineNotice();
      });
      this.loadCampaignData();
    },

    loadCampaignData: function () {
      var self = this;
      Promise.all([
        apiGet('/campaigns').catch(function () { return null; }),
        apiGet('/suppression').catch(function () { return null; }),
        apiGet('/campaign-config').catch(function () { return null; })
      ]).then(function (res) {
        self.campaigns = listFrom(res[0], 'campaigns');
        self.suppression = listFrom(res[1], 'suppression');
        self.campaignConfig = res[2] || null;
        self.renderCampaigns();
        self.renderSuppression();
        self.renderProviderBadge();
        self.renderDashboard(); // refresh "Campaigns Sent"
      });
    },

    showOfflineNotice: function () {
      if (this._noticeShown) return;
      this._noticeShown = true;
      var notice = document.createElement('div');
      notice.className = 'notice';
      notice.innerHTML =
        '<strong>CRM backend not reachable.</strong> Showing empty states. ' +
        'Most likely the Worker isn\'t deployed yet, or your Cloudflare Access ' +
        'session expired (try <a href="/cdn-cgi/access/logout">signing out</a> and back in).';
      var tabs = document.querySelector('.admin-tabs');
      if (tabs && tabs.after) tabs.after(notice);
    },

    // ---- Dashboard ----
    _isOverdue: function (f) {
      if (!f.next_follow_up_date || f.stage === 'Lost') return false;
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var d = new Date(f.next_follow_up_date);
      return !isNaN(d.getTime()) && d <= today;
    },

    renderDashboard: function () {
      var stageCounts = {};
      CONTACT_STAGES.forEach(function (s) { stageCounts[s] = 0; });
      var total = 0, activeClients = 0, newCount = 0, dueCount = 0;
      var self = this;

      this.contacts.forEach(function (rec) {
        var f = fields(rec);
        var stage = f.stage || 'New';
        total++;
        if (stageCounts[stage] !== undefined) stageCounts[stage]++;
        if (stage === 'Active Client') activeClients++;
        if (stage === 'New') newCount++;
        if (self._isOverdue(f)) dueCount++;
      });

      var sentCampaigns = this.campaigns.filter(function (rec) {
        var st = (fields(rec).status || '').toLowerCase();
        return st === 'sent';
      }).length;

      var el = function (id) { return document.getElementById(id); };
      if (el('dashContacts')) el('dashContacts').textContent = total.toLocaleString();
      if (el('dashActive')) el('dashActive').textContent = activeClients.toLocaleString();
      if (el('dashNew')) el('dashNew').textContent = newCount.toLocaleString();
      if (el('dashDue')) el('dashDue').textContent = dueCount.toLocaleString();
      if (el('dashCampaigns')) el('dashCampaigns').textContent = sentCampaigns.toLocaleString();

      this.renderPipeline(stageCounts, total);
      this.renderRecentInteractions();
    },

    renderPipeline: function (stageCounts, total) {
      var bar = document.getElementById('pipelineBar');
      var legend = document.getElementById('pipelineLegend');
      if (!bar || !legend) return;

      if (!total) {
        bar.innerHTML = '<div class="pipeline-empty">No contacts yet</div>';
        legend.innerHTML = '';
        return;
      }
      bar.innerHTML = '';
      legend.innerHTML = '';
      CONTACT_STAGES.forEach(function (stage) {
        var count = stageCounts[stage] || 0;
        if (!count) return;
        var meta = STAGE_META[stage];
        var pct = Math.round((count / total) * 100);
        var div = document.createElement('div');
        div.style.width = Math.max(pct, 4) + '%';
        div.style.background = meta.color;
        div.textContent = count;
        div.title = stage + ': ' + count + ' (' + pct + '%)';
        bar.appendChild(div);

        var span = document.createElement('span');
        span.innerHTML = '<span class="dot" style="background:' + meta.color + '"></span>' +
          escapeHTML(stage) + ' (' + count + ')';
        legend.appendChild(span);
      });
    },

    _contactName: function (contactId) {
      var rec = this.contacts.find(function (r) { return recId(r) === contactId; });
      return rec ? (fields(rec).name || 'Unknown') : '';
    },

    renderRecentInteractions: function () {
      var host = document.getElementById('recentInteractions');
      if (!host) return;
      var self = this;

      if (!this.interactions.length) {
        host.innerHTML = '<div class="table-empty">No interactions logged yet.</div>';
        return;
      }
      var list = this.interactions.slice().sort(function (a, b) {
        return (fields(b).date || '').localeCompare(fields(a).date || '');
      }).slice(0, 6);

      host.innerHTML = list.map(function (rec) {
        var i = fields(rec);
        var link = i.contact;
        var cid = Array.isArray(link) ? link[0] : link;
        var who = self._contactName(cid);
        var when = fmtDateTime(i.date);
        var meta = [i.type, i.direction, when].filter(Boolean).join(' · ');
        return '<div class="list-row">' +
          '<span><span class="lr-name">' + escapeHTML(who || '—') + '</span>' +
            (i.summary ? '<div class="lr-meta">' + escapeHTML(i.summary) + '</div>' : '') + '</span>' +
          '<span class="lr-meta">' + escapeHTML(meta) + '</span>' +
        '</div>';
      }).join('');
    },

    // ---- Contacts ----
    _contactById: function (id) {
      return this.contacts.find(function (r) { return recId(r) === id; });
    },

    _interactionsFor: function (contactId) {
      return this.interactions.filter(function (rec) {
        var link = fields(rec).contact;
        if (Array.isArray(link)) return link.indexOf(contactId) !== -1;
        return link === contactId;
      });
    },

    renderContacts: function () {
      var tbody = document.getElementById('contactsBody');
      if (!tbody) return;
      var badge = document.getElementById('contactsCountBadge');
      if (badge) badge.textContent = this.contacts.length ? '(' + this.contacts.length + ')' : '';

      this.renderNewContacts();
      this.renderFollowupsDue();

      if (!this.contacts.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No contacts yet. Click <strong>+ New Contact</strong> to add one, or <strong>Import</strong> to pull in inbound leads.</td></tr>';
        return;
      }

      var q = ((document.getElementById('contactSearch') || {}).value || '').trim().toLowerCase();
      var list = this.contacts.slice();
      if (q) {
        list = list.filter(function (rec) {
          var f = fields(rec);
          return [f.name, f.phone, f.email].filter(Boolean).join(' ').toLowerCase().indexOf(q) !== -1;
        });
      }
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No contacts match that search.</td></tr>';
        return;
      }

      // Soonest follow-up first; contacts without a date fall to the bottom, by name.
      list.sort(function (a, b) {
        var fa = fields(a), fb = fields(b);
        var da = fa.next_follow_up_date || '', db = fb.next_follow_up_date || '';
        if (da && db) return da.localeCompare(db);
        if (da) return -1;
        if (db) return 1;
        return (fa.name || '').localeCompare(fb.name || '');
      });

      var self = this;
      tbody.innerHTML = list.map(function (rec) {
        var f = fields(rec);
        var id = recId(rec);
        var contactCell = [
          f.phone ? escapeHTML(f.phone) : '',
          f.email ? '<span class="cell-sub">' + escapeHTML(f.email) + '</span>' : ''
        ].filter(Boolean).join('') || '—';
        var overdue = self._isOverdue(f);
        return '<tr>' +
          '<td class="cell-strong">' + escapeHTML(f.name || '—') + '</td>' +
          '<td>' + contactCell + '</td>' +
          '<td>' + stageBadge(f.stage) + '</td>' +
          '<td' + (overdue ? ' class="cell-due"' : '') + '>' + fmtDate(f.next_follow_up_date) + '</td>' +
          '<td>' + fmtDate(f.last_contacted) + '</td>' +
          '<td class="table-actions"><button class="btn btn-sm btn-outline" onclick="ADMIN.openContact(\'' + escapeHTML(id) + '\')">Open</button></td>' +
        '</tr>';
      }).join('');
    },

    renderNewContacts: function () {
      var card = document.getElementById('newContactsCard');
      var body = document.getElementById('newContactsBody');
      if (!card || !body) return;
      var fresh = this.contacts.filter(function (rec) {
        return (fields(rec).stage || 'New') === 'New';
      });
      if (!fresh.length) { card.style.display = 'none'; return; }
      fresh.sort(function (a, b) {
        return (fields(b).last_contacted || '').localeCompare(fields(a).last_contacted || '')
          || (fields(a).name || '').localeCompare(fields(b).name || '');
      });
      card.style.display = '';
      body.innerHTML =
        '<div class="callout-lead">' + fresh.length + ' contact' + (fresh.length === 1 ? '' : 's') + ' waiting for a first touch.</div>' +
        fresh.map(function (rec) {
          var f = fields(rec);
          var id = recId(rec);
          return '<div class="list-row">' +
            '<span><span class="lr-name">' + escapeHTML(f.name || '') + '</span>' +
              (f.phone ? ' <span class="lr-meta">' + escapeHTML(f.phone) + '</span>' : '') + '</span>' +
            '<button class="btn btn-sm btn-outline" onclick="ADMIN.openContact(\'' + escapeHTML(id) + '\')">Open</button>' +
          '</div>';
        }).join('');
    },

    renderFollowupsDue: function () {
      var card = document.getElementById('followupsDueCard');
      var body = document.getElementById('followupsDueBody');
      if (!card || !body) return;
      var self = this;
      var due = this.contacts.filter(function (rec) { return self._isOverdue(fields(rec)); });
      if (!due.length) { card.style.display = 'none'; return; }
      due.sort(function (a, b) {
        return (fields(a).next_follow_up_date || '').localeCompare(fields(b).next_follow_up_date || '');
      });
      card.style.display = '';
      body.innerHTML = due.map(function (rec) {
        var f = fields(rec);
        var id = recId(rec);
        return '<div class="list-row">' +
          '<span class="lr-name">' + escapeHTML(f.name || '') + '</span>' +
          '<span class="lr-right"><span class="cell-due" style="font-size:.8rem;">due ' + fmtDate(f.next_follow_up_date) + '</span>' +
          '<button class="btn btn-sm btn-outline" onclick="ADMIN.openContact(\'' + escapeHTML(id) + '\')">Open</button></span>' +
        '</div>';
      }).join('');
    },

    // Best-effort backfill from inbound leads. Keeps the button even though the
    // Worker may no-op it.
    importFromLeads: function () {
      var self = this;
      var btn = document.getElementById('importLeadsBtn');
      var status = document.getElementById('importStatus');
      if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
      if (status) { status.style.display = ''; status.classList.remove('err', 'ok'); status.textContent = 'Importing leads into contacts…'; }

      apiSend('POST', '/import-leads-to-contacts', {}).then(function (res) {
        var created = res.created || 0, updated = res.updated || 0;
        if (status) {
          status.classList.add('ok');
          status.textContent = 'Done. ' + created + ' new, ' + updated + ' updated. Refreshing…';
        }
        self.loadData();
        setTimeout(function () {
          if (btn) { btn.disabled = false; btn.textContent = 'Import'; }
          if (status) setTimeout(function () { status.style.display = 'none'; }, 4000);
        }, 700);
      }).catch(function (err) {
        if (status) { status.classList.add('err'); status.textContent = 'Import unavailable: ' + err.message; }
        if (btn) { btn.disabled = false; btn.textContent = 'Import'; }
      });
    },

    openContact: function (id) {
      var rec = this._contactById(id);
      if (!rec) return;
      var f = fields(rec);
      var esc = escapeHTML(id);

      var stageOpts = CONTACT_STAGES.map(function (s) {
        return '<option value="' + escapeHTML(s) + '"' + ((f.stage || 'New') === s ? ' selected' : '') + '>' + escapeHTML(s) + '</option>';
      }).join('');
      var sourceOpts = CONTACT_SOURCES.map(function (s) {
        return '<option value="' + escapeHTML(s) + '"' + ((f.source || '') === s ? ' selected' : '') + '>' + escapeHTML(s) + '</option>';
      }).join('');
      var typeOpts = INTERACTION_TYPES.map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('');

      var timeline = this._interactionsFor(id).slice().sort(function (a, b) {
        return (fields(b).date || '').localeCompare(fields(a).date || '');
      });
      var timelineHTML = timeline.length ? timeline.map(function (rec2) {
        var i = fields(rec2);
        var meta = [fmtDateTime(i.date), i.type, i.direction, i.logged_by].filter(Boolean).join(' · ');
        return '<div class="timeline-item">' +
          '<div class="timeline-meta">' + escapeHTML(meta) + '</div>' +
          (i.summary ? '<div>' + escapeHTML(i.summary) + '</div>' : '') +
          (i.next_action ? '<div class="timeline-next">Next: ' + escapeHTML(i.next_action) + '</div>' : '') +
        '</div>';
      }).join('') : '<div class="table-empty" style="padding:1rem 0;">No interactions logged yet.</div>';

      var contactLine = [
        f.phone ? escapeHTML(f.phone) : '',
        f.email ? escapeHTML(f.email) : ''
      ].filter(Boolean).join(' · ');
      var addrLine = [f.address, f.city].filter(Boolean).join(', ');

      document.getElementById('modalBody').innerHTML =
        '<h2>' + escapeHTML(f.name || 'Contact') + '</h2>' +
        '<p class="modal-sub">' + contactLine + (addrLine ? (contactLine ? '<br>' : '') + escapeHTML(addrLine) : '') + '</p>' +

        '<div class="field-inline" style="margin-bottom:1.1rem;">' +
          '<label>Stage<br><select id="ctStage" onchange="ADMIN.updateContactField(\'' + esc + '\',\'stage\',this.value)">' + stageOpts + '</select></label>' +
          '<label>Source<br><select id="ctSource" onchange="ADMIN.updateContactField(\'' + esc + '\',\'source\',this.value)"><option value="">—</option>' + sourceOpts + '</select></label>' +
          '<label>Next follow-up<br><input type="date" id="ctFollowup" value="' + escapeHTML(f.next_follow_up_date || '') + '" onchange="ADMIN.updateContactField(\'' + esc + '\',\'next_follow_up_date\',this.value)"></label>' +
        '</div>' +

        '<div class="subpanel">' +
          '<h3>Log an interaction</h3>' +
          '<div class="field-inline" style="margin-bottom:.6rem;">' +
            '<select id="logType">' + typeOpts + '</select>' +
            '<select id="logDirection"><option value="Outbound">Outbound</option><option value="Inbound">Inbound</option></select>' +
          '</div>' +
          '<textarea id="logSummary" placeholder="What was said / done" style="width:100%;margin-bottom:.5rem;"></textarea>' +
          '<input id="logNextAction" placeholder="Next action (optional)" style="width:100%;margin-bottom:.5rem;">' +
          '<label class="field-label" style="font-weight:400;">Set next follow-up (optional) <input type="date" id="logFollowup"></label>' +
          '<div style="margin-top:.6rem;"><button class="btn btn-sm btn-primary" onclick="ADMIN.saveInteraction(\'' + esc + '\')">Save interaction</button> ' +
          '<span id="logStatus" class="inline-status"></span></div>' +
        '</div>' +

        '<h3>Timeline</h3>' +
        '<div>' + timelineHTML + '</div>';

      this.openModal();
    },

    updateContactField: function (id, field, value) {
      var self = this;
      var patch = {}; patch[field] = value;
      apiSend('PATCH', '/contact/' + encodeURIComponent(id), patch).then(function () {
        var rec = self._contactById(id);
        if (rec) fields(rec)[field] = value;
        self.renderContacts();
        self.renderDashboard();
      }).catch(function (err) {
        alert('Could not save: ' + err.message);
      });
    },

    saveInteraction: function (contactId) {
      var self = this;
      var summary = ((document.getElementById('logSummary') || {}).value || '').trim();
      var statusEl = document.getElementById('logStatus');
      if (!summary) { if (statusEl) { statusEl.className = 'inline-status err'; statusEl.textContent = 'Add a quick summary first.'; } return; }
      if (statusEl) { statusEl.className = 'inline-status'; statusEl.textContent = 'Saving…'; }

      var body = {
        contact: contactId,
        type: (document.getElementById('logType') || {}).value || 'Note',
        direction: (document.getElementById('logDirection') || {}).value || 'Outbound',
        summary: summary,
        next_action: ((document.getElementById('logNextAction') || {}).value || '').trim(),
        logged_by: OWNER,
        date: new Date().toISOString()
      };
      var followup = (document.getElementById('logFollowup') || {}).value;
      if (followup) body.next_follow_up_date = followup;

      apiSend('POST', '/interaction', body).then(function () {
        self.loadData();
        setTimeout(function () { self.openContact(contactId); }, 500);
      }).catch(function (err) {
        if (statusEl) { statusEl.className = 'inline-status err'; statusEl.textContent = 'Failed: ' + err.message; }
      });
    },

    openNewContact: function () {
      var stageOpts = CONTACT_STAGES.map(function (s) { return '<option value="' + escapeHTML(s) + '">' + escapeHTML(s) + '</option>'; }).join('');
      var sourceOpts = CONTACT_SOURCES.map(function (s) { return '<option value="' + escapeHTML(s) + '"' + (s === 'Manual' ? ' selected' : '') + '>' + escapeHTML(s) + '</option>'; }).join('');
      document.getElementById('modalBody').innerHTML =
        '<h2>New Contact</h2>' +
        '<input id="ncName" placeholder="Name (required)" class="field-block">' +
        '<input id="ncPhone" placeholder="Phone" class="field-block">' +
        '<input id="ncEmail" placeholder="Email" class="field-block">' +
        '<input id="ncCity" placeholder="City" class="field-block">' +
        '<div class="field-inline" style="margin-bottom:.6rem;">' +
          '<label>Stage<br><select id="ncStage">' + stageOpts + '</select></label>' +
          '<label>Source<br><select id="ncSource">' + sourceOpts + '</select></label>' +
          '<label>Next follow-up<br><input type="date" id="ncFollowup"></label>' +
        '</div>' +
        '<textarea id="ncNotes" placeholder="Notes (optional)" class="field-block"></textarea>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-sm btn-primary" onclick="ADMIN.saveNewContact()">Create contact</button> ' +
          '<button class="btn btn-sm btn-outline" onclick="ADMIN.closeModal()">Cancel</button> ' +
          '<span id="ncStatus" class="inline-status"></span>' +
        '</div>';
      this.openModal();
    },

    saveNewContact: function () {
      var self = this;
      var name = ((document.getElementById('ncName') || {}).value || '').trim();
      var statusEl = document.getElementById('ncStatus');
      if (!name) { if (statusEl) { statusEl.className = 'inline-status err'; statusEl.textContent = 'Name is required.'; } return; }
      if (statusEl) { statusEl.className = 'inline-status'; statusEl.textContent = 'Creating…'; }

      var body = {
        name: name,
        phone: ((document.getElementById('ncPhone') || {}).value || '').trim(),
        email: ((document.getElementById('ncEmail') || {}).value || '').trim(),
        city: ((document.getElementById('ncCity') || {}).value || '').trim(),
        stage: (document.getElementById('ncStage') || {}).value || 'New',
        source: (document.getElementById('ncSource') || {}).value || 'Manual',
        owner: OWNER,
        notes: ((document.getElementById('ncNotes') || {}).value || '').trim()
      };
      var followup = (document.getElementById('ncFollowup') || {}).value;
      if (followup) body.next_follow_up_date = followup;

      apiSend('POST', '/contact', body).then(function () {
        self.closeModal();
        self.switchTab('contacts');
        self.loadData();
      }).catch(function (err) {
        if (statusEl) { statusEl.className = 'inline-status err'; statusEl.textContent = 'Failed: ' + err.message; }
      });
    },

    // ---- Campaigns ----
    renderProviderBadge: function () {
      var badge = document.getElementById('providerBadge');
      if (!badge) return;
      var cfg = this.campaignConfig;
      if (!cfg) { badge.textContent = 'channel: unknown'; return; }
      var provider = cfg.provider || 'unknown';
      var label;
      if (provider === 'dryrun') label = 'dry-run (no emails sent)';
      else if (cfg.live === false) label = provider + ' — needs setup';
      else label = provider;
      badge.textContent = 'channel: ' + label;
      badge.title = cfg.from ? ('Sending from: ' + cfg.from) : '';
    },

    renderCampaigns: function () {
      var tbody = document.getElementById('campaignsBody');
      if (!tbody) return;
      var badge = document.getElementById('campaignsCountBadge');
      if (badge) badge.textContent = this.campaigns.length ? '(' + this.campaigns.length + ')' : '';

      if (!this.campaigns.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No campaigns yet. Click <strong>+ New Campaign</strong> to build one.</td></tr>';
        return;
      }
      var list = this.campaigns.slice().sort(function (a, b) {
        return (fields(b).sent_at || fields(b).name || '').localeCompare(fields(a).sent_at || fields(a).name || '');
      });
      tbody.innerHTML = list.map(function (rec) {
        var f = fields(rec);
        var id = recId(rec);
        var status = f.status || 'Draft';
        var stCls = { Sent: 'sent', Sending: 'sending', Failed: 'failed' }[status] || 'muted';
        var aud = f.recipient_count != null ? f.recipient_count : '—';
        var sent = f.sent_count != null ? f.sent_count : '—';
        return '<tr>' +
          '<td class="cell-strong">' + escapeHTML(f.name || '') +
            (f.subject ? '<div class="cell-sub">' + escapeHTML(f.subject) + '</div>' : '') + '</td>' +
          '<td><span class="badge badge--' + stCls + '">' + escapeHTML(status) + '</span></td>' +
          '<td>' + aud + '</td>' +
          '<td>' + sent + '</td>' +
          '<td>' + fmtDate(f.sent_at) + '</td>' +
          '<td class="table-actions"><button class="btn btn-sm btn-outline" onclick="ADMIN.openCampaign(\'' + escapeHTML(id) + '\')">Open</button></td>' +
        '</tr>';
      }).join('');
    },

    renderSuppression: function () {
      var tbody = document.getElementById('suppressionBody');
      if (!tbody) return;
      var badge = document.getElementById('suppressionCountBadge');
      if (badge) badge.textContent = this.suppression.length ? '(' + this.suppression.length + ')' : '';
      if (!this.suppression.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="table-empty">No suppressions yet.</td></tr>';
        return;
      }
      var list = this.suppression.slice().sort(function (a, b) {
        return (fields(b).added_at || '').localeCompare(fields(a).added_at || '');
      });
      tbody.innerHTML = list.map(function (rec) {
        var f = fields(rec);
        return '<tr><td>' + escapeHTML(f.email || '') + '</td><td>' + escapeHTML(f.reason || '') + '</td><td>' + fmtDate(f.added_at) + '</td></tr>';
      }).join('');
    },

    addSuppression: function () {
      var input = document.getElementById('suppEmailInput');
      var email = (input && input.value || '').trim();
      if (!email) return;
      var self = this;
      apiSend('POST', '/suppression', { email: email, reason: 'manual' }).then(function () {
        if (input) input.value = '';
        self.loadCampaignData();
      }).catch(function (err) { alert('Could not add: ' + err.message); });
    },

    _campaignById: function (id) {
      return this.campaigns.find(function (r) { return recId(r) === id; });
    },

    openNewCampaign: function () { this._renderCampaignEditor(null, {}); },

    openCampaign: function (id) {
      var rec = this._campaignById(id);
      if (!rec) return;
      this._renderCampaignEditor(id, fields(rec));
    },

    // Shared editor for new + existing campaigns. `id` is null for a new draft.
    _renderCampaignEditor: function (id, f) {
      var esc = id ? escapeHTML(id) : '';
      var sent = (f.status === 'Sent');
      var audience = {};
      try { audience = f.audience ? (typeof f.audience === 'string' ? JSON.parse(f.audience) : f.audience) : {}; } catch (e) { audience = {}; }

      function checkboxes(name, values, selected) {
        selected = selected || [];
        return values.map(function (v) {
          var on = selected.indexOf(v) !== -1;
          return '<label><input type="checkbox" data-aud="' + name + '" value="' + escapeHTML(v) + '"' + (on ? ' checked' : '') + '> ' + escapeHTML(v) + '</label>';
        }).join('');
      }

      var sentNote = sent
        ? '<div class="notice" style="color:var(--success);border-color:rgba(74,222,128,.3);background:rgba(74,222,128,.08);">Already sent ' + (f.sent_count || 0) + ' on ' + fmtDate(f.sent_at) + '. Editing here won\'t re-send; create a new campaign to send again.</div>'
        : '';

      document.getElementById('modalBody').innerHTML =
        '<h2>' + (id ? 'Campaign' : 'New Campaign') + '</h2>' +
        sentNote +
        '<label class="field-label">Campaign name (internal)</label>' +
        '<input id="cmName" placeholder="e.g. July studio update" value="' + escapeHTML(f.name || '') + '" class="field-block">' +
        '<label class="field-label">Subject line</label>' +
        '<input id="cmSubject" placeholder="Hi {{first_name}}, a quick note" value="' + escapeHTML(f.subject || '') + '" class="field-block">' +
        '<label class="field-label">Preview text (optional)</label>' +
        '<input id="cmPreview" value="' + escapeHTML(f.preview_text || '') + '" class="field-block">' +
        '<label class="field-label">Email body — plain text or HTML. Merge tags: {{first_name}} {{name}} {{city}}</label>' +
        '<textarea id="cmBody" placeholder="Hi {{first_name}},\n\n…" class="field-block" style="min-height:130px;">' + escapeHTML(f.body || '') + '</textarea>' +

        '<div class="subpanel">' +
          '<h3>Audience</h3>' +
          '<div class="callout-lead">Leave a row unchecked to include everyone on that dimension. Contacts with no email and anyone on the suppression list are always excluded.</div>' +
          '<div style="margin-bottom:.5rem;"><strong style="font-size:.78rem;">Stage</strong><div class="check-row">' + checkboxes('stages', CONTACT_STAGES, audience.stages) + '</div></div>' +
          '<div style="margin-bottom:.5rem;"><strong style="font-size:.78rem;">Source</strong><div class="check-row">' + checkboxes('sources', CONTACT_SOURCES, audience.sources) + '</div></div>' +
          '<div style="margin-bottom:.5rem;"><strong style="font-size:.78rem;">Consent</strong> <span class="muted" style="font-size:.72rem;">(use "express" for regulated sends)</span><div class="check-row">' + checkboxes('consent', CONSENT_LEVELS, audience.consent) + '</div></div>' +
          '<div><strong style="font-size:.78rem;">City contains</strong> <input id="cmCity" placeholder="Salem" value="' + escapeHTML((audience.cities || []).join(', ')) + '" style="width:180px;"></div>' +
        '</div>' +

        '<div class="modal-actions">' +
          '<button class="btn btn-sm btn-outline" onclick="ADMIN.previewCampaign()">Preview audience</button>' +
          '<button class="btn btn-sm btn-primary" onclick="ADMIN.saveCampaign(' + (id ? '\'' + esc + '\'' : 'null') + ')">Save draft</button>' +
          (sent ? '' : '<button class="btn btn-sm btn-success" onclick="ADMIN.sendCampaign(' + (id ? '\'' + esc + '\'' : 'null') + ')">Save &amp; Send</button>') +
          (id ? '<button class="btn btn-sm btn-danger" onclick="ADMIN.deleteCampaign(\'' + esc + '\')">Delete</button>' : '') +
          '<button class="btn btn-sm btn-outline" onclick="ADMIN.closeModal()">Close</button>' +
        '</div>' +
        '<div id="cmStatus" class="inline-status" style="margin-top:.6rem;"></div>' +
        '<div id="cmPreviewOut" class="preview-out"></div>';

      this.openModal();
    },

    _collectCampaign: function () {
      var audience = {};
      ['stages', 'sources', 'consent'].forEach(function (dim) {
        var vals = [];
        document.querySelectorAll('input[data-aud="' + dim + '"]:checked').forEach(function (cb) { vals.push(cb.value); });
        if (vals.length) audience[dim] = vals;
      });
      var city = ((document.getElementById('cmCity') || {}).value || '').trim();
      if (city) audience.cities = city.split(',').map(function (s) { return s.trim(); }).filter(Boolean);

      return {
        name: ((document.getElementById('cmName') || {}).value || '').trim(),
        subject: ((document.getElementById('cmSubject') || {}).value || '').trim(),
        preview_text: ((document.getElementById('cmPreview') || {}).value || '').trim(),
        body: (document.getElementById('cmBody') || {}).value || '',
        audience: audience
      };
    },

    previewCampaign: function () {
      var draft = this._collectCampaign();
      var out = document.getElementById('cmPreviewOut');
      if (out) out.innerHTML = '<span class="muted" style="font-size:.82rem;">Building audience…</span>';
      apiSend('POST', '/campaign-preview', draft.audience).then(function (res) {
        // Tolerate {recipients, count} (this contract) or {sample, audience_size} (GGC shape).
        var recipients = res.recipients || res.sample || [];
        var count = res.count != null ? res.count : (res.audience_size != null ? res.audience_size : recipients.length);
        var sampleHTML = recipients.slice(0, 8).map(function (s) {
          var name = s.name || s.first_name || '';
          var email = s.email || s.to || '';
          return '<div class="preview-card"><div class="cell-strong">' + escapeHTML(name || email) + '</div>' +
            (email && name ? '<div class="lr-meta">' + escapeHTML(email) + '</div>' : '') + '</div>';
        }).join('');
        if (out) out.innerHTML =
          '<div class="subpanel" style="margin-bottom:0;">' +
          '<strong>' + count + '</strong> contact' + (count === 1 ? '' : 's') + ' will receive this.' +
          sampleHTML + '</div>';
      }).catch(function (err) {
        if (out) out.innerHTML = '<span class="inline-status err">Preview unavailable: ' + escapeHTML(err.message) + '</span>';
      });
    },

    // Persist a draft. Resolves to the campaign id.
    saveCampaign: function (id) {
      var self = this;
      var draft = this._collectCampaign();
      var statusEl = document.getElementById('cmStatus');
      if (!draft.name) {
        if (statusEl) { statusEl.className = 'inline-status err'; statusEl.textContent = 'Give the campaign a name first.'; }
        return Promise.reject(new Error('name required'));
      }
      if (statusEl) { statusEl.className = 'inline-status'; statusEl.textContent = 'Saving…'; }
      var payload = {
        name: draft.name, subject: draft.subject, preview_text: draft.preview_text,
        body: draft.body, audience: JSON.stringify(draft.audience)
      };
      var p = id
        ? apiSend('PATCH', '/campaign/' + encodeURIComponent(id), payload).then(function () { return id; })
        : apiSend('POST', '/campaign', payload).then(function (res) { return recId(res); });
      return p.then(function (newId) {
        if (statusEl) { statusEl.className = 'inline-status ok'; statusEl.textContent = 'Saved.'; }
        self.loadCampaignData();
        return newId;
      }).catch(function (err) {
        if (statusEl) { statusEl.className = 'inline-status err'; statusEl.textContent = 'Save failed: ' + err.message; }
        throw err;
      });
    },

    // Save latest edits, then send through the active channel.
    sendCampaign: function (id) {
      var self = this;
      var cfg = this.campaignConfig || {};
      var draft = this._collectCampaign();
      if (!draft.subject || !draft.body) { alert('Add a subject and body before sending.'); return; }
      var channelMsg = cfg.provider === 'dryrun'
        ? 'Channel is DRY-RUN — this builds the audience but sends no real emails.'
        : 'This will SEND real emails via ' + (cfg.provider || 'the configured channel') + '.';
      if (!confirm(channelMsg + '\n\nContinue?')) return;
      var statusEl = document.getElementById('cmStatus');

      this.saveCampaign(id).then(function (campId) {
        if (statusEl) { statusEl.className = 'inline-status'; statusEl.textContent = 'Sending…'; }
        return apiSend('POST', '/campaign-send/' + encodeURIComponent(campId), {});
      }).then(function (res) {
        var count = res.sent_count != null ? res.sent_count : (res.sent != null ? res.sent : 0);
        if (statusEl) {
          statusEl.className = 'inline-status ok';
          statusEl.textContent = (cfg.provider === 'dryrun')
            ? 'Dry run complete — ' + count + ' would receive it. No emails sent.'
            : 'Sent to ' + count + ' recipient' + (count === 1 ? '' : 's') + '.';
        }
        self.loadCampaignData();
      }).catch(function (err) {
        if (statusEl) { statusEl.className = 'inline-status err'; statusEl.textContent = 'Send failed: ' + err.message; }
      });
    },

    deleteCampaign: function (id) {
      if (!confirm('Delete this campaign? This cannot be undone.')) return;
      var self = this;
      apiSend('DELETE', '/campaign/' + encodeURIComponent(id), null).then(function () {
        self.closeModal();
        self.loadCampaignData();
      }).catch(function (err) { alert('Could not delete: ' + err.message); });
    },

    // ---- Modal ----
    openModal: function () { document.getElementById('crmModal').classList.add('open'); },
    closeModal: function () { document.getElementById('crmModal').classList.remove('open'); }
  };

  document.addEventListener('DOMContentLoaded', function () { ADMIN.init(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') ADMIN.closeModal(); });

  window.ADMIN = ADMIN;
})();
